import type { CancellationToken } from 'vscode';
import { l10n, ProgressLocation, window } from 'vscode';
import type { PullRequest, PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import { getPullRequestNumberFromUrl, getStackedMergeCount } from '@gitlens/git/utils/pullRequest.utils.js';
import type { GitHostIntegration } from '@gitlens/integrations/models/gitHostIntegration.js';
import { formatPlural } from '@gitlens/utils/plural.js';
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
