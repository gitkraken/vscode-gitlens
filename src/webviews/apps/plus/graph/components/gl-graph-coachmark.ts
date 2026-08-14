import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { OnboardingKeys } from '../../../../../constants.onboarding.js';
import type { GraphCoachMarkType } from '../../../../plus/graph/protocol.js';
import { GlPopover } from '../../../shared/components/overlays/popover.js';
import type { OnboardingDismissals } from '../../../shared/contexts/onboardingDismissals.js';
import { onboardingDismissalsContext } from '../../../shared/contexts/onboardingDismissals.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import type { CoachMarkSeenStore } from '../coachMarkSeen.js';
import { coachMarkSeenContext } from '../coachMarkSeen.js';
import { graphCoachMarks } from './coachMarks.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
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
/** Force-opened this session. Guards against re-opening while the persist is in flight; an incidental
 *  close gives the entry back (bounded — see {@link maxAutoReopens}) so the tip can return, and a
 *  spent budget leaves it, keeping the lightbulb offered when `seen` was never banked. */
const forceOpenedThisSession = new Set<GraphCoachMarkType>();
let openMark: GraphCoachMarkType | undefined;
let flushScheduled = false;

/** `gl-popover` closes on webview blur and when any other popover opens, so persisting on open would
 *  let a stray close burn the one force-open a user ever gets. */
const seenDwellMs = 1500;

/** An incidental close (blur, another popover's `closeOthers()`, auto-show flicker, unmount) doesn't
 *  consume the session's force-open — the mark relinquishes its `forceOpenedThisSession` entry after
 *  a settle delay and re-arms. Bounded per session so loading-time focus churn can't strobe the tip;
 *  a spent budget leaves the entry in place, parking the mark on the lightbulb. */
const maxAutoReopens = 3;
/** Bulb-less marks never bank `seen` (a banked showing would be unreachable forever with no
 *  lightbulb to park on), so the incidental-close reopen check can't use the store to tell "was
 *  displayed long enough to read" — this session-local marker fills that role, banked by the same
 *  dwell/deliberate-close paths that would have banked `seen`. Without it every webview blur (e.g.
 *  clicking into the very terminal the followTerminal tip is talking about) strobes the tip back
 *  open until the reopen budget is spent. */
const bulblessSeenThisSession = new Set<GraphCoachMarkType>();
const reopenDelayMs = 1000;
const autoReopensRemaining = new Map<GraphCoachMarkType, number>();

function takeAutoReopen(mark: GraphCoachMarkType): boolean {
	const remaining = autoReopensRemaining.get(mark) ?? maxAutoReopens;
	if (remaining <= 0) return false;

	autoReopensRemaining.set(mark, remaining - 1);
	return true;
}

/** A lazy anchor can resolve null while a nested component's shadow is still rendering (the commit
 *  panel's header lives two shadow roots down from the details panel). The IntersectionObserver
 *  retry needs a node to observe, so a null anchor gets a bounded frame-by-frame retry instead. */
