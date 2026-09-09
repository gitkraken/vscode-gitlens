/**
 * Pure (vscode-free) classification helpers for WIP-panel commit failures.
 *
 * Kept separate from `repository.ts` so the logic is unit-testable without the extension host;
 * the vscode-facing presentation (`presentCommitFailure`) lives in the service alongside its
 * other dialog code.
 */

import * as l10n from '@vscode/l10n';
import { CommitError, SigningError } from '@gitlens/git/errors.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { getPresentableErrorMessage } from '../../../errors.js';

/**
 * Classified outcome of a commit failure, used to drive the WIP panel's error UX.
 * `hookRejected` covers any unrecognized non-zero `git commit` that produced output —
 * overwhelmingly a pre-commit/commit-msg hook, since git's own commit failures are enumerated.
 */
export type CommitFailureReason =
	| 'hookRejected'
	| 'signingFailed'
	| 'nothingToCommit'
	| 'conflicts'
	| 'identityMissing'
	| 'unknown';

export type CommitResult =
	| { status: 'committed' }
	| { status: 'cancelled' }
	| { status: 'failed'; reason: CommitFailureReason; summary: string; hasOutput: boolean };

export interface ClassifiedCommitFailure {
	reason: CommitFailureReason;
	/**
	 * Complete, display-ready message (e.g. `Unable to commit: signing failed`). Surfaces show it
	 * verbatim — framing lives here in the classifier, not in each consumer, so re-framing is a
	 * single-place change rather than scattered prefix logic.
	 */
	summary: string;
	output: string | undefined;
}

/** Reads the raw terminal output (stderr, then stdout) off a wrapped git error, if any. */
export function getCommitFailureOutput(ex: unknown): string | undefined {
	const original = ex instanceof CommitError || ex instanceof SigningError ? ex.original : ex;
	const candidate = original as { stderr?: unknown; stdout?: unknown } | undefined;
	const stderr = typeof candidate?.stderr === 'string' ? candidate.stderr.trim() : '';
	if (stderr) return stderr;

	const stdout = typeof candidate?.stdout === 'string' ? candidate.stdout.trim() : '';
	return stdout || undefined;
}

/**
 * Maps a caught commit error to a {@link CommitFailureReason}, a short cause fragment, and the
 * raw output (when present). Known git commit failures and signing failures are classified first;
 * any remaining failure that produced output is treated as a hook rejection (see {@link CommitFailureReason}).
 */
export function classifyCommitFailure(ex: unknown): ClassifiedCommitFailure {
	const output = getCommitFailureOutput(ex);

	if (SigningError.is(ex)) {
		return { reason: 'signingFailed', summary: l10n.t('Unable to commit: signing failed'), output: output };
	}
	if (CommitError.is(ex, 'nothingToCommit')) {
		return { reason: 'nothingToCommit', summary: l10n.t('Unable to commit: no staged changes'), output: output };
	}
	if (CommitError.is(ex, 'conflicts')) {
		return { reason: 'conflicts', summary: l10n.t('Unable to commit: unresolved merge conflicts'), output: output };
	}
	if (CommitError.is(ex, 'noUserNameConfigured')) {
		return {
			reason: 'identityMissing',
			summary: l10n.t('Unable to commit: Git user name and email are not configured'),
			output: output,
		};
	}

	if (output != null) {
		return { reason: 'hookRejected', summary: l10n.t('Unable to commit: blocked by a Git hook'), output: output };
	}

	const message = getPresentableErrorMessage(ex);
	return {
		reason: 'unknown',
		summary: message ? l10n.t('Unable to commit: {0}', message) : l10n.t('Unable to commit'),
		output: output,
	};
}

/** Builds the truncated output preview shown in the modal's detail block. */
export function buildCommitOutputPreview(output: string): string {
	const maxLines = 10;
	const maxChars = 600;

	const lines = output.split('\n');
	let preview = lines.slice(0, maxLines).join('\n');
	let truncatedLines = Math.max(0, lines.length - maxLines);

	if (preview.length > maxChars) {
		preview = preview.slice(0, maxChars);
		truncatedLines = Math.max(truncatedLines, 1);
	}

	return truncatedLines > 0
		? `${preview}\n… ${formatPlural(l10n.t('{0, plural, one{({0} more line)} other{({0} more lines)}}'), [truncatedLines])}`
		: preview;
}
