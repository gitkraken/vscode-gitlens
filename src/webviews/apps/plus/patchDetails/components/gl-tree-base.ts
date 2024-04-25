import { html, nothing } from 'lit';
import type { GitFileChangeShape } from '../../../../../git/models/file';
import type { HierarchicalItem } from '../../../../../system/array';
import { makeHierarchical } from '../../../../../system/array';
import { GlElement } from '../../../shared/components/element';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemBase,
	TreeItemCheckedDetail,
	TreeItemSelectionDetail,
	TreeModel,
} from '../../../shared/components/tree/base';
import '../../../shared/components/tree/tree-generator';
import '../../../shared/components/skeleton-loader';
import '../../../shared/components/actions/action-item';

export class GlTreeBase extends GlElement {
	protected onTreeItemActionClicked?(_e: CustomEvent<TreeItemActionDetail>): void;
	protected onTreeItemChecked?(_e: CustomEvent<TreeItemCheckedDetail>): void;
	protected onTreeItemSelected?(_e: CustomEvent<TreeItemSelectionDetail>): void;

	protected renderLoading() {
		return html`
			<div class="section section--skeleton">
				<skeleton-loader></skeleton-loader>
			</div>
			<div class="section section--skeleton">
				<skeleton-loader></skeleton-loader>
			</div>
			<div class="section section--skeleton">
				<skeleton-loader></skeleton-loader>
			</div>
		`;
	}

	protected renderLayoutAction(layout: string) {
		if (!layout) return nothing;

		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		switch (layout) {
			case 'auto':
				value = 'list';
				icon = 'gl-list-auto';
				label = 'View as List';
				break;
			case 'list':
				value = 'tree';
				icon = 'list-flat';
				label = 'View as Tree';
				break;
			case 'tree':
				value = 'auto';
				icon = 'list-tree';
				label = 'View as Auto';
				break;
		}

		return html`<action-item data-switch-value="${value}" label="${label}" icon="${icon}"></action-item>`;
	}

	protected renderTreeView(treeModel: TreeModel[], guides: 'none' | 'onHover' | 'always' = 'none') {
		return html`<gl-tree-generator
			.model=${treeModel}
			.guides=${guides}
			@gl-tree-generated-item-action-clicked=${this.onTreeItemActionClicked}
			@gl-tree-generated-item-checked=${this.onTreeItemChecked}
			@gl-tree-generated-item-selected=${this.onTreeItemSelected}
		></gl-tree-generator>`;
	}

	protected renderFiles(files: GitFileChangeShape[], isTree = false, compact = false, level = 2): TreeModel[] {
		const children: TreeModel[] = [];
		if (isTree) {
			const fileTree = makeHierarchical(
				files,
				n => n.path.split('/'),
				(...parts: string[]) => parts.join('/'),
				compact,
			);
			if (fileTree.children != null) {
				for (const child of fileTree.children.values()) {
					const childModel = this.walkFileTree(child, { level: level });
					children.push(childModel);
				}
			}
		} else {
			for (const file of files) {
				const child = this.fileToTreeModel(file, { level: level, branch: false }, true);
				children.push(child);
			}
		}

		return children;
	}

	protected walkFileTree(
		item: HierarchicalItem<GitFileChangeShape>,
		options: Partial<TreeItemBase> = { level: 1 },
	): TreeModel {
		if (options.level === undefined) {
			options.level = 1;
		}

		let model: TreeModel;
		if (item.value == null) {
			model = this.folderToTreeModel(item.name, options);
		} else {
			model = this.fileToTreeModel(item.value, options);
		}

		if (item.children != null) {
			const children = [];
			for (const child of item.children.values()) {
				const childModel = this.walkFileTree(child, { ...options, level: options.level + 1 });
				children.push(childModel);
			}

			if (children.length > 0) {
				model.branch = true;
				model.children = children;
			}
		}

		return model;
	}

	protected folderToTreeModel(name: string, options?: Partial<TreeItemBase>): TreeModel {
		return {
			branch: false,
			expanded: true,
			path: name,
			level: 1,
			checkable: false,
			checked: false,
			icon: 'folder',
			label: name,
			...options,
		};
	}

	protected getRepoActions(_name: string, _path: string, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		return [];
	}

	protected emptyTreeModel(name: string, options?: Partial<TreeItemBase>): TreeModel {
		return {
			branch: false,
			expanded: true,
			path: '',
			level: 1,
			checkable: true,
			checked: true,
			icon: undefined,
			label: name,
			...options,
		};
	}

	protected repoToTreeModel(
		name: string,
		path: string,
		options?: Partial<TreeItemBase>,
		description?: string,
	): TreeModel<string[]> {
		return {
			branch: false,
			expanded: true,
			path: path,
			level: 1,
			checkable: true,
			checked: true,
			icon: 'repo',
			label: name,
			description: description,
			context: [path],
			actions: this.getRepoActions(name, path, options),
			...options,
		};
	}

	protected getFileActions(_file: GitFileChangeShape, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		return [];
	}

	protected fileToTreeModel(
		file: GitFileChangeShape,
		options?: Partial<TreeItemBase>,
		flat = false,
		glue = '/',
	): TreeModel<GitFileChangeShape[]> {
		const pathIndex = file.path.lastIndexOf(glue);
		const fileName = pathIndex !== -1 ? file.path.substring(pathIndex + 1) : file.path;
		const filePath = flat && pathIndex !== -1 ? file.path.substring(0, pathIndex) : '';

		return {
			branch: false,
			expanded: true,
			path: file.path,
			level: 1,
			checkable: false,
			checked: false,
			icon: 'file', //{ type: 'status', name: file.status },
			label: fileName,
			description: flat === true ? filePath : undefined,
			context: [file],
			actions: this.getFileActions(file, options),
			decorations: [{ type: 'text', label: file.status }],
			...options,
		};
	}
}
