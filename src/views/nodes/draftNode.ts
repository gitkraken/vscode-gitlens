import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { Draft } from '../../plus/drafts/draftsService';
import type { DraftsView } from '../draftsView';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';

export class DraftNode extends ViewNode<'draft', DraftsView> {
	constructor(
		uri: GitUri,
		view: DraftsView,
		protected override parent: ViewNode,
		public readonly draft: Draft,
	) {
		super('draft', uri, view, parent);

		this.updateContext({ draft: draft });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.draft.title ?? this.draft.description ?? '';
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const label = this.draft.title ?? `Draft (${this.draft.id})`;
		const item = new TreeItem(label, TreeItemCollapsibleState.None);

		item.id = this.id;
		item.contextValue = ContextValues.Draft;
		item.iconPath = new ThemeIcon('cloud');
		item.tooltip = `${label}`;
		// item.description = descriptionItems.join(', ');
		return item;
	}
}
