import { MarkdownString, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { getPresenceDataUri } from '../../avatars';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { GitContributor } from '../../git/models/contributor';
import type { GitLog } from '../../git/models/log';
import { formatNumeric } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import { pluralize } from '../../system/string';
import { configuration } from '../../system/vscode/configuration';
import type { ContactPresence } from '../../vsls/vsls';
import type { ViewsWithContributors } from '../viewBase';
import type { ClipboardType, PageableViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { insertDateMarkers } from './helpers';

export class ContributorNode extends ViewNode<'contributor', ViewsWithContributors> implements PageableViewNode {
	limit: number | undefined;

	constructor(
		uri: GitUri,
		view: ViewsWithContributors,
		protected override readonly parent: ViewNode,
		public readonly contributor: GitContributor,
		private readonly options?: {
			all?: boolean;
			ref?: string;
			presence: Map<string, ContactPresence> | undefined;
			showMergeCommits?: boolean;
		},
	) {
		super('contributor', uri, view, parent);

		this.updateContext({ contributor: contributor });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(type?: ClipboardType): string {
		const text = `${this.contributor.name}${this.contributor.email ? ` <${this.contributor.email}>` : ''}`;
		switch (type) {
			case 'markdown':
				return this.contributor.email ? `[${text}](mailto:${this.contributor.email})` : text;
			default:
				return text;
		}
	}

	override getUrl(): string {
		return this.contributor.email ? `mailto:${this.contributor.email}` : '';
	}

	get repoPath(): string {
		return this.contributor.repoPath;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await this.view.container.git.getBranchesAndTagsTipsLookup(this.uri.repoPath);
		const children = [
			...insertDateMarkers(
				map(
					log.commits.values(),
					c => new CommitNode(this.view, this, c, undefined, undefined, getBranchAndTagTips),
				),
				this,
			),
		];

		if (log.hasMore) {
			children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
		}
		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const presence = this.options?.presence?.get(this.contributor.email!);

		const shortStats =
			this.contributor.stats != null
				? ` (${pluralize('file', this.contributor.stats.files)}, +${formatNumeric(
						this.contributor.stats.additions,
				  )} -${formatNumeric(this.contributor.stats.additions)} ${pluralize(
						'line',
						this.contributor.stats.additions + this.contributor.stats.deletions,
						{ only: true },
				  )})`
				: '';

		const item = new TreeItem(
			this.contributor.current ? `${this.contributor.label} (you)` : this.contributor.label,
			TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = this.contributor.current
			? `${ContextValues.Contributor}+current`
			: ContextValues.Contributor;
		item.description = `${
			presence != null && presence.status !== 'offline'
				? `${presence.statusText} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `
				: ''
		}${this.contributor.latestCommitDate != null ? `${this.contributor.formatDateFromNow()}, ` : ''}${pluralize(
			'commit',
			this.contributor.commits,
		)}${shortStats}`;

		let avatarUri;
		let avatarMarkdown;
		if (this.view.config.avatars) {
			const size = configuration.get('hovers.avatarSize');
			avatarUri = await this.contributor.getAvatarUri({
				defaultStyle: configuration.get('defaultGravatarsStyle'),
				size: size,
			});

			if (presence != null) {
				const title = `${this.contributor.commits ? 'You are' : `${this.contributor.label} is`} ${
					presence.status === 'dnd' ? 'in ' : ''
				}${presence.statusText.toLocaleLowerCase()}`;

				avatarMarkdown = `![${title}](${avatarUri.toString(
					true,
				)}|width=${size},height=${size} "${title}")![${title}](${getPresenceDataUri(
					presence.status,
				)} "${title}")`;
			} else {
				avatarMarkdown = `![${this.contributor.label}](${avatarUri.toString(
					true,
				)}|width=${size},height=${size} "${this.contributor.label}")`;
			}
		}

		const stats =
			this.contributor.stats != null
				? `\\\n${pluralize('file', this.contributor.stats.files)} changed, ${pluralize(
						'addition',
						this.contributor.stats.additions,
				  )}, ${pluralize('deletion', this.contributor.stats.deletions)}`
				: '';

		const link = this.contributor.email
			? `__[${this.contributor.name}](mailto:${this.contributor.email} "Email ${this.contributor.label} (${this.contributor.email})")__`
			: `__${this.contributor.label}__`;

		const lastCommitted =
			this.contributor.latestCommitDate != null
				? `Last commit ${this.contributor.formatDateFromNow()} (${this.contributor.formatDate()})\\\n`
				: '';

		const markdown = new MarkdownString(
			`${avatarMarkdown != null ? avatarMarkdown : ''} &nbsp;${link} \n\n${lastCommitted}${pluralize(
				'commit',
				this.contributor.commits,
			)}${stats}`,
		);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;
		item.iconPath = avatarUri;

		return item;
	}

	@gate()
	@debug()
	override refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log == null) {
			this._log = await this.view.container.git.getLog(this.uri.repoPath!, {
				all: this.options?.all,
				ref: this.options?.ref,
				limit: this.limit ?? this.view.config.defaultItemLimit,
				merges: this.options?.showMergeCommits,
				authors: [
					{
						name: this.contributor.name,
						email: this.contributor.email,
						username: this.contributor.username,
						id: this.contributor.id,
					},
				],
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }) {
		let log = await window.withProgress(
			{
				location: { viewId: this.view.id },
			},
			() => this.getLog(),
		);
		if (!log?.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
