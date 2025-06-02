import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { focusableBaseStyles } from './styles/lit/a11y.css';
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
			width: 100%;
		}

		::slotted(gl-breadcrumb-item:not(:last-of-type))::after {
			content: '\\eab6'; /* chevron-right codicon */
			font-family: codicon;
			font-size: 12px;
			width: 12px;
			height: 12px;
			opacity: 0.6;
			display: flex;
			flex-shrink: 0;
			align-items: center;
			justify-content: center;
			position: relative;
			left: -0.6rem;
			margin-right: -0.6rem;
			transition:
				left 0.3s cubic-bezier(0.25, 1, 0.5, 1),
				margin-right 0.3s cubic-bezier(0.25, 1, 0.5, 1);
		}

		::slotted(gl-breadcrumb-item[collapsed]:not(:hover):not(:focus-within):not(:last-of-type))::after {
			left: -1.2rem;
			margin-right: -1.2rem;
		}

		::slotted(:last-child:not(gl-breadcrumb-item:last-of-type)) {
			margin-left: 1rem;
		}
	`;

	override render() {
		return html`<slot></slot>`;
	}
}

@customElement('gl-breadcrumb-item')
export class GlBreadcrumbItem extends LitElement {
	static override styles = [
		focusableBaseStyles,
		css`
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
				min-width: 0;
				flex-shrink: var(--gl-breadcrumb-item-shrink, 1);
			}

			:host([icon]) {
				min-width: calc(24px + 0.6rem);
			}

			:host(:hover),
			:host(:focus-within) {
				flex-shrink: 0;
			}

			.breadcrumb-item {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 0.4rem;
				white-space: nowrap;
				overflow: hidden;
				min-width: 0;
				width: 100%;
				cursor: default;
			}

			.breadcrumb-content {
				display: inline-flex;
				align-items: center;
				gap: 0.6rem;
				vertical-align: middle;
				max-width: 100%;
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
				max-width: 100vw;
				transition: max-width 0.3s cubic-bezier(0.25, 1, 0.5, 1);
			}

			.breadcrumb-tooltip {
				display: inline-flex;
				align-items: center;
				vertical-align: middle;
			}

			slot[name='children'] {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 0.4rem;
				overflow: hidden;
				max-width: 100vw;
				transition: max-width 0.3s cubic-bezier(0.25, 1, 0.5, 1);
			}

			:host([collapsed]) .breadcrumb-item:not(:hover):not(:focus-within) .breadcrumb-label,
			:host([collapsed]) .breadcrumb-item:not(:hover):not(:focus-within) slot[name='children'] {
				max-width: 0;
			}
		`,
	];

	@state()
	private _collapsed: boolean | undefined;
	@property({ type: Boolean, reflect: true })
	private get collapsed(): boolean {
		return this._collapsed ?? this.collapsibleState === 'collapsed';
	}
	private set collapsed(value: boolean) {
		this._collapsed = value;
	}

	private get collapsible(): boolean {
		return this.collapsibleState !== 'none';
	}

	@property({ type: String })
	collapsibleState: CollapsibleState = 'none';

	@property()
	icon?: string;

	@property()
	iconTooltip?: string;

	private _shrink: number = 1;
	get shrink(): number {
		return this._shrink;
	}
	@property({ type: Number })
	set shrink(value: number) {
		const oldValue = this._shrink;
		this._shrink = value;
		this.style.setProperty('--gl-breadcrumb-item-shrink', String(value));
		this.requestUpdate('shrink', oldValue);
	}

	override render() {
		const { collapsed, collapsible } = this;

		return html`<div class=${classMap({ 'breadcrumb-item': true, collapsible: collapsible })}>
			<span class="breadcrumb-content">
				${this.renderIcon(collapsible, collapsed)}
				<slot class="breadcrumb-label"></slot>
			</span>
			<slot name="children"></slot>
		</div>`;
	}

	private renderIcon(collapsible: boolean, collapsed: boolean) {
		if (!this.icon) return nothing;

		if (!collapsible && !this.iconTooltip) {
			return html`<code-icon class="breadcrumb-icon" icon="${this.icon}"></code-icon>`;
		}

		return html`<gl-tooltip
			content="${collapsible ? (collapsed ? 'Click to Expand' : 'Click to Collapse') : this.iconTooltip}"
			placement="bottom"
		>
			<code-icon
				class="breadcrumb-icon"
				icon="${this.icon}"
				tabindex="0"
				@click=${collapsible ? this.onToggleCollapse : undefined}
				@keyup=${collapsible ? this.onToggleCollapse : undefined}
			></code-icon>
		</gl-tooltip>`;
	}

	private onToggleCollapse = (e: MouseEvent | KeyboardEvent) => {
		e.preventDefault();
		e.stopPropagation();

		if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') {
			return;
		}

		this.collapsed = !this.collapsed;
	};
}

@customElement('gl-breadcrumb-item-child')
export class GlBreadcrumbItemChild extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: row;
			align-items: center;
			white-space: nowrap;
			overflow: hidden;
			margin-right: 0.6rem;
		}

		:host::before {
			content: '\\eab6'; /* chevron-right codicon */
			font-family: codicon;
			font-size: 12px;
			width: 12px;
			height: 12px;
			opacity: 0.6;
			margin-right: 0.4rem;
			display: flex;
			flex-shrink: 0;
			align-items: center;
			justify-content: center;
		}

		.breadcrumb-label {
			display: inline-block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	`;

	override render() {
		return html`<slot></slot>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-breadcrumbs': GlBreadcrumbs;
		'gl-breadcrumb-item': GlBreadcrumbItem;
		'gl-breadcrumb-item-child': GlBreadcrumbItemChild;
	}
}
