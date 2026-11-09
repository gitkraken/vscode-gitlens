/**
 * Notifications service — the GitKraken notifications inbox (list, read state, settings) and its change events.
 *
 * Mirrors `SubscriptionService`: one eager listener (registered in the constructor) keeps `notificationsState`
 * fresh AND fires the RPC event, so the bridged signal stays fresh even for webviews that read without
 * subscribing (#5513). Released via `dispose()` (`disposeServices`) at webview teardown.
 *
 * Not part of the shared services; the Settings inbox and the Graph header's bell opt in. To opt a webview in:
 * 1. Add `notifications: NotificationsRpcService` to the webview's services type, and construct it in
 *    `getRpcServices()` with the provider's `WebviewHost` plus the `buffer`/`tracker` it was handed.
 * 2. On the webview side, resolve it as a {@link RemoteNotificationsService} and report `setInboxVisible(true/false)`
 *    as the inbox opens and closes.
 *
 * The service owns the rest of the visibility lifecycle: it clears this webview's visibility when the webview hides,
 * when a (re)loaded page connects (it reports again if it shows the inbox) and on teardown, so the provider needs no
 * hooks and a page that goes away without saying so can't hold security/system toasts window-wide.
 */

import type { Remote } from '@eamodio/supertalk';
import { Signal } from 'signal-polyfill';
import type { Event } from 'vscode';
import { Disposable, l10n } from 'vscode';
import { NotificationsApiError } from '@gitlens/notifications/errors.js';
import type { NotificationSettings } from '@gitlens/notifications/models.js';
import type { NotificationsService as GkNotificationsService } from '@gitlens/notifications/notificationsService.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	AuthenticationRequiredError,
	classifyNetworkError,
	RequestRateLimitError,
	RequestsAreBlockedTemporarilyError,
} from '../../../errors.js';
import type { NotificationsController } from '../../../plus/notifications/notificationsController.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createRpcEvent } from '../eventVisibilityBuffer.js';
import type { NotificationsInboxState, RpcEventSubscription } from './types.js';

/** The webview host signals {@link NotificationsRpcService} resets the inbox visibility on (a `WebviewHost` fits) */
export interface NotificationsServiceHost {
	/** Fired when the containing editor/view/tab's visibility changes */
	readonly onDidChangeVisibility: Event<boolean>;
	/** Fired when a (re)loaded page completes its connect handshake */
	readonly onDidConnect: Event<void>;
}

/** The notifications service as webview code sees it, once resolved from its webview's remote services */
export type RemoteNotificationsService = Awaited<Remote<{ notifications: NotificationsRpcService }>['notifications']>;

export class NotificationsRpcService implements Disposable {
	readonly #controller: NotificationsController;
	readonly #disposable: Disposable;

	/** The inbox state; initialized synchronously from the host and kept fresh by the eager listener. */
	readonly notificationsState: Signal.State<NotificationsInboxState>;

	/** Fired with the new inbox state on every change (including the feature turning on or off). */
	readonly onNotificationsChanged: RpcEventSubscription<NotificationsInboxState>;

