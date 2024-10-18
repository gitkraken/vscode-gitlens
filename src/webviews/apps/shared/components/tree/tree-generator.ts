import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { GlElement } from '../element';
import type { GlGitStatus } from '../status/git-status';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemCheckedDetail,
	TreeItemSelectionDetail,
	TreeModel,
	TreeModelFlat,
} from './base';
import '../actions/action-item';
import '../status/git-status';
import '../code-icon';
import './tree';
import './tree-item';

@customElement('gl-tree-generator')
export class GlTreeGenerator extends GlElement {
	static override styles = css`
		:host {
			display: contents;
		}
	`;

	@state()
	treeItems?: TreeModelFlat[] = undefined;

	@property({ reflect: true })
	guides?: 'none' | 'onHover' | 'always';

	_model?: TreeModel[];
	@property({ type: Array, attribute: false })
	set model(value: TreeModel[] | undefined) {
		if (this._model === value) return;

		this._model = value;

		let treeItems: TreeModelFlat[] | undefined;
		if (this._model != null) {
			const size = this._model.length;
			treeItems = this._model.reduce<TreeModelFlat[]>((acc, node, index) => {
				acc.push(...flattenTree(node, size, index + 1));
				return acc;
			}, []);
		}

		this.treeItems = treeItems;
	}

	get model() {
		return this._model;
	}

	private renderIcon(icon?: string | { type: 'status'; name: GlGitStatus['status'] }) {
		if (icon == null) return nothing;

		if (typeof icon === 'string') {
			return html`<code-icon slot="icon" icon=${icon}></code-icon>`;
		}

		if (icon.type !== 'status') {
			return nothing;
		}

		return html`<gl-git-status slot="icon" .status=${icon.name}></gl-git-status>`;
	}

	private renderActions(model: TreeModelFlat) {
		const actions = model.actions;
		if (actions == null || actions.length === 0) return nothing;

		return actions.map(action => {
			return html`<action-item
				slot="actions"
				.icon=${action.icon}
				.label=${action.label}
				@click=${(e: MouseEvent) => this.onTreeItemActionClicked(e, model, action)}
				@dblclick=${(e: MouseEvent) => this.onTreeItemActionDblClicked(e, model, action)}
			></action-item>`;
		});
	}

	private renderDecorations(model: TreeModelFlat) {
		const decorations = model.decorations;
		if (decorations == null || decorations.length === 0) return nothing;

		return decorations.map(decoration => {
			if (decoration.type === 'icon') {
				return html`<code-icon
					slot="decorations"
					title="${decoration.label}"
					aria-label="${decoration.label}"
					.icon=${decoration.icon}
				></code-icon>`;
			}

			if (decoration.type === 'text') {
				return html`<span slot="decorations">${decoration.label}</span>`;
			}

			// TODO: implement badge and indicator decorations

			return undefined;
		});
	}

	private renderTreeItem(model: TreeModelFlat) {
		return html`<gl-tree-item
			.branch=${model.branch}
			.expanded=${model.expanded}
			.path=${model.path}
			.parentPath=${model.parentPath}
			.parentExpanded=${model.parentExpanded}
			.level=${model.level}
			.size=${model.size}
			.position=${model.position}
			.checkable=${model.checkable}
			.checked=${model.checked ?? false}
			.disableCheck=${model.disableCheck ?? false}
			.showIcon=${model.icon != null}
			@gl-tree-item-selected=${(e: CustomEvent<TreeItemSelectionDetail>) => this.onTreeItemSelected(e, model)}
			@gl-tree-item-checked=${(e: CustomEvent<TreeItemCheckedDetail>) => this.onTreeItemChecked(e, model)}
		>
			${this.renderIcon(model.icon)}
			${model.label}${when(
				model.description != null,
				() => html`<span slot="description">${model.description}</span>`,
			)}
			${this.renderActions(model)} ${this.renderDecorations(model)}
		</gl-tree-item>`;
	}

	private renderTree(nodes?: TreeModelFlat[]) {
		return nodes?.map(node => this.renderTreeItem(node));
	}

	override render() {
		return html`<gl-tree>${this.renderTree(this.treeItems)}</gl-tree>`;
	}

	private onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>, model: TreeModelFlat) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-selected', {
			...e.detail,
			node: model,
			context: model.context,
		});
	}

	private onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>, model: TreeModelFlat) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-checked', {
			...e.detail,
			node: model,
			context: model.context,
		});
	}

	private onTreeItemActionClicked(e: MouseEvent, model: TreeModelFlat, action: TreeItemAction) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-action-clicked', {
			node: model,
			context: model.context,
			action: action,
			dblClick: false,
			altKey: e.altKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
		});
	}

	private onTreeItemActionDblClicked(e: MouseEvent, model: TreeModelFlat, action: TreeItemAction) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-action-clicked', {
			node: model,
			context: model.context,
			action: action,
			dblClick: true,
			altKey: e.altKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
		});
	}
}

function flattenTree(tree: TreeModel, children: number = 1, position: number = 1): TreeModelFlat[] {
	// const node = Object.keys(tree).reduce<TreeModelFlat>(
	// 	(acc, key) => {
	// 		if (key !== 'children') {
	// 			const value = tree[key as keyof TreeModel];
	// 			if (value != null) {
	// 				acc[key] = value;
	// 			}
	// 		}

	// 		return acc;
	// 	},
	// 	{ size: children, position: position },
	// );

	const node: Partial<TreeModelFlat> = {
		size: children,
		position: position,
	};

	for (const [key, value] of Object.entries(tree)) {
		if (value == null || key === 'children') continue;
		node[key as keyof TreeModelFlat] = value;
	}

	const nodes = [node as TreeModelFlat];
	if (tree.children != null && tree.children.length > 0) {
		const childSize = tree.children.length;
		for (let i = 0; i < childSize; i++) {
			nodes.push(...flattenTree(tree.children[i], childSize, i + 1));
		}
	}

	return nodes;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-tree-generator': GlTreeGenerator;
	}

	interface GlobalEventHandlersEventMap {
		'gl-tree-generated-item-action-clicked': CustomEvent<TreeItemActionDetail>;
		'gl-tree-generated-item-selected': CustomEvent<TreeItemSelectionDetail>;
		'gl-tree-generated-item-checked': CustomEvent<TreeItemCheckedDetail>;
	}
}
