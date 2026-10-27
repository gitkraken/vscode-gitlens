import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import { focusOutline, focusOutlineButton, srOnly } from '@gitlens/components/components/styles/lit/a11y.css.js';
import { boxSizingBase, linkBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { GkNotification } from '@gitlens/notifications/models.js';
import { getDisplayBody } from '@gitlens/notifications/presentation.js';
import { fromNow } from '@gitlens/utils/date.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { Source } from '../../../../constants.telemetry.js';
import { isSubscriptionPaid } from '../../../../plus/gk/utils/subscription.utils.js';
import { createCommandLink } from '../../../../system/commands.js';
import type { NotificationsInboxState } from '../../../rpc/services/types.js';
import {
	formatProjectSharedBody,
	getCategoryChipBadge,
	getNeedsNewerVersionText,
	getNotificationBodyText,
	getNotificationHeaderText,
	getNotificationHeadline,
	getNotificationSender,
	syncTruncationTooltips,
} from '../../plus/shared/notifications.utils.js';
import type { GlButton } from '../../shared/components/button.js';
import type { GlSegmentedControl } from '../../shared/components/segmented/segmented.js';
import type { SubscriptionContextState } from '../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../shared/contexts/subscription.js';
import type { SettingsActions } from '../actions.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import '../../shared/components/badges/badge.js';
import '../../shared/components/button.js';
import '../../shared/components/checkbox/checkbox.js';
import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/tooltip.js';
import '../../shared/components/formatted-date.js';
import '../../shared/components/markdown/markdown.js';
import '../../shared/components/segmented/segmented.js';
import '../../shared/components/skeleton-loader.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-settings-notifications']: GlSettingsNotifications;
	}
}

type InboxFilter = 'all' | 'unread' | 'read';

/** An action that failed (the host already rolled its effect back), shown with a Retry. */
interface FailedAction {
	/** What failed, led with in bold (e.g. "Couldn’t mark as read.") */
	title: string;
	/** Why it failed */
	message: string;
	retry: () => Promise<void>;
}

/** Opening the inbox refreshes it when the last sync is older than this (the host polls every 30 minutes). */
const refreshOnShowAfter = 5 * 60 * 1000; // 5 minutes

/**
 * The GitKraken notifications inbox — the Notifications category's panel.
 *
 * State is the host's inbox (`state.notifications`, pushed by the notifications RPC service); every action
 * goes through `SettingsActions`, which the host applies optimistically and rolls back on failure. While the
 * panel is on screen it tells the host so, which holds security/system toasts.
 */
