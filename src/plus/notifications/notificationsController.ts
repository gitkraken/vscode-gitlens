import type { Event, MessageItem, WindowState } from 'vscode';
import { Disposable, EventEmitter, l10n, window } from 'vscode';
import type { NotificationsContext } from '@gitlens/notifications/context.js';
import type { GkNotification } from '@gitlens/notifications/models.js';
import { NotificationsService } from '@gitlens/notifications/notificationsService.js';
import { isSafeExternalUrl } from '@gitlens/notifications/presentation.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { StoredNotificationsCacheEntry } from '../../constants.storage.js';
import type { Container } from '../../container.js';
import { FeatureFlagKey } from '../../featureFlags/featureFlagService.js';
import { showMessage } from '../../messages.js';
import { executeCommand } from '../../system/-webview/command.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import type { Subscription } from '../gk/models/subscription.js';
import type { ServerConnection } from '../gk/serverConnection.js';
import type { SubscriptionChangeEvent } from '../gk/subscriptionService.js';
import { createNotificationsContext } from './context.js';

const pollInterval = 30 * 60 * 1000; // 30 minutes
const refreshOnFocusAfter = 5 * 60 * 1000; // 5 minutes
const startupDelay = 5 * 1000; // Give VS Code time to settle before the first request
const focusRequestLifetime = 60 * 1000; // 1 minute
const toastedRetention = 30 * 24 * 60 * 60 * 1000; // 30 days
/** How many accounts keep a cached snapshot; the least recently written are evicted */
const maxCachedIdentities = 5;

/**
 * Owns the GitKraken notifications for this window: creates the {@link NotificationsService} while the feature flag
 * is on and the user has an account, polls it (only while the window is focused), caches it in `globalState`, and
 * toasts new security/system notices. Webviews reach it through the notifications RPC service.
 */
export class NotificationsController implements Disposable {
	private readonly _onDidChange = new EventEmitter<void>();
	/** Fires when the service is created or disposed, and on every change to its state */
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private readonly _disposable: Disposable;
	private readonly _persist: Deferrable<() => void>;
	/** The webviews currently showing the inbox; no toasts while there is any */
	private readonly _visibleInboxes = new Set<object>();

	private _service: NotificationsService | undefined;
	private _serviceDisposable: Disposable | undefined;
	/**
	 * The account the service is for; `undefined` while disabled. Not the organization: the service lists a user's
	 * notifications whatever organization is active, so an organization switch keeps the same inbox
	 */
	private _identity: string | undefined;
	/** Bumped each time a service is created; see {@link inboxId} */
	private _inboxId = 0;
	/** The serialized snapshot last written for the current service, so an unchanged one isn't rewritten */
	private _persistedSnapshot: string | undefined;
	/** Whether the feature flag is on (regardless of account) */
	private _available = false;
	/** The in-flight refresh, with the service it belongs to (an account switch replaces the service) */
	private _refreshing: { service: NotificationsService; promise: Promise<void> } | undefined;
	/** When the last refresh failed, so regaining focus doesn't retry a down service every time */
	private _lastFailedAt: number | undefined;
	/** The notification a toast's View asked the inbox to focus, until the inbox applies it */
	private _focusNotificationId: string | undefined;
	/** When the focus request was made; one the inbox never picked up goes stale (see {@link focusRequestLifetime}) */
	private _focusRequestedAt = 0;
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _disposed = false;
	/** DEBUG only: the simulator's fake GK API; see {@link setSimulation} */
	private _simulatedFetchGkApi: NotificationsContext['fetchGkApi'] | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {
		this._persist = debounce(() => this.persist(), 1000);
		this._disposable = Disposable.from(
			this._onDidChange,
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			container.subscription.onDidChange(this.onSubscriptionChanged, this),
		);

		void this.evaluate();
		// Flags are read from the cached map until this activation's fetch lands (there is no change event)
		void container.featureFlags.whenReady.then(() => this.evaluate());

		if (DEBUG) {
			void import(/* webpackChunkName: "__debug__" */ './__debug__notificationsSimulator.js').then(m =>
				m.registerNotificationsSimulator(this.container),
			);
		}
	}

