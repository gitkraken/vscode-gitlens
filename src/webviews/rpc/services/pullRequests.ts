/**
 * Pull Requests service — PR viewing and navigation operations for webviews.
 *
 * Provides shared pull request operations (open changes, comparison, remote,
 * details) that any webview can reuse. Method signatures match the structural
 * typing expected by `src/webviews/apps/shared/actions/pr.ts`.
 */

import { l10n } from 'vscode';
import type { PullRequestRefs, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { getComparisonRefsForPullRequest, serializePullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../../commands/openPullRequestOnRemote.js';
import type { Container } from '../../../container.js';
import { openComparisonChanges } from '../../../git/actions/commit.js';
import { getBranchAssociatedPullRequest } from '../../../git/utils/-webview/branch.utils.js';
import { getCommitAssociatedPullRequest } from '../../../git/utils/-webview/commit.utils.js';
import { getBestRemoteWithIntegration, getRemoteIntegration } from '../../../git/utils/-webview/remote.utils.js';
import { executeCommand } from '../../../system/-webview/command.js';

export class PullRequestsService {
	constructor(private readonly container: Container) {}

	/**
	 * Get the pull request associated with a commit.
	 *
	 * Looks up the commit by SHA and resolves its associated PR
	 * via the remote integration provider.
	 */
	async getPullRequestForCommit(
		repoPath: string,
		sha: string,
		signal?: AbortSignal,
	): Promise<PullRequestShape | undefined> {
		signal?.throwIfAborted();
		const pr = await getCommitAssociatedPullRequest(repoPath, sha);
		signal?.throwIfAborted();
		return pr != null ? serializePullRequest(pr) : undefined;
	}

	/**
	 * Get the pull request associated with the current branch.
	 *
	 * Looks up the repository's current branch and resolves its associated PR
	 * via the remote integration provider. Uses a 5-minute expiry override
	 * for cached PR data.
	 */
	async getPullRequestForBranch(repoPath: string): Promise<PullRequestShape | undefined> {
		const repoService = this.container.git.getRepositoryService(repoPath);
		const status = await repoService.status.getStatus();
		if (status?.branch == null) return undefined;

		const branch = await repoService.branches.getBranch(status.branch);
		if (branch == null) return undefined;

		const pr = await getBranchAssociatedPullRequest(this.container, branch, { expiryOverride: 1000 * 60 * 5 });
		return pr != null ? serializePullRequest(pr) : undefined;
	}

	/**
	 * Open all changed files for a pull request.
	 *
	 * Converts PR refs to comparison refs and opens a multi-file diff view
	 * showing all changes in the pull request.
	 */
	async openPullRequestChanges(repoPath: string, prRefs: PullRequestRefs): Promise<void> {
		const refs = getComparisonRefsForPullRequest(repoPath, prRefs);
		await openComparisonChanges(
			this.container,
			{ repoPath: refs.repoPath, lhs: refs.base.ref, rhs: refs.head.ref },
			{ title: l10n.t('Changes in Pull Request') },
		);
	}

	/**
	 * Open the Search & Compare view with a PR comparison.
	 *
	 * Converts PR refs to comparison refs and triggers a comparison
	 * in the Search & Compare tree view.
	 */
	openPullRequestComparison(repoPath: string, prRefs: PullRequestRefs): Promise<void> {
		const refs = getComparisonRefsForPullRequest(repoPath, prRefs);
		void this.container.views.searchAndCompare.compare(refs.repoPath, refs.head, refs.base);
		return Promise.resolve();
	}

	/**
	 * Open a pull request on its remote provider (GitHub, GitLab, etc.).
	 *
	 * Delegates to the `gitlens.openPullRequestOnRemote` command which
	 * handles opening the PR URL in the default browser.
	 */
	async openPullRequestOnRemote(prUrl: string): Promise<void> {
		await executeCommand<OpenPullRequestOnRemoteCommandArgs>('gitlens.openPullRequestOnRemote', {
			pr: { url: prUrl },
		});
	}

	/**
	 * Open the pull request details view.
	 *
	 * When `prId` and `prProvider` are both provided, resolves the PR directly via the
	 * matching integration so the correct PR opens regardless of which branch is currently
	 * checked out. This is the path used by non-WIP PR chips (multicommit, compare,
	 * single-commit) where the PR is not necessarily on the repo's current branch.
	 *
	 * When either is empty, falls back to resolving via the repo's current branch — the
	 * legacy behavior preserved for callers that don't have id/provider context (e.g.,
	 * single-WIP scenarios where the current branch IS the PR's branch).
	 */
	async openPullRequestDetails(repoPath: string, prId: string, prProvider: string): Promise<void> {
		if (prId && prProvider) {
			const remote = await getBestRemoteWithIntegration(repoPath, {
				filter: r => r.provider.id === prProvider,
			});
			if (remote != null) {
				const integration = await getRemoteIntegration(remote);
				const pr = await integration?.getPullRequest(remote.provider.repoDesc, prId);
				if (pr != null) {
					void this.container.views.pullRequest.showPullRequest(pr, repoPath);
					return;
				}
			}
		}

		// Fallback: resolve via the repo's current branch.
		const repoService = this.container.git.getRepositoryService(repoPath);
		const status = await repoService.status.getStatus();
		if (status?.branch == null) return;

		const branch = await repoService.branches.getBranch(status.branch);
		const pr = branch != null ? await getBranchAssociatedPullRequest(this.container, branch) : undefined;
		if (pr == null) return;

		void this.container.views.pullRequest.showPullRequest(pr, repoPath);
	}
}