@customElement('gl-settings-notifications')
export class GlSettingsNotifications extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		srOnly,
		css`
			:host {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-12);

				--notification-unread-color: var(
					--vscode-notificationsInfoIcon-foreground,
					var(--vscode-textLink-foreground)
				);
				--notification-border: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
			}

			.toolbar {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-8);
				align-items: center;
				justify-content: space-between;
			}

			.toolbar__actions {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.confirm {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-6);
				align-items: center;
				font-size: var(--gl-font-md);
			}

			.banner {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-8) var(--gl-space-12);
				font-size: var(--gl-font-md);
				line-height: 1.5;
				color: var(--color-foreground--85);
				border-radius: var(--gl-radius-md);
			}

			.banner span {
				flex: 1;
			}

			.banner--warning {
				background-color: color-mix(in srgb, var(--color-alert-warningBackground) 60%, transparent);
				border: var(--gl-border-width) solid
					color-mix(in srgb, var(--color-alert-warningBorder) 70%, transparent);
			}

			.banner--error {
				background-color: color-mix(in srgb, var(--color-alert-errorBackground) 60%, transparent);
				border: var(--gl-border-width) solid color-mix(in srgb, var(--color-alert-errorBorder) 70%, transparent);
			}

			.list {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				padding: 0;
				margin: 0;
				list-style: none;
			}

			.card {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				padding: var(--gl-space-10) var(--gl-space-12);
				border: var(--notification-border);
				border-radius: var(--gl-radius-md);
			}

			/* Focused programmatically (a toast's View); it's not in the tab order */
			.card--focus-requested:focus {
				${focusOutline}
			}

			.card__header {
				display: flex;
				gap: var(--gl-space-8);
				align-items: flex-start;
			}

			.card__dot {
				flex: none;
				width: 0.8rem;
				height: 0.8rem;
				margin-block-start: 0.5rem;
				background-color: var(--notification-unread-color);
				border: var(--gl-border-width) solid var(--notification-unread-color);
				border-radius: var(--gl-radius-circle);
			}

			.card__headline {
				display: -webkit-box;
				flex: 1;
				min-width: 0;
				margin: 0;
				overflow: hidden;
				-webkit-line-clamp: 2;
				line-clamp: 2;
				font-size: var(--gl-font-base);
				font-weight: var(--gl-font-weight-semibold);
				line-height: 1.4;
				color: var(--color-foreground);
				-webkit-box-orient: vertical;
			}

			/* The sender, standing in for a headline the notification doesn't have; deliberately not a heading */
			.card__byline {
				flex: 1;
				min-width: 0;
				font-size: var(--gl-font-base);
				font-weight: var(--gl-font-weight-regular);
				line-height: 1.4;
				color: var(--color-foreground--75);
			}

			.card__meta {
				display: flex;
				flex: none;
				gap: var(--gl-space-8);
				align-items: center;
				font-size: var(--gl-font-sm);
				line-height: 1.8rem;
				color: var(--color-foreground--65);
			}

			.card__body {
				padding-inline-start: var(--gl-space-16);
				font-size: var(--gl-font-md);
				line-height: 1.5;
				color: var(--color-foreground--85);
				overflow-wrap: anywhere;
			}

			.card__body > p {
				margin: 0;
			}

			.card__note {
				margin: var(--gl-space-4) 0 0;
				font-style: italic;
				color: var(--color-foreground--65);
			}

			/* The time and the actions share one cell: hovering or focusing the card swaps one for the other
			   without shifting the layout */
			/* The time sets the row height; the (taller) action buttons overlay it, so a one-line headline's header
			   isn't padded out by buttons that are hidden most of the time */
			.card__when {
				position: relative;
				display: block;
				min-inline-size: 5.6rem;
				text-align: end;
			}

			.card__when > * {
				transition: opacity var(--gl-duration-fast) var(--gl-ease-out);
			}

			.card__actions {
				position: absolute;
				inset-block-start: 50%;
				inset-inline-end: 0;
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
				opacity: 0;
				transform: translateY(-50%);
			}

			/* Always in the tab order (opacity only); they show on hover or keyboard focus */
			.card:hover .card__actions,
			.card:focus-within .card__actions {
				opacity: 1;
			}

			.card:hover .card__time,
			.card:focus-within .card__time {
				opacity: 0;
			}

			.card__footer {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-8);
				align-items: center;
				padding-inline-start: var(--gl-space-16);
			}

			/* Hover tints the card; keyboard focus (or any focus inside) swaps the border for the focus border, which
			   high-contrast themes draw too (their hover background is transparent, so the contrast border marks hover) */
			.card:hover {
				background-color: var(--vscode-list-hoverBackground);
				border-color: var(
					--vscode-contrastActiveBorder,
					var(--vscode-widget-border, var(--color-foreground--25))
				);
			}

			.card:focus-within {
				border-color: var(--vscode-focusBorder);
			}

			.card--read .card__dot {
				background-color: transparent;
				border-color: var(--color-foreground--50);
			}

			.card--read .card__headline {
				font-weight: var(--gl-font-weight-regular);
				color: var(--color-foreground--75);
			}

			.card--read .card__body {
				color: var(--color-foreground--65);
			}

			.card__error {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				margin-inline-start: var(--gl-space-16);
				font-size: var(--gl-font-md);
				color: var(--vscode-errorForeground);
			}

			.card__error span {
				flex: 1;
			}

			.skeleton {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				padding: var(--gl-space-12);
				border: var(--notification-border);
				border-radius: var(--gl-radius-md);
			}

			.empty {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				align-items: center;
				padding: var(--gl-space-24) var(--gl-space-16);
				text-align: center;
				border: var(--gl-border-width) dashed var(--vscode-widget-border, var(--color-foreground--25));
				border-radius: var(--gl-radius-md);
			}

			.empty code-icon {
				--code-icon-size: 2.4rem;

				color: var(--color-foreground--50);
			}

			.empty__title {
				margin: 0;
				font-size: var(--gl-font-base);
				font-weight: var(--gl-font-weight-semibold);
			}

			.empty__text {
				margin: 0;
				font-size: var(--gl-font-md);
				color: var(--color-foreground--65);
			}

			.more {
				display: flex;
				justify-content: center;
			}

			.preferences {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				padding-block-start: var(--gl-space-12);
				border-top: var(--notification-border);
			}

			.preferences__title {
				margin: 0;
				font-size: var(--gl-font-md);
				font-weight: var(--gl-font-weight-semibold);
				color: var(--color-foreground--85);
			}

			.preferences__row {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
			}

			.info-button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				padding: var(--gl-space-2);
				color: var(--color-foreground--65);
				cursor: help;
				background: none;
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			.info-button:hover {
				color: var(--color-foreground);
			}

			.info-button:focus-visible {
				${focusOutlineButton}
			}

			.preferences__error {
				margin: 0;
				font-size: var(--gl-font-md);
				color: var(--vscode-errorForeground);
			}

			@media (prefers-reduced-motion: reduce) {
				.card__when > * {
					transition: none;
				}
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@property({ attribute: false })
	actions?: SettingsActions;

	@state() private _filter: InboxFilter = 'unread';
	/** Per-notification failures, keyed by id */
	@state() private _failures = new Map<string, FailedAction>();
	/** A failed list-wide action (Mark All as Read, Delete All Read, Load More) */
	@state() private _listFailure: FailedAction | undefined;
	@state() private _confirmingDeleteRead = false;
	@state() private _loadingMore = false;
	@state() private _settingsFailure: FailedAction | undefined;
	/** The text of the polite live region (see `announce`) */
	@state() private _announcement = '';

	@query('#delete-read')
	private _deleteReadButton?: GlButton;

	@query('#delete-read-cancel')
	private _deleteReadCancelButton?: GlButton;

	@query('gl-segmented-control')
	private _filterControl?: GlSegmentedControl;

	/**
	 * The host's inbox at the last update (`undefined` unless signed in), to catch it turning on or off, or being
	 * replaced (an account switch), while shown
	 */
	private _inboxId: number | undefined;
	private _settingsRequested = false;
	/** The last focus request applied, so a state update that still carries it doesn't apply it again */
	private _appliedFocusId: string | undefined;
	private _announceTimer: ReturnType<typeof setTimeout> | undefined;
	/** The card a running action holds focus in, so focus moves on the render that removes it */
	private _pendingFocusRestore: { cardId: string; index: number } | undefined;
	/** Re-checks which headlines are truncated when the panel is resized */
	private _resizeObserver: ResizeObserver | undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();
		document.addEventListener('visibilitychange', this.onDocumentVisibilityChanged);
		this._resizeObserver = new ResizeObserver(() => this.syncHeadlineTooltips());
		this._resizeObserver.observe(this);
		// A first connection is handled by the first update (see `willUpdate`); this is a re-connection
		if (this.hasUpdated) {
			this.reportShown();
		}
	}

	override disconnectedCallback(): void {
		document.removeEventListener('visibilitychange', this.onDocumentVisibilityChanged);
		clearTimeout(this._announceTimer);
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		void this.actions?.setNotificationsInboxVisible(false);
		super.disconnectedCallback?.();
	}

	override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		const inbox = this._state.notifications.get();
		const inboxId = inbox?.access === 'signedIn' ? inbox.inboxId : undefined;
		const inboxChanged = inboxId !== this._inboxId;
		this._inboxId = inboxId;

		if (inboxChanged) {
			// A new inbox (sign-in or an account switch) starts with no settings fetched, and the
			// previous one's failures don't apply to it
			this._settingsRequested = false;
			this._settingsFailure = undefined;
			this._listFailure = undefined;
			this._failures = new Map();
			this._confirmingDeleteRead = false;
		}

		if ((changedProperties.has('actions') && this.actions != null) || inboxChanged) {
			this.reportShown();
		}
	}

	override updated(): void {
		// Covers a request arriving while the inbox is already open, as well as one waiting when it first renders
		this.applyFocusRequest();
		this.applyPendingFocusRestore();
		this.syncHeadlineTooltips();
	}

	private syncHeadlineTooltips(): void {
		syncTruncationTooltips(this.renderRoot, '.card__headline');
	}

	private onDocumentVisibilityChanged = (): void => {
		this.reportShown();
	};

	/**
	 * Tells the host whether the inbox is actually on screen (signed in, connected, and the document visible), which
	 * holds toasts. Once it is: refresh a stale list, and fetch the preferences once
	 */
	private reportShown(): void {
		const actions = this.actions;
		if (actions == null) return;

		const inbox = this._state.notifications.get();
		const shown = inbox?.access === 'signedIn' && this.isConnected && document.visibilityState === 'visible';
		void actions.setNotificationsInboxVisible(shown);
		if (!shown) return;

		this.applyFocusRequest();

		if (
			inbox.status !== 'loading' &&
			(inbox.lastSyncedAt == null || Date.now() - inbox.lastSyncedAt >= refreshOnShowAfter)
		) {
			void actions.refreshNotifications();
		}

		if (inbox.settings == null && !this._settingsRequested) {
			this._settingsRequested = true;
			void this.loadSettings();
		} else if (this._settingsFailure != null) {
			void this.recheckSettings();
		}
	}

	/** Scrolls to and focuses the notification a toast's View asked for, once the inbox is on screen with it */
	private applyFocusRequest(): void {
		const inbox = this._state.notifications.get();
		const id = inbox?.focusNotificationId;
		if (
			id == null ||
			id === this._appliedFocusId ||
			inbox?.access !== 'signedIn' ||
			this.actions == null ||
			document.visibilityState !== 'visible'
		) {
			return;
		}

		this._appliedFocusId = id;
		void this.focusNotification(inbox, id);
	}

	private async focusNotification(inbox: NotificationsInboxState, id: string): Promise<void> {
		const notification = inbox.items.find(n => n.id === id);
		// Gone (e.g. deleted elsewhere) or not loaded: nothing to focus, but the request is still spent
		if (notification != null) {
			if (!matchesFilter(notification, this._filter)) {
				this._filter = 'all';
			}
			await this.updateComplete;

			const card = this.renderRoot.querySelector<HTMLElement>(`#${getNotificationDomId(id)}`);
			if (card != null) {
				card.scrollIntoView({ block: 'nearest' });
				// Outline it while it holds the focus a toast's View gave it (a click on a card shouldn't outline)
				card.classList.add('card--focus-requested');
				card.addEventListener('blur', () => card.classList.remove('card--focus-requested'), { once: true });
				card.focus({ preventScroll: true });
			}
		}

		void this.actions?.consumeNotificationFocus(id);
	}

	private async loadSettings(): Promise<void> {
		this._settingsFailure = undefined;
		const inboxId = this._inboxId;
		try {
			await this.actions?.getNotificationSettings();
		} catch (ex) {
			// Unless the inbox was replaced meanwhile (its own fetch is already underway)
			if (this._inboxId === inboxId) {
				this._settingsFailure = {
					title: l10n.t('Couldn’t load your preferences.'),
					message: getErrorMessage(ex),
					retry: () => this.loadSettings(),
				};
			}
		}
	}

	/**
	 * Re-fetches the settings while a settings failure is showing, and clears it once they load (the server
	 * recovered). A fetch that fails again leaves the failure — and its Retry of the original action — as is.
	 */
	private async recheckSettings(): Promise<void> {
		const failure = this._settingsFailure;
		try {
			await this.actions?.getNotificationSettings();
		} catch {
			return;
		}

		// Unless a newer failure (e.g. another save) replaced it while the fetch was in flight
		if (this._settingsFailure === failure) {
			this._settingsFailure = undefined;
		}
	}

	/**
	 * Runs a per-notification action, recording (or clearing) its failure on the card. If the action takes the
	 * card out of the list while focus is inside it, focus moves to a neighbor instead of falling to the page.
	 * `announceIfGone` announces when the notification turns out to be gone (the host drops one the server no
	 * longer has), for actions where removal isn't the expected outcome.
	 */
	private async runForNotification(
		id: string,
		failureTitle: string,
		action: () => Promise<void>,
		announceIfGone = false,
	): Promise<void> {
		this.setFailure(id, undefined);

		const cardId = getNotificationDomId(id);
		const active = this.shadowRoot?.activeElement;
		// The optimistic update removes the card well before the request settles, so focus moves on that render
		// (in `updated`) rather than after the round trip
		const pending =
			active?.closest('li.card')?.id === cardId
				? { cardId: cardId, index: this.getRenderedCards().findIndex(c => c.id === cardId) }
				: undefined;
		if (pending != null) {
			this._pendingFocusRestore = pending;
		}

		try {
			await action();
		} catch (ex) {
			this.setFailure(id, {
				title: failureTitle,
				message: getErrorMessage(ex),
				retry: () => this.runForNotification(id, failureTitle, action, announceIfGone),
			});
			return;
		} finally {
			await this.updateComplete;
			if (pending != null && this._pendingFocusRestore === pending) {
				// Still rendered (e.g. a failure rolled it back), or removed by this final update
				this.applyPendingFocusRestore();
				this._pendingFocusRestore = undefined;
			}
		}

		if (announceIfGone && !this._state.notifications.get()?.items.some(n => n.id === id)) {
			this.announce(l10n.t('This notification is no longer available'));
		}
	}

	private applyPendingFocusRestore(): void {
		const pending = this._pendingFocusRestore;
		if (pending == null || this.renderRoot.querySelector(`#${pending.cardId}`) != null) return;

		this._pendingFocusRestore = undefined;
		this.restoreFocusAfterRemoval(pending.index);
	}

	private getRenderedCards(): HTMLElement[] {
		return [...this.renderRoot.querySelectorAll<HTMLElement>('li.card')];
	}

	/** Once the focused card has left the list, focuses the card now at `index`, else the one before it, else the filter */
	private restoreFocusAfterRemoval(index: number): void {
		// Leave the focus alone if the user moved it elsewhere meanwhile
		if (document.activeElement != null && document.activeElement !== document.body) return;

		const cards = this.getRenderedCards();
		const next = cards[index] ?? cards[index - 1];
		if (next != null) {
			next.focus();
		} else {
			this._filterControl?.focus();
		}
	}

	/** Announces a message in the polite live region, clearing it first so repeating a message re-fires */
	private announce(message: string): void {
		clearTimeout(this._announceTimer);
		this._announcement = '';
		this._announceTimer = setTimeout(() => {
			this._announcement = message;
			this._announceTimer = setTimeout(() => (this._announcement = ''), 5000);
		}, 50);
	}

	private setFailure(id: string, failure: FailedAction | undefined): void {
		if (failure == null && !this._failures.has(id)) return;

		const failures = new Map(this._failures);
		if (failure != null) {
			failures.set(id, failure);
		} else {
			failures.delete(id);
		}
		this._failures = failures;
	}

	/** Runs a list-wide action, recording (or clearing) its failure above the list */
	private async runForList(failureTitle: string, action: () => Promise<void>): Promise<void> {
		this._listFailure = undefined;
		try {
			await action();
		} catch (ex) {
			this._listFailure = {
				title: failureTitle,
				message: getErrorMessage(ex),
				retry: () => this.runForList(failureTitle, action),
			};
		}
	}

	private async loadMore(): Promise<void> {
		if (this._loadingMore) return;

		this._loadingMore = true;
		try {
			await this.runForList(l10n.t('Couldn’t load more notifications.'), () =>
				this.actions!.loadMoreNotifications(),
			);
		} finally {
			this._loadingMore = false;
		}
	}

	private async setConfirmingDeleteRead(confirming: boolean): Promise<void> {
		this._confirmingDeleteRead = confirming;
		await this.updateComplete;
		// Keep focus on the control that replaced the one just pressed
		(confirming ? this._deleteReadCancelButton : this._deleteReadButton)?.focus();
	}

	private async confirmDeleteRead(): Promise<void> {
		await this.setConfirmingDeleteRead(false);
		await this.runForList(l10n.t('Couldn’t delete read notifications.'), () =>
			this.actions!.deleteAllReadNotifications(),
		);
		await this.updateComplete;

		// Leave the focus alone if the user moved it elsewhere while the deletion ran
		const focusLost = document.activeElement == null || document.activeElement === document.body;
		if (!focusLost && this.shadowRoot?.activeElement !== this._deleteReadButton) return;

		// With nothing read left, Delete All Read is disabled and drops the focus; hand it to the filter instead
		if (this._deleteReadButton != null && !this._deleteReadButton.disabled) {
			this._deleteReadButton.focus();
		} else {
			this._filterControl?.focus();
		}
	}

	private async setMarketingEnabled(enabled: boolean): Promise<void> {
		this._settingsFailure = undefined;
		try {
			await this.actions?.updateNotificationSettings({ marketingEnabled: enabled });
		} catch (ex) {
			// The host restored the previous value; offer to apply the change again
			this._settingsFailure = {
				title: l10n.t('Couldn’t save your preferences.'),
				message: getErrorMessage(ex),
				retry: () => this.setMarketingEnabled(enabled),
			};
		}
	}

	override render(): unknown {
		const inbox = this._state.notifications.get();
		if (inbox == null || inbox.access === 'unavailable') return nothing;

		if (inbox.access === 'signedOut') {
			// Wait for the subscription before choosing between the sign-in prompt and the service starting up
			const subscription = this._subscription.subscription.get();
			if (subscription !== undefined && !this._subscription.hasAccount.get()) {
				return this.renderSignIn();
			}
			return this.renderSkeleton();
		}

		const unread = inbox.items.filter(n => n.readAt == null);
		const readCount = inbox.items.length - unread.length;
		const filter = this._filter;
		const filtered = filter === 'unread' ? unread : inbox.items.filter(n => matchesFilter(n, filter));

		return html`${this.renderToolbar(unread.length, readCount)} ${this.renderRefreshError(inbox)}
			${this._listFailure != null ? this.renderFailure(this._listFailure, 'banner banner--error') : nothing}
			${this.renderList(inbox, filtered, readCount)}
			${
				inbox.hasMore
					? html`<div class="more">
							<gl-button
								appearance="secondary"
								?disabled=${this._loadingMore}
								@click=${() => void this.loadMore()}
								>${this._loadingMore ? l10n.t('Loading…') : l10n.t('Load More')}</gl-button
							>
						</div>`
					: nothing
			}
			${this.renderPreferences(inbox)}
			<div class="sr-only" role="status" aria-live="polite">${this._announcement}</div>`;
	}

	private renderToolbar(unreadCount: number, readCount: number) {
		return html`<div class="toolbar">
			<gl-segmented-control
				label=${l10n.t('Show notifications')}
				.options=${[
					{ value: 'all', label: l10n.t('All') },
					{ value: 'unread', label: l10n.t('Unread ({count})', { count: unreadCount }) },
					{ value: 'read', label: l10n.t('Read') },
				]}
				.value=${this._filter}
				@gl-change-value=${(e: Event) => {
					this._filter = ((e.target as HTMLElement & { value?: string }).value ?? 'unread') as InboxFilter;
				}}
			></gl-segmented-control>
			<div class="toolbar__actions">
				<gl-button
					appearance="secondary"
					?disabled=${unreadCount === 0}
					@click=${() =>
						void this.runForList(l10n.t('Couldn’t mark all as read.'), () =>
							this.actions!.markAllNotificationsRead(),
						)}
					><code-icon icon="check-all" slot="prefix" aria-hidden="true"></code-icon>
					${l10n.t('Mark All as Read')}</gl-button
				>
				${
					this._confirmingDeleteRead && readCount > 0
						? html`<span class="confirm" role="group" aria-label=${l10n.t('Confirm deletion')}>
								<span
									>${formatPlural(
										l10n.t(
											'{count, plural, one{Delete {count} read notification?} other{Delete {count} read notifications?}}',
										),
										{ count: readCount },
									)}</span
								>
								<gl-button variant="danger" @click=${() => void this.confirmDeleteRead()}
									>${l10n.t('Confirm')}</gl-button
								>
								<gl-button
									id="delete-read-cancel"
									appearance="secondary"
									@click=${() => void this.setConfirmingDeleteRead(false)}
									>${l10n.t('Cancel')}</gl-button
								>
							</span>`
						: html`<gl-button
								id="delete-read"
								appearance="secondary"
								?disabled=${readCount === 0}
								@click=${() => void this.setConfirmingDeleteRead(true)}
								><code-icon icon="trash" slot="prefix" aria-hidden="true"></code-icon>
								${l10n.t('Delete All Read')}</gl-button
							>`
				}
			</div>
		</div>`;
	}

	private renderRefreshError(inbox: NotificationsInboxState) {
		if (inbox.status !== 'error') return nothing;

		const message =
			inbox.lastSyncedAt != null
				? l10n.t('Couldn’t refresh notifications. Showing what was loaded {0}.', fromNow(inbox.lastSyncedAt))
				: l10n.t('Couldn’t refresh notifications.');

		return html`<div class="banner banner--warning" role="status">
			<code-icon icon="warning" aria-hidden="true"></code-icon>
			<span>${message}</span>
			<gl-button appearance="secondary" @click=${() => void this.actions?.refreshNotifications()}
				>${l10n.t('Retry')}</gl-button
			>
		</div>`;
	}

	private renderList(inbox: NotificationsInboxState, filtered: GkNotification[], readCount: number) {
		if (!inbox.items.length) {
			// Nothing cached and the first fetch hasn't finished
			if (inbox.lastSyncedAt == null && inbox.status !== 'ready') {
				return inbox.status === 'error' ? nothing : this.renderSkeleton();
			}

			return this.renderEmpty(
				'bell',
				l10n.t('No notifications yet'),
				l10n.t('Messages from GitKraken about your account and organization will show up here.'),
			);
		}

		if (!filtered.length) {
			if (this._filter === 'unread') {
				return this.renderEmpty(
					'check',
					l10n.t('You’re all caught up'),
					readCount > 0
						? html`<gl-button appearance="link" @click=${() => (this._filter = 'read')}
								>${l10n.t('Show read notifications ({count})', { count: readCount })}</gl-button
							>`
						: nothing,
				);
			}

			return this.renderEmpty('bell', l10n.t('No read notifications'), nothing);
		}

		return html`<ul class="list" aria-label=${l10n.t('Notifications')}>
			${repeat(
				filtered,
				n => n.id,
				n => this.renderNotification(n),
			)}
		</ul>`;
	}

	private renderNotification(n: GkNotification) {
		const read = n.readAt != null;
		// A card without a heading (see `getNotificationHeadline`) shows a sender byline and is named from its body
		const headerText = getNotificationHeaderText(n);
		const headline = getNotificationHeadline(n);
		const failure = this._failures.get(n.id);
		const cardId = getNotificationDomId(n.id);
		const headlineId = `${cardId}-headline`;
		const body = this.renderBody(n, headerText);
		// The body renders inside gl-markdown's shadow root, which aria-labelledby can't reliably reach, so a card without a
		// heading is named from the body's plain text instead
		let bylineLabel: string | undefined;
		if (headline == null) {
			const plain = getNotificationBodyText(n);
			const text = plain
				? plain.length > 150
					? `${plain.slice(0, 149).trimEnd()}…`
					: plain
				: getNotificationSender();
			bylineLabel = read ? text : l10n.t('Unread: {0}', text);
		}

		return html`<li
			id=${cardId}
			class=${classMap({ card: true, 'card--read': read })}
			tabindex="-1"
			aria-labelledby=${headline != null ? headlineId : nothing}
			aria-label=${bylineLabel ?? nothing}
		>
			<div class="card__header">
				<span class="card__dot" aria-hidden="true"></span>
				${
					headline != null
						? html`<gl-tooltip disabled placement="bottom-start">
								<span slot="content" aria-hidden="true">${headline}</span>
								<h3 class="card__headline" id=${headlineId}>
									${read ? nothing : html`<span class="sr-only">${l10n.t('Unread:')}</span>`}
									${headline}
								</h3>
							</gl-tooltip>`
						: html`<span class="card__byline">${getNotificationSender()}</span>`
				}
				<span class="card__meta">
					${this.renderChip(n)}
					<span class="card__when">
						<formatted-date class="card__time" .date=${new Date(n.createdAt)}></formatted-date>
						<span class="card__actions">
							${
								read
									? html`<gl-button
											appearance="toolbar"
											tooltip=${l10n.t('Mark as Unread')}
											aria-label=${l10n.t('Mark as Unread')}
											@click=${() =>
												void this.runForNotification(
													n.id,
													l10n.t('Couldn’t mark as unread.'),
													() => this.actions!.markNotificationsUnread([n.id]),
													true,
												)}
											><code-icon icon="mail"></code-icon
										></gl-button>`
									: html`<gl-button
											appearance="toolbar"
											tooltip=${l10n.t('Mark as Read')}
											aria-label=${l10n.t('Mark as Read')}
											@click=${() =>
												void this.runForNotification(
													n.id,
													l10n.t('Couldn’t mark as read.'),
													() => this.actions!.markNotificationsRead([n.id]),
													true,
												)}
											><code-icon icon="mail-read"></code-icon
										></gl-button>`
							}
							<gl-button
								appearance="toolbar"
								tooltip=${l10n.t('Delete')}
								aria-label=${l10n.t('Delete')}
								@click=${() =>
									void this.runForNotification(
										n.id,
										l10n.t('Couldn’t delete the notification.'),
										() => this.actions!.deleteNotifications([n.id]),
									)}
								><code-icon icon="trash"></code-icon
							></gl-button>
						</span>
					</span>
				</span>
			</div>
			${body !== nothing ? html`<div class="card__body">${body}</div>` : nothing}
			${
				n.cta != null
					? html`<div class="card__footer">
							<gl-button
								appearance=${read ? 'secondary' : nothing}
								@click=${() =>
									void this.runForNotification(n.id, l10n.t('Couldn’t open the notification.'), () =>
										this.actions!.openNotificationCta(n.id),
									)}
								>${n.cta.text}</gl-button
							>
						</div>`
					: nothing
			}
			${failure != null ? this.renderFailure(failure, 'card__error') : nothing}
		</li>`;
	}

	private renderChip(n: GkNotification) {
		const chip = getCategoryChipBadge(n);
		if (chip == null) return nothing;

		return html`<gl-badge appearance=${chip.warning ? 'warning' : nothing}>${chip.label}</gl-badge>`;
	}

	/** The card's body content, or `nothing` when there's none (so the card doesn't reserve an empty row) */
	private renderBody(n: GkNotification, headline: string | undefined) {
		const shared = n.projectShared;
		if (n.event === 'projectShared' && shared != null) {
			return html`<p>${formatProjectSharedBody(shared, html`<strong>${shared.project}</strong>`)}</p>`;
		}

		const markdown = getDisplayBody(headline, n.body);
		if (markdown == null && !n.needsNewerVersion) return nothing;

		return html`${
			markdown != null
				? html`<gl-markdown untrusted density="document" .markdown=${markdown}></gl-markdown>`
				: nothing
		}
		${n.needsNewerVersion ? html`<p class="card__note">${getNeedsNewerVersionText()}</p>` : nothing}`;
	}

	private renderFailure(failure: FailedAction, className: string) {
		return html`<div class=${className} role="alert">
			<code-icon icon="error" aria-hidden="true"></code-icon>
			<span><strong>${failure.title}</strong> ${failure.message}</span>
			<gl-button appearance="secondary" density="compact" @click=${() => void failure.retry()}
				>${l10n.t('Retry')}</gl-button
			>
		</div>`;
	}

	private renderEmpty(icon: string, title: string, detail: unknown) {
		return html`<div class="empty" role="status">
			<code-icon icon=${icon} aria-hidden="true"></code-icon>
			<p class="empty__title">${title}</p>
			${detail !== nothing ? html`<p class="empty__text">${detail}</p>` : nothing}
		</div>`;
	}

	private renderSkeleton() {
		return html`<div class="list" aria-busy="true" aria-label=${l10n.t('Loading notifications')}>
			${[0, 1, 2].map(() => html`<div class="skeleton"><skeleton-loader lines="2"></skeleton-loader></div>`)}
		</div>`;
	}

	private renderSignIn() {
		return html`<div class="empty">
			<code-icon icon="bell" aria-hidden="true"></code-icon>
			<p class="empty__title">${l10n.t('Sign in to see your notifications')}</p>
			<p class="empty__text">
				${l10n.t('Organization requests, account notices and GitLens news appear here once you’re signed in to GitKraken.')}
			</p>
			<gl-button
				href=${createCommandLink<Source>('gitlens.plus.login', {
					source: 'settings',
					detail: 'notifications',
				})}
				>${l10n.t('Sign In')}</gl-button
			>
		</div>`;
	}

	private renderPreferences(inbox: NotificationsInboxState) {
		const subscription = this._subscription.subscription.get();
		const paid = subscription != null && isSubscriptionPaid(subscription);
		const settings = inbox.settings;
		// Unknown preferences (not fetched yet, or unreachable) can't be changed; the opt-out is paid-only
		const disabled = settings == null || inbox.status === 'error' || !paid;
		const reason = l10n.t('These notifications can be turned off with a paid subscription.');

		return html`<div class="preferences" role="group" aria-labelledby="preferences-title">
			<h3 class="preferences__title" id="preferences-title">${l10n.t('Preferences')}</h3>
			<div class="preferences__row">
				<gl-checkbox
					.checked=${live(settings?.marketingEnabled ?? true)}
					?disabled=${disabled}
					@gl-change-value=${(e: Event) =>
						void this.setMarketingEnabled((e.target as HTMLElement & { checked: boolean }).checked)}
					>${l10n.t('Receive marketing notifications')}</gl-checkbox
				>
				${
					subscription != null && !paid
						? html`<gl-tooltip content=${reason}>
									<button
										type="button"
										class="info-button"
										aria-label=${l10n.t('Why is this disabled?')}
										aria-describedby="marketing-disabled-reason"
									>
										<code-icon icon="info" aria-hidden="true"></code-icon>
									</button>
								</gl-tooltip>
								<span class="sr-only" id="marketing-disabled-reason">${reason}</span>`
						: nothing
				}
			</div>
			${this._settingsFailure != null ? this.renderFailure(this._settingsFailure, 'preferences__error') : nothing}
		</div>`;
	}
}

function matchesFilter(n: GkNotification, filter: InboxFilter): boolean {
	switch (filter) {
		case 'unread':
			return n.readAt == null;
		case 'read':
			return n.readAt != null;
		default:
			return true;
	}
}

/**
 * A DOM id for a notification's card. Ids come from the server, so escape everything but `[A-Za-z0-9-]` (`_`
 * included, which keeps the mapping one-to-one) to get a valid id that's also safe in a `#id` selector.
 */
function getNotificationDomId(id: string): string {
	return `notification-${id.replace(/[^A-Za-z0-9-]/g, c => `_${c.charCodeAt(0).toString(16)}_`)}`;
}

/** RPC rejections carry a message that is already presentable (see `NotificationsRpcService`) */
function getErrorMessage(ex: unknown): string {
	return ex instanceof Error ? ex.message : String(ex);
}
