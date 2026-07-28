import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
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

	@query('gl-popover')
	popup!: GlPopover;

	private hoverMarkdownCache = new Map<
		string,
		Promise<PromiseSettledResult<string>> | PromiseSettledResult<string> | string
	>();
	private shaHovering: string | undefined;
	private unhoverTimer: ReturnType<typeof setTimeout> | undefined;

	// Shared modifier-key tracker — the same source of Alt truth `gl-lit-graph` uses for the Alt-hold lane
	// dim. A bare window keydown/keyup pair wouldn't do: those only fire when the webview iframe has keyboard
	// focus, and hovering the graph never grants it. The tracker also reads `altKey` off pointer events, so
	// Alt registers even while the graph is unfocused.
	private readonly _modifiers = new ModifierKeysController(this);

	override connectedCallback(): void {
		super.connectedCallback?.();

		this.parentElement?.addEventListener('mouseleave', this.onParentMouseLeave);
		window.addEventListener('keydown', this.onWindowKeydown);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this.parentElement?.removeEventListener('mouseleave', this.onParentMouseLeave);
		window.removeEventListener('keydown', this.onWindowKeydown);
	}

	override firstUpdated(): void {
		// Add mouseleave listener to the popover to handle when mouse moves from hover to graph background
		this.popup?.addEventListener('mouseleave', this.onPopoverMouseLeave);
	}

	override willUpdate(): void {
		// Holding Alt dismisses the hover for as long as it's held — Alt drives the graph's branch-lane dim
		// (`activateModifierChain`) and modifies row actions (Open Changes → working tree), both of which need
		// the rows this card covers. The tracker `requestUpdate`s us on every Alt transition, so this fires on
		// the press itself without waiting for a mouse move. `close()` rather than `hide()` so releasing Alt
		// doesn't arm the quick-show window — the card returns only on the next hover, at the normal delay.
		if (this._modifiers.altKey && this.open) {
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
		this.hide();
	};

	private onPopoverMouseLeave = (e: MouseEvent) => {
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
		// Alt is held — stay dismissed (and skip the markdown request entirely). Before `resetUnhoverTimer`
		// so a pending hide still runs.
		if (this._modifiers.altKey) return;

		const showQuickly = performance.now() - this._lastUnhoveredTimestamp <= 750;
		this.resetUnhoverTimer();

		if (this.requestMarkdown == null) return;

		// Break if we are already showing the hover for the same row
		if (row.sha === this.shaHovering && this.open) return;

		this.shaHovering = row.sha;

		let markdown = this.hoverMarkdownCache.get(row.sha);
		if (markdown == null) {
			const cache = row.type !== 'work-dir-changes';

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

		if (this.open || showQuickly) {
			this.showCore(anchor, markdown);
		} else {
			this._showCoreDebounced ??= debounce(this.showCore.bind(this), 500);
			this._showCoreDebounced(anchor, markdown);
		}
	}

	onRowChanged(row: GitGraphRow): void {
		if (!this.open || row.sha === this.shaHovering) return;

		this._showCoreDebounced?.cancel();
		this.hide();
	}

	onRowUnhovered(_row: GitGraphRow, relatedTarget: EventTarget | null): void {
		this.recalculated = false;
		this.resetUnhoverTimer();
		this._showCoreDebounced?.cancel();

		if (relatedTarget != null && relatedTarget instanceof HTMLElement) {
			if (relatedTarget.classList.contains('resizable-handle')) {
				this.unhoverTimer = setTimeout(() => this.hide(), 500);
				return;
			}

			if (relatedTarget.closest('gl-graph-hover')) return;
		}

		// Use a short delay to allow row-to-row transitions without flicker.
		// The rowhoverstart event will cancel this timer if moving to another row.
		this.unhoverTimer = setTimeout(() => this.hide(), 150);
	}

	private onWindowKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			this.hide();
		}
	};

	private showCore(
		anchor: string | HTMLElement | { getBoundingClientRect: () => Omit<DOMRect, 'toJSON'> },
		markdown: Promise<PromiseSettledResult<string>> | PromiseSettledResult<string> | string,
	) {
		// Backstop for the deferred paths: a debounced show scheduled before Alt went down would otherwise
		// land while it's held (`willUpdate` can't cancel it — the card isn't `open` yet), as would an
		// awaited markdown resolution.
		if (this._modifiers.altKey) return;

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
						this.hide();
					}
				})
				.catch(() => {});
		} else {
			this.markdown = getSettledValue(markdown);
		}

		this.anchor = anchor;
		this.open = true;
	}

	private _lastUnhoveredTimestamp = 0;

	hide(): void {
		// Arm the quick-show window so hovering another row re-opens without the full delay
		this._lastUnhoveredTimestamp = performance.now();

		this.close();
	}

	/** Closes the hover without arming the `showQuickly` grace window */
	private close(): void {
		this._showCoreDebounced?.cancel();
		this.resetUnhoverTimer();

		this.shaHovering = undefined;
		this.markdown = undefined;
		this.open = false;
	}

	resetUnhoverTimer(): void {
		if (this.unhoverTimer) {
			clearTimeout(this.unhoverTimer);
			this.unhoverTimer = undefined;
		}
	}
}
