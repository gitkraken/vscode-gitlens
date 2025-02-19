import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import './code-icon';
import './overlays/tooltip';

export type CollapsibleState = 'none' | 'collapsed' | 'expanded';

@customElement('gl-breadcrumbs')
export class GlBreadcrumbs extends LitElement {
	static override styles = css`
		* {
			box-sizing: border-box;
		}

		:host {
			display: flex;
			flex-direction: row;
			flex-wrap: nowrap;
			align-items: center;
			gap: 0.4rem;
			overflow: hidden;
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
		}

		::slotted(gl-breadcrumb-item:not(:first-child))::before {
			content: '\\eab6'; /* chevron-right codicon */
			display: flex;
			flex-shrink: 0;
			opacity: 0.6;
			font-family: codicon;
			font-size: 12px;
			width: 12px;
			height: 12px;
			align-items: center;
			justify-content: center;
		}
	`;

	override render() {
		return html`<slot></slot>`;
	}
}

@customElement('gl-breadcrumb-item')
export class GlBreadcrumbItem extends LitElement {
	static override styles = css`
		* {
			box-sizing: border-box;
		}

		:host {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0.4rem;
			white-space: nowrap;
			overflow: hidden;
		}

		.breadcrumb-item {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0.4rem;
			white-space: nowrap;
			overflow: hidden;
		}

		.breadcrumb-content {
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			vertical-align: middle;
		}

		.breadcrumb-icon {
			flex-shrink: 0;
			z-index: 2;
		}

		.collapsible .breadcrumb-icon {
			cursor: pointer;
		}

		.breadcrumb-label {
			display: inline-block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
		}

		slot[name='children'] {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0.4rem;
			overflow: hidden;
			transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
		}

		slot[name='children']::slotted(*) {
			margin-right: 0.4rem;
		}

		slot[name='children']::slotted(:last-child) {
			margin-right: 0;
		}

		.collapsed .breadcrumb-label,
		.collapsed slot[name='children'] {
			width: 0;
			opacity: 0;
			margin-left: -0.4rem;
		}

		.collapsed:hover .breadcrumb-label,
		.collapsed:hover slot[name='children'] {
			width: max-content;
			opacity: 1;
			margin-left: 0;
		}
	`;

	@state()
	private _collapsed: boolean | undefined;
	@property({ type: Boolean, reflect: true })
	private get collapsed(): boolean {
		if (this._collapsed == null) {
			return this.collapsibleState === 'collapsed' && !this._hovering;
		}
		return this._collapsed && !this._hovering;
	}
	private set collapsed(value: boolean) {
		this._collapsed = value;
	}

	private get collapsible(): boolean {
		return this.collapsibleState === 'collapsed' || this.collapsibleState === 'expanded';
	}

	@property({ type: String })
	collapsibleState: CollapsibleState = 'none';

	@property()
	icon?: string;

	@property()
	tooltip: string = '';

	@state()
	private _hovering: boolean = false;

	override render() {
		const { collapsed, collapsible } = this;

		return html`
			<div
				class=${classMap({
					'breadcrumb-item': true,
					collapsed: collapsed,
					collapsible: collapsible,
				})}
				@mouseenter=${collapsible ? this.onMouseEnter : undefined}
				@mouseleave=${collapsible ? this.onMouseLeave : undefined}
			>
				<gl-tooltip content="${this.tooltip}" placement="bottom">
					<span class="breadcrumb-content">
						${this.icon
							? html`<code-icon
									class="breadcrumb-icon"
									icon="${this.icon}"
									@click=${collapsible ? this.onToggleCollapse : undefined}
							  ></code-icon>`
							: nothing}
						<slot class="breadcrumb-label"></slot>
					</span>
				</gl-tooltip>
				<slot name="children"></slot>
			</div>
		`;
	}

	private onMouseEnter = () => (this._hovering = true);
	private onMouseLeave = () => (this._hovering = false);

	private onToggleCollapse = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();

		this._collapsed = !(this._collapsed ?? this.collapsibleState === 'collapsed');
	};
}

@customElement('gl-breadcrumb-item-child')
export class GlBreadcrumbItemChild extends LitElement {
	static override styles = css`
		:host {
			display: inline-block;
			vertical-align: middle;
			/* margin-right: 0.4rem; */
		}

		/* :host:last-of-type {
			margin-right: 0;
		} */

		:host::before {
			content: '\\eab6'; /* chevron-right codicon */
			opacity: 0.6;
			font-family: codicon;
			font-size: 12px;
			width: 12px;
			height: 12px;
		}

		.breadcrumb-label {
			display: inline-block;
		}
	`;

	@property()
	tooltip: string = '';

	override render() {
		return html`<gl-tooltip content="${this.tooltip}" placement="bottom">
			<span class="breadcrumb-label"><slot></slot></span>
		</gl-tooltip>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-breadcrumbs': GlBreadcrumbs;
		'gl-breadcrumb-item': GlBreadcrumbItem;
		'gl-breadcrumb-item-child': GlBreadcrumbItemChild;
	}
}
