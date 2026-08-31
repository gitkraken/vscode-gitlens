import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import type { Ref } from 'lit/directives/ref.js';
import { createRef, ref } from 'lit/directives/ref.js';
import type { GlPopover } from '@gitlens/components/components/overlays/popover.js';

/** One-time-bound view of the host state the delegated tooltip reads. Built ONCE by
 *  `<gl-lit-graph>` as closures over itself; none of these run on a hot path. */
export type DelegatedTooltipHost = {
	isDraggingColumn(): boolean;
	renderRefMetadataTooltip(type: 'pullRequest' | 'issue', refId: string | undefined): TemplateResult | undefined;
};

// Ref-pill segments that own a tooltip of their own, in the order `expandedTwinIfCovered` tests them.
const pillTooltipSegmentClasses = [
	'gl-graph__ref-pill-upstream',
	'gl-graph__ref-pill-pr',
	'gl-graph__ref-pill-issue',
] as const;

/**
 * Shared delegated tooltip: ONE `<gl-popover trigger="manual">` retargeted per hover instead of a
 * tooltip per cell — rows carry a plain `data-tooltip` string and the host anchors + shows the single
 * popover. Keeps the rich GitLens tooltip styling without adding a tooltip to every row.
 *
 * Owns the show/hide timer state machine, the target resolution (`data-tooltip` strings, scroll-rail
 * row bands, PR/issue metadata cards), and the popover element ref + its render.
 */
export class DelegatedTooltipController implements ReactiveController {
	private readonly _popoverRef: Ref<GlPopover> = createRef();
	// Open state is DECOUPLED from the anchor: on hide we flip `_open` to false but KEEP the anchor
	// until the close settles. Nulling the anchor while still open made the popover reposition to the
	// webview's top-left corner (no reference) as it animated out — especially the jump tooltip, whose
	// anchor (the expand overlay's copy) loses its layout box the instant the pill un-hovers.
	private _anchor?: HTMLElement;
	private _open = false;
	private _text = '';
	private _icon = '';
	// Rich tooltip body (a template) — for tooltips that need an INLINE icon mid-text (e.g. the split
	// pill's "Jump to ☁ origin/main"), which the scalar leading-icon path can't express.
	private _content?: TemplateResult;
	private _placement: 'top' | 'left' = 'top';
	private _showTimer?: ReturnType<typeof setTimeout>;
	private _hideTimer?: ReturnType<typeof setTimeout>;

	private readonly _controllerHost: ReactiveControllerHost;

	constructor(controllerHost: ReactiveControllerHost, deps: DelegatedTooltipHost) {
		this._controllerHost = controllerHost;
		this.deps = deps;
		controllerHost.addController(this);
	}

	private readonly deps: DelegatedTooltipHost;

	hostDisconnected(): void {
		this._clearShowTimer();
		this._clearHideTimer();
	}

