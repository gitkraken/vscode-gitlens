import type { TreeItem } from 'vscode';
import { Disposable, TreeItemCollapsibleState } from 'vscode';
import type { LaunchpadGroup } from '../../plus/launchpad/models';
import type { TreeViewNodeCollapsibleStateChangeEvent, View } from '../viewBase';
import type { ViewNode } from './abstract/viewNode';
import { GroupingNode } from './groupingNode';

export class LaunchpadViewGroupingNode<TChild extends ViewNode = ViewNode> extends GroupingNode {
	private disposable: Disposable;

	constructor(
		view: View,
		label: string,
		private readonly group: LaunchpadGroup,
		childrenOrFn: TChild[] | Promise<TChild[]> | (() => TChild[] | Promise<TChild[]>),
		collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.Expanded,
		description?: string,
		tooltip?: string,
		iconPath?: TreeItem['iconPath'],
		contextValue?: string,
	) {
		super(view, label, childrenOrFn, collapsibleState, description, tooltip, iconPath, contextValue);
		this.disposable = Disposable.from(
			this.view.onDidChangeNodeCollapsibleState(this.onNodeCollapsibleStateChanged, this),
		);
	}

	override dispose() {
		super.dispose();
		this.disposable?.dispose();
	}

	private onNodeCollapsibleStateChanged(e: TreeViewNodeCollapsibleStateChangeEvent<ViewNode>) {
		if (e.element === this) {
			const storedExpandedGroups = this.view.container.storage.get('launchpadView:groups:expanded') ?? [];
			if (e.state === TreeItemCollapsibleState.Expanded) {
				storedExpandedGroups.push(this.group);
			} else {
				storedExpandedGroups.splice(storedExpandedGroups.indexOf(this.group), 1);
			}

			void this.view.container.storage.store('launchpadView:groups:expanded', storedExpandedGroups).catch();
		}
	}
}