	dispose(): void {
		this._disposed = true;
		this._persist.flush();
		this.stop();
		this._disposable.dispose();
	}

	/** Whether the feature flag is on; the inbox shows (with a sign-in prompt when signed out) only when it is */
	get available(): boolean {
		return this._available;
	}

	get enabled(): boolean {
		return this._service != null;
	}

	/** `undefined` while notifications are disabled (flag off or no account) */
	get service(): NotificationsService | undefined {
		return this._service;
	}

	/**
	 * Identifies the current service: it changes whenever a new one is created (sign-in or an account switch), so a
	 * surface can drop UI state that belonged to the previous one. Only meaningful while {@link enabled}
	 */
	get inboxId(): number {
		return this._inboxId;
	}

	/** The notification the inbox should scroll to and focus (from a toast's View); see {@link consumeFocus} */
	get focusNotificationId(): string | undefined {
		// The inbox never showed (e.g. closed while loading): don't jump to the card days later
		if (this._focusNotificationId != null && Date.now() - this._focusRequestedAt > focusRequestLifetime) {
			this._focusNotificationId = undefined;
		}
		return this._focusNotificationId;
	}

	/** The inbox applied the focus request for `id`, so drop it (a newer request for another id is kept) */
	consumeFocus(id: string): void {
		if (this._focusNotificationId !== id) return;

		this._focusNotificationId = undefined;
		this._onDidChange.fire();
	}

	/** Manual refresh; toasts follow the same policy as polling (and never show while the inbox is visible) */
	refresh(): Promise<void> {
		const service = this._service;
		if (service == null) return Promise.resolve();

		// Only share an in-flight refresh of the current service; one for a replaced service doesn't fetch this one
		if (this._refreshing?.service !== service) {
			const refreshing = {
				service: service,
				promise: this.refreshCore(service).finally(() => {
					if (this._refreshing === refreshing) {
						this._refreshing = undefined;
					}
				}),
			};
			this._refreshing = refreshing;
		}
		return this._refreshing.promise;
	}

	/**
	 * DEBUG only (the notifications simulator): while `fetchGkApi` is set, the feature is available even if the flag
	 * turned it off, and the service talks to it instead of the GK API, with no cache read or written. Setting or clearing
	 * it always recreates the service (so a fresh start has no toast baseline: its first load doesn't toast), then
	 * refreshes. An account is still required.
	 */
	async setSimulation(fetchGkApi: NotificationsContext['fetchGkApi'] | undefined): Promise<void> {
		this._simulatedFetchGkApi = fetchGkApi;
		this.stop();
		await this.evaluate();
		await this.refresh();
	}

	/** Tracks whether `owner` (a webview's RPC service) is showing the inbox */
	setInboxVisible(owner: object, visible: boolean): void {
		if (visible) {
			this._visibleInboxes.add(owner);
		} else {
			this._visibleInboxes.delete(owner);
		}
	}

	/** Opens the notification's call-to-action link externally (only if it is a safe `https:` URL) and marks it read */
	async openCta(id: string): Promise<void> {
		const service = this._service;
		const notification = service?.getState().items.find(n => n.id === id);
		if (service == null || notification?.cta == null || !isSafeExternalUrl(notification.cta.url)) {
			Logger.warn(`Notifications: no safe call-to-action to open for ${id}`);
			return;
		}

		await openUrl(notification.cta.url);
		if (notification.readAt == null) {
			await service.markRead([id]);
		}
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent): void {
		this.apply(e.current);
	}

	private onWindowStateChanged(e: WindowState): void {
		if (this._service == null) return;

		if (!e.focused) {
			this.clearTimer();
			return;
		}

		// Measured from the last attempt, successful or not, so a down service isn't hit on every focus change
		const lastAttemptAt = Math.max(this._service.getState().lastSyncedAt ?? 0, this._lastFailedAt ?? 0);
		const elapsed = lastAttemptAt > 0 ? Date.now() - lastAttemptAt : Infinity;
		this.schedule(elapsed >= refreshOnFocusAfter ? 0 : pollInterval - elapsed);
	}

