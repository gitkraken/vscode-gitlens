import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { TextDocumentShowOptions } from 'vscode';
import '../converters/number-converter';
import '../code-icon';

// Can only import types from 'vscode'
const BesideViewColumn = -2; /*ViewColumn.Beside*/

declare global {
	interface HTMLElementEventMap {
		selected: CustomEvent;
	}
}

export type ListItemSelectedEvent = CustomEvent<ListItemSelectedEventDetail>;

export interface ListItemSelectedEventDetail {
	tree: boolean;
	branch: boolean;
	expanded: boolean;
	level: number;
	showOptions?: TextDocumentShowOptions;
}

@customElement('list-item')
export class ListItem extends LitElement {
	static override styles = css`
		:host {
			box-sizing: border-box;
			padding-left: var(--gitlens-gutter-width);
			padding-right: var(--gitlens-scrollbar-gutter-width);
			padding-top: 0.1rem;
			padding-bottom: 0.1rem;
			line-height: 2.2rem;
			height: 2.2rem;

			display: flex;
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			font-size: var(--vscode-font-size);
			color: var(--vscode-sideBar-foreground);

			content-visibility: auto;
			contain-intrinsic-size: auto 2.2rem;
		}

		:host(:hover) {
			color: var(--vscode-list-hoverForeground);
			background-color: var(--vscode-list-hoverBackground);
		}

		:host([active]) {
			color: var(--vscode-list-inactiveSelectionForeground);
			background-color: var(--vscode-list-inactiveSelectionBackground);
		}

		:host(:focus-within) {
			outline: 1px solid var(--vscode-list-focusOutline);
			outline-offset: -0.1rem;
			color: var(--vscode-list-activeSelectionForeground);
			background-color: var(--vscode-list-activeSelectionBackground);
		}

		:host([aria-hidden='true']) {
			display: none;
		}

		* {
			box-sizing: border-box;
		}

		.item {
			appearance: none;
			display: flex;
			flex-direction: row;
			justify-content: flex-start;
			align-items: center;
			gap: 0.6rem;
			width: 100%;
			padding: 0;
			text-decoration: none;
			color: inherit;
			background: none;
			border: none;
			outline: none;
			cursor: pointer;
			min-width: 0;
		}

		.icon {
			display: inline-block;
			width: 1.6rem;
			text-align: center;
		}

		slot[name='icon']::slotted(*) {
			width: 1.6rem;
			aspect-ratio: 1;
			vertical-align: text-bottom;
		}

		.node {
			display: inline-block;
			width: 1.6rem;
			text-align: center;
		}

		.node--connector {
			position: relative;
		}
		.node--connector::before {
			content: '';
			position: absolute;
			height: 2.2rem;
			border-left: 1px solid transparent;
			top: 50%;
			transform: translate(-50%, -50%);
			left: 0.8rem;
			width: 0.1rem;
			transition: border-color 0.1s linear;
			opacity: 0.4;
		}

		:host-context(.indentGuides-always) .node--connector::before,
		:host-context(.indentGuides-onHover:focus-within) .node--connector::before,
		:host-context(.indentGuides-onHover:hover) .node--connector::before {
			border-color: var(--vscode-tree-indentGuidesStroke);
		}

		.text {
			line-height: 1.6rem;
			overflow: hidden;
			white-space: nowrap;
			text-align: left;
			text-overflow: ellipsis;
			flex: 1;
		}

		.description {
			opacity: 0.7;
			margin-left: 0.3rem;
		}

		.actions {
			flex: none;
			user-select: none;
			color: var(--vscode-icon-foreground);
		}

		:host(:focus-within) .actions {
			color: var(--vscode-list-activeSelectionIconForeground);
		}

		:host(:not(:hover):not(:focus-within)) .actions {
			display: none;
		}

		slot[name='actions']::slotted(*) {
			display: flex;
			align-items: center;
		}

		.checkbox {
			position: relative;
			display: inline-flex;
			width: 1.6rem;
			aspect-ratio: 1 / 1;
			text-align: center;
			color: var(--vscode-checkbox-foreground);
			background: var(--vscode-checkbox-background);
			border: 1px solid var(--vscode-checkbox-border);
			border-radius: 0.3rem;
			// overflow: hidden;
		}

		.checkbox:has(:checked) {
			color: var(--vscode-inputOption-activeForeground);
			border-color: var(--vscode-inputOption-activeBorder);
			background-color: var(--vscode-inputOption-activeBackground);
		}

		.checkbox:has(:disabled) {
			opacity: 0.4;
		}

		.checkbox__input {
			position: absolute;
			top: 0;
			left: 0;
			appearance: none;
			width: 1.4rem;
			aspect-ratio: 1 / 1;
			margin: 0;
			cursor: pointer;
			border-radius: 0.3rem;
		}

		.checkbox__input:disabled {
			cursor: default;
		}

		.checkbox__check {
			width: 1.6rem;
			aspect-ratio: 1 / 1;
			opacity: 0;
			transition: opacity 0.1s linear;
			color: var(--vscode-checkbox-foreground);
			pointer-events: none;
		}

		.checkbox__input:checked + .checkbox__check {
			opacity: 1;
		}
	`;

