import type { CancellationToken } from 'vscode';
import { ProgressLocation, window } from 'vscode';
import type { PullRequest, PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import { getPullRequestNumberFromUrl, getStackedMergeCount } from '@gitlens/git/utils/pullRequest.utils.js';
import type { GitHostIntegration } from '@gitlens/integrations/models/gitHostIntegration.js';
import { toAbortSignal } from '../../../../system/-webview/cancellation.js';

/**
 * Confirms the blast radius of merging a pull request before doing it. A stacked pull request never
 * merges alone — everything below it lands with it, which can include other people's reviewed work.
 * Names the real blast radius before asking. Returns `true` if the user confirmed, `false` if they
 * cancelled.
 */
export async function confirmPullRequestMerge(pr: PullRequest): Promise<boolean> {
	const headName = pr.refs?.head?.branch;
	const baseName = pr.refs?.base?.branch;

	const stack = pr.stack;
	const count = getStackedMergeCount(stack);
	const mergeLabel = count > 1 ? `Merge ${count} Pull Requests` : 'Merge';
	const number = getPullRequestNumberFromUrl(pr.url) ?? pr.id;
	const confirm = await window.showQuickPick([mergeLabel, 'Cancel'], {
		title: `${count > 1 ? 'Merge Stack' : 'Merge Pull Request'} • #${number} ${pr.title}`,
		placeHolder:
			stack != null && count > 1
				? `Merging ${headName ?? 'this pull request'} also merges the ${count - 1} pull request${
						count - 1 === 1 ? '' : 's'
					} below it in the stack, into ${stack.baseRef}. This cannot be undone.`
				: `Are you sure you want to merge ${headName ?? 'this pull request'}${
						baseName ? ` into ${baseName}` : ''
					}? This cannot be undone.`,
	});
	return confirm === mergeLabel;
}

export type PullRequestMergeProgressResult = 'merged' | 'cancelled' | 'failed';

/**
 * Runs a pull request merge under a cancellable progress notification and surfaces the outcome —
 * an info message when the user stops waiting (the server-side merge may still complete), an error
 * message on failure. Callers own their own cache/view refreshes.
 */
export async function mergePullRequestWithProgress(
	integration: GitHostIntegration,
	pr: PullRequest,
	options?: { mergeMethod?: PullRequestMergeMethod },
): Promise<PullRequestMergeProgressResult> {
	const count = getStackedMergeCount(pr.stack);
	const number = getPullRequestNumberFromUrl(pr.url) ?? pr.id;

	let cancellationToken: CancellationToken | undefined;
	const merged = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title:
				count > 1
					? `Merging ${count} pull requests (#${number} and the ${count - 1} below it in the stack)...`
					: `Merging pull request #${number}...`,
			cancellable: true,
		},
		(_progress, token) => {
			cancellationToken = token;
			return integration.mergePullRequest(pr, options, toAbortSignal(token));
		},
	);
	if (merged) return 'merged';

	if (cancellationToken?.isCancellationRequested) {
		// The client-side poll stopped, but the server-side merge may still be running — don't claim it didn't happen.
		void window.showInformationMessage(
			`Stopped waiting for pull request #${number} to merge — the merge may still complete on ${integration.name}.`,
		);
		return 'cancelled';
	}

	void window.showErrorMessage(`Unable to merge pull request #${number}`);
	return 'failed';
}