	private async evaluate(): Promise<void> {
		const subscription = await this.container.subscription.getSubscription(true);
		this.apply(subscription);
	}

	private apply(subscription: Subscription): void {
		if (this._disposed) return;

		// On by default: the flag is a remote kill switch, so a missing flag (or no ConfigCat config) leaves it on
		const available =
			this._simulatedFetchGkApi != null ||
			this.container.featureFlags.getFlag(FeatureFlagKey.Notifications, true);
		const availableChanged = available !== this._available;
		this._available = available;

		const account = subscription.account;
		const identity = account != null && available ? account.id : undefined;
		if (identity === this._identity) {
			// e.g. the flag turned on while signed out: no service, but the inbox (its sign-in prompt) can show now
			if (availableChanged) {
				this._onDidChange.fire();
			}
			return;
		}

		const starting = this._identity == null;
		this.stop();
		this._identity = identity;

		if (identity == null) {
			// Signed out (or the flag went off): don't leave any account's cached notifications behind
			void this.container.storage.delete('notifications:cache');
			this._onDidChange.fire();
			return;
		}

		const service = new NotificationsService(
			createNotificationsContext(this.connection, this._simulatedFetchGkApi),
		);
		this._service = service;
		this._inboxId++;
		this._serviceDisposable = Disposable.from(
			service,
			service.onDidChange(() => {
				this._persist();
				this._onDidChange.fire();
			}),
		);

		const cached =
			this._simulatedFetchGkApi == null
				? this.container.storage.get('notifications:cache')?.[identity]
				: undefined;
		if (isCacheEntry(cached)) {
			service.restore(cached.snapshot);
			// Restoring changes nothing worth writing back
			this._persistedSnapshot = JSON.stringify(service.toSnapshot());
		}

		this._onDidChange.fire();
		// Wait for VS Code to settle when starting (activation or sign-in); an account switch refreshes now
		this.schedule(starting ? startupDelay : 0);
	}

	private stop(): void {
		this.clearTimer();
		this._persist.cancel();
		this._serviceDisposable?.dispose();
		this._serviceDisposable = undefined;
		this._service = undefined;
		this._identity = undefined;
		this._persistedSnapshot = undefined;
		this._lastFailedAt = undefined;
		this._focusNotificationId = undefined;
	}

	/** Refreshes after `delay`, then every {@link pollInterval}, but only while the window is focused */
	private schedule(delay: number): void {
		this.clearTimer();
		const service = this._service;
		if (service == null || !window.state.focused) return;

		this._timer = setTimeout(
			() => {
				this._timer = undefined;
				void this.refresh().finally(() => {
					// Unless something rescheduled meanwhile, or the service was replaced (which scheduled its own)
					if (this._timer == null && this._service === service) {
						this.schedule(pollInterval);
					}
				});
			},
			Math.max(delay, 0),
		);
	}

	private clearTimer(): void {
		if (this._timer != null) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
	}

	private async refreshCore(service: NotificationsService): Promise<void> {
		// The service decides what newly arrived (including no backfill on a first sync); this controller is its only
		// caller, so the list is ours to act on
		const arrived = await service.refresh();
		// Disposed, signed out, or switched account while the request was in flight
		if (service !== this._service) return;

		// `refresh()` never throws; a failed one keeps the cache and its `lastSyncedAt`
		if (service.getState().status !== 'ready') {
			this._lastFailedAt = Date.now();
			return;
		}

		await this.notify(service, arrived);
	}

