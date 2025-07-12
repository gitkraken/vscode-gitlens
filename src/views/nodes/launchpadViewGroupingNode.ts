import type { TreeItem } from 'vscode';
import { Disposable, TreeItemCollapsibleState } from 'vscode';
import type { LaunchpadGroup } from '../../plus/launchpad/models/launchpad';
import type { TreeViewNodeCollapsibleStateChangeEvent, View } from '../viewBase';
import type { ContextValues, ViewNode } from './abstract/viewNode';
import { getViewNodeId } from './abstract/viewNode';
import { GroupingNode } from './groupingNode';

export class LaunchpadViewGroupingNode<TChild extends ViewNode = ViewNode> extends GroupingNode {
	private disposable: Disposable;

	constructor(
		view: View,
		parent: ViewNode,
		label: string,
		private readonly group: LaunchpadGroup,
		children: (parent: ViewNode) => TChild[] | Promise<TChild[]>,
		options?: {
			readonly collapsibleState?: TreeItemCollapsibleState;
			readonly contextValue?: ContextValues;
			readonly description?: string;
			readonly iconPath?: TreeItem['iconPath'];
			readonly tooltip?: string;
		},
	) {
		super(view, parent, label, children, options);
		this.disposable = Disposable.from(
			this.view.onDidChangeNodeCollapsibleState(this.onNodeCollapsibleStateChanged, this),
		);

		this.updateContext({ launchpadGroup: group });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override dispose(): void {
		super.dispose();
		this.disposable?.dispose();
	}

	override get id(): string {
		return this._uniqueId;
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
