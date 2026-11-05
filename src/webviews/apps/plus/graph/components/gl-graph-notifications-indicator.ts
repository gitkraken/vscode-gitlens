import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GlPopover } from '@gitlens/components/components/overlays/popover.js';
import { srOnly } from '@gitlens/components/components/styles/lit/a11y.css.js';
import { scrollableBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { GkNotification } from '@gitlens/notifications/models.js';
import { formatUnreadCount } from '@gitlens/notifications/presentation.js';
import { fromNow } from '@gitlens/utils/date.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { RemoteNotificationsService } from '../../../../rpc/services/notifications.js';
import type { NotificationsInboxState } from '../../../../rpc/services/types.js';
import { noop } from '../../../shared/actions/rpc.js';
import {
	getCategoryChipBadge,
	getNotificationBodyText,
	getNotificationHeadline,
	getNotificationSender,
	observeTruncationTargets,
	syncTruncationTooltips,
} from '../../shared/notifications.utils.js';
import type { GraphNotificationsState } from '../graphNotificationsState.js';
import { graphNotificationsContext } from '../graphNotificationsState.js';
import { actionButton } from '../styles/graph.css.js';
import '../../../shared/components/badges/badge.js';
import '../../../shared/components/button.js';
import '../../../shared/components/formatted-date.js';
import '../../../shared/components/skeleton-loader.js';
import '@gitlens/components/components/codeIcon.js';
import '@gitlens/components/components/overlays/popover.js';
import '@gitlens/components/components/overlays/tooltip.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-notifications-indicator': GlGraphNotificationsIndicator;
	}
}

/** The popover lists only the newest few; the full inbox lives in Settings */
const maxItems = 5;

/**
 * Graph header GitKraken notifications bell — an unread badge on a bell, opening a popover with the newest
 * notifications and quick actions (mark read, the call to action), and a way to the full inbox in Settings.
 * Hidden when the feature is off or there's no account (the account pill owns sign-in).
 *
 * Data comes from the shared {@link graphNotificationsContext} store owned by `gl-graph-app` — this component
 * never fetches. While its popover is open (and the webview visible) it tells the host so, which holds
 * security/system toasts, as the Settings inbox does.
 */
