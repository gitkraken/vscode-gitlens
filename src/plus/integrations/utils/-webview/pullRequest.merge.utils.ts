import type { CancellationToken } from 'vscode';
import { l10n, ProgressLocation, window } from 'vscode';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestMergeQueueActionResult,
} from '@gitlens/git/models/pullRequest.js';
import {
	getPullRequestNumberFromUrl,
	getStackedMergeCount,
	isPullRequestInMergeQueue,
} from '@gitlens/git/utils/pullRequest.utils.js';
import type { GitHostIntegration } from '@gitlens/integrations/index.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { toAbortSignal } from '../../../../system/-webview/cancellation.js';
import { openUrl } from '../../../../system/-webview/vscode/uris.js';
import { getMergeQueueActionFailureMessage, getPullRequestMergeRoute } from '../pullRequest.mergeQueue.utils.js';

/**
 * What a merge action did: `merged`, `queued` (added to its merge queue instead, where the base branch requires one),
 * `dequeued` (removed from its merge queue, offered in place of merging a queued pull request), `cancelled` (stopped
 * waiting on a merge that may still land), `failed`, or `declined` (the user didn't confirm, or nothing was done).
 */
export type PullRequestMergeOutcome = 'merged' | 'queued' | 'dequeued' | 'cancelled' | 'failed' | 'declined';

/**
 * Merges a pull request, or adds it to its merge queue when its base branch accepts it only through one — the single
 * flow behind every Merge action. Pass a freshly read pull request: the route is decided from its merge-queue state.
 * A queued pull request isn't merged: the user is told why and offered the queue, or removing it from the queue.
 * `confirmed` names what the caller already confirmed in place; a different route still confirms here, since the
 * user agreed to something else. Callers own their own cache/view refreshes.
 */
export async function mergeOrEnqueuePullRequest(
	integration: GitHostIntegration,
	pr: PullRequest,
	options?: { confirmed?: 'merge' | 'enqueue'; mergeMethod?: PullRequestMergeMethod },
): Promise<PullRequestMergeOutcome> {
	const blocked = await blockMergeIfQueued(integration, pr);
	if (blocked != null) return blocked;

	if (getPullRequestMergeRoute(pr) === 'enqueue') {
		// The merge method is moot here: the queue's own rules decide how it merges
		if (options?.confirmed !== 'enqueue' && !(await confirmPullRequestEnqueue(pr))) return 'declined';

		return enqueuePullRequestWithProgress(integration, pr);
	}

	if (options?.confirmed !== 'merge' && !(await confirmPullRequestMerge(pr))) return 'declined';

	return mergePullRequestWithProgress(
		integration,
		pr,
		options?.mergeMethod != null ? { mergeMethod: options.mergeMethod } : undefined,
	);
}

/**
 * Refuses to merge a pull request that's waiting in a merge queue — the queue merges it on its own, and merging it
 * here would fight the queue. Tells the user why, offering the queue and removing the pull request from it. Returns
 * `undefined` when the pull request isn't queued (go ahead), otherwise what came of it.
 */
async function blockMergeIfQueued(
	integration: GitHostIntegration,
	pr: PullRequest,
): Promise<PullRequestMergeOutcome | undefined> {
	if (!isPullRequestInMergeQueue(pr)) return undefined;

	const queueNumber = getPullRequestNumberFromUrl(pr.url) ?? pr.id;
	const message = l10n.t('Pull Request #{number} is already in the merge queue', { number: queueNumber });
	const queueUrl = pr.mergeQueue.url;
	const openQueue = { title: l10n.t('Open Merge Queue') };
	const dequeue = { title: l10n.t('Remove from Merge Queue...') };
	const choice = await window.showInformationMessage(
		message,
		...(queueUrl != null ? [openQueue, dequeue] : [dequeue]),
	);
	if (choice === openQueue && queueUrl != null) {
		void openUrl(queueUrl);
	} else if (choice === dequeue) {
		return removePullRequestFromMergeQueue(integration, pr);
	}
	return 'declined';
}

/**
 * Removes a queued pull request from its merge queue, after confirming (it loses its place) unless the caller already
 * did in place. Pass a freshly read pull request: one that's no longer queued is reported, not acted on, as
 * `declined`. Callers own their own cache/view refreshes.
 */
