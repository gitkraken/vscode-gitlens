import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { unknownGitUri } from '../../git/gitUri';
import type { View } from '../viewBase';
import { ContextValues, ViewNode } from './abstract/viewNode';

export class GroupingNode<TChild extends ViewNode = ViewNode> extends ViewNode<'grouping'> {
	constructor(
		view: View,
		private readonly label: string,
		private readonly childrenOrFn: TChild[] | Promise<TChild[]> | (() => TChild[] | Promise<TChild[]>),
		private readonly collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.Expanded,
		private readonly description?: string,
		private readonly tooltip?: string,
		private readonly iconPath?: TreeItem['iconPath'],
		private readonly contextValue?: string,
	) {
		super('grouping', unknownGitUri, view);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return typeof this.childrenOrFn === 'function' ? this.childrenOrFn() : this.childrenOrFn;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, this.collapsibleState);
		item.id = this.id;
		item.contextValue = this.contextValue ?? ContextValues.Grouping;
		item.description = this.description;
		item.tooltip = this.tooltip;
		item.iconPath = this.iconPath;
		return item;
	}
}
