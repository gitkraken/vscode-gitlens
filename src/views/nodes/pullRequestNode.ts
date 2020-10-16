'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchesView } from '../branchesView';
import { CommitsView } from '../commitsView';
import { ContributorsView } from '../contributorsView';
import { GitBranch, GitCommit, PullRequest, PullRequestState } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RemotesView } from '../remotesView';
import { RepositoriesView } from '../repositoriesView';
import { RepositoryNode } from './repositoryNode';
import { SearchAndCompareView } from '../searchAndCompareView';
import { ContextValues, ViewNode } from './viewNode';

export class PullRequestNode extends ViewNode<
	BranchesView | CommitsView | ContributorsView | RemotesView | RepositoriesView | SearchAndCompareView
> {
	static key = ':pullrequest';
	static getId(repoPath: string, number: number, ref: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${number}):${ref}`;
	}

	constructor(
		view: BranchesView | CommitsView | ContributorsView | RemotesView | RepositoriesView | SearchAndCompareView,
		parent: ViewNode,
		public readonly pullRequest: PullRequest,
		public readonly branchOrCommit: GitBranch | GitCommit,
	) {
		super(GitUri.fromRepoPath(branchOrCommit.repoPath), view, parent);
	}

	toClipboard(): string {
		return this.pullRequest.url;
	}

	get id(): string {
		return PullRequestNode.getId(this.branchOrCommit.repoPath, this.pullRequest.number, this.branchOrCommit.ref);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`#${this.pullRequest.number}: ${this.pullRequest.title}`,
			TreeItemCollapsibleState.None,
		);
		item.contextValue = ContextValues.PullRequest;
		item.description = `${this.pullRequest.state}, ${this.pullRequest.formatDateFromNow()}`;
		item.iconPath = new ThemeIcon('git-pull-request');
		item.id = this.id;
		item.tooltip = `${this.pullRequest.title}\n#${this.pullRequest.number} by ${this.pullRequest.author.name} was ${
			this.pullRequest.state === PullRequestState.Open ? 'opened' : this.pullRequest.state.toLowerCase()
		} ${this.pullRequest.formatDateFromNow()}`;

		if (this.branchOrCommit instanceof GitCommit) {
			item.tooltip = `Commit ${this.branchOrCommit.shortSha} was introduced by PR #${this.pullRequest.number}\n${item.tooltip}`;
		}

		// item.tooltip = `Open Pull Request #${this.pullRequest.number} on ${this.pullRequest.provider}`;
		// item.command = {
		// 	title: 'Open Pull Request',
		// 	command: Commands.OpenPullRequestOnRemote,
		// 	arguments: [this],
		// };

		return item;
	}
}
