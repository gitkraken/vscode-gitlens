import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { OnboardingKeys } from '../../../../../constants.onboarding.js';
import type { GraphCoachMarkType } from '../../../../plus/graph/protocol.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import type { OnboardingDismissals } from '../../../shared/contexts/onboardingDismissals.js';
import { onboardingDismissalsContext } from '../../../shared/contexts/onboardingDismissals.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import type { CoachMarkSeenStore } from '../coachMarkSeen.js';
import { coachMarkSeenContext } from '../coachMarkSeen.js';
import { graphCoachMarks } from './coachMarks.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-coachmark': GlGraphCoachMark;
	}
}

export type CoachMarkTrigger = 'auto' | 'lightbulb';

/** Highest-priority one opens; the rest stay queued and re-flush when it closes, so a forced mark is
 *  never silently dropped. */
const pendingAutoShows = new Set<GlGraphCoachMark>();
/** Force-opened this session. Guards against re-opening while the persist is in flight, and keeps
 *  the lightbulb offered when an incidental close means `seen` was never banked. */
const forceOpenedThisSession = new Set<GraphCoachMarkType>();
let openMark: GraphCoachMarkType | undefined;
let flushScheduled = false;

/** `gl-popover` closes on webview blur and when any other popover opens, so persisting on open would
 *  let a stray close burn the one force-open a user ever gets. */
const seenDwellMs = 1500;

function scheduleAutoShowFlush(): void {
	if (flushScheduled) return;

	flushScheduled = true;
	requestAnimationFrame(() => {
		flushScheduled = false;

		const candidates = [...pendingAutoShows].sort(
			(a, b) => graphCoachMarks[b.mark].priority - graphCoachMarks[a.mark].priority,
		);

		for (const mark of candidates) {
			if (mark.show({ trigger: 'auto' })) {
				pendingAutoShows.delete(mark);
				// Leave the rest queued — `onPopoverHide` re-flushes once this one closes.
				return;
			}
		}
	});
}

