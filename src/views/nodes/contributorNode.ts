'use strict';
import { MarkdownString, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { getPresenceDataUri } from '../../avatars';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitContributor, GitLog } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { debug, gate, Iterables, Strings } from '../../system';
import { ContactPresence } from '../../vsls/vsls';
import { ContributorsView } from '../contributorsView';
import { RepositoriesView } from '../repositoriesView';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { insertDateMarkers } from './helpers';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, PageableViewNode, ViewNode } from './viewNode';

export class ContributorNode extends ViewNode<ContributorsView | RepositoriesView> implements PageableViewNode {
	static key = ':contributor';
	static getId(repoPath: string, name: string, email: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name}|${email})`;
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
		return ContributorNode.getId(this.contributor.repoPath, this.contributor.name, this.contributor.email);
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath);
		const children = [
			...insertDateMarkers(
				Iterables.map(
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
		const presence = this._options?.presence?.get(this.contributor.email);

		const item = new TreeItem(
			this.contributor.current ? `${this.contributor.name} (you)` : this.contributor.name,
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
		}${this.contributor.email}`;

		let avatarUri;
		let avatarMarkdown;
		if (this.view.config.avatars) {
			const size = Container.config.hovers.avatarSize;
			avatarUri = await this.contributor.getAvatarUri({
				defaultStyle: Container.config.defaultGravatarsStyle,
				size: size,
			});

			if (presence != null) {
				const title = `${this.contributor.count ? 'You are' : `${this.contributor.name} is`} ${
					presence.status === 'dnd' ? 'in ' : ''
				}${presence.statusText.toLocaleLowerCase()}`;

				avatarMarkdown = `![${title}](${avatarUri.toString(
					true,
				)}|width=${size},height=${size} "${title}")![${title}](${getPresenceDataUri(
					presence.status,
				)} "${title}")`;
			} else {
				avatarMarkdown = `![${this.contributor.name}](${avatarUri.toString(
					true,
				)}|width=${size},height=${size} "${this.contributor.name}")`;
			}
		}

		const numberFormatter = new Intl.NumberFormat();

		const stats =
			this.contributor.stats != null
				? `\\\n${Strings.pluralize('file', this.contributor.stats.files, {
						number: numberFormatter.format(this.contributor.stats.files),
				  })} changed, ${Strings.pluralize('addition', this.contributor.stats.additions, {
						number: numberFormatter.format(this.contributor.stats.additions),
				  })}, ${Strings.pluralize('deletion', this.contributor.stats.deletions, {
						number: numberFormatter.format(this.contributor.stats.deletions),
				  })}`
				: '';

		item.tooltip = new MarkdownString(
			`${avatarMarkdown != null ? avatarMarkdown : ''} &nbsp;__[${this.contributor.name}](mailto:${
				this.contributor.email
			} "Email ${this.contributor.name} (${
				this.contributor.email
			})")__ \\\nLast commit ${this.contributor.formatDateFromNow()} (${this.contributor.formatDate()})\n\n${Strings.pluralize(
				'commit',
				this.contributor.count,
				{ number: numberFormatter.format(this.contributor.count) },
			)}${stats}`,
		);

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
			this._log = await Container.git.getLog(this.uri.repoPath!, {
				all: this._options?.all,
				ref: this._options?.ref,
				limit: this.limit ?? this.view.config.defaultItemLimit,
				authors: [`^${this.contributor.name} <${this.contributor.email}>$`],
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
