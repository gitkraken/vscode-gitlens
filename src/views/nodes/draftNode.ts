import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { Draft } from '../../gk/models/drafts';
import { configuration } from '../../system/configuration';
import { formatDate, fromNow } from '../../system/date';
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

		const dateFormat = configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma';

		const showUpdated = this.draft.updatedAt.getTime() - this.draft.createdAt.getTime() >= 1000;

		item.id = this.id;
		item.contextValue = ContextValues.Draft;
		item.iconPath = new ThemeIcon('cloud');
		item.tooltip = new MarkdownString(
			`${label}${this.draft.description ? `\\\n${this.draft.description}` : ''}\n\nCreated ${fromNow(
				this.draft.createdAt,
			)} &nbsp; _(${formatDate(this.draft.createdAt, dateFormat)})_${
				showUpdated
					? ` \\\nLast updated ${fromNow(this.draft.updatedAt)} &nbsp; _(${formatDate(
							this.draft.updatedAt,
							dateFormat,
					  )})_`
					: ''
			}`,
		);
		item.description = fromNow(this.draft.updatedAt);
		item.command = {
			title: 'Show Patch',
			command: this.view.getQualifiedCommand('open'),
			arguments: [this],
		};
		return item;
	}
}
