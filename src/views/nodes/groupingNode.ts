import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { unknownGitUri } from '../../git/gitUri';
import type { View } from '../viewBase';
import { ContextValues, ViewNode } from './abstract/viewNode';

export class GroupingNode<TChild extends ViewNode = ViewNode> extends ViewNode<'grouping'> {
	constructor(
		view: View,
		parent: ViewNode,
		private readonly label: string,
		private readonly children: (parent: ViewNode) => TChild[] | Promise<TChild[]>,
		private readonly options?: {
			readonly collapsibleState?: TreeItemCollapsibleState;
			readonly contextValue?: ContextValues;
			readonly description?: string;
			readonly iconPath?: TreeItem['iconPath'];
			readonly tooltip?: string;
		},
	) {
		super('grouping', unknownGitUri, view, parent);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return this.children(this);
	}

	getTreeItem(): TreeItem {
		const { collapsibleState, description, tooltip, iconPath, contextValue } = this.options ?? {};

		const item = new TreeItem(this.label, collapsibleState ?? TreeItemCollapsibleState.Expanded);
		item.id = this.id;
		item.contextValue = contextValue ?? ContextValues.Grouping;
		item.description = description;
		item.tooltip = tooltip;
		item.iconPath = iconPath;
		return item;
	}
}
