import { html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { GlElement } from '../element';
import type { TreeItemCheckedDetail, TreeItemSelectionDetail } from './base';
import { treeItemStyles } from './tree.css';
import '../actions/action-nav';
import '../code-icon';

@customElement('gl-tree-item')
export class GlTreeItem extends GlElement {
	static override styles = treeItemStyles;

	// node properties
	@property({ type: Boolean })
	branch = false;

	@property({ type: Boolean })
	expanded = true;

	@property({ type: String })
	path = '';

	// parent
	@property({ type: String, attribute: 'parent-path' })
	parentPath?: string;

	@property({ type: Boolean, attribute: 'parent-expanded' })
	parentExpanded?: boolean;

	// depth and siblings
	@property({ type: Number })
	level = 0;

	@property({ type: Number })
	size = 1;

	@property({ type: Number })
	position = 1;

	// checkbox
	@property({ type: Boolean })
	checkable = false;

	@property({ type: Boolean })
	checked = false;

	@property({ type: Boolean })
	disableCheck = false;

	@property({ type: Boolean })
	showIcon = true;

	// state
	@state()
	selected = false;

	@state()
	focused = false;

	@query('#button')
	buttonEl!: HTMLButtonElement;

	get isHidden() {
		return this.parentExpanded === false || (!this.branch && !this.expanded);
	}

	override connectedCallback() {
		super.connectedCallback();
		this.addEventListener('click', this.onComponentClickBound);
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		this.removeEventListener('click', this.onComponentClickBound);
	}

	private onComponentClick(e: MouseEvent) {
		this.selectCore({
			dblClick: false,
			altKey: e.altKey,
		});
		this.buttonEl.focus();
	}
	private onComponentClickBound = this.onComponentClick.bind(this);

	private updateAttrs(changedProperties: Map<string, any>, force = false) {
		if (changedProperties.has('expanded') || force) {
			this.setAttribute('aria-expanded', this.expanded.toString());
		}

		if (changedProperties.has('parentExpanded') || force) {
			this.setAttribute('aria-hidden', this.isHidden.toString());
		}

		if (changedProperties.has('selected') || force) {
			this.setAttribute('aria-selected', this.selected.toString());
		}

		if (changedProperties.has('size') || force) {
			this.setAttribute('aria-setsize', this.size.toString());
		}

		if (changedProperties.has('position') || force) {
			this.setAttribute('aria-posinset', this.position.toString());
		}

		if (changedProperties.has('level') || force) {
			this.setAttribute('aria-level', this.level.toString());
		}
	}

	override firstUpdated() {
		this.role = 'treeitem';
	}

	override updated(changedProperties: Map<string, any>) {
		this.updateAttrs(changedProperties);
	}

	private renderBranching() {
		const connectors = this.level - 1;
		if (connectors < 1 && !this.branch) {
			return nothing;
		}

		const branching = [];
		if (connectors > 0) {
			for (let i = 0; i < connectors; i++) {
				branching.push(html`<span class="node node--connector"><code-icon name="blank"></code-icon></span>`);
			}
		}

		if (this.branch) {
			branching.push(
				html`<code-icon class="branch" icon="${this.expanded ? 'chevron-down' : 'chevron-right'}"></code-icon>`,
			);
		}

		return branching;
	}

	private renderCheckbox() {
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
				@change=${this.onCheckboxChange}
				@click=${this.onCheckboxClick} /><code-icon icon="check" size="14" class="checkbox__check"></code-icon
		></span>`;
	}

	private renderActions() {
		return html`<action-nav class="actions"><slot name="actions"></slot></action-nav>`;
	}

	private renderDecorations() {
		return html`<slot name="decorations" class="decorations"></slot>`;
	}

	override render() {
		return html`
			${this.renderBranching()}${this.renderCheckbox()}
			<button
				id="button"
				class="item"
				type="button"
				@click=${this.onButtonClick}
				@dblclick=${this.onButtonDblClick}
			>
				${when(this.showIcon, () => html`<slot name="icon" class="icon"></slot>`)}
				<span class="text">
					<slot class="main"></slot>
					<slot name="description" class="description"></slot>
				</span>
			</button>
			${this.renderActions()}${this.renderDecorations()}
		`;
	}

	private selectCore(
		modifiers?: { dblClick: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
		quiet = false,
	) {
		this.emit('gl-tree-item-select');
		if (this.branch) {
			this.expanded = !this.expanded;
		}
		this.selected = true;

		if (!quiet) {
			window.requestAnimationFrame(() => {
				this.emit('gl-tree-item-selected', {
					node: this,
					dblClick: modifiers?.dblClick ?? false,
					altKey: modifiers?.altKey ?? false,
					ctrlKey: modifiers?.ctrlKey ?? false,
					metaKey: modifiers?.metaKey ?? false,
				});
			});
		}
	}

	select() {
		this.selectCore(undefined, true);
	}

	deselect() {
		this.selected = false;
	}

	override focus() {
		this.buttonEl.focus();
	}

	onButtonClick(e: MouseEvent) {
		console.log('onButtonClick', e);
		e.stopPropagation();
		this.selectCore({
			dblClick: false,
			altKey: e.altKey,
		});
	}

	onButtonDblClick(e: MouseEvent) {
		console.log('onButtonDblClick', e);
		e.stopPropagation();
		this.selectCore({
			dblClick: true,
			altKey: e.altKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
		});
	}

	onCheckboxClick(e: Event) {
		console.log('onCheckboxClick', e);
		e.stopPropagation();
	}

	onCheckboxChange(e: Event) {
		console.log('onCheckboxChange', e);
		e.preventDefault();
		e.stopPropagation();
		this.checked = (e.target as HTMLInputElement).checked;

		this.emit('gl-tree-item-checked', { node: this, checked: this.checked });
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-tree-item': GlTreeItem;
	}

	interface GlobalEventHandlersEventMap {
		'gl-tree-item-select': CustomEvent<undefined>;
		'gl-tree-item-selected': CustomEvent<TreeItemSelectionDetail>;
		'gl-tree-item-checked': CustomEvent<TreeItemCheckedDetail>;
	}
}
