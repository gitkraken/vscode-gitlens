import { MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import { getIssueOrPullRequestMarkdownIcon, getIssueOrPullRequestThemeIcon } from '../../git/models/issue';
import type { PullRequest } from '../../git/models/pullRequest';
import { getComparisonRefsForPullRequest } from '../../git/models/pullRequest';
import type { GitBranchReference } from '../../git/models/reference';
import { createRevisionRange } from '../../git/models/reference';
import { getAheadBehindFilesQuery, getCommitsQuery } from '../../git/queryResults';
import { pluralize } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ClipboardType, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { CodeSuggestionsNode } from './codeSuggestionsNode';
import { ResultsCommitsNode } from './resultsCommitsNode';
import { ResultsFilesNode } from './resultsFilesNode';

export class PullRequestNode extends CacheableChildrenViewNode<'pullrequest', ViewsWithCommits> {
	readonly repoPath: string;

	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly pullRequest: PullRequest,
		branchOrCommitOrRepoPath: GitBranch | GitCommit | string,
		private readonly options?: { expand?: boolean },
	) {
		let branchOrCommit;
		let repoPath;
		if (typeof branchOrCommitOrRepoPath === 'string') {
			repoPath = branchOrCommitOrRepoPath;
		} else {
			repoPath = branchOrCommitOrRepoPath.repoPath;
			branchOrCommit = branchOrCommitOrRepoPath;
		}

		super('pullrequest', GitUri.fromRepoPath(repoPath), view, parent);

		if (branchOrCommit != null) {
			if (branchOrCommit instanceof GitBranch) {
				this.updateContext({ branch: branchOrCommit });
			} else {
				this.updateContext({ commit: branchOrCommit });
			}
		}

		this.updateContext({ pullRequest: pullRequest });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.repoPath = repoPath;
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(type?: ClipboardType): string {
		switch (type) {
			case 'markdown':
				return `[${this.pullRequest.id}](${this.pullRequest.url}) ${this.pullRequest.title}`;
			default:
				return this.pullRequest.url;
		}
	}

	override getUrl(): string {
		return this.pullRequest.url;
	}

	get baseRef(): GitBranchReference | undefined {
		if (this.pullRequest.refs?.base != null) {
			return {
				refType: 'branch',
				repoPath: this.repoPath,
				ref: this.pullRequest.refs.base.sha,
				name: this.pullRequest.refs.base.branch,
				remote: true,
			};
		}
		return undefined;
	}

	get ref(): GitBranchReference | undefined {
		if (this.pullRequest.refs?.head != null) {
			return {
				refType: 'branch',
				repoPath: this.repoPath,
				ref: this.pullRequest.refs.head.sha,
				name: this.pullRequest.refs.head.branch,
				remote: true,
			};
		}
		return undefined;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const refs = await getComparisonRefsForPullRequest(
				this.view.container,
				this.repoPath,
				this.pullRequest.refs!,
			);

			const comparison = {
				ref1: refs.base.ref,
				ref2: refs.head.ref,
			};

			const aheadBehindCounts = await this.view.container.git.getAheadBehindCommitCount(this.repoPath, [
				createRevisionRange(comparison.ref2, comparison.ref1, '...'),
			]);

			const children = [
				new ResultsCommitsNode(
					this.view,
					this,
					this.repoPath,
					'Commits',
					{
						query: getCommitsQuery(
							this.view.container,
							this.repoPath,
							createRevisionRange(comparison.ref1, comparison.ref2, '..'),
						),
						comparison: comparison,
					},
					{
						autolinks: false,
						expand: false,
						description: pluralize('commit', aheadBehindCounts?.ahead ?? 0),
					},
				),
				new CodeSuggestionsNode(this.view, this, this.repoPath, this.pullRequest),
				new ResultsFilesNode(
					this.view,
					this,
					this.repoPath,
					comparison.ref1,
					comparison.ref2,
					() =>
						getAheadBehindFilesQuery(
							this.view.container,
							this.repoPath,
							createRevisionRange(comparison.ref1, comparison.ref2, '...'),
							false,
						),
					undefined,
					{ expand: true, timeout: false },
				),
			];

			this.children = children;
		}
		return this.children;
	}

	getTreeItem(): TreeItem {
		const hasRefs = this.pullRequest.refs?.base != null && this.pullRequest.refs.head != null;

		const item = new TreeItem(
			`#${this.pullRequest.id}: ${this.pullRequest.title}`,
			hasRefs
				? this.options?.expand
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed
				: TreeItemCollapsibleState.None,
		);
		item.id = this.id;
		item.contextValue = ContextValues.PullRequest;
		if (this.pullRequest.refs?.base != null && this.pullRequest.refs.head != null) {
			item.contextValue += `+refs`;
		}
		item.description = `${this.pullRequest.state}, ${this.pullRequest.formatDateFromNow()}`;
		item.iconPath = getIssueOrPullRequestThemeIcon(this.pullRequest);

		const tooltip = new MarkdownString('', true);
		tooltip.supportHtml = true;
		tooltip.isTrusted = true;

		if (this.context.commit != null) {
			tooltip.appendMarkdown(
				`Commit \`$(git-commit) ${this.context.commit.shortSha}\` was introduced by $(git-pull-request) PR #${this.pullRequest.id}\n\n`,
			);
		}

		const linkTitle = ` "Open Pull Request \\#${this.pullRequest.id} on ${this.pullRequest.provider.name}"`;
		tooltip.appendMarkdown(
			`${getIssueOrPullRequestMarkdownIcon(this.pullRequest)} [**${this.pullRequest.title.trim()}**](${
				this.pullRequest.url
			}${linkTitle}) \\\n[#${this.pullRequest.id}](${this.pullRequest.url}${linkTitle}) by [@${
				this.pullRequest.author.name
			}](${this.pullRequest.author.url} "Open @${this.pullRequest.author.name} on ${
				this.pullRequest.provider.name
			}") was ${this.pullRequest.state.toLowerCase()} ${this.pullRequest.formatDateFromNow()}`,
		);

		item.tooltip = tooltip;

		return item;
	}
}
