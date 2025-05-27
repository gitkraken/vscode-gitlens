import type { GraphRow } from '@gitkraken/gitkraken-components';
import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';
import type { Deferrable } from '../../../../../system/function/debounce';
import { debounce } from '../../../../../system/function/debounce';
import { getSettledValue, isPromise } from '../../../../../system/promise';
import type { DidGetRowHoverParams } from '../../../../plus/graph/protocol';
import { GlElement } from '../../../shared/components/element';
import type { GlPopover } from '../../../shared/components/overlays/popover';
import '../../../shared/components/markdown/markdown';
import '../../../shared/components/overlays/popover';

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
		gl-popover::part(body) {
			--max-width: min(92vw, 45rem);
			max-height: 50vh;
			width: clamp(min(30rem, 92vw), min-content, max-content);
			overflow-x: hidden;
			overflow-y: auto;
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
	requestMarkdown: ((row: GraphRow) => Promise<DidGetRowHoverParams>) | undefined;

	@query('gl-popover')
	popup!: GlPopover;

	private hoverMarkdownCache = new Map<
		string,
		Promise<PromiseSettledResult<string>> | PromiseSettledResult<string> | string
	>();
	private shaHovering: string | undefined;
	private unhoverTimer: ReturnType<typeof setTimeout> | undefined;

	override connectedCallback(): void {
		super.connectedCallback();

		this.parentElement?.addEventListener('mouseleave', this.onParentMouseLeave);
		window.addEventListener('keydown', this.onWindowKeydown);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		this.parentElement?.removeEventListener('mouseleave', this.onParentMouseLeave);
		window.removeEventListener('keydown', this.onWindowKeydown);
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

	private _showCoreDebounced: Deferrable<GlGraphHover['showCore']> | undefined = undefined;

	onRowHovered(row: GraphRow, anchor: Anchor): void {
		const showQuickly = Date.now() - this._lastUnhoveredTimestamp <= 750;
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

	onRowUnhovered(_row: GraphRow, relatedTarget: EventTarget | null): void {
		this.recalculated = false;
		this.resetUnhoverTimer();

		if (relatedTarget != null && relatedTarget instanceof HTMLElement) {
			if (relatedTarget.classList.contains('resizable-handle')) {
				this.unhoverTimer = setTimeout(() => this.hide(), 500);
				return;
			}

			if (relatedTarget.closest('gl-graph-hover')) return;
		}

		this.hide();
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
		if (typeof markdown === 'string') {
			this.markdown = markdown;
		} else if (isPromise(markdown)) {
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
		this._lastUnhoveredTimestamp = Date.now();

		this._showCoreDebounced?.cancel();
		this.resetUnhoverTimer();

		this.shaHovering = undefined;
		this.markdown = undefined;
		this.open = false;
	}

	private resetUnhoverTimer(): void {
		if (this.unhoverTimer) {
			clearTimeout(this.unhoverTimer);
			this.unhoverTimer = undefined;
		}
	}
}
