import type { GraphRow } from '@gitkraken/gitkraken-components';
import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';
import type { Deferrable } from '../../../../../system/function';
import { debounce } from '../../../../../system/function';
import { getSettledValue, isPromise } from '../../../../../system/promise';
import type { DidGetRowHoverParams } from '../../../../plus/graph/protocol';
import { GlElement } from '../../../shared/components/element';
import type { GlPopover } from '../../../shared/components/overlays/popover.react';
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
	static override styles = css``;

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
	private hoveredSha: string | undefined;
	private unhoverTimer: ReturnType<typeof setTimeout> | undefined;

	override render() {
		if (!this.markdown) {
			this.hide();
			return;
		}

		return html`<gl-popover
			?open=${this.open}
			.anchor=${this.anchor}
			.distance=${this.distance}
			.skidding=${this.skidding}
			.placement=${this.placement}
			trigger="manual"
			@gl-popover-hide=${() => this.hide()}
			@sl-reposition=${() => this.onReposition()}
		>
			<div slot="content">
				<gl-markdown .markdown=${until(this.markdown, 'Loading...')}></gl-markdown>
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

	reset() {
		this.recalculated = false;
		this.hoverMarkdownCache.clear();
	}

	onParentMouseLeave = () => {
		this.hide();
	};

	private _showCoreDebounced: Deferrable<GlGraphHover['showCore']> | undefined = undefined;

	onRowHovered(row: GraphRow, anchor: Anchor) {
		clearTimeout(this.unhoverTimer);
		if (this.requestMarkdown == null) return;
		// Break if we are already showing the hover for the same row
		if (this.hoveredSha === row.sha && this.open) return;

		this.hoveredSha = row.sha;

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

		if (this.open) {
			this.showCore(anchor, markdown);
		} else {
			this._showCoreDebounced ??= debounce(this.showCore.bind(this), 500);
			this._showCoreDebounced(anchor, markdown);
		}
	}

	onRowUnhovered(_row: GraphRow, relatedTarget: EventTarget | null) {
		this.recalculated = false;
		clearTimeout(this.unhoverTimer);

		if (
			relatedTarget != null &&
			'closest' in relatedTarget &&
			(relatedTarget as HTMLElement).closest('gl-graph-hover')
		) {
			return;
		}

		this.unhoverTimer = setTimeout(() => this.hide(), 250);
	}

	onWindowKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
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
			const previousSha = this.hoveredSha;
			void markdown
				.then(markdown => {
					if (previousSha !== this.hoveredSha) return;

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
		this.parentElement?.addEventListener('mouseleave', this.onParentMouseLeave);
		window.addEventListener('keydown', this.onWindowKeydown);
	}

	hide() {
		this._showCoreDebounced?.cancel();
		clearTimeout(this.unhoverTimer);
		this.parentElement?.removeEventListener('mouseleave', this.onParentMouseLeave);
		window.removeEventListener('keydown', this.onWindowKeydown);

		this.hoveredSha = undefined;
		this.markdown = undefined;
		this.open = false;
	}
}
