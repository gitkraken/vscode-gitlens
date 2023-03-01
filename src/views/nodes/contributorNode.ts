import { MarkdownString, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { getPresenceDataUri } from '../../avatars';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { GitContributor } from '../../git/models/contributor';
import type { GitLog } from '../../git/models/log';
import { configuration } from '../../system/configuration';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import { pluralize } from '../../system/string';
import type { ContactPresence } from '../../vsls/vsls';
import type { ContributorsView } from '../contributorsView';
import type { RepositoriesView } from '../repositoriesView';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { insertDateMarkers } from './helpers';
import { RepositoryNode } from './repositoryNode';
import type { PageableViewNode } from './viewNode';
import { ContextValues, ViewNode } from './viewNode';

export class ContributorNode extends ViewNode<ContributorsView | RepositoriesView> implements PageableViewNode {
	static key = ':contributor';
	static getId(
		repoPath: string,
		name: string | undefined,
		email: string | undefined,
		username: string | undefined,
	): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name}|${email}|${username})`;
	}

	constructor(
		uri: GitUri,
		view: ContributorsView | RepositoriesView,
		parent: ViewNode,
		public readonly contributor: GitContributor,
		private readonly _options?: {
			all?: boolean;
			ref?: string;
			presence: Map<string, ContactPresence> | undefined;
		},
	) {
		super(uri, view, parent);
	}

	override toClipboard(): string {
		return `${this.contributor.name}${this.contributor.email ? ` <${this.contributor.email}>` : ''}`;
	}

	override get id(): string {
		return ContributorNode.getId(
			this.contributor.repoPath,
			this.contributor.name,
			this.contributor.email,
			this.contributor.username,
		);
	}

	get repoPath(): string {
		return this.contributor.repoPath;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await this.view.container.git.getBranchesAndTagsTipsFn(this.uri.repoPath);
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
		const presence = this._options?.presence?.get(this.contributor.email!);

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
		}${this.contributor.date != null ? `${this.contributor.formatDateFromNow()}, ` : ''}${pluralize(
			'commit',
			this.contributor.count,
		)}`;

		let avatarUri;
		let avatarMarkdown;
		if (this.view.config.avatars) {
			const size = configuration.get('hovers.avatarSize');
			avatarUri = await this.contributor.getAvatarUri({
				defaultStyle: configuration.get('defaultGravatarsStyle'),
				size: size,
			});

			if (presence != null) {
				const title = `${this.contributor.count ? 'You are' : `${this.contributor.label} is`} ${
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

		const numberFormatter = new Intl.NumberFormat();

		const stats =
			this.contributor.stats != null
				? `\\\n${pluralize('file', this.contributor.stats.files, {
						format: numberFormatter.format,
				  })} changed, ${pluralize('addition', this.contributor.stats.additions, {
						format: numberFormatter.format,
				  })}, ${pluralize('deletion', this.contributor.stats.deletions, {
						format: numberFormatter.format,
				  })}`
				: '';

		const link = this.contributor.email
			? `__[${this.contributor.name}](mailto:${this.contributor.email} "Email ${this.contributor.label} (${this.contributor.email})")__`
			: `__${this.contributor.label}__`;

		const lastCommitted =
			this.contributor.date != null
				? `Last commit ${this.contributor.formatDateFromNow()} (${this.contributor.formatDate()})\\\n`
				: '';

		const markdown = new MarkdownString(
			`${avatarMarkdown != null ? avatarMarkdown : ''} &nbsp;${link} \n\n${lastCommitted}${pluralize(
				'commit',
				this.contributor.count,
				{ format: numberFormatter.format },
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
				all: this._options?.all,
				ref: this._options?.ref,
				limit: this.limit ?? this.view.config.defaultItemLimit,
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

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	@gate()
	async loadMore(limit?: number | { until?: any }) {
		let log = await window.withProgress(
			{
				location: { viewId: this.view.id },
			},
			() => this.getLog(),
		);
		if (log == null || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