export async function removePullRequestFromMergeQueue(
	integration: GitHostIntegration,
	pr: PullRequest,
	options?: { confirmed?: boolean },
): Promise<PullRequestMergeOutcome> {
	const number = getPullRequestNumberFromUrl(pr.url) ?? pr.id;
	if (!isPullRequestInMergeQueue(pr)) {
		void window.showInformationMessage(
			l10n.t('Pull Request #{number} is no longer in the merge queue', { number: number }),
		);
		return 'declined';
	}

	if (!options?.confirmed) {
		const remove = { label: l10n.t('Remove from Merge Queue') };
		const cancel = { label: l10n.t('Cancel') };
		const confirm = await window.showQuickPick([remove, cancel], {
			title: l10n.t('Remove from Merge Queue • #{number} {title}', { number: number, title: pr.title }),
			placeHolder: l10n.t(
				'Removing #{number} from the merge queue loses its place — adding it back puts it at the end of the queue.',
				{ number: number },
			),
		});
		if (confirm !== remove) return 'declined';
	}

	const result = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: l10n.t('Removing pull request #{number} from the merge queue...', { number: number }),
		},
		() => integration.dequeuePullRequest(pr),
	);
	return reportMergeQueueActionResult('dequeue', number, result);
}

/** Confirms adding a pull request to its merge queue, in place of the merge its base branch doesn't allow directly. */
async function confirmPullRequestEnqueue(pr: PullRequest): Promise<boolean> {
	const headName = pr.refs?.head?.branch;
	const baseName = pr.refs?.base?.branch;
	const number = getPullRequestNumberFromUrl(pr.url) ?? pr.id;

	const enqueue = { label: l10n.t('Add to Merge Queue') };
	const cancel = { label: l10n.t('Cancel') };
	const confirm = await window.showQuickPick([enqueue, cancel], {
		title: l10n.t('Add to Merge Queue • #{number} {title}', { number: number, title: pr.title }),
		placeHolder:
			headName != null && baseName
				? l10n.t(
						'{base} merges only through its merge queue. Add {head} to the queue? The queue merges it once its checks pass.',
						{ head: headName, base: baseName },
					)
				: l10n.t(
						'This pull request merges only through its merge queue. Add it to the queue? The queue merges it once its checks pass.',
					),
	});
	return confirm === enqueue;
}

/** Adds a pull request to its merge queue under a progress notification and surfaces the outcome. */
async function enqueuePullRequestWithProgress(
	integration: GitHostIntegration,
	pr: PullRequest,
): Promise<PullRequestMergeOutcome> {
	const number = getPullRequestNumberFromUrl(pr.url) ?? pr.id;
	// Not cancellable: it's one mutation, never retried, and stopping the wait wouldn't stop it from landing
	const result = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: l10n.t('Adding pull request #{number} to the merge queue...', { number: number }),
		},
		() => integration.enqueuePullRequest(pr),
	);
	return reportMergeQueueActionResult('enqueue', number, result);
}

/** Tells the user what a merge-queue action did. The provider's own failure message goes to the log, never the UI. */
function reportMergeQueueActionResult(
	action: 'enqueue' | 'dequeue',
	number: string,
	result: PullRequestMergeQueueActionResult,
): PullRequestMergeOutcome {
	switch (result.status) {
		case 'queued': {
			const message = l10n.t('Added pull request #{number} to the merge queue', { number: number });
			const queueUrl = result.entry?.url;
			if (queueUrl != null) {
				const openQueue = { title: l10n.t('Open Merge Queue') };
				void window.showInformationMessage(message, openQueue).then(choice => {
					if (choice === openQueue) {
						void openUrl(queueUrl);
					}
				});
			} else {
				void window.showInformationMessage(message);
			}
			return 'queued';
		}
		case 'dequeued':
			void window.showInformationMessage(
				l10n.t('Removed pull request #{number} from the merge queue', { number: number }),
			);
			return 'dequeued';
		case 'failed': {
			Logger.warn(
				`Unable to ${action} pull request #${number}: ${result.reason}${result.message ? ` (${result.message})` : ''}`,
				'reportMergeQueueActionResult',
			);

			const message = getMergeQueueActionFailureMessage(action, number, result.reason);
			// Already where the user wanted it — a stale view, not an error
			if (result.reason === 'already-queued') {
				void window.showWarningMessage(message);
			} else {
				void window.showErrorMessage(message);
			}
			return 'failed';
		}
	}
}

