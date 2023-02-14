import type { Disposable } from 'vscode';
import { Commands, ContextKeys } from '../../../constants';
import type { Container } from '../../../container';
import { setContext } from '../../../context';
import type { SearchedIssue } from '../../../git/models/issue';
// import { serializeIssue } from '../../../git/models/issue';
import type { SearchedPullRequest } from '../../../git/models/pullRequest';
import {
	PullRequestMergeableState,
	PullRequestReviewDecision,
	serializePullRequest,
} from '../../../git/models/pullRequest';
import type { GitRemote } from '../../../git/models/remote';
import type { RichRemoteProvider } from '../../../git/remotes/richRemoteProvider';
import { registerCommand } from '../../../system/command';
import { WebviewBase } from '../../../webviews/webviewBase';
import type { State } from './protocol';

export class WorkspacesWebview extends WebviewBase<State> {
	constructor(container: Container) {
		super(
			container,
			'gitlens.workspaces',
			'workspaces.html',
			'images/gitlens-icon.png',
			'Workspaces',
			`${ContextKeys.WebviewPrefix}workspaces`,
			'workspacesWebview',
			Commands.ShowWorkspacesPage,
		);
	}

	protected override registerCommands(): Disposable[] {
		return [registerCommand(Commands.RefreshWorkspaces, () => this.refresh(true))];
	}

	protected override onFocusChanged(focused: boolean): void {
		if (focused) {
			// If we are becoming focused, delay it a bit to give the UI time to update
			setTimeout(() => void setContext(ContextKeys.WorkspacesFocused, focused), 0);

			return;
		}

		void setContext(ContextKeys.WorkspacesFocused, focused);
	}

	private async getWorkspaces() {
		try {
			const rsp = await this.container.workspaces.getWorkspacesWithPullRequests();
			console.log(rsp);
		} catch (ex) {
			console.log(ex);
		}

		return {};
	}

	private async getState(): Promise<State> {
		// return Promise.resolve({});

		const prs = await this.getMyPullRequests();
		const serializedPrs = prs.map(pr => ({
			pullRequest: serializePullRequest(pr.pullRequest),
			reasons: pr.reasons,
		}));

		// const issues = await this.getMyIssues();
		// const serializedIssues = issues.map(issue => ({
		// 	issue: serializeIssue(issue.issue),
		// 	reasons: issue.reasons,
		// }));

		return {
			// workspaces: await this.getWorkspaces(),
			pullRequests: serializedPrs,
			// myIssues: serializedIssues,
		};
	}

	protected override async includeBootstrap(): Promise<State> {
		return this.getState();
	}

	private async getRichProviders(): Promise<GitRemote<RichRemoteProvider>[]> {
		const remotes: GitRemote<RichRemoteProvider>[] = [];
		for (const repo of this.container.git.openRepositories) {
			const richRemote = await repo.getRichRemote(true);
			if (richRemote == null || remotes.includes(richRemote)) {
				continue;
			}
			remotes.push(richRemote);
		}

		return remotes;
	}

	private async getMyPullRequests(): Promise<SearchedPullRequest[]> {
		const providers = await this.getRichProviders();
		const allPrs = [];
		for (const provider of providers) {
			const prs = await this.container.git.getMyPullRequests(provider);
			if (prs == null) {
				continue;
			}
			allPrs.push(...prs.filter(pr => pr.reasons.length > 0));
		}

		function getScore(pr: SearchedPullRequest) {
			let score = 0;
			if (pr.reasons.includes('author')) {
				score += 1000;
			} else if (pr.reasons.includes('assignee')) {
				score += 900;
			} else if (pr.reasons.includes('reviewer')) {
				score += 800;
			} else if (pr.reasons.includes('mentioned')) {
				score += 700;
			}

			if (pr.pullRequest.reviewDecision === PullRequestReviewDecision.Approved) {
				if (pr.pullRequest.mergeableState === PullRequestMergeableState.Mergeable) {
					score += 100;
				} else if (pr.pullRequest.mergeableState === PullRequestMergeableState.Conflicting) {
					score += 90;
				} else {
					score += 80;
				}
			} else if (pr.pullRequest.reviewDecision === PullRequestReviewDecision.ChangesRequested) {
				score += 70;
			}

			return score;
		}

		return allPrs.sort((a, b) => {
			const scoreA = getScore(a);
			const scoreB = getScore(b);

			if (scoreA === scoreB) {
				return a.pullRequest.date.getTime() - b.pullRequest.date.getTime();
			}
			return (scoreB ?? 0) - (scoreA ?? 0);
		});
	}

	private async getMyIssues(): Promise<SearchedIssue[]> {
		const providers = await this.getRichProviders();
		const allIssues = [];
		for (const provider of providers) {
			const issues = await this.container.git.getMyIssues(provider);
			if (issues == null) {
				continue;
			}
			allIssues.push(...issues.filter(pr => pr.reasons.length > 0));
		}

		return allIssues.sort((a, b) => b.issue.date.getTime() - a.issue.date.getTime());
	}
}
