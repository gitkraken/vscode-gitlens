import type { Command, Uri } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { unknownGitUri } from '../../git/gitUri';
import { configuration } from '../../system/vscode/configuration';
import type { View } from '../viewBase';
import type { PageableViewNode } from './abstract/viewNode';
import { ContextValues, ViewNode } from './abstract/viewNode';

export class MessageNode extends ViewNode<'message'> {
	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		private readonly message: string,
		private readonly description?: string,
		private readonly tooltip?: string,
		private readonly iconPath?: TreeItem['iconPath'],
		private readonly contextValue?: string,
		private readonly resourceUri?: Uri,
	) {
		super('message', unknownGitUri, view, parent);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return [];
	}

	getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
		item.contextValue = this.contextValue ?? ContextValues.Message;
		item.description = this.description;
		item.tooltip = this.tooltip;
		item.iconPath = this.iconPath;
		item.resourceUri = this.resourceUri;
		return item;
	}
}

export class GroupedHeaderNode extends MessageNode {
	constructor(view: View, parent: ViewNode, description?: string, label?: string) {
		super(view, parent, label ?? view.name, description, view.name, undefined, `gitlens:views:${view.type}`);
	}
}

export class CommandMessageNode extends MessageNode {
	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		private readonly _command: Command,
		message: string,
		description?: string,
		tooltip?: string,
		iconPath?: TreeItem['iconPath'],
	) {
		super(view, parent, message, description, tooltip, iconPath);
	}

	override getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = super.getTreeItem();
		if (item instanceof TreeItem) {
			item.command = this._command;
			return item;
		}

		return item.then(i => {
			i.command = this._command;
			return i;
		});
	}
}

export abstract class PagerNode extends ViewNode<'pager'> {
	constructor(
		view: View,
		parent: ViewNode & PageableViewNode,
		protected readonly message: string,
		protected readonly previousNode?: ViewNode,
		protected readonly options?: {
			context?: Record<string, unknown>;
			pageSize?: number;
			getCount?: () => Promise<number | undefined>;
		}, // protected readonly pageSize: number = configuration.get('views.pageItemLimit'), // protected readonly countFn?: () => Promise<number | undefined>, // protected readonly context?: Record<string, unknown>, // protected readonly beforeLoadCallback?: (mode: 'all' | 'more') => void,
	) {
		super('pager', unknownGitUri, view, parent);
	}

	async loadAll() {
		const count = (await this.options?.getCount?.()) ?? 0;
		return this.view.loadMoreNodeChildren(
			this.parent! as ViewNode & PageableViewNode,
			count > 5000 ? 5000 : 0,
			this.previousNode,
			this.options?.context,
		);
	}

	loadMore() {
		return this.view.loadMoreNodeChildren(
			this.parent! as ViewNode & PageableViewNode,
			this.options?.pageSize ?? configuration.get('views.pageItemLimit'),
			this.previousNode,
			this.options?.context,
		);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return [];
	}

	getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.Pager;
		item.command = this.getCommand();
		return item;
	}

	override getCommand(): Command | undefined {
		return {
			title: 'Load more',
			command: 'gitlens.views.loadMoreChildren',
			arguments: [this],
		};
	}
}

export class LoadMoreNode extends PagerNode {
	constructor(
		view: View,
		parent: ViewNode & PageableViewNode,
		previousNode: ViewNode,
		options?: {
			context?: Record<string, unknown>;
			getCount?: () => Promise<number | undefined>;
			message?: string;
			pageSize?: number;
		},
	) {
		super(
			view,
			parent,
			options?.message ??
				(options?.pageSize === 0
					? `Load all ${GlyphChars.Space}${GlyphChars.Dash}${GlyphChars.Space} this may take a while`
					: 'Load more'),
			previousNode,
			options,
		);
	}
}