	constructor(
		container: Container,
		host: NotificationsServiceHost,
		buffer: EventVisibilityBuffer | undefined,
		tracker?: SubscriptionTracker,
	) {
		this.#controller = container.notifications;

		this.notificationsState = new Signal.State<NotificationsInboxState>(this.#readState());

		const notificationsChanged = createRpcEvent<NotificationsInboxState>('notificationsChanged', 'save-last');
		this.onNotificationsChanged = notificationsChanged.subscribe(buffer, tracker);

		// Outlives `tracker.reset()` (RPC reconnection) by design; released by `dispose()` at teardown
		this.#disposable = Disposable.from(
			this.#controller.onDidChange(() => {
				const state = this.#readState();
				this.notificationsState.set(state);
				notificationsChanged.fire(state);
			}),
			// A hidden webview can't be showing the inbox, so let toasts through again
			host.onDidChangeVisibility(visible => {
				if (!visible) {
					this.#controller.setInboxVisible(this, false);
				}
			}),
			// A (re)loaded page starts over: whatever the previous page reported is stale (it may have unloaded without
			// saying so, e.g. reloaded with the inbox open). The new page reports again once it shows the inbox, and its
			// calls only reach the service after its connect handshake completes
			host.onDidConnect(() => this.#controller.setInboxVisible(this, false)),
		);
	}

	dispose(): void {
		// A torn-down webview can't be showing the inbox anymore, so let toasts through again
		this.#controller.setInboxVisible(this, false);
		this.#disposable.dispose();
	}

	/** Re-fetches the loaded pages (up to 5). Never rejects: a failed refresh keeps the cached list with `status: 'error'`. */
	refresh(): Promise<void> {
		return this.#controller.refresh();
	}

	/** Loads the next page; rejects (with a presentable message) on failure, leaving the list as it was. */
	loadMore(): Promise<void> {
		return this.#run(s => s.loadMore());
	}

	/** Optimistic; rolls back and rejects (with a presentable message) on failure. */
	markRead(ids: string[]): Promise<void> {
		return this.#run(s => s.markRead(ids));
	}

	/** Optimistic; rolls back and rejects (with a presentable message) on failure. */
	markUnread(ids: string[]): Promise<void> {
		return this.#run(s => s.markUnread(ids));
	}

	/** Optimistic; rolls back and rejects (with a presentable message) on failure. */
	delete(ids: string[]): Promise<void> {
		return this.#run(s => s.delete(ids));
	}

	/** Marks every loaded unread notification read. Optimistic, like {@link markRead}. */
	markAllRead(): Promise<void> {
		return this.#run(s => s.markAllRead());
	}

	/** Deletes every loaded read notification. Optimistic, like {@link delete}. */
	deleteAllRead(): Promise<void> {
		return this.#run(s => s.deleteAllRead());
	}

	/** Fetches the user's notification settings (also published through `notificationsState.settings`). */
	getSettings(): Promise<NotificationSettings> {
		return this.#run(s => s.getSettings());
	}

	/** Optimistic; restores the previous settings and rejects (with a presentable message) on failure. */
	updateSettings(changes: Partial<NotificationSettings>): Promise<NotificationSettings> {
		return this.#run(s => s.updateSettings(changes));
	}

	/** Opens the notification's call-to-action link externally (`https:` only) and marks the notification read. */
	openCta(id: string): Promise<void> {
		return this.#run(() => this.#controller.openCta(id));
	}

	/**
	 * The inbox applied `focusNotificationId` (scrolled to and focused the notification), so drop the request.
	 * Settings-only, like the field: other surfaces must not call it, or they'd drop the Settings inbox's request.
	 */
	consumeFocus(id: string): Promise<void> {
		this.#controller.consumeFocus(id);
		return Promise.resolve();
	}

	/**
	 * Tell the host whether this webview is showing the inbox; security/system toasts are held while it is. The service
	 * clears it itself when the webview hides, reloads or is torn down.
	 */
	setInboxVisible(visible: boolean): Promise<void> {
		this.#controller.setInboxVisible(this, visible);
		return Promise.resolve();
	}

	#readState(): NotificationsInboxState {
		const state = this.#controller.service?.getState();
		return {
			access: !this.#controller.available ? 'unavailable' : state == null ? 'signedOut' : 'signedIn',
			inboxId: state != null ? this.#controller.inboxId : undefined,
			status: state?.status ?? 'idle',
			items: state != null ? [...state.items] : [],
			hasMore: state?.hasMore ?? false,
			unreadCount: state?.unreadCount ?? 0,
			settings: state?.settings,
			lastSyncedAt: state?.lastSyncedAt,
			focusNotificationId: state != null ? this.#controller.focusNotificationId : undefined,
		};
	}

	/** Runs `action` against the current service, rejecting with a plain, presentable error (it crosses RPC). */
	async #run<T>(action: (service: GkNotificationsService) => Promise<T>): Promise<T> {
		const service = this.#controller.service;
		if (service == null) throw new Error(l10n.t('Notifications are not available'));

		try {
			return await action(service);
		} catch (ex) {
			Logger.error(ex, 'Notifications: request failed');
			throw new Error(getNotificationsErrorMessage(ex), { cause: ex });
		}
	}
}

/**
 * The message shown to the user for a failed notifications request. The errors' own messages are for logs (status,
 * operation, raw fetch text), not for display, so each known cause maps to a localized one.
 */
function getNotificationsErrorMessage(ex: unknown): string {
	if (NotificationsApiError.is(ex)) {
		// The connection hands back 4xx responses rather than throwing, so the status is the only signal here
		switch (ex.status) {
			case 401:
				return l10n.t('Your GitKraken session has expired. Please sign in again.');
			case 429:
				return l10n.t('Too many requests to GitKraken. Please try again in a few minutes.');
			case 503:
				return l10n.t('GitKraken is temporarily unavailable. Please try again in a few minutes.');
			default:
				return l10n.t("GitKraken couldn't complete the request. Please try again.");
		}
	}
	// No session to authenticate the request with
	if (ex instanceof AuthenticationRequiredError) {
		return l10n.t('Your GitKraken session has expired. Please sign in again.');
	}
	if (ex instanceof RequestsAreBlockedTemporarilyError) {
		return l10n.t('GitKraken is temporarily unavailable. Please try again in a few minutes.');
	}
	if (RequestRateLimitError.is(ex)) {
		return l10n.t('Too many requests to GitKraken. Please try again in a few minutes.');
	}
	if (ex instanceof AuthenticationError) {
		// A 403 that isn't a rate limit is a refusal, not an expired session
		return ex.reason === AuthenticationErrorReason.Unauthorized
			? l10n.t('Your GitKraken session has expired. Please sign in again.')
			: l10n.t("GitKraken couldn't complete the request. Please try again.");
	}
	if (
		classifyNetworkError(ex) != null ||
		// The browser's fetch fails with a bare `TypeError: Failed to fetch` (no code or cause to classify)
		(ex instanceof TypeError && ex.message === 'Failed to fetch') ||
		// Nothing here can be cancelled by the user: a cancellation is the connection's request timeout
		isCancellationError(ex)
	) {
		return l10n.t("Couldn't reach GitKraken. Check your connection and try again.");
	}
	return l10n.t('Something went wrong. Please try again.');
}
