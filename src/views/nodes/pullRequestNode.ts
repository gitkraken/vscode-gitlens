import { MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import { getIssueOrPullRequestMarkdownIcon, getIssueOrPullRequestThemeIcon } from '../../git/models/issue';
import type { PullRequest } from '../../git/models/pullRequest';
import type { GitBranchReference } from '../../git/models/reference';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';

export class PullRequestNode extends ViewNode<'pullrequest', ViewsWithCommits> {
	readonly repoPath: string;

	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly pullRequest: PullRequest,
		branchOrCommitOrRepoPath: GitBranch | GitCommit | string,
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

		this._uniqueId = getViewNodeId(this.type, this.context);
		this.repoPath = repoPath;
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
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

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(`#${this.pullRequest.id}: ${this.pullRequest.title}`, TreeItemCollapsibleState.None);
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