@customElement('gl-graph-notifications-indicator')
export class GlGraphNotificationsIndicator extends SignalWatcher(LitElement) {
	static override styles = [
		actionButton,
		srOnly,
		scrollableBase,
		css`
			:host {
				display: inline-flex;

				--notification-unread-color: var(
					--vscode-notificationsInfoIcon-foreground,
					var(--vscode-textLink-foreground)
				);
			}

			:host([hidden]) {
				display: none;
			}

			gl-popover {
				--max-width: 85vw;
			}

			.badge {
				position: absolute;
				inset-block-start: 0;
				inset-inline-end: 0;
				box-sizing: border-box;
				min-width: 1.4rem;
				height: 1.4rem;
				padding: 0 0.3rem;
				font-size: 0.9rem;
				font-weight: var(--gl-font-weight-semibold);
				line-height: 1.4rem;
				color: var(--vscode-activityBarBadge-foreground);
				text-align: center;
				pointer-events: none;
				background-color: var(--vscode-activityBarBadge-background);
				border-radius: var(--gl-radius-circle);
			}

			/* Comfortable ~39rem target, yielding on narrow viewports (the popover body is capped to the viewport).
			   In a short view the body caps the height too (auto-size-vertical), and only the list scrolls so the
			   header and View All stay reachable */
			.panel {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				width: 39rem;
				min-width: 0;
				max-width: 100%;
				min-height: 0;
				padding: var(--gl-space-4);
				font-size: var(--gl-font-md);
			}

			.panel__header {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				padding: var(--gl-space-4) var(--gl-space-4) 0;
			}

			.panel__title {
				margin: 0;
				font-size: var(--gl-font-base);
				font-weight: var(--gl-font-weight-semibold);
			}

			.panel__mark-all {
				margin-inline-start: auto;
			}

			.list {
				display: flex;
				flex-direction: column;
				min-height: 0;
				padding: 0;
				margin: 0;
				overflow-y: auto;
				list-style: none;
			}

			.row {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				min-width: 0;
				padding: var(--gl-space-8) var(--gl-space-4);
				border-block-start: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
			}

			/* Hover tints the row; focus inside draws an inset focus border (the row's own border is only its top edge),
			   which high-contrast themes show too. The contrast border marks hover there */
			.row:hover {
				outline: var(--gl-border-width) dashed var(--vscode-contrastActiveBorder, transparent);
				outline-offset: -1px;
				background-color: var(--vscode-list-hoverBackground);
			}

			.row:focus-within {
				outline: var(--gl-border-width) solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.row__header {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				min-width: 0;
			}

			.row__dot {
				flex: none;
				width: 0.8rem;
				height: 0.8rem;
				background-color: var(--notification-unread-color);
				border: var(--gl-border-width) solid var(--notification-unread-color);
				border-radius: var(--gl-radius-circle);
			}

			.row__headline {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: var(--gl-font-weight-semibold);
				color: var(--color-foreground);
				white-space: nowrap;
			}

			/* The sender, standing in for a headline the notification doesn't have */
			.row__headline--byline {
				font-weight: var(--gl-font-weight-regular);
				color: var(--color-foreground--75);
			}

			.row__time {
				flex: none;
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--65);
			}

			.row__body,
			.row__actions {
				padding-inline-start: var(--gl-space-16);
			}

			.row__body {
				margin: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				color: var(--color-foreground--85);
				white-space: nowrap;
			}

			.row__actions {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-6);
				align-items: center;
			}

			.row--read .row__dot {
				background-color: transparent;
				border-color: var(--color-foreground--50);
			}

			.row--read .row__headline {
				font-weight: var(--gl-font-weight-regular);
				color: var(--color-foreground--75);
			}

			.row--read .row__body {
				color: var(--color-foreground--65);
			}

			.note {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				padding: 0 var(--gl-space-4);
				margin: 0;
			}

			.note span {
				flex: 1;
			}

			.note--error {
				color: var(--vscode-errorForeground);
			}

			.empty {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				align-items: center;
				padding: var(--gl-space-16);
				margin: 0;
				color: var(--color-foreground--65);
				text-align: center;
			}

			.empty code-icon {
				--code-icon-size: 2rem;
			}

			.skeleton {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-12);
				padding: var(--gl-space-8) var(--gl-space-4);
			}

			.panel__footer {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				justify-content: space-between;
				padding: var(--gl-space-8) var(--gl-space-4) var(--gl-space-4);
				border-block-start: var(--gl-border-width) solid
					var(--vscode-widget-border, var(--color-foreground--25));
			}
		`,
	];

	@consume({ context: graphNotificationsContext, subscribe: true })
	private _state?: GraphNotificationsState;

	@query('gl-popover')
	private _popover?: GlPopover;

	@query('.bell')
	private _bell?: HTMLButtonElement;

	@query('.panel')
	private _panel?: HTMLElement;

	/** The last failed action — what failed and its (presentable) cause — shown inline until the next action or the popover closes */
	@state()
	private _error: { title: string; message: string } | undefined;

	/**
	 * Re-checks which headlines are truncated when one's box changes: the panel resizing, the popover opening, or
	 * a row's meta finishing its first render
	 */
	private _resizeObserver: ResizeObserver | undefined;
	private readonly _observedHeadlines = new Set<Element>();

	@state()
	private _open = false;

	private get service(): RemoteNotificationsService | undefined {
		return this._state?.service.get();
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		document.addEventListener('visibilitychange', this.onDocumentVisibilityChanged);
	}

	override disconnectedCallback(): void {
		document.removeEventListener('visibilitychange', this.onDocumentVisibilityChanged);
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		this._observedHeadlines.clear();
		this.setOpen(false);
		super.disconnectedCallback?.();
	}

	override updated(): void {
		// The bell went away (signed out, or the feature turned off) with its popover open
		if (this._open && this._popover == null) {
			this.setOpen(false);
		}

		this._resizeObserver ??= new ResizeObserver(() => this.syncHeadlineTooltips());
		observeTruncationTargets(this._resizeObserver, this.renderRoot, '.row__headline', this._observedHeadlines);
		this.syncHeadlineTooltips();
	}