const nullAnchorRetryFrames = 30;

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

		/* A closed mark otherwise lingers as a zero-width flex item in whatever row hosts it (the
		   host is display: contents, so the popover element itself joins the flow) — and every such
		   phantom earns the row's flex gap, stacking blank space between the title text and the one
		   visible lightbulb. Positioning doesn't need the host box: the popup floats off the assigned
		   anchor element. */
		gl-popover:not([open]) {
			display: none;
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
			display: flex;
			align-items: center;
			gap: var(--gl-space-8);
			min-width: 0;
			font-weight: 600;
		}

		.coachmark__icon {
			flex: none;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2.2rem;
			height: 2.2rem;
			border-radius: 0.6rem;
			background: color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent);
			color: var(--vscode-focusBorder);
		}

		.coachmark__icon code-icon {
			font-size: 1.4rem;
		}

		.coachmark__icon--warning {
			background: color-mix(in srgb, var(--vscode-charts-yellow) 15%, transparent);
			color: var(--vscode-charts-yellow);
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

		.lede {
			color: var(--color-foreground);
		}

		.coachmark__body .lede {
			margin: 0;
		}

		.steps {
			display: grid;
			gap: var(--gl-space-6);
			margin-block-start: var(--gl-space-8);
		}

		.step {
			display: grid;
			grid-template-columns: 1.7rem 1fr;
			gap: var(--gl-space-8);
			align-items: baseline;
		}

		.step__num {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 1.6rem;
			height: 1.6rem;
			border-radius: 50%;
			background: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
			color: var(--vscode-focusBorder);
			font-size: 1rem;
			font-weight: 700;
			translate: 0 0.2rem;
		}

		.rows {
			display: grid;
			gap: var(--gl-space-6);
			margin-block-start: var(--gl-space-8);
		}

		.step__body .rows {
			margin-block-start: var(--gl-space-6);
		}

		.row {
			display: grid;
			grid-template-columns: 1.6rem 1fr;
			gap: var(--gl-space-6);
			align-items: baseline;
		}

		.row--block {
			grid-template-columns: 1fr;
		}

		.row__icon {
			color: var(--vscode-focusBorder);
			justify-self: center;
			font-size: 1.2rem;
		}

		.dot {
			width: 0.8rem;
			height: 0.8rem;
			border-radius: 50%;
			justify-self: center;
		}

		.dot--critical {
			background: var(--vscode-charts-red);
		}

		.dot--warning {
			background: var(--vscode-charts-yellow);
		}

		.dot--suggestion {
			background: var(--vscode-charts-blue);
		}

		.dot--success {
			background: var(--vscode-charts-green);
		}

		.dot--attention {
			background: var(--vscode-charts-orange);
		}

		.dot--muted {
			background: var(--vscode-descriptionForeground);
		}

		/* Matches the overview bar's own .pill__dot (uncommitted-changes indicator) exactly. */
		.dot--dirty {
			background: var(--gl-agent-working-color);
		}

		.chip {
			display: inline-block;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			font-size: 1.1rem;
			font-weight: 500;
			padding: 0 0.6rem;
			border-radius: 0.3rem;
			white-space: nowrap;
			line-height: 1.6rem;
		}

		.chip--ui {
			background: none;
			border: 0.1rem solid var(--vscode-widget-border);
			color: var(--color-foreground);
			line-height: 1.4rem;
		}

		/* Scoped under the body so it out-specifies the body's blanket p { margin: 0 } reset. */
		.coachmark__body .footnote {
			margin-block-start: var(--gl-space-8);
			font-size: 1.1rem;
			color: var(--vscode-descriptionForeground);
		}

		.coachmark__trust {
			display: flex;
			gap: var(--gl-space-6);
			align-items: baseline;
			font-size: 1.1rem;
			color: var(--vscode-descriptionForeground);
		}

		.coachmark__trust code-icon {
			color: var(--vscode-charts-green);
			font-size: 1rem;
			flex: none;
			translate: 0 0.1rem;
		}

		.coachmark__actions {
			display: flex;
			justify-content: flex-end;
			gap: 0.8rem;
		}

		.lightbulb {
			flex: none;
			/* The host is display: contents, so in a flex row the bulb itself is the flex item — self-center
			   so baseline-aligned title rows don't stretch to hang the bulb's box off the text baseline. */
			align-self: center;
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
	/** Set by the ✕ button and by a click outside. Blur counts as incidental, which costs the mark
	 *  nothing but its next-session force-open. */
	private _closedByUser = false;
	/** Escape is deliberate — it must not auto-reopen — but unlike ✕ it doesn't bank `seen`, so the tip
	 *  still force-opens next session. */
	private _closedByEscape = false;
	private _anchorObserver?: IntersectionObserver;
	private _seenTimer?: ReturnType<typeof setTimeout>;
	private _reopenTimer?: ReturnType<typeof setTimeout>;
	/** Frames spent waiting for a lazy anchor to resolve non-null — see {@link nullAnchorRetryFrames}. */
	private _nullAnchorRetries = 0;

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

	/** Escape is a deliberate close, but `gl-popover`'s CloseWatcher path surfaces no reason and other
	 *  layers can eat the first Esc before the watcher fires — so classify and hide here, first. The
	 *  watcher's own later close request finds the popover already closed and no-ops. */
	private readonly onDocumentKeyDown = (e: KeyboardEvent): void => {
		if (!this._open || e.key !== 'Escape') return;

		this._closedByEscape = true;
		void this._popover?.hide();
	};

	private listenForDismissals(listen: boolean): void {
		document.removeEventListener('mousedown', this.onDocumentMouseDown, true);
		document.removeEventListener('keydown', this.onDocumentKeyDown, true);
		if (listen) {
			document.addEventListener('mousedown', this.onDocumentMouseDown, true);
			document.addEventListener('keydown', this.onDocumentKeyDown, true);
		}
	}

	override disconnectedCallback(): void {
		clearTimeout(this._seenTimer);
		this.listenForDismissals(false);
		const reopenPending = this._reopenTimer != null;
		clearTimeout(this._reopenTimer);
		this._reopenTimer = undefined;
		if (reopenPending) {
			// The delayed relinquish must still happen or a remounted instance stays blocked forever.
			forceOpenedThisSession.delete(this.mark);
		} else if (this._open && this._seen?.has(this.mark) === false && takeAutoReopen(this.mark)) {
			// Unmount-while-open fires no `gl-popover-hide`. Immediate delete is safe: remount latency plus
			// `show()`'s anchor-visibility guards provide the settling.
			forceOpenedThisSession.delete(this.mark);
		}
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
			// Opening calls `closeOthers()` — never stomp a popover the user has open (a pill hover card,
			// a header menu). Matters most on the auto-reopen path, which fires ~1s after a `closeOthers()`
			// close, exactly when such a popover is up. Stay queued; a later re-arm retries.
			if (GlPopover.hasOpenPopover()) return false;
		}

		const popover = this._popover;
		const anchor = this.resolveAnchor();
		if (popover == null || anchor == null || !anchor.checkVisibility()) {
			// The trigger state holds but the anchor isn't on screen yet (e.g. the details split is
			// still at zero width) — retry once when it becomes visible.
			if (trigger === 'auto') {
				if (anchor != null) {
					this.observeAnchor(anchor);
				} else if (this._nullAnchorRetries < nullAnchorRetryFrames) {
					this._nullAnchorRetries++;
					requestAnimationFrame(() => {
						if (this.autoShow && pendingAutoShows.has(this)) {
							scheduleAutoShowFlush();
						}
					});
				}
			}
			return false;
		}

		this._nullAnchorRetries = 0;

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
		this.listenForDismissals(true);

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

	/** Shared by "Got it" and a content-supplied action button: both bank the dismissal for good and
	 *  differ only in which telemetry action they report. */
	private dismissPermanently(action: 'dismissed' | 'actioned'): void {
		this._acknowledged = true;
		void this._popover?.hide();

		this._dismissals?.dismiss(this.onboardingKey);

		emitTelemetrySentEvent<'graph/coachMark'>(this, {
			name: 'graph/coachMark',
			data: { key: this.mark, action: action },
		});
	}

	/** "Got it" — persists the dismissal; neither the tip nor its lightbulb returns. */
	private onGotItClick() {
		this.dismissPermanently('dismissed');
	}

	/** A content-supplied action (e.g. "Turn Off") — dismisses the same as "Got it", then notifies the
	 *  host to carry out the action; the behavior itself stays out of the static content module. */
	private onActionClick() {
		this.dismissPermanently('actioned');

		this.dispatchEvent(
			new CustomEvent('gl-coachmark-action', { detail: { mark: this.mark }, bubbles: true, composed: true }),
		);
	}

	/** ✕ — soft close: the how-to parks on the lightbulb rather than being dismissed for good. */
	private onCloseClick() {
		this._closedByUser = true;
		void this._popover?.hide();
	}

	/** Banks the one force-open — on the dwell timer or an explicit close, whichever comes first.
	 *  Bulb-less marks never bank `seen`: with no lightbulb to park on, a banked showing would be
	 *  unreachable forever, so soft closes only defer to the next session — the buttons are the sole
	 *  permanent endings (via the dismissal they bank). */
	private persistSeen(): void {
		clearTimeout(this._seenTimer);
		this._seenTimer = undefined;
		if (graphCoachMarks[this.mark]?.lightbulb === false) {
			bulblessSeenThisSession.add(this.mark);
			return;
		}

		if (this._seen?.has(this.mark) === false) {
			this._seen.markSeen(this.mark);
		}
	}

	/** Relinquishes the force-open after a settle delay so the mark re-arms via `updated()`. The set
	 *  entry is kept during the delay — it is the debounce, and keeps the lightbulb offered meanwhile. */
	private scheduleAutoReopen(): void {
		if (this._reopenTimer != null) return;
		if (!forceOpenedThisSession.has(this.mark)) return;
		if (!takeAutoReopen(this.mark)) return;

		this._reopenTimer = setTimeout(() => {
			this._reopenTimer = undefined;
			forceOpenedThisSession.delete(this.mark);
			// The set isn't reactive — nudge a render so `updated()` re-arms through its normal gates.
			this.requestUpdate();
		}, reopenDelayMs);
	}

	private onLightbulbClick() {
		this.show({ trigger: 'lightbulb' });
	}

	private onPopoverHide(e: Event) {
		if (e.target !== this._popover) return;

		this.listenForDismissals(false);

		if (openMark === this.mark) {
			openMark = undefined;
		}
		this._open = false;

		if (this._acknowledged || this._closedByUser) {
			// A deliberate close ("Got it" / ✕) counts as seen without waiting out the dwell.
			this.persistSeen();
		} else {
			// Incidental (blur, or another popover's `closeOthers()`). Unread, so don't bank `seen` —
			// instead give back the force-open (bounded) so the tip returns once things settle.
			clearTimeout(this._seenTimer);
			this._seenTimer = undefined;
			if (
				!this._closedByEscape &&
				this._seen?.has(this.mark) === false &&
				!bulblessSeenThisSession.has(this.mark)
			) {
				this.scheduleAutoReopen();
			}
		}
		this._acknowledged = false;
		this._closedByUser = false;
		this._closedByEscape = false;

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

		// Not just `seen`: an incidental close leaves `seen` unbanked, and re-arming is spent, so
		// without this the tip would have no way back for the rest of the session.
		const offered = seen === true || forceOpenedThisSession.has(this.mark);

		const lightbulb =
			content.lightbulb !== false && offered && this.autoShow && !this._open && dismissed === false
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
						<span class="coachmark__title">
							${
								content.icon
									? html`<span
											class="coachmark__icon${
												content.iconTone === 'warning' ? ' coachmark__icon--warning' : ''
											}"
											><code-icon icon=${content.icon}></code-icon
										></span>`
									: nothing
							}
							${content.title}
						</span>
						${
							// A bulb-less mark has no parked fallback for a soft close to defer to, and its
							// buttons are the real choices — no redundant ✕ (Esc still closes for the session).
							content.lightbulb !== false
								? html`<gl-button
										appearance="toolbar"
										density="compact"
										aria-label="Close"
										@click=${this.onCloseClick}
										><code-icon icon="close"></code-icon
									></gl-button>`
								: nothing
						}
					</div>
					<div class="coachmark__body">${content.body()}</div>
					${
						content.trust
							? html`<div class="coachmark__trust">
									<code-icon icon="check"></code-icon>
									<span>${content.trust}</span>
								</div>`
							: nothing
					}
					<div class="coachmark__actions">
						${
							content.action
								? html`<gl-button appearance="secondary" @click=${this.onActionClick}
										>${content.action.label}</gl-button
									>`
								: nothing
						}
						<gl-button @click=${this.onGotItClick}>Got it</gl-button>
					</div>
				</div>
			</gl-popover>
			${lightbulb}`;
	}
}