	// Resolve + show the delegated tooltip for a `data-tooltip` element. Shared by the
	// pointer (`onPointerOverTooltip`) and keyboard (`showForFocus`) paths.
	showForTarget(target: HTMLElement): void {
		if (target === this._anchor) {
			// Re-entering the same anchor (still open, or just-closed within the keep window): cancel the
			// pending hide/clear and re-open in place — content is still set, so no re-fetch/flash. Also
			// dedupes a coincident hover+focus on one element (the host anchors one tooltip at a time).
			if (this._hideTimer != null) {
				clearTimeout(this._hideTimer);
				this._hideTimer = undefined;
			}
			this._open = true;
			this._controllerHost.requestUpdate();

			return;
		}

		// PR/issue chips: the card is rendered from the ref's live metadata rather than duplicated into the
		// DOM per chip, so it resolves here instead of coming in as a `data-tooltip` string.
		//
		// Matched on the two metadata types that HAVE a card — `data-ref-metadata-type` is older than this
		// path and also marks the upstream and merge-target segments (for double-click routing), which carry
		// ordinary `data-tooltip` strings. Claiming every element with the attribute swallowed their
		// tooltips. A chip whose metadata has since been invalidated falls through too, and the generic
		// path below hides it.
		const metadataType = target.dataset.refMetadataType;
		if (metadataType === 'pullRequest' || metadataType === 'issue') {
			const content = this._resolveRefMetadataTooltip(metadataType, target.dataset.refId);
			if (content != null) {
				this.showContent(target, content, 'top', 280);
				return;
			}
		}

		const text = target.dataset.tooltip ?? '';
		if (text.length === 0) {
			this.scheduleHide();
			return;
		}

		// Targets can opt into a side placement (e.g. the right-edge scroll markers anchor to the
		// LEFT), a leading icon (codicon name), and a faster reveal — those show near-instantly;
		// row-cell tooltips keep the longer dwell so they don't flash while scanning.
		const placement = target.dataset.tooltipPlacement === 'left' ? 'left' : 'top';
		const delay = placement === 'left' ? 60 : 280;
		const icon = target.dataset.tooltipIcon ?? '';
		// `data-tooltip-action` opts into an INLINE icon: "<action> <icon> <text>" (the glyph stands in
		// for a word — e.g. the split pill's cloud=Upstream / vm=Local). The accessible name stays in
		// the element's aria-label, which spells the word out for screen readers.
		const action = target.dataset.tooltipAction;
		if (action != null && action.length > 0 && icon.length > 0) {
			this.showContent(
				target,
				html`${action}
					<code-icon class="gl-graph__tooltip-icon" icon=${icon}></code-icon>
					${text}`,
				placement,
				delay,
			);
			return;
		}

		this.show(target, text, icon, placement, delay);
	}

	// Keyboard focus → same delegated tooltip resolver. Cheap + delegated (rides the viewport `focusin`).
	showForFocus(event: FocusEvent): void {
		if (this.deps.isDraggingColumn()) return;

		const target = this.closestTarget(event.target);
		if (target == null) return;
		// The mode-picker strip labels itself (aria + is-current highlight) — a tooltip popping over the
		// just-opened menu from its own programmatic focus is noise, not help.
		if (target.closest('.gl-graph__changes-mode-strip') != null) return;

		// A focused pill sub-chip is hidden behind the expand overlay; anchor to its visible twin instead.
		this.showForTarget(this._expandedTwinIfCovered(target));
	}

	/** When `target` is a pill sub-chip covered by the (shown) expand overlay, return its visible twin inside
	 *  `.gl-graph__ref-pill-expand` so a keyboard tooltip anchors to what's on screen, not the covered copy. */
	private _expandedTwinIfCovered(target: HTMLElement): HTMLElement {
		const pill = target.closest<HTMLElement>('.gl-graph__ref-pill');
		if (pill == null || target.closest('.gl-graph__ref-pill-expand') != null) return target;

		const expand = pill.querySelector<HTMLElement>('.gl-graph__ref-pill-expand');
		if (expand == null || getComputedStyle(expand).display === 'none') return target;

		// The pill's tooltip-bearing segments: the upstream half (jump / status, a `data-tooltip` string) and
		// the PR / issue chips (a card resolved from `refsMetadata`). Each has a twin inside -expand.
		const segment = pillTooltipSegmentClasses.find(c => target.classList.contains(c));
		const twin = segment != null ? expand.querySelector<HTMLElement>(`.${segment}`) : null;

		return twin ?? target;
	}

	/** Whether a pointerout is just a move WITHIN the current anchor's subtree (child-to-child churn) —
	 *  the caller must ignore those entirely rather than schedule a hide. */
	isPointerOutWithinAnchor(event: PointerEvent): boolean {
		// Only react when the pointer actually leaves the current anchor (not when moving to a child).
		const related = event.relatedTarget;
		return this._anchor != null && related instanceof Node && this._anchor.contains(related);
	}

