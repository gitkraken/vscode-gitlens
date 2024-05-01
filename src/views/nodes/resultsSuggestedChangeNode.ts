import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { Draft } from '../../gk/models/drafts';
import { configuration } from '../../system/configuration';
import { formatDate, fromNow } from '../../system/date';
import type { View } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';

export class ResultsSuggestedChangeNode extends ViewNode<'results-suggested-change'> {
	constructor(
		uri: GitUri,
		view: View,
		parent: ViewNode,
		private readonly draft: Draft,
	) {
		super('results-suggested-change', uri, view, parent);

		this.updateContext({ draft: draft });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
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
		let contextValue: string = ContextValues.Draft;
		if (this.draft.isMine) {
			contextValue += '+mine';
		}
		item.contextValue = contextValue;
		item.iconPath = new ThemeIcon('gitlens-code-suggestion');
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
			command: 'gitlens.views.openDraft',
			arguments: [this.draft],
		};
		return item;
	}
}