	@property({ type: Boolean, reflect: true }) tree = false;

	@property({ type: Boolean, reflect: true }) branch = false;

	@property({ type: Boolean, reflect: true }) expanded = true;

	@property({ type: Boolean, reflect: true }) parentexpanded = true;

	@property({ type: Number }) level = 1;

	@property({ type: Boolean, reflect: true }) checkable = false;
	@property({ type: Boolean, reflect: true }) checked = false;
	@property({ type: Boolean, attribute: 'disable-check', reflect: true }) disableCheck = false;

	@property({ type: Boolean })
	active = false;

	@property({ attribute: 'hide-icon', type: Boolean })
	hideIcon = false;

	@state()
	get treeLeaves() {
		const length = this.level - 1;
		if (length < 1) return [];

		return Array.from({ length: length }, (_, i) => i + 1);
	}

	@state()
	get isHidden(): 'true' | 'false' {
		if (this.parentexpanded === false || (!this.branch && !this.expanded)) {
			return 'true';
		}

		return 'false';
	}

	@query('#checkbox')
	checkboxEl?: HTMLInputElement;

	onItemClick(e: MouseEvent) {
		if (this.checkable && e.target === this.checkboxEl) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		this.select(e.altKey ? { viewColumn: BesideViewColumn } : undefined);
	}

	onDblItemClick(e: MouseEvent) {
		if (this.checkable && e.target === this.checkboxEl) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		this.select({
			preview: false,
			viewColumn: e.altKey || e.ctrlKey || e.metaKey ? BesideViewColumn : undefined,
		});
	}

	select(showOptions?: TextDocumentShowOptions, quiet = false) {
		this.dispatchEvent(new CustomEvent('select'));
		if (this.branch) {
			this.expanded = !this.expanded;
		}

		this.active = true;
		if (!quiet) {
			window.requestAnimationFrame(() => {
				this.dispatchEvent(
					new CustomEvent('selected', {
						detail: {
							tree: this.tree,
							branch: this.branch,
							expanded: this.expanded,
							level: this.level,
							showOptions: showOptions,
						},
					}),
				);
			});
		}
	}

	deselect() {
		this.active = false;
	}

	override focus(options?: FocusOptions | undefined): void {
		this.shadowRoot?.getElementById('item')?.focus(options);
	}

	override firstUpdated(_changedProperties: PropertyValues): void {
		this.setAttribute('role', 'treeitem');

		// this.shadowRoot
		// 	?.querySelector('slot[name="icon"]')
		// 	?.addEventListener('slotchange', this.handleIconSlotChange.bind(this));
	}

	// private _hasIcon = false;
	// @state()
	// get hasIcon() {
	// 	return this._hasIcon;
	// }

	// handleIconSlotChange(e: Event) {
	// 	this._hasIcon = (e.target as HTMLSlotElement).assignedNodes().length > 0;
	// }

	override updated() {
		this.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
		this.setAttribute('aria-hidden', this.isHidden);
	}

	renderCheckbox() {
		if (!this.checkable) {
			return nothing;
		}
		return html`<span class="checkbox"
			><input
				class="checkbox__input"
				id="checkbox"
				type="checkbox"
				.checked=${this.checked}
				?disabled=${this.disableCheck}
				@change=${this.onCheckedChange}
				@click=${this.onCheckedClick} /><code-icon icon="check" size="14" class="checkbox__check"></code-icon
		></span>`;
	}

	override render() {
		return html`
			<button
				id="item"
				class="item"
				type="button"
				@click="${this.onItemClick}"
				@dblclick="${this.onDblItemClick}"
			>
				${this.treeLeaves.map(
					() => html`<span class="node node--connector"><code-icon name="blank"></code-icon></span>`,
				)}
				${this.branch
					? html`<span class="node"
							><code-icon
								class="branch"
								icon="${this.expanded ? 'chevron-down' : 'chevron-right'}"
							></code-icon
					  ></span>`
					: nothing}
				${this.renderCheckbox()}
				${this.hideIcon ? nothing : html`<span class="icon"><slot name="icon"></slot></span>`}
				<span class="text">
					<span class="main"><slot></slot></span>
					<span class="description"><slot name="description"></slot></span>
				</span>
			</button>
			<nav class="actions"><slot name="actions"></slot></nav>
		`;
	}

	onCheckedClick(e: Event) {
		console.log('onCheckedClick', e);
		e.stopPropagation();
	}

	onCheckedChange(e: Event) {
		console.log('onCheckedChange', e);
		e.preventDefault();
		e.stopPropagation();
		this.checked = (e.target as HTMLInputElement).checked;

		this.dispatchEvent(new CustomEvent('list-item-checked', { detail: { checked: this.checked } }));
	}
}