	closestTarget(node: EventTarget | null): HTMLElement | undefined {
		if (!(node instanceof Element)) return undefined;

		// Match scalar tooltips and metadata cards. `data-ref-metadata-type` joins them: the PR/issue chips
		// carry no tooltip STRING — their card is
		// built from the ref's metadata at hover time — so without this they'd resolve to null and the row
		// hover card would fire over the chip instead.
		const el = node.closest<HTMLElement>('[data-tooltip], [data-ref-metadata-type]');
		return el ?? undefined;
	}

	/** The hover card for a PR/issue chip, resolved from the same `refsMetadata` the chip was rendered from.
	 *  Undefined when the metadata has since been invalidated — the chip outlives a refresh by a frame. */
	private _resolveRefMetadataTooltip(type: string, refId: string | undefined): TemplateResult | undefined {
		return type === 'pullRequest' || type === 'issue' ? this.deps.renderRefMetadataTooltip(type, refId) : undefined;
	}

	// Scalar tooltip (one icon + one text string) — used by row cells, lane-fold chips, WIP stats.
	show(anchor: HTMLElement, text: string, icon: string, placement: 'top' | 'left', delay: number): void {
		this._schedule(anchor, placement, delay, () => {
			this._icon = icon;
			this._text = text;
			this._content = undefined;
		});
	}

	// Rich tooltip (a template with an inline icon). Mutually exclusive with the scalar path.
	showContent(anchor: HTMLElement, content: TemplateResult, placement: 'top' | 'left', delay: number): void {
		this._schedule(anchor, placement, delay, () => {
			this._icon = '';
			this._text = '';
			this._content = content;
		});
	}

	private _schedule(anchor: HTMLElement, placement: 'top' | 'left', delay: number, apply: () => void): void {
		if (this._hideTimer != null) {
			clearTimeout(this._hideTimer);
			this._hideTimer = undefined;
		}

		// Re-anchoring an open popover doesn't always reposition cleanly, so close-then-open on a
		// short delay — also debounces rapid passes over many cells so we don't flash per row.
		const open = (): void => {
			this._showTimer = undefined;
			this._placement = placement;
			this._anchor = anchor;
			this._open = true;
			apply();
			this._controllerHost.requestUpdate();
		};
		// Close the current popover (keep its anchor for a clean in-place close) before reopening.
		this._open = false;
		this._controllerHost.requestUpdate();

		if (this._showTimer != null) {
			clearTimeout(this._showTimer);
		}

		this._showTimer = setTimeout(open, delay);
	}

	scheduleHide(): void {
		if (this._showTimer != null) {
			clearTimeout(this._showTimer);
			this._showTimer = undefined;
		}
		if (!this._open || this._hideTimer != null) return;

		// Close IMMEDIATELY (so the popover stops tracking and animates out from its current spot — not from
		// the corner once its anchor's box vanishes), but keep the anchor + content briefly so re-entering
		// the same element reopens cleanly.
		this._open = false;
		this._controllerHost.requestUpdate();
		this._hideTimer = setTimeout(() => {
			this._hideTimer = undefined;
			this._anchor = undefined;
			this._text = '';
			this._content = undefined;
			this._controllerHost.requestUpdate();
		}, 120);
	}

	private _clearShowTimer(): void {
		if (this._showTimer != null) {
			clearTimeout(this._showTimer);
			this._showTimer = undefined;
		}
	}

	private _clearHideTimer(): void {
		if (this._hideTimer != null) {
			clearTimeout(this._hideTimer);
			this._hideTimer = undefined;
		}
	}

	render(): TemplateResult {
		return html`<gl-popover
			${ref(this._popoverRef)}
			class="gl-graph__tooltip"
			trigger="manual"
			placement=${this._placement}
			arrow
			.distance=${6}
			.anchor=${this._anchor}
			.open=${this._open}
		>
			<span slot="anchor"></span>
			<span slot="content" class="gl-graph__tooltip-content"
				>${
					this._content ??
					html`${
						this._icon.length > 0
							? html`<code-icon class="gl-graph__tooltip-icon" icon=${this._icon}></code-icon>`
							: nothing
					}${this._text}`
				}</span
			>
		</gl-popover>`;
	}
}
