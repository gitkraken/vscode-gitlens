import type { Command } from 'vscode';
import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithPreviousCommandArgs } from '../../commands';
import type { Colors } from '../../constants';
import { Commands } from '../../constants';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import type { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import type { PullRequest } from '../../git/models/pullRequest';
import type { GitRevisionReference } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import type { RichRemoteProvider } from '../../git/remotes/richRemoteProvider';
import { makeHierarchical } from '../../system/array';
import { pauseOnCancelOrTimeoutMapTuplePromise } from '../../system/cancellation';
import { configuration } from '../../system/configuration';
import { getContext } from '../../system/context';
import { gate } from '../../system/decorators/gate';
import { joinPaths, normalizePath } from '../../system/path';
import type { Deferred } from '../../system/promise';
import { defer, getSettledValue } from '../../system/promise';
import { sortCompare } from '../../system/string';
import type { FileHistoryView } from '../fileHistoryView';
import { TagsView } from '../tagsView';
import type { ViewsWithCommits } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { PullRequestNode } from './pullRequestNode';
import type { ViewNode } from './viewNode';
import { ContextValues, getViewNodeId, ViewRefNode } from './viewNode';

type State = {
	pullRequest: PullRequest | null | undefined;
	pendingPullRequest: Promise<PullRequest | undefined> | undefined;
};

export class CommitNode extends ViewRefNode<ViewsWithCommits | FileHistoryView, GitRevisionReference, State> {
	constructor(
		view: ViewsWithCommits | FileHistoryView,
		parent: ViewNode,
		public readonly commit: GitCommit,
		private readonly unpublished?: boolean,
		public readonly branch?: GitBranch,
		private readonly getBranchAndTagTips?: (sha: string, options?: { compact?: boolean }) => string | undefined,
		private readonly _options: { expand?: boolean } = {},
	) {
		super(commit.getGitUri(), view, parent);

		this.updateContext({ commit: commit });
		this._uniqueId = getViewNodeId('commit', this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return `${this.commit.shortSha}: ${this.commit.summary}`;
	}

	get isTip(): boolean {
		return (this.branch?.current && this.branch.sha === this.commit.ref) ?? false;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	private _children: (PullRequestNode | FileNode)[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const commit = this.commit;

			let children: (PullRequestNode | FileNode)[] = [];
			let onCompleted: Deferred<void> | undefined;
			let pullRequest;

			if (
				!(this.view instanceof TagsView) &&
				!this.unpublished &&
				getContext('gitlens:hasConnectedRemotes') &&
				this.view.config.pullRequests.enabled &&
				this.view.config.pullRequests.showForCommits
			) {
				pullRequest = this.getState('pullRequest');
				if (pullRequest === undefined && this.getState('pendingPullRequest') === undefined) {
					onCompleted = defer<void>();
					const prPromise = this.getAssociatedPullRequest(commit);

					queueMicrotask(async () => {
						await onCompleted?.promise;

						// If we are waiting too long, refresh this node to show a spinner while the pull request is loading
						let spinner = false;
						const timeout = setTimeout(() => {
							spinner = true;
							this.view.triggerNodeChange(this);
						}, 250);

						const pr = await prPromise;
						clearTimeout(timeout);

						// If we found a pull request, insert it into the children cache (if loaded) and refresh the node
						if (pr != null && this._children != null) {
							this._children.unshift(new PullRequestNode(this.view, this, pr, commit));
						}

						// Refresh this node to add the pull request node or remove the spinner
						if (spinner || pr != null) {
							this.view.triggerNodeChange(this);
						}
					});
				}
			}

			const commits = await commit.getCommitsForFiles();
			for (const c of commits) {
				children.push(new CommitFileNode(this.view, this, c.file!, c));
			}

			if (this.view.config.files.layout !== 'list') {
				const hierarchy = makeHierarchical(
					children as FileNode[],
					n => n.uri.relativePath.split('/'),
					(...parts: string[]) => normalizePath(joinPaths(...parts)),
					this.view.config.files.compact,
				);

				const root = new FolderNode(this.view, this, hierarchy, this.repoPath, '', undefined);
				children = root.getChildren() as FileNode[];
			} else {
				(children as FileNode[]).sort((a, b) => sortCompare(a.label!, b.label!));
			}

			if (pullRequest != null) {
				children.unshift(new PullRequestNode(this.view, this, pullRequest, commit));
			}

			this._children = children;
			setTimeout(() => onCompleted?.fulfill(), 1);
		}

		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const label = CommitFormatter.fromTemplate(this.view.config.formats.commits.label, this.commit, {
			dateFormat: configuration.get('defaultDateFormat'),
			getBranchAndTagTips: (sha: string) => this.getBranchAndTagTips?.(sha, { compact: true }),
			messageTruncateAtNewLine: true,
		});

		const item = new TreeItem(
			label,
			this._options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = `${ContextValues.Commit}${this.branch?.current ? '+current' : ''}${
			this.isTip ? '+HEAD' : ''
		}${this.unpublished ? '+unpublished' : ''}`;

		item.description = CommitFormatter.fromTemplate(this.view.config.formats.commits.description, this.commit, {
			dateFormat: configuration.get('defaultDateFormat'),
			getBranchAndTagTips: (sha: string) => this.getBranchAndTagTips?.(sha, { compact: true }),
			messageTruncateAtNewLine: true,
		});

		const pendingPullRequest = this.getState('pendingPullRequest');

		item.iconPath =
			pendingPullRequest != null
				? new ThemeIcon('loading~spin')
				: this.unpublished
				? new ThemeIcon('arrow-up', new ThemeColor('gitlens.unpublishedCommitIconColor' satisfies Colors))
				: this.view.config.avatars
				? await this.commit.getAvatarUri({ defaultStyle: configuration.get('defaultGravatarsStyle') })
				: undefined;
		// item.tooltip = this.tooltip;

		return item;
	}

	override getCommand(): Command | undefined {
		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			uri: this.uri,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes with Previous Revision',
			command: Commands.DiffWithPrevious,
			arguments: [undefined, commandArgs],
		};
	}

	@gate()
	override refresh(reset?: boolean) {
		this._children = undefined;
		if (reset) {
			this.deleteState();
		}
	}

	override async resolveTreeItem(item: TreeItem): Promise<TreeItem> {
		if (item.tooltip == null) {
			item.tooltip = await this.getTooltip();
		}
		return item;
	}

	private async getAssociatedPullRequest(
		commit: GitCommit,
		remote?: GitRemote<RichRemoteProvider>,
	): Promise<PullRequest | undefined> {
		let pullRequest = this.getState('pullRequest');
		if (pullRequest !== undefined) return Promise.resolve(pullRequest ?? undefined);

		let pendingPullRequest = this.getState('pendingPullRequest');
		if (pendingPullRequest == null) {
			pendingPullRequest = commit.getAssociatedPullRequest(remote);
			this.storeState('pendingPullRequest', pendingPullRequest);

			pullRequest = await pendingPullRequest;
			this.storeState('pullRequest', pullRequest ?? null);
			this.deleteState('pendingPullRequest');

			return pullRequest;
		}

		return pendingPullRequest;
	}

	private async getTooltip() {
		const [remotesResult, _] = await Promise.allSettled([
			this.view.container.git.getBestRemotesWithProviders(this.commit.repoPath),
			this.commit.message == null ? this.commit.ensureFullDetails() : undefined,
		]);

		const remotes = getSettledValue(remotesResult, []);
		const [remote] = remotes;

		let enrichedAutolinks;
		let pr;

		if (remote?.hasRichIntegration()) {
			const [enrichedAutolinksResult, prResult] = await Promise.allSettled([
				pauseOnCancelOrTimeoutMapTuplePromise(this.commit.getEnrichedAutolinks(remote)),
				this.getAssociatedPullRequest(this.commit, remote),
			]);

			enrichedAutolinks = getSettledValue(enrichedAutolinksResult)?.value;
			pr = getSettledValue(prResult);
		}

		const tooltip = await CommitFormatter.fromTemplateAsync(this.view.config.formats.commits.tooltip, this.commit, {
			enrichedAutolinks: enrichedAutolinks,
			dateFormat: configuration.get('defaultDateFormat'),
			getBranchAndTagTips: this.getBranchAndTagTips,
			messageAutolinks: true,
			messageIndent: 4,
			pullRequest: pr,
			outputFormat: 'markdown',
			remotes: remotes,
			unpublished: this.unpublished,
		});

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		return markdown;
	}
}