	private syncHeadlineTooltips(): void {
		syncTruncationTooltips(this.renderRoot, '.row__headline');
	}

	private readonly onDocumentVisibilityChanged = (): void => {
		this.reportInboxVisible();
	};

	private setOpen(open: boolean): void {
		if (this._open === open) return;

		this._open = open;
		this.reportInboxVisible();
	}

	/** Holds security/system toasts while the popover is actually on screen */
	private reportInboxVisible(): void {
		const visible = this._open && document.visibilityState === 'visible';
		this.service?.setInboxVisible(visible).catch(noop);
	}

	private readonly onPopoverShow = (): void => {
		this.setOpen(true);
	};

	private readonly onPopoverHide = (): void => {
		this._error = undefined;
		this.setOpen(false);

		// Escape (or an action) closed it with the focus inside: hand the focus back to the bell instead of the page
		const active = this.shadowRoot?.activeElement;
		if (active != null && active !== this._bell && this._panel?.contains(active)) {
			this._bell?.focus();
		}
	};

	/**
	 * Runs an action against the notifications service, showing its failure inline. If the action took the
	 * focused control away (e.g. a row's Mark as Read), focus moves to `fallback` instead of falling to the page.
	 */
	private async run(
		failureTitle: string,
		action: (service: RemoteNotificationsService) => Promise<void>,
		fallback: () => HTMLElement | null | undefined,
	): Promise<void> {
		const service = this.service;
		if (service == null) return;

		this._error = undefined;
		const hadFocus = this._panel?.contains(this.shadowRoot?.activeElement ?? null) ?? false;
		try {
			await action(service);
		} catch (ex) {
			// RPC rejections carry a message that is already presentable (see `NotificationsRpcService`)
			this._error = { title: failureTitle, message: ex instanceof Error ? ex.message : String(ex) };
		}

		await this.updateComplete;
		if (hadFocus && this.shadowRoot?.activeElement == null && this._open) {
			(fallback() ?? this._bell)?.focus();
		}
	}

	private getRow(id: string): HTMLElement | undefined {
		return [...this.renderRoot.querySelectorAll<HTMLElement>('li.row')].find(r => r.dataset.id === id);
	}

	override render(): unknown {
		const inbox = this._state?.inbox.get();
		if (inbox?.access !== 'signedIn') return nothing;

		const unread = inbox.unreadCount;
		return html`<gl-popover
			placement="bottom-end"
			trigger="click"
			auto-size-vertical
			interactive
			label=${l10n.t('Notifications')}
			?arrow=${false}
			.distance=${0}
			@gl-popover-show=${this.onPopoverShow}
			@gl-popover-hide=${this.onPopoverHide}
		>
			<button
				class="action-button bell"
				type="button"
				slot="anchor"
				aria-haspopup="dialog"
				aria-expanded=${this._open}
				aria-label=${unread === 0 ? l10n.t('Notifications, no unread') : unread > 99 ? l10n.t('Notifications, more than 99 unread') : l10n.t('Notifications, {count} unread', { count: unread })}
			>
				<code-icon icon="bell" aria-hidden="true"></code-icon>
				${unread > 0 ? html`<span class="badge" aria-hidden="true">${formatUnreadCount(unread)}</span>` : nothing}
			</button>
			<div slot="content" class="panel">
				<div class="panel__header">
					<h2 class="panel__title">${l10n.t('Notifications')}</h2>
					${unread > 0 ? html`<gl-badge aria-hidden="true">${formatUnreadCount(unread)}</gl-badge>` : nothing}
					${
						unread > 0
							? html`<gl-button
									class="panel__mark-all"
									appearance="toolbar"
									density="compact"
									@click=${() =>
										void this.run(
											l10n.t('Couldn’t mark all as read.'),
											s => s.markAllRead(),
											() => this.renderRoot.querySelector<HTMLElement>('li.row'),
										)}
									>${l10n.t('Mark All as Read')}</gl-button
								>`
							: nothing
					}
				</div>
				${this.renderStatus(inbox)}
				${
					this._error != null
						? html`<p class="note note--error" role="alert">
								<code-icon icon="error" aria-hidden="true"></code-icon
								><span><strong>${this._error.title}</strong> ${this._error.message}</span>
							</p>`
						: nothing
				}
				${this.renderList(inbox)}
				<div class="panel__footer">
					<gl-button
						appearance="secondary"
						href=${createCommandLink('gitlens.showSettingsPage!notifications')}
						@click=${() => void this._popover?.hide()}
						>${l10n.t('View All Notifications')}</gl-button
					>
				</div>
			</div>
		</gl-popover>`;
	}

