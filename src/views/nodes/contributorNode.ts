import type { Uri } from 'vscode';
import { MarkdownString, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { GitContributor } from '@gitlens/git/models/contributor.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import { formatNumeric } from '@gitlens/utils/date.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { map } from '@gitlens/utils/iterable.js';
import { pluralize } from '@gitlens/utils/string.js';
import { getPresenceDataUri } from '../../avatars.js';
import { GlyphChars } from '../../constants.js';
import type { GitUri } from '../../git/gitUri.js';
import { formatCurrentUserDisplayName } from '../../git/utils/-webview/commit.utils.js';
import { getContributorAvatarUri } from '../../git/utils/-webview/contributor.utils.js';
import { configuration } from '../../system/-webview/configuration.js';
import { gate } from '../../system/decorators/gate.js';
import type { ContactPresence } from '../../vsls/vsls.js';
import type { ViewsWithContributors } from '../viewBase.js';
import type { ClipboardType, PageableViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';
import { CommitNode } from './commitNode.js';
import { LoadMoreNode, MessageNode } from './common.js';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode.js';
import { insertDateMarkers } from './utils/-webview/node.utils.js';

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
			pathspec?: { uri: Uri; isFolder: boolean };
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

		const hasPathspec = this.options?.pathspec != null;
		const useFileRevisionAsCommit = this.options?.pathspec != null && !this.options.pathspec.isFolder;

		const getBranchAndTagTips = await this.view.container.git
			.getRepositoryService(this.uri.repoPath!)
			.getBranchesAndTagsTipsLookup();
		const children = [
			...insertDateMarkers(
				map(log.commits.values(), c =>
					useFileRevisionAsCommit
						? new FileRevisionAsCommitNode(this.view, this, c.file!, c, {
								getBranchAndTagTips: getBranchAndTagTips,
							})
						: new CommitNode(this.view, this, c, undefined, undefined, getBranchAndTagTips, {
								allowFilteredFiles: hasPathspec,
							}),
				),
				this,
			),
		];

		if (log.hasMore) {
			children.push(new LoadMoreNode(this.view, this, children.at(-1)!));
		}
		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const presence = this.options?.presence?.get(this.contributor.email!);

		const shortStats =
			this.contributor.stats != null
				? ` (${pluralize('file', this.contributor.stats.files)}, +${formatNumeric(
						this.contributor.stats.additions,
					)} -${formatNumeric(this.contributor.stats.deletions)} ${pluralize(
						'line',
						this.contributor.stats.additions + this.contributor.stats.deletions,
						{ only: true },
					)})`
				: '';

		const displayName = this.contributor.current
			? formatCurrentUserDisplayName(this.contributor.label)
			: this.contributor.label;

		const item = new TreeItem(displayName, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = this.contributor.current
			? `${ContextValues.Contributor}+current`
			: ContextValues.Contributor;
		item.description = `${
			presence != null && presence.status !== 'offline'
				? `${presence.statusText} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `
				: ''
		}${this.contributor.latestCommitDate != null ? `${GitContributor.formatDateFromNow(this.contributor)}, ` : ''}${pluralize(
			'commit',
			this.contributor.contributionCount,
		)}${shortStats}`;

		let avatarUri;
		let avatarMarkdown;
		if (this.view.config.avatars) {
			const size = configuration.get('hovers.avatarSize');
			avatarUri = await getContributorAvatarUri(this.contributor, {
				defaultStyle: configuration.get('defaultGravatarsStyle'),
				size: size,
			});

			if (presence != null) {
				let subjectAndVerb: string;
				if (this.contributor.current) {
					const style = configuration.get('defaultCurrentUserNameStyle');
					subjectAndVerb = `${formatCurrentUserDisplayName(this.contributor.label, style)} ${style === 'you' ? 'are' : 'is'}`;
				} else {
					subjectAndVerb = `${this.contributor.label} is`;
				}
				const title = `${subjectAndVerb} ${
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
				? `Last commit ${GitContributor.formatDateFromNow(this.contributor)} (${GitContributor.formatDate(this.contributor)})\\\n`
				: '';

		const pathContext = this.options?.pathspec?.uri
			? ` to \`${this.view.container.git.getRelativePath(this.options?.pathspec?.uri, this.uri.repoPath!)}\``
			: '';
		const markdown = new MarkdownString(
			`${avatarMarkdown ?? ''} &nbsp;${link} \n\n${lastCommitted}${pluralize(
				'commit',
				this.contributor.contributionCount,
			)}${pathContext}${stats}`,
		);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;
		item.iconPath = avatarUri;

		return item;
	}

	@trace()
	override refresh(reset?: boolean): void {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		const svc = this.view.container.git.getRepositoryService(this.uri.repoPath!);

		const { name, email, username, id } = this.contributor;

		// If a Uri is provided, get log for the specific path, otherwise get all commits by author
		if (this.options?.pathspec?.uri) {
			this._log ??= await svc.commits.getLogForPath(this.uri, this.options?.ref, {
				all: this.options?.all,
				authors: [{ name: name, email: email, username: username, id: id }],
				isFolder: this.options?.pathspec.isFolder,
				limit: this.limit ?? this.view.config.defaultItemLimit,
				merges: this.options?.showMergeCommits,
			});
		} else {
			this._log ??= await svc.commits.getLog(this.options?.ref, {
				all: this.options?.all,
				authors: [{ name: name, email: email, username: username, id: id }],
				limit: this.limit ?? this.view.config.defaultItemLimit,
				merges: this.options?.showMergeCommits,
			});
		}
		return this._log;
	}

	get hasMore(): boolean {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }): Promise<void> {
		let log = await window.withProgress({ location: { viewId: this.view.id } }, () => this.getLog());
		if (!log?.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
