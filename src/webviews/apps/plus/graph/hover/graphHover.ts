import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { OverlayEntry } from '@gitlens/utils/keys/keybinding.js';
import { getSettledValue, isPromise } from '@gitlens/utils/promise.js';
import type { DidGetRowHoverParams } from '../../../../plus/graph/protocol.js';
import { GlElement } from '../../../shared/components/element.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import { ModifierKeysController } from '../../../shared/controllers/modifier-keys.js';
import '../../../shared/components/markdown/markdown.js';
import '../../../shared/components/overlays/popover.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-hover': GlGraphHover;
	}

	// interface GlobalEventHandlersEventMap {
	// 	'gl-popover-show': CustomEvent<void>;
	// 	'gl-popover-after-show': CustomEvent<void>;
	// 	'gl-popover-hide': CustomEvent<void>;
	// 	'gl-popover-after-hide': CustomEvent<void>;
	// }
}

type Anchor = string | HTMLElement | { getBoundingClientRect: () => Omit<DOMRect, 'toJSON'> };

@customElement('gl-graph-hover')
export class GlGraphHover extends GlElement {
	static override styles = css`
		:host {
			position: absolute;
			z-index: var(--gl-z-popover);
		}

		gl-popover::part(body) {
			--max-width: min(92vw, 45rem);

			width: clamp(min(30rem, 92vw), min-content, max-content);
			max-height: 50vh;
			overflow: hidden auto;
		}
	`;

	@property({ type: Object })
	anchor?: Anchor;

	@property({ reflect: true, type: Number })
	distance?: number | undefined;

	@property({ reflect: true, type: Boolean })
	open?: boolean = false;

	@property({ reflect: true })
	placement?: GlPopover['placement'] = 'bottom-start';

	@property({ type: Object })
	markdown?: Promise<PromiseSettledResult<string>> | string;

	@property({ reflect: true, type: Number })
	skidding?: number | undefined;

	@property({ type: Function })
	requestMarkdown: ((row: GitGraphRow) => Promise<DidGetRowHoverParams>) | undefined;

	/** Pushes this card onto the keymap's Esc overlay stack while it's open, so one Esc closes the
	 *  topmost surface only. Injected by `graph-app`, which owns the dispatcher. */
	@property({ attribute: false })
	pushOverlay?: (entry: OverlayEntry) => Disposable;

	@query('gl-popover')
	popup!: GlPopover;

	private hoverMarkdownCache = new Map<
		string,
		Promise<PromiseSettledResult<string>> | PromiseSettledResult<string> | string
	>();
	private shaHovering: string | undefined;
	private unhoverTimer: ReturnType<typeof setTimeout> | undefined;

	// ————— Keyboard peek —————
	// A card opened from the keyboard (`i` / `mod+I`) is PINNED: no pointer is inside it, so every
	// pointer-driven close path (row exit, parent/popover mouseleave, the row under a scroll changing) must
	// leave it alone. It closes on Esc (the overlay stack, pushed by `showCore` like any card), a second `i`,
	// focus leaving the graph, or its anchor row being virtualized away — all driven by `gl-lit-graph`.
	// TODO: focus never moves INTO the card, so its links/actions stay keyboard-unreachable; reaching them
	// needs a focus trap plus a way back out to the row (the card content is markdown, so also a tab order).
	private _peeked = false;
	/** Set by the pointermove listener that's live only while peeked — see {@link onRowHovered}. */
	private _pointerMovedSincePeek = false;
	/** Set around a graph-REQUESTED peek close (`closePeek`), where the graph already knows and announces —
	 *  the `gl-graph-hoverpeekclosed` event is only for closes the graph can't see (Esc's overlay pop). */
	private _suppressPeekClosedEvent = false;

	// Shared modifier-key tracker — the same source of Ctrl/Alt truth `gl-lit-graph` uses for the modifier-
	// hold lane dim. A bare window keydown/keyup pair wouldn't do: those only fire when the webview iframe
	// has keyboard focus, and hovering the graph never grants it. The tracker also reads the modifiers off
	// pointer events, so a hold registers even while the graph is unfocused.
	private readonly _modifiers = new ModifierKeysController(this);

