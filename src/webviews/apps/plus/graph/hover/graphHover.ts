import type { GraphRow } from '@gitkraken/gitkraken-components';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { until } from 'lit/directives/until.js';
import type { DidGetRowHoverParams } from '../../../../../plus/webviews/graph/protocol';
import { isPromise } from '../../../../../system/promise';
import { GlElement } from '../../../shared/components/element';
import type { GlPopover } from '../../../shared/components/overlays/popover.react';
import '../../../shared/components/overlays/popover';
import './markdown';

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
	placement?: GlPopover['placement'] = 'bottom';

	@property({ type: Object })
	markdown?: Promise<string | undefined> | string | undefined;

	@property({ reflect: true, type: Number })
	skidding?: number | undefined;

	@property({ type: Function })
	requestMarkdown: ((row: GraphRow) => Promise<DidGetRowHoverParams | undefined>) | undefined;

	private hoverMarkdownCache = new Map<string, Promise<string> | string>();
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
		>
			<div slot="content">
				<gl-markdown .markdown=${until(this.markdown, 'Loading...')}></gl-markdown>
			</div>
		</gl-popover>`;
	}

	reset() {
		this.hoverMarkdownCache.clear();
	}

	onRowHovered(row: GraphRow, anchor: Anchor) {
		console.log('onRowHovered', row.sha);

		if (this.requestMarkdown == null) return;

		this.hoveredSha = row.sha;

		let markdown = this.hoverMarkdownCache.get(row.sha);
		if (markdown == null) {
			const cache = row.type !== 'work-dir-changes';

			markdown = this.requestMarkdown(row).then(params => {
				if (params?.markdown != null) {
					if (cache) {
						this.hoverMarkdownCache.set(row.sha, params.markdown);
					}
					return params.markdown;
				}

				this.hoverMarkdownCache.delete(row.sha);
				return '';
			});

			if (cache) {
				this.hoverMarkdownCache.set(row.sha, markdown);
			}
		}
		this.showCore(anchor, markdown);
	}

	onRowUnhovered(row: GraphRow, relatedTarget: EventTarget | null) {
		console.log('onRowUnhovered', row.sha);

		clearTimeout(this.unhoverTimer);

		if (
			relatedTarget != null &&
			'closest' in relatedTarget &&
			(relatedTarget as HTMLElement).closest('gl-graph-hover')
		) {
			return;
		}

		this.hoveredSha = undefined;

		this.unhoverTimer = setTimeout(() => {
			console.log('onRowUnhovered timeout', this.hoveredSha);
			if (this.hoveredSha == null) {
				this.hide();
			}
		}, 100);
	}

	private showCore(
		anchor: string | HTMLElement | { getBoundingClientRect: () => Omit<DOMRect, 'toJSON'> },
		markdown: Promise<string | undefined> | string | undefined,
	) {
		if (isPromise(markdown)) {
			void markdown.then(markdown => {
				this.markdown = markdown;
				if (!markdown) {
					this.open = false;
				}
			});
		}

		this.anchor = anchor;
		this.markdown = markdown;
		this.open = true;
	}

	hide() {
		this.open = false;
	}
}
