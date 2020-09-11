import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { View } from '../viewBase';
import { ContextValues, PageableViewNode, unknownGitUri, ViewNode } from './viewNode';

export class MessageNode extends ViewNode {
	constructor(
		view: View,
		parent: ViewNode,
		private readonly _message: string,
		private readonly _description?: string,
		private readonly _tooltip?: string,
		private readonly _iconPath?:
			| string
			| Uri
			| {
					light: string | Uri;
					dark: string | Uri;
			  }
			| ThemeIcon,
	) {
		super(unknownGitUri, view, parent);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return [];
	}

	getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = new TreeItem(this._message, TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.Message;
		item.description = this._description;
		item.tooltip = this._tooltip;
		item.iconPath = this._iconPath;
		return item;
	}
}

export class CommandMessageNode extends MessageNode {
	constructor(
		view: View,
		parent: ViewNode,
		private readonly _command: Command,
		message: string,
		description?: string,
		tooltip?: string,
		iconPath?:
			| string
			| Uri
			| {
					light: string | Uri;
					dark: string | Uri;
			  }
			| ThemeIcon,
	) {
		super(view, parent, message, description, tooltip, iconPath);
	}

	getTreeItem(): TreeItem | Promise<TreeItem> {
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

export class UpdateableMessageNode extends ViewNode {
	constructor(
		view: View,
		parent: ViewNode,
		public readonly id: string,
		private _message: string,
		private _tooltip?: string,
		private _iconPath?:
			| string
			| Uri
			| {
					light: string | Uri;
					dark: string | Uri;
			  }
			| ThemeIcon,
	) {
		super(unknownGitUri, view, parent);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return [];
	}

	getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = new TreeItem(this._message, TreeItemCollapsibleState.None);
		item.id = this.id;
		item.contextValue = ContextValues.Message;
		item.tooltip = this._tooltip;
		item.iconPath = this._iconPath;
		return item;
	}

	update(
		changes: {
			message?: string;
			tooltip?: string | null;
			iconPath?:
				| string
				| null
				| Uri
				| {
						light: string | Uri;
						dark: string | Uri;
				  }
				| ThemeIcon;
		},
		view: View,
	) {
		if (changes.message !== undefined) {
			this._message = changes.message;
		}

		if (changes.tooltip !== undefined) {
			this._tooltip = changes.tooltip === null ? undefined : changes.tooltip;
		}

		if (changes.iconPath !== undefined) {
			this._iconPath = changes.iconPath === null ? undefined : changes.iconPath;
		}

		view.triggerNodeChange(this);
	}
}

export abstract class PagerNode extends ViewNode {
	constructor(
		view: View,
		parent: ViewNode & PageableViewNode,
		protected readonly message: string,
		protected readonly previousNode?: ViewNode,
		protected readonly pageSize: number = Container.config.views.pageItemLimit,
	) {
		super(unknownGitUri, view, parent);
	}

	loadAll() {
		return this.view.loadMoreNodeChildren(this.parent! as ViewNode & PageableViewNode, 0, this.previousNode);
	}

	loadMore() {
		return this.view.loadMoreNodeChildren(
			this.parent! as ViewNode & PageableViewNode,
			this.pageSize,
			this.previousNode,
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

	getCommand(): Command | undefined {
		return {
			title: 'Load more',
			command: 'gitlens.views.loadMoreChildren',
			arguments: [this],
		};
	}
}

export class LoadMoreNode extends PagerNode {
	constructor(view: View, parent: ViewNode & PageableViewNode, previousNode: ViewNode, pageSize?: number) {
		super(
			view,
			parent,
			pageSize === 0
				? `Load all ${GlyphChars.Space}${GlyphChars.Dash}${GlyphChars.Space} this may take a while`
				: 'Load more',
			previousNode,
			pageSize,
		);
	}
}