@customElement('gl-graph-coachmark')
export class GlGraphCoachMark extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			display: contents;

			/* Coach-mark copy is sentence case wherever it's hosted. text-transform is inherited, so
			   without this the sidebar panel's uppercase header shouts the whole tip — and the same
			   would happen to the lightbulb's tooltip. */
			text-transform: none;
		}

		gl-popover::part(body) {
			--max-width: 320px;
		}

		.coachmark {
			display: flex;
			flex-direction: column;
			gap: var(--gl-space-8);
		}

		.coachmark__header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 1ch;
		}

		.coachmark__title {
			font-weight: 600;
		}

		.coachmark__body strong {
			color: var(--color-foreground);
		}

		/* The spec's copy is multi-paragraph, and Compose's is a numbered list. */
		.coachmark__body p {
			margin: 0;
		}

		.coachmark__body p + p,
		.coachmark__body p + ol {
			margin-block-start: var(--gl-space-8);
		}

		.coachmark__body ol {
			margin: 0;
			padding-inline-start: 2rem;
		}

		.coachmark__body li + li {
			margin-block-start: var(--gl-space-4);
		}

		.coachmark__actions {
			display: flex;
			justify-content: flex-end;
		}

		.lightbulb {
			flex: none;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2rem;
			height: 2rem;
			padding: 0;
			border: none;
			border-radius: 50%;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			cursor: pointer;
			vertical-align: middle;
		}

		.lightbulb:hover {
			background: var(--vscode-button-hoverBackground);
		}

		.lightbulb:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 0.1rem;
		}

		.lightbulb code-icon {
			font-size: 1.2rem;
		}
	`;

	@property()
	mark!: GraphCoachMarkType;

	@property()
	placement: GlPopover['placement'] = 'bottom';

	/** Element, or a lazy resolver for owner-shadow-DOM anchors that may not exist at bind time. */
	@property({ attribute: false })
	anchor?: HTMLElement | (() => HTMLElement | null | undefined);

	/** Declarative trigger — force-opens while true (gated on dismissal and `seen`), and gates the
	 *  lightbulb, which only shows while the trigger context holds. */
	@property({ type: Boolean, attribute: 'auto-show' })
	autoShow = false;

	@consume({ context: onboardingDismissalsContext, subscribe: true })
	private _dismissals?: OnboardingDismissals;

	@consume({ context: coachMarkSeenContext, subscribe: true })
	private _seen?: CoachMarkSeenStore;

	@query('gl-popover')
	private _popover?: GlPopover;

	@state()
	private _open = false;

	/** Set just before the "Got it" hide so `onPopoverHide` can tell acknowledgment apart from a
	 *  soft close (gl-popover emits no close reason). */
	private _acknowledged = false;
	/** Set by the ✕ button and by a click outside. Escape and blur count as incidental, which costs the
	 *  mark nothing but its next-session force-open. */
	private _closedByUser = false;
	private _anchorObserver?: IntersectionObserver;
	private _seenTimer?: ReturnType<typeof setTimeout>;

	/** Clicking away is the same intent as ✕. `gl-popover` wires its own outside-click dismissal only for
	 *  `click`/`focus` triggers, and these are `manual`, so a tip is otherwise unclickable-away: the only
	 *  exits are ✕, Got it, Escape, webview blur, and another popover's `closeOthers()`. Capture phase, so
	 *  a row/canvas handler that stops propagation can't swallow it. */
	private readonly onDocumentMouseDown = (e: MouseEvent): void => {
		if (!this._open) return;

		const popover = this._popover;
		// Anything inside the popover's tree (including its slotted content) composes through its host.
		if (popover == null || e.composedPath().includes(popover)) return;

		this._closedByUser = true;
		void popover.hide();
	};

	private listenForOutsideMouseDown(listen: boolean): void {
		document.removeEventListener('mousedown', this.onDocumentMouseDown, true);
		if (listen) {
			document.addEventListener('mousedown', this.onDocumentMouseDown, true);
		}
	}

	override disconnectedCallback(): void {
		clearTimeout(this._seenTimer);
		this.listenForOutsideMouseDown(false);
		pendingAutoShows.delete(this);
		if (openMark === this.mark) {
			openMark = undefined;
			// Unmounting while open never fires `gl-popover-hide`, so release the latch here or a mark
			// that lost the arbitration waits for an unrelated re-render to try again.
			if (pendingAutoShows.size) {
				scheduleAutoShowFlush();
			}
		}
		this._anchorObserver?.disconnect();
		this._anchorObserver = undefined;

		super.disconnectedCallback?.();
	}

	override updated(changedProperties: PropertyValues): void {
		// Re-arm on every render while the trigger holds, not just on a false→true transition: sites
		// like `gl-details-wip-header` re-render mid-mode-swap, so the first attempt can land while the
		// anchor is briefly invisible. `show()`'s guards make the retries idempotent.
		if (this.autoShow) {
			// `dismissed` is part of the arming test, not just `show()`'s: an acknowledged mark would
			// otherwise sit in the queue for the session, costing a no-op rAF on every render.
			if (
				!forceOpenedThisSession.has(this.mark) &&
				this._seen?.has(this.mark) === false &&
				this.dismissed === false
			) {
				pendingAutoShows.add(this);
				scheduleAutoShowFlush();
			}
		} else {
			pendingAutoShows.delete(this);
			// Marks aren't unmounted when their trigger ends, so an open tip would keep holding the latch.
			if (this._open) {
				void this._popover?.hide();
			}
			this._anchorObserver?.disconnect();
			this._anchorObserver = undefined;
		}

		super.updated(changedProperties);
	}

	private get onboardingKey(): OnboardingKeys {
		return `graph:coachMark:${this.mark}`;
	}

	/** `undefined` until the host answers — treated as "not ready", never as "not dismissed", so a
	 *  mark can't flash open before we know it was already acknowledged. */
	private get dismissed(): boolean | undefined {
		return this._dismissals?.get(this.onboardingKey);
	}

	/** Returns false when suppressed or the anchor isn't visible. A `lightbulb` trigger bypasses the
	 *  `seen` guard and arbitration — but never a "Got it" dismissal. */
	show(options?: { trigger?: CoachMarkTrigger }): boolean {
		const trigger = options?.trigger ?? 'auto';

		// Rendered outside the Graph, so neither context is provided — stay dormant.
		if (this._dismissals == null || this._seen == null) return false;
		if (this.dismissed !== false) return false;

		if (trigger === 'auto') {
			if (forceOpenedThisSession.has(this.mark)) return false;
			if (this._seen.has(this.mark) !== false) return false;
			// Another mark holds the screen — stay queued; its `onPopoverHide` re-flushes.
			if (openMark != null) return false;
		}

		const popover = this._popover;
		const anchor = this.resolveAnchor();
		if (popover == null || anchor == null || !anchor.checkVisibility()) {
			// The trigger state holds but the anchor isn't on screen yet (e.g. the details split is
			// still at zero width) — retry once when it becomes visible.
			if (trigger === 'auto' && anchor != null) {
				this.observeAnchor(anchor);
			}
			return false;
		}

		this._anchorObserver?.disconnect();
		this._anchorObserver = undefined;

		popover.anchor = anchor;
		if (trigger === 'auto') {
			forceOpenedThisSession.add(this.mark);
		}
		openMark = this.mark;
		this._acknowledged = false;
		this._open = true;
		void popover.show();
		// Safe to arm now: a lightbulb click's own mousedown has already been dispatched.
		this.listenForOutsideMouseDown(true);

		// Dwell before persisting, so a stray blur-close doesn't consume the force-open.
		clearTimeout(this._seenTimer);
		this._seenTimer = setTimeout(() => {
			// Still open when the dwell elapsed → the user actually had a chance to read it.
			if (this._open) {
				this.persistSeen();
			}
		}, seenDwellMs);

		emitTelemetrySentEvent<'graph/coachMark'>(this, {
			name: 'graph/coachMark',
			data: { key: this.mark, action: 'shown', trigger: trigger },
		});
		return true;
	}

	private resolveAnchor(): HTMLElement | undefined {
		const anchor = typeof this.anchor === 'function' ? this.anchor() : this.anchor;
		return anchor ?? undefined;
	}

	private observeAnchor(anchor: HTMLElement): void {
		if (this._anchorObserver != null) return;

		this._anchorObserver = new IntersectionObserver(entries => {
			if (!entries.some(e => e.isIntersecting)) return;

			this._anchorObserver?.disconnect();
			this._anchorObserver = undefined;
			if (this.autoShow) {
				this.show({ trigger: 'auto' });
			}
		});
		this._anchorObserver.observe(anchor);
	}

	/** "Got it" — persists the dismissal; neither the tip nor its lightbulb returns. */
	private onGotItClick() {
		this._acknowledged = true;
		void this._popover?.hide();

		this._dismissals?.dismiss(this.onboardingKey);

		emitTelemetrySentEvent<'graph/coachMark'>(this, {
			name: 'graph/coachMark',
			data: { key: this.mark, action: 'dismissed' },
		});
	}

	/** ✕ — soft close: the how-to parks on the lightbulb rather than being dismissed for good. */
	private onCloseClick() {
		this._closedByUser = true;
		void this._popover?.hide();
	}

	/** Banks the one force-open — on the dwell timer or an explicit close, whichever comes first. */
	private persistSeen(): void {
		clearTimeout(this._seenTimer);
		this._seenTimer = undefined;
		if (this._seen?.has(this.mark) === false) {
			this._seen.markSeen(this.mark);
		}
	}

	private onLightbulbClick() {
		this.show({ trigger: 'lightbulb' });
	}

	private onPopoverHide(e: Event) {
		if (e.target !== this._popover) return;

		this.listenForOutsideMouseDown(false);

		if (openMark === this.mark) {
			openMark = undefined;
		}
		this._open = false;

		if (this._acknowledged || this._closedByUser) {
			// A deliberate close ("Got it" / ✕) counts as seen without waiting out the dwell.
			this.persistSeen();
		} else {
			// Incidental (blur, or another popover's `closeOthers()`). Unread, so don't bank `seen`: it
			// force-opens again next session, and the lightbulb covers this one.
			clearTimeout(this._seenTimer);
			this._seenTimer = undefined;
		}
		this._acknowledged = false;
		this._closedByUser = false;

		// Let a mark that lost the arbitration take the screen now.
		if (pendingAutoShows.size) {
			scheduleAutoShowFlush();
		}
	}

	override render(): unknown {
		const content = graphCoachMarks[this.mark];

		// Read BOTH unconditionally: `SignalWatcher` only tracks signals actually read during render,
		// and both start `undefined`. A `&&` chain that bails on the first leaves the second untracked,
		// so the component never re-renders when it resolves and the mark never force-opens.
		const seen = this._seen?.has(this.mark);
		const dismissed = this.dismissed;

		// Not just `seen`: an incidental close leaves `seen` unbanked, and re-arming is blocked, so
		// without this the tip would have no way back for the rest of the session.
		const offered = seen === true || forceOpenedThisSession.has(this.mark);

		const lightbulb =
			offered && this.autoShow && !this._open && dismissed === false
				? html`<gl-tooltip placement="bottom" content="Show Tip: ${content.title}">
						<button
							type="button"
							class="lightbulb"
							aria-label="Show Tip: ${content.title}"
							@click=${this.onLightbulbClick}
						>
							<code-icon icon="lightbulb-sparkle"></code-icon>
						</button>
					</gl-tooltip>`
				: nothing;

		return html`<gl-popover trigger="manual" placement=${this.placement} @gl-popover-hide=${this.onPopoverHide}>
				<!-- No role/aria-live here: gl-popover's body already carries role="tooltip" and switches
					 aria-live to polite while open, so the tip is announced once. A nested role="dialog"
					 would both contradict that role and (without focus management) promise a modal. -->
				<div slot="content" class="coachmark">
					<div class="coachmark__header">
						<span class="coachmark__title">${content.title}</span>
						<gl-button appearance="toolbar" density="compact" aria-label="Close" @click=${this.onCloseClick}
							><code-icon icon="close"></code-icon
						></gl-button>
					</div>
					<div class="coachmark__body">${content.body()}</div>
					<div class="coachmark__actions">
						<gl-button @click=${this.onGotItClick}>Got it</gl-button>
					</div>
				</div>
			</gl-popover>
			${lightbulb}`;
	}
}