/**
 * Confirms the blast radius of merging a pull request before doing it. A stacked pull request never
 * merges alone — everything below it lands with it, which can include other people's reviewed work.
 * Names the real blast radius before asking. Returns `true` if the user confirmed, `false` if they
 * cancelled.
 */
async function confirmPullRequestMerge(pr: PullRequest): Promise<boolean> {
	const headName = pr.refs?.head?.branch;
	const baseName = pr.refs?.base?.branch;

	const stack = pr.stack;
	const count = getStackedMergeCount(stack);
	const merge = { label: count > 1 ? l10n.t('Merge {count} Pull Requests', { count: count }) : l10n.t('Merge') };
	const cancel = { label: l10n.t('Cancel') };
	const number = getPullRequestNumberFromUrl(pr.url) ?? pr.id;
	const title =
		count > 1
			? l10n.t('Merge Stack • #{number} {title}', { number: number, title: pr.title })
			: l10n.t('Merge Pull Request • #{number} {title}', { number: number, title: pr.title });
	let placeHolder: string;
	if (stack != null && count > 1) {
		const lowerCount = count - 1;
		if (headName != null) {
			placeHolder = formatPlural(
				l10n.t(
					'{count, plural, one{Merging {head} also merges the {count} pull request below it in the stack, into {base}. This cannot be undone.} other{Merging {head} also merges the {count} pull requests below it in the stack, into {base}. This cannot be undone.}}',
				),
				{ head: headName, count: lowerCount, base: stack.baseRef },
			);
		} else {
			placeHolder = formatPlural(
				l10n.t(
					'{count, plural, one{Merging this pull request also merges the {count} pull request below it in the stack, into {base}. This cannot be undone.} other{Merging this pull request also merges the {count} pull requests below it in the stack, into {base}. This cannot be undone.}}',
				),
				{ count: lowerCount, base: stack.baseRef },
			);
		}
	} else if (headName != null && baseName) {
		placeHolder = l10n.t('Are you sure you want to merge {head} into {base}? This cannot be undone.', {
			head: headName,
			base: baseName,
		});
	} else if (headName != null) {
		placeHolder = l10n.t('Are you sure you want to merge {head}? This cannot be undone.', { head: headName });
	} else if (baseName) {
		placeHolder = l10n.t('Are you sure you want to merge this pull request into {base}? This cannot be undone.', {
			base: baseName,
		});
	} else {
		placeHolder = l10n.t('Are you sure you want to merge this pull request? This cannot be undone.');
	}

	const confirm = await window.showQuickPick([merge, cancel], {
		title: title,
		placeHolder: placeHolder,
	});
	return confirm === merge;
}

/**
 * Runs a pull request merge under a cancellable progress notification and surfaces the outcome —
 * an info message when the user stops waiting (the server-side merge may still complete), an error
 * message on failure. Callers own their own cache/view refreshes.
 */
async function mergePullRequestWithProgress(
	integration: GitHostIntegration,
	pr: PullRequest,
	options?: { mergeMethod?: PullRequestMergeMethod },
): Promise<'merged' | 'cancelled' | 'failed'> {
	const count = getStackedMergeCount(pr.stack);
	const number = getPullRequestNumberFromUrl(pr.url) ?? pr.id;
	const belowCount = count - 1;

	let cancellationToken: CancellationToken | undefined;
	const merged = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title:
				count > 1
					? l10n.t(
							'Merging {count} pull requests (#{number} and the {belowCount} below it in the stack)...',
							{ count: count, number: number, belowCount: belowCount },
						)
					: l10n.t('Merging pull request #{number}...', { number: number }),
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
			l10n.t(
				'Stopped waiting for pull request #{number} to merge — the merge may still complete on {provider}.',
				{ number: number, provider: integration.name },
			),
		);
		return 'cancelled';
	}

	void window.showErrorMessage(l10n.t('Unable to merge pull request #{number}', { number: number }));
	return 'failed';
}
