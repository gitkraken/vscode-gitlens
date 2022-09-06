import { MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import { isCommit } from '../../git/models/commit';
import { PullRequest, PullRequestState } from '../../git/models/pullRequest';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './viewNode';

export class PullRequestNode extends ViewNode<ViewsWithCommits> {
	static key = ':pullrequest';
	static getId(parent: ViewNode, id: string, ref?: string): string {
		return `${parent.id}${this.key}(${id}):${ref}`;
	}

	public readonly pullRequest: PullRequest;
	private readonly branchOrCommit?: GitBranch | GitCommit;
	private readonly repoPath: string;

	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		pullRequest: PullRequest,
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

		super(GitUri.fromRepoPath(repoPath), view, parent);

		this.branchOrCommit = branchOrCommit;
		this.pullRequest = pullRequest;
		this.repoPath = repoPath;
	}

	override toClipboard(): string {
		return this.pullRequest.url;
	}

	override get id(): string {
		return PullRequestNode.getId(this.parent, this.pullRequest.id, this.branchOrCommit?.ref);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(`#${this.pullRequest.id}: ${this.pullRequest.title}`, TreeItemCollapsibleState.None);
		item.id = this.id;
		item.contextValue = ContextValues.PullRequest;
		item.description = `${this.pullRequest.state}, ${this.pullRequest.formatDateFromNow()}`;
		item.iconPath = PullRequest.getThemeIcon(this.pullRequest);

		const tooltip = new MarkdownString('', true);
		tooltip.supportHtml = true;
		tooltip.isTrusted = true;

		if (isCommit(this.branchOrCommit)) {
			tooltip.appendMarkdown(
				`Commit \`$(git-commit) ${this.branchOrCommit.shortSha}\` was introduced by $(git-pull-request) PR #${this.pullRequest.id}\n\n`,
			);
		}

		const linkTitle = ` "Open Pull Request \\#${this.pullRequest.id} on ${this.pullRequest.provider.name}"`;
		tooltip.appendMarkdown(
			`${PullRequest.getMarkdownIcon(this.pullRequest)} [**${this.pullRequest.title.trim()}**](${
				this.pullRequest.url
			}${linkTitle}) \\\n[#${this.pullRequest.id}](${this.pullRequest.url}${linkTitle}) by [@${
				this.pullRequest.author.name
			}](${this.pullRequest.author.url} "Open @${this.pullRequest.author.name} on ${
				this.pullRequest.provider.name
			}") was ${
				this.pullRequest.state === PullRequestState.Open ? 'opened' : this.pullRequest.state.toLowerCase()
			} ${this.pullRequest.formatDateFromNow()}`,
		);

		item.tooltip = tooltip;

		return item;
	}
}
