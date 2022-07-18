import { MarkdownString, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import * as nls from 'vscode-nls';
import { getPresenceDataUri } from '../../avatars';
import { configuration } from '../../configuration';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { GitContributor } from '../../git/models/contributor';
import type { GitLog } from '../../git/models/log';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { ContactPresence } from '../../vsls/vsls';
import type { ContributorsView } from '../contributorsView';
import type { RepositoriesView } from '../repositoriesView';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { insertDateMarkers } from './helpers';
import { RepositoryNode } from './repositoryNode';
import type { PageableViewNode } from './viewNode';
import { ContextValues, ViewNode } from './viewNode';

const localize = nls.loadMessageBundle();
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

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log == null) {
			return [new MessageNode(this.view, this, localize('noCommitsCouldBeFound', 'No commits could be found.'))];
		}

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
			this.contributor.current
				? localize('contributor.you', '{0} (you)', this.contributor.label)
				: this.contributor.label,
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
		}${this.contributor.date != null ? `${this.contributor.formatDateFromNow()}, ` : ''}${
			this.contributor.count === 1
				? localize('commit', '{0} commit', this.contributor.count)
				: localize('commits', '{0} commits', this.contributor.count)
		}`;

		let avatarUri;
		let avatarMarkdown;
		if (this.view.config.avatars) {
			const size = configuration.get('hovers.avatarSize');
			avatarUri = await this.contributor.getAvatarUri({
				defaultStyle: configuration.get('defaultGravatarsStyle'),
				size: size,
			});

			if (presence != null) {
				const title = this.contributor.count
					? presence.status === 'dnd'
						? localize('youAreInStatus', 'You are in {0}', presence.statusText.toLocaleLowerCase())
						: localize('youAreStatus', 'You are {0}', presence.statusText.toLocaleLowerCase())
					: presence.status === 'dnd'
					? localize(
							'contributorIsInStatus',
							'{0} is in {1}',
							this.contributor.label,
							presence.statusText.toLocaleLowerCase(),
					  )
					: localize(
							'contributorIsStatus',
							'{0} is {1}',
							this.contributor.label,
							presence.statusText.toLocaleLowerCase(),
					  );

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
				? `\\\n${
						this.contributor.stats.files === 1
							? localize(
									'fileChanged',
									'{0} file changed',
									numberFormatter.format(this.contributor.stats.files),
							  )
							: localize(
									'filesChanged',
									'{0} files changed',
									numberFormatter.format(this.contributor.stats.files),
							  )
				  }
					, ${
						this.contributor.stats.additions === 1
							? localize(
									'addition',
									'{0} addition',
									numberFormatter.format(this.contributor.stats.additions),
							  )
							: localize(
									'additions',
									'{0} additions',
									numberFormatter.format(this.contributor.stats.additions),
							  )
					}
					, ${
						this.contributor.stats.deletions === 1
							? localize(
									'deletion',
									'{0} deletion',
									numberFormatter.format(this.contributor.stats.deletions),
							  )
							: localize(
									'deletions',
									'{0} deletions',
									numberFormatter.format(this.contributor.stats.deletions),
							  )
					}`
				: '';

		const link = this.contributor.email
			? `__[${this.contributor.name}](mailto:${this.contributor.email} "${localize(
					'emailContributor',
					'Email {0} ({1})',
					this.contributor.label,
					this.contributor.email,
			  )}")__`
			: `__${this.contributor.label}__`;

		const lastCommitted =
			this.contributor.date != null
				? `${localize(
						'lastCommit',
						'Last commit {0} ({1})',
						this.contributor.formatDateFromNow(),
						this.contributor.formatDate(),
				  )}\\\n`
				: '';

		const markdown = new MarkdownString(
			`${avatarMarkdown != null ? avatarMarkdown : ''} &nbsp;${link} \n\n${lastCommitted}${
				this.contributor.count === 1
					? localize('commit', '{0} commit', numberFormatter.format(this.contributor.count))
					: localize('commits', '{0} commits', numberFormatter.format(this.contributor.count))
			}${stats}`,
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
