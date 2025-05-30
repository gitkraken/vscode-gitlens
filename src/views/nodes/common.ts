import type { Command, Disposable, Uri } from 'vscode';
import { commands, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { unknownGitUri } from '../../git/gitUri';
import { configuration } from '../../system/-webview/configuration';
import { isPromise } from '../../system/promise';
import type { View } from '../viewBase';
import type { PageableViewNode } from './abstract/viewNode';
import { ContextValues, ViewNode } from './abstract/viewNode';

export class MessageNode extends ViewNode<'message'> {
	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		protected message: string,
		protected description?: string,
		protected tooltip?: string,
		protected iconPath?: TreeItem['iconPath'],
		protected contextValue?: string,
		protected resourceUri?: Uri,
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
		contextValue?: string,
		resourceUri?: Uri,
	) {
		super(view, parent, message, description, tooltip, iconPath, contextValue, resourceUri);
	}

	override getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = super.getTreeItem();
		if (isPromise(item)) {
			return item.then(i => {
				i.command = this._command;
				return i;
			});
		}

		item.command = this._command;
		return item;
	}

	override getCommand(): Command | undefined {
		return this._command;
	}
}

export class ActionMessageNode extends CommandMessageNode {
	private readonly _disposable: Disposable;

	constructor(
		view: View,
		parent: ViewNode,
		action: (node: ActionMessageNode) => void | Promise<void>,
		message: string,
		description?: string,
		tooltip?: string,
		iconPath?: TreeItem['iconPath'],
		contextValue?: string,
		resourceUri?: Uri,
	) {
		const command = { command: `gitlens.node.action:${Date.now()}`, title: 'Execute action' };
		super(view, parent, command, message, description, tooltip, iconPath, contextValue, resourceUri);

		this._disposable = commands.registerCommand(command.command, action.bind(undefined, this));
	}

	override dispose(): void {
		this._disposable.dispose();
	}

	update(options: {
		message?: string;
		description?: string | null;
		tooltip?: string | null;
		iconPath?: TreeItem['iconPath'] | null;
		contextValue?: string | null;
		resourceUri?: Uri | null;
	}): void {
		this.message = options.message ?? this.message;
		this.description = options.description === null ? undefined : options.description ?? this.description;
		this.tooltip = options.tooltip === null ? undefined : options.tooltip ?? this.tooltip;
		this.iconPath = options.iconPath === null ? undefined : options.iconPath ?? this.iconPath;
		this.contextValue = options.contextValue === null ? undefined : options.contextValue ?? this.contextValue;
		this.resourceUri = options.resourceUri === null ? undefined : options.resourceUri ?? this.resourceUri;
		this.view.triggerNodeChange(this);
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

	async loadAll(): Promise<void> {
		const count = (await this.options?.getCount?.()) ?? 0;
		return this.view.loadMoreNodeChildren(
			this.parent! as ViewNode & PageableViewNode,
			count > 5000 ? 5000 : 0,
			this.previousNode,
			this.options?.context,
		);
	}

	loadMore(): Promise<void> {
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