	/** Records `candidates` as toasted (across windows), then toasts them unless the inbox is already showing */
	private async notify(service: NotificationsService, candidates: GkNotification[]): Promise<void> {
		if (!candidates.length) return;

		// Re-read right before toasting: other windows record what they toasted in the same (shared) key
		const previouslyToasted = this.container.storage.get('notifications:toasted') ?? {};
		const notifications = candidates.filter(n => previouslyToasted[n.id] == null);
		if (!notifications.length) return;

		const now = Date.now();
		const toasted = Object.fromEntries([
			...Object.entries(previouslyToasted).filter(([, toastedAt]) => now - toastedAt <= toastedRetention),
			...notifications.map(n => [n.id, now] as const),
		]);
		// Record before showing, so no other window toasts these too. Also when an open inbox holds the toast: the
		// user is looking at them already
		try {
			await this.container.storage.store('notifications:toasted', toasted);
		} catch (ex) {
			// Without the record another window could toast these too, so skip rather than risk a duplicate
			Logger.error(ex, 'Unable to record toasted notifications');
			return;
		}
		// Signed out or switched account while recording: these belong to someone else now
		if (service !== this._service || this._visibleInboxes.size) return;

		this.showToast(notifications);
	}

	/** `notifications` are newest first */
	private showToast(notifications: GkNotification[]): void {
		// Only a lone notice has text of its own to show: its title, else the server's plain-text summary
		const text =
			notifications.length === 1 ? (notifications[0].headline ?? notifications[0].summary)?.trim() : undefined;
		const message = text
			? l10n.t('GitLens: {0}', neutralizeMessageLinks(text))
			: formatPlural(
					l10n.t(
						'{count, plural, one{GitLens: {count} new important notice} other{GitLens: {count} new important notices}}',
					),
					{ count: notifications.length },
				);

		const view: MessageItem = { title: l10n.t('View') };
		const dismiss: MessageItem = { title: l10n.t('Dismiss'), isCloseAffordance: true };
		// Not awaited: it settles only when the user acts on it, and the refresh (shared by polling, focus and the
		// inbox) must not wait on that
		void showMessage('warn', message, undefined, null, view, dismiss).then(result => {
			if (result !== view) return;

			// Focus the notice (the newest, when several were combined) once the inbox shows
			this._focusNotificationId = notifications[0].id;
			this._focusRequestedAt = Date.now();
			this._onDidChange.fire();
			void executeCommand('gitlens.showSettingsPage!notifications');
		});
	}

	private persist(): void {
		const service = this._service;
		const identity = this._identity;
		// Simulated notifications must not replace the account's real cache
		if (service == null || identity == null || this._simulatedFetchGkApi != null) return;

		// The service fires on every change, including status flips on each poll: only write when the content changed
		const snapshot = service.toSnapshot();
		const serialized = JSON.stringify(snapshot);
		if (serialized === this._persistedSnapshot) return;

		this._persistedSnapshot = serialized;

		// Re-read right before writing: windows on other accounts/orgs keep their entries in the same (shared) key
		const others = Object.entries(this.container.storage.get('notifications:cache') ?? {})
			.filter(([key, entry]) => key !== identity && isCacheEntry(entry))
			.sort(([, a], [, b]) => b.writtenAt - a.writtenAt)
			.slice(0, maxCachedIdentities - 1);
		const entries: [string, StoredNotificationsCacheEntry][] = [
			[identity, { snapshot: snapshot, writtenAt: Date.now() }],
			...others,
		];
		void this.container.storage.store('notifications:cache', Object.fromEntries(entries));
	}
}

/** Storage is untyped at runtime (e.g. a pre-release single-entry cache shape), so keep only well-formed entries */
function isCacheEntry(entry: unknown): entry is StoredNotificationsCacheEntry {
	if (entry == null || typeof entry !== 'object') return false;

	const { snapshot, writtenAt } = entry as Partial<StoredNotificationsCacheEntry>;
	return typeof writtenAt === 'number' && snapshot != null && typeof snapshot === 'object';
}

/**
 * VS Code renders `[text](target)` in notification messages as a link — including `command:` targets — so break
 * that syntax in server-supplied text rather than let it become clickable
 */
function neutralizeMessageLinks(text: string): string {
	return text.replace(/\]\s*\(/g, '] (');
}
