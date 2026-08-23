/**
 * Shared pull request actions for webview apps.
 *
 * Standalone functions for PR viewing operations. Each function accepts
 * the relevant commands service method via structural typing.
 */
import type { PullRequestRefs } from '@gitlens/git/models/pullRequest.js';
import { notifyService } from './rpc.js';

export function openPullRequestChanges(
	commands: { openPullRequestChanges(repoPath: string, prRefs: PullRequestRefs): Promise<void> },
	repoPath: string,
	refs: PullRequestRefs,
): void {
	notifyService(commands, 'open PR changes', svc => svc.openPullRequestChanges(repoPath, refs));
}

export function openPullRequestComparison(
	commands: { openPullRequestComparison(repoPath: string, prRefs: PullRequestRefs): Promise<void> },
	repoPath: string,
	refs: PullRequestRefs,
): void {
	notifyService(commands, 'open PR comparison', svc => svc.openPullRequestComparison(repoPath, refs));
}

export function openPullRequestOnRemote(
	commands: { openPullRequestOnRemote(prUrl: string): Promise<void> },
	url: string,
): void {
	notifyService(commands, 'open PR on remote', svc => svc.openPullRequestOnRemote(url));
}

export function openPullRequestDetails(
	commands: { openPullRequestDetails(repoPath: string, prId: string, prProvider: string): Promise<void> },
	repoPath: string,
	id: string,
	provider: string,
): void {
	notifyService(commands, 'open PR details', svc => svc.openPullRequestDetails(repoPath, id, provider));
}
