/**
 * Shared pull request actions for webview apps.
 *
 * Standalone functions for PR viewing operations. Each function accepts
 * the relevant commands service method via structural typing.
 */
import type { PullRequestRefs } from '@gitlens/git/models/pullRequest.js';
import { fireAndForget } from './rpc.js';

export function openPullRequestChanges(
	commands: { openPullRequestChanges(repoPath: string, prRefs: PullRequestRefs): Promise<void> },
	repoPath: string,
	refs: PullRequestRefs,
): void {
	fireAndForget(commands.openPullRequestChanges(repoPath, refs), 'open PR changes');
}

export function openPullRequestComparison(
	commands: { openPullRequestComparison(repoPath: string, prRefs: PullRequestRefs): Promise<void> },
	repoPath: string,
	refs: PullRequestRefs,
): void {
	fireAndForget(commands.openPullRequestComparison(repoPath, refs), 'open PR comparison');
}

export function openPullRequestOnRemote(
	commands: { openPullRequestOnRemote(prUrl: string): Promise<void> },
	url: string,
): void {
	fireAndForget(commands.openPullRequestOnRemote(url), 'open PR on remote');
}

export function openPullRequestDetails(
	commands: { openPullRequestDetails(repoPath: string, prId: string, prProvider: string): Promise<void> },
	repoPath: string,
	id: string,
	provider: string,
): void {
	fireAndForget(commands.openPullRequestDetails(repoPath, id, provider), 'open PR details');
}
