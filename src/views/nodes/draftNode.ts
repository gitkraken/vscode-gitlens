import type { Uri } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { getAvatarUri } from '../../avatars';
import type { GitUri } from '../../git/gitUri';
import type { Draft } from '../../gk/models/drafts';
import { formatDate, fromNow } from '../../system/date';
import { configuration } from '../../system/vscode/configuration';
import type { DraftsView } from '../draftsView';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';

export class DraftNode extends ViewNode<'draft', ViewsWithCommits | DraftsView> {
	constructor(
		uri: GitUri,
		view: ViewsWithCommits | DraftsView,
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
		return this.getUrl();
	}

	override getUrl(): string {
		return this.view.container.drafts.generateWebUrl(this.draft.id);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const label = this.draft.title ?? `Draft (${this.draft.id})`;
		const item = new TreeItem(label, TreeItemCollapsibleState.None);

		const dateFormat = configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma';

		// Only show updated time if it is more than a 30s after the created time
		const showUpdated = this.draft.updatedAt.getTime() - this.draft.createdAt.getTime() >= 30000;

		item.id = this.id;
		let contextValue: string = ContextValues.Draft;
		if (this.draft.isMine) {
			contextValue += '+mine';
		}
		item.contextValue = contextValue;
		item.description = fromNow(this.draft.updatedAt);
		item.command = {
			title: 'Open',
			command: 'gitlens.views.draft.open',
			arguments: [this],
		};

		let avatarUri: Uri | undefined;
		if (this.view.config.avatars && this.draft.author != null) {
			avatarUri = this.draft.author.avatarUri ?? getAvatarUri(this.draft.author.email);
		}

		item.iconPath =
			avatarUri ?? new ThemeIcon(this.draft.type === 'suggested_pr_change' ? 'gitlens-code-suggestion' : 'cloud');

		item.tooltip = new MarkdownString(
			`${label}${this.draft.description ? `\\\n${this.draft.description}` : ''}\n\nCreated ${
				this.draft.author?.name ? ` by ${this.draft.author.name}` : ''
			} ${fromNow(this.draft.createdAt)} &nbsp; _(${formatDate(this.draft.createdAt, dateFormat)})_${
				showUpdated
					? ` \\\nLast updated ${fromNow(this.draft.updatedAt)} &nbsp; _(${formatDate(
							this.draft.updatedAt,
							dateFormat,
					  )})_`
					: ''
			}`,
		);

		return item;
	}
}