	/** Live overlay-stack registration — non-null exactly while the card is open. */
	private _overlay: Disposable | undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.parentElement?.addEventListener('mouseleave', this.onParentMouseLeave);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this.parentElement?.removeEventListener('mouseleave', this.onParentMouseLeave);
		this.unpeek();
		this._overlay?.dispose();
		this._overlay = undefined;
	}

	override firstUpdated(): void {
		// Add mouseleave listener to the popover to handle when mouse moves from hover to graph background
		this.popup?.addEventListener('mouseleave', this.onPopoverMouseLeave);
	}

	override willUpdate(): void {
		// Holding Ctrl or Alt dismisses the hover for as long as it's held — both drive the graph's
		// branch-lane dim (`activateModifierChain`), which needs the rows this card covers. The card itself
		// is pure markdown with nothing modifier-dependent; the [Alt] alternate row actions (Open Changes →
		// working tree) live on the row's action strip, which stays clickable regardless. The tracker
		// `requestUpdate`s us on every modifier transition, so this fires on the press itself without
		// waiting for a mouse move. `close()` rather than `hide()` so releasing doesn't arm the quick-show
		// window — the card returns only on the next hover, at the normal delay.
		if ((this._modifiers.ctrlKey || this._modifiers.altKey) && this.open && !this._peeked) {
			this.close();
		}
	}

	override render(): unknown {
		return html`<gl-popover
			?open=${this.open}
			.anchor=${this.anchor}
			.distance=${this.distance}
			.skidding=${this.skidding}
			.placement=${this.placement}
			trigger="manual"
			@sl-reposition=${this.onReposition}
		>
			<div slot="content">
				<gl-markdown .markdown=${until(this.markdown ?? 'Loading...', 'Loading...')}></gl-markdown>
			</div>
		</gl-popover>`;
	}

	private previousSkidding: number | undefined;
	private recalculated = false;

	private onReposition() {
		if (this.skidding == null || (this.placement !== `bottom-start` && this.placement !== `top-start`)) {
			return;
		}

		switch (this.popup?.currentPlacement) {
			case 'bottom-end':
			case 'top-end':
				if (!this.recalculated && this.previousSkidding == null) {
					this.previousSkidding = this.skidding;
					this.skidding = -this.skidding * 5;
					this.recalculated = true;
				}
				break;
			default:
				if (this.previousSkidding != null) {
					this.skidding = this.previousSkidding;
					this.previousSkidding = undefined;
				}
				break;
		}
	}

	reset(): void {
		this.recalculated = false;
		this.hoverMarkdownCache.clear();
	}

	private onParentMouseLeave = () => {
		if (this._peeked) return;

		this.hide();
	};

	private onPopoverMouseLeave = (e: MouseEvent) => {
		if (this._peeked) return;

		// When mouse leaves the popover, check if it's going to a graph row or staying within the hover component
		const relatedTarget = e.relatedTarget;
		if (relatedTarget != null && relatedTarget instanceof HTMLElement) {
			// Don't hide if moving to another part of the hover component
			if (relatedTarget.closest('gl-graph-hover')) return;
		}

		// Use a small delay to allow row hover events to fire first
		// If moving to another row, the row hover event will cancel this timer and show the new hover
		// If moving to graph background, this timer will hide the hover
		this.unhoverTimer = setTimeout(() => this.hide(), 100);
	};

	private _showCoreDebounced: Deferrable<GlGraphHover['showCore']> | undefined = undefined;

	onRowHovered(row: GitGraphRow, anchor: Anchor): void {
		// Ctrl or Alt is held — stay dismissed (and skip the markdown request entirely). Before
		// `resetUnhoverTimer` so a pending hide still runs.
		if (this._modifiers.ctrlKey || this._modifiers.altKey) return;

		// Pointer takeover while a keyboard peek is pinned: the pointer wins, but only once it has actually
		// MOVED since the peek opened/re-anchored. Chromium re-fires pointerover as rows scroll under a
		// stationary cursor, so without the movement test keyboard paging with the mouse parked over the
		// graph would yank the card onto whatever row happened to slide beneath it.
		if (this._peeked) {
			if (!this._pointerMovedSincePeek) return;

			this.unpeek();
		}

		const showQuickly = performance.now() - this._lastUnhoveredTimestamp <= 750;
		this.resetUnhoverTimer();

		// Break if we are already showing the hover for the same row
		if (row.sha === this.shaHovering && this.open) return;

		const markdown = this.markdownFor(row);
		if (markdown == null) return;

		if (this.open || showQuickly) {
			this.showCore(anchor, markdown);
		} else {
			this._showCoreDebounced ??= debounce(this.showCore.bind(this), 500);
			this._showCoreDebounced(anchor, markdown);
		}
	}

	/** Resolves (and caches) a row's hover markdown, marking it the row the card is now tracking.
	 *  `undefined` only when no requester has been wired up yet. */
	private markdownFor(
		row: GitGraphRow,
	): Promise<PromiseSettledResult<string>> | PromiseSettledResult<string> | string | undefined {
		if (this.requestMarkdown == null) return undefined;

		this.shaHovering = row.sha;

		let markdown = this.hoverMarkdownCache.get(row.sha);
		if (markdown == null) {
			const cache = row.kind !== 'workdir';

			markdown = this.requestMarkdown(row).then(params => {
				if (params.markdown.status === 'fulfilled' && cache) {
					this.hoverMarkdownCache.set(row.sha, params.markdown);
				} else if (params.markdown.status === 'rejected') {
					this.hoverMarkdownCache.delete(row.sha);
				}

				return params.markdown;
			});

			if (cache) {
				this.hoverMarkdownCache.set(row.sha, markdown);
			}
		}

		return markdown;
	}

	/** Opens the card for a keyboard-focused row, or closes an already-peeked one (the `i` toggle).
	 *  Returns whether the card is open afterwards. */
	togglePeek(row: GitGraphRow, anchor: Anchor): boolean {
		if (this._peeked && this.open) {
			// Through `closePeek` for its event suppression: this close is graph-REQUESTED (the toggle's
			// return value tells the graph, which announces) — the external-close event would make the
			// graph announce the same close twice.
			this.closePeek();
			return false;
		}

		return this.peek(row, anchor);
	}

	/** Moves an open peek onto the newly focused row. No-op (returns `false`) unless a peek is showing —
	 *  which is also how `gl-lit-graph` learns the card went away behind its back (Esc, pointer takeover). */
	repeek(row: GitGraphRow, anchor: Anchor): boolean {
		if (!this._peeked || !this.open) return false;

		return this.peek(row, anchor);
	}

	/** Closes the card only if it's a keyboard peek — a pointer hover is none of the keyboard's business. */
	closePeek(): void {
		if (!this._peeked) return;

		this._suppressPeekClosedEvent = true;
		try {
			this.close();
		} finally {
			this._suppressPeekClosedEvent = false;
		}
	}

	private peek(row: GitGraphRow, anchor: Anchor): boolean {
		const markdown = this.markdownFor(row);
		if (markdown == null) return false;

		if (!this._peeked) {
			this._peeked = true;
			this._pointerMovedSincePeek = false;
			window.addEventListener('pointermove', this.onPointerMoveWhilePeeked, { passive: true });
		} else {
			// Re-anchoring restarts the takeover test: the pointer has to move again from wherever it now
			// sits before it can steal a card the keyboard just moved.
			this._pointerMovedSincePeek = false;
		}

		// Straight to `showCore` — no dwell debounce, no quick-show window: the keystroke IS the intent.
		this._showCoreDebounced?.cancel();
		this.showCore(anchor, markdown, true);
		return true;
	}

	private unpeek() {
		this._peeked = false;
		this._pointerMovedSincePeek = false;
		window.removeEventListener('pointermove', this.onPointerMoveWhilePeeked);
	}

	private readonly onPointerMoveWhilePeeked = () => {
		this._pointerMovedSincePeek = true;
	};

	onRowChanged(row: GitGraphRow): void {
		// Pinned: the row under the pointer changing (a scroll) says nothing about the row the keyboard is on.
		if (this._peeked) return;

		if (!this.open || row.sha === this.shaHovering) return;

		this._showCoreDebounced?.cancel();
		this.hide();
	}

	onRowUnhovered(_row: GitGraphRow, relatedTarget: EventTarget | null): void {
		// Pinned: there was never a pointer in the card to leave it.
		if (this._peeked) return;

		this.recalculated = false;
		this.resetUnhoverTimer();
		this._showCoreDebounced?.cancel();

		if (relatedTarget != null && relatedTarget instanceof HTMLElement) {
			if (relatedTarget.classList.contains('gl-graph__resize-handle')) {
				this.unhoverTimer = setTimeout(() => this.hide(), 500);
				return;
			}

			if (relatedTarget.closest('gl-graph-hover')) return;
		}

		// Use a short delay to allow row-to-row transitions without flicker.
		// The rowhoverstart event will cancel this timer if moving to another row.
		this.unhoverTimer = setTimeout(() => this.hide(), 150);
	}

	private showCore(
		anchor: string | HTMLElement | { getBoundingClientRect: () => Omit<DOMRect, 'toJSON'> },
		markdown: Promise<PromiseSettledResult<string>> | PromiseSettledResult<string> | string,
		peeked?: boolean,
	) {
		// Backstop for the deferred paths: a debounced show scheduled before Ctrl/Alt went down would
		// otherwise land while it's held (`willUpdate` can't cancel it — the card isn't `open` yet), as
		// would an awaited markdown resolution. A keyboard peek opts out: the hold gates the POINTER hover
		// (it drives the lane dim over the rows the card would cover), and an explicit keystroke shouldn't
		// silently do nothing because a modifier is down.
		if (!peeked && (this._modifiers.ctrlKey || this._modifiers.altKey)) return;

		if (typeof markdown === 'string') {
			this.markdown = markdown;
		} else if (isPromise(markdown)) {
			this.markdown = undefined;
			const previousSha = this.shaHovering;
			void markdown
				.then(markdown => {
					if (previousSha !== this.shaHovering) return;

					this.markdown = getSettledValue(markdown);
					if (!markdown) {
						// `close`, not `hide`: must also end a pinned peek (hide is peek-inert), and there's
						// no content whose re-show the quick-show grace would speed up.
						this.close();
					}
				})
				.catch(() => {});
		} else {
			this.markdown = getSettledValue(markdown);
		}

		this.anchor = anchor;
		this.open = true;
		// Push at open time, not at construction — the stack is LIFO and its order has to be the order the
		// surfaces actually opened in. Re-anchoring to another row keeps the original entry, so a card that
		// stays up across a row-to-row move doesn't jump the queue.
		this._overlay ??= this.pushOverlay?.({ id: 'graph-hover', onClose: () => this.onOverlayClose() });
	}

	private onOverlayClose(): boolean {
		if (!this.open) return false;

		// `close`, not `hide`: hide is peek-inert (see there), and Esc must end a peek; the quick-show
		// grace hide arms is a pointer affordance an Esc dismissal shouldn't grant anyway.
		this.close();
		return true;
	}

	private _lastUnhoveredTimestamp = 0;

	hide(): void {
		// `hide` is the POINTER path's close (unhover timers, selection changes, parent mouse-leave) — a
		// pinned keyboard peek ignores it entirely. Keyboard navigation changes the selection, and that
		// hide arrived ~50ms before the peek's own re-anchor: without this guard the teardown always won
		// the race and `repeek` found nothing left to move. Paths that must end a peek use `close()`
		// (Esc's overlay close, empty markdown) or `closePeek()`.
		if (this._peeked) return;

		// Arm the quick-show window so hovering another row re-opens without the full delay
		this._lastUnhoveredTimestamp = performance.now();

		this.close();
	}

	/** Closes the hover without arming the `showQuickly` grace window */
	private close(): void {
		this._showCoreDebounced?.cancel();
		this.resetUnhoverTimer();
		// Closing a PEEKED card by a path the graph can't see (Esc's overlay pop) — tell it, so it can
		// sync its own peek flag and announce; graph-requested closes suppress this (see closePeek).
		if (this._peeked && !this._suppressPeekClosedEvent) {
			this.dispatchEvent(new CustomEvent('gl-graph-hoverpeekclosed', { bubbles: true, composed: true }));
		}
		this.unpeek();

		this.shaHovering = undefined;
		this.markdown = undefined;
		this.open = false;
		this._overlay?.dispose();
		this._overlay = undefined;
	}

	resetUnhoverTimer(): void {
		if (this.unhoverTimer) {
			clearTimeout(this.unhoverTimer);
			this.unhoverTimer = undefined;
		}
	}
}