	/** A failed refresh keeps showing the cached list, with a note */
	private renderStatus(inbox: NotificationsInboxState) {
		if (inbox.status !== 'error') return nothing;

		const message =
			inbox.lastSyncedAt != null
				? l10n.t('Couldn’t refresh notifications. Showing what was loaded {0}.', fromNow(inbox.lastSyncedAt))
				: l10n.t('Couldn’t refresh notifications.');

		return html`<p class="note" role="status">
			<code-icon icon="warning" aria-hidden="true"></code-icon>
			<span>${message}</span>
			<gl-button appearance="toolbar" density="compact" @click=${() => void this.service?.refresh()}
				>${l10n.t('Retry')}</gl-button
			>
		</p>`;
	}

	private renderList(inbox: NotificationsInboxState) {
		if (!inbox.items.length) {
			// Nothing cached and the first fetch hasn't finished (a failed one shows its note above)
			if (inbox.lastSyncedAt == null && inbox.status !== 'ready') {
				if (inbox.status === 'error') return nothing;

				return html`<div class="skeleton" aria-busy="true" aria-label=${l10n.t('Loading notifications')}>
					<skeleton-loader lines="2"></skeleton-loader><skeleton-loader lines="2"></skeleton-loader>
				</div>`;
			}

			return html`<p class="empty" role="status">
				<code-icon icon="bell" aria-hidden="true"></code-icon>${l10n.t('No notifications yet')}
			</p>`;
		}

		return html`<ul class="list scrollable" aria-label=${l10n.t('Notifications')}>
			${repeat(
				inbox.items.slice(0, maxItems),
				n => n.id,
				n => this.renderNotification(n),
			)}
		</ul>`;
	}

	private renderNotification(n: GkNotification) {
		const read = n.readAt != null;
		const headline = getNotificationHeadline(n);
		const body = getNotificationBodyText(n);
		const chip = getCategoryChipBadge(n);

		return html`<li class="row${read ? ' row--read' : ''}" data-id=${n.id} tabindex="-1">
			<div class="row__header">
				<span class="row__dot" aria-hidden="true"></span>
				<gl-tooltip disabled placement="bottom-start">
					<span slot="content" aria-hidden="true">${headline ?? getNotificationSender()}</span>
					<span class="row__headline${headline == null ? ' row__headline--byline' : ''}"
						>${read ? nothing : html`<span class="sr-only">${l10n.t('Unread:')}</span> `}${headline ?? getNotificationSender()}</span
					>
				</gl-tooltip>
				${chip != null ? html`<gl-badge appearance=${chip.warning ? 'warning' : nothing}>${chip.label}</gl-badge>` : nothing}
				<formatted-date class="row__time" .date=${new Date(n.createdAt)}></formatted-date>
			</div>
			${body != null ? html`<p class="row__body">${body}</p>` : nothing}
			${
				n.cta != null || !read
					? html`<div class="row__actions">
							${
								n.cta != null
									? html`<gl-button
											appearance=${read ? 'secondary' : nothing}
											density="compact"
											@click=${() =>
												void this.run(
													l10n.t('Couldn’t open the notification.'),
													s => s.openCta(n.id),
													() => this.getRow(n.id),
												)}
											>${n.cta.text}</gl-button
										>`
									: nothing
							}
							${
								read
									? nothing
									: html`<gl-button
											appearance="secondary"
											density="compact"
											@click=${() =>
												void this.run(
													l10n.t('Couldn’t mark as read.'),
													s => s.markRead([n.id]),
													() => this.getRow(n.id),
												)}
											>${l10n.t('Mark as Read')}</gl-button
										>`
							}
						</div>`
					: nothing
			}
		</li>`;
	}
}
