/**
 * Shared a11y helpers for the commit graph surface — screen-reader-facing strings, testable without a DOM.
 */

import * as l10n from '@vscode/l10n';
import type { CommitKind, GraphCommit } from './engine/types.js';
import { relativeTimeShort } from './time.js';

/**
 * Build the aria-label string announced for a commit row. Composes:
 *   - row kind prefix ("Commit" / "Merge commit" / "Working directory" / "Stash")
 *   - short sha (skipped for workdir — "WIP" is a placeholder, not information)
 *   - author (if present)
 *   - relative time (if date parses)
 *   - commit message summary (first line, if present)
 *   - optional adornment fragment (from the adornment registry's describeForA11y)
 *
 * Every optional-field combination has an extractable full-utterance template. This is deliberately
 * more verbose than joining English fragments: word order and connective words differ by locale.
 */
export function buildAriaLabel(
	commit: GraphCommit,
	kind: CommitKind | undefined,
	adornmentLabel?: string,
	relativeDate?: string,
	/** Workdir-only: the row's branch/worktree identity (`on main`, `worktree foo, on bar`) — the caller
	 *  computes this from its own `WipRowInfo`, since that type isn't known to this package. Every
	 *  workdir row's message is now the same bare "Working Changes" (see `wipRowMessage`), so this is
	 *  what actually distinguishes the row from every other workdir row. */
	identity?: string,
	/** Workdir-only rendered label. The canonical commit message remains the fallback for callers that
	 *  don't supply a localized display boundary. */
	workdirLabel?: string,
): string {
	const isMerge = kind === 'merge' || commit.parents.length > 1;
	// Prefer the renderer's already-formatted relative date so the spoken label matches the VISIBLE
	// date exactly; fall back to the package's own short formatter when the caller supplies none.
	const rel = relativeDate ?? (commit.date ? relativeTimeShort(commit.date) : '');

	// For workdir rows the message ("Working Changes") is generic — `identity` carries the actually
	// disambiguating branch/worktree name, spoken right after it. Fall back to the generic "Working
	// directory" header only when the summary is empty.
	if (kind === 'workdir') {
		return formatWorkdirAriaLabel(
			firstLine(workdirLabel ?? commit.message) || l10n.t('Working directory'),
			identity,
			rel,
			adornmentLabel,
		);
	}

	let header: string;
	if (kind === 'stash') {
		header = l10n.t('Stash {0}', commit.shortSha);
	} else if (isMerge) {
		header = l10n.t('Merge commit {0}', commit.shortSha);
	} else {
		header = l10n.t('Commit {0}', commit.shortSha);
	}
	const summary = firstLine(commit.message);
	return formatCommitAriaLabel(header, commit.author, rel, summary, adornmentLabel);
}

function formatWorkdirAriaLabel(
	label: string,
	identity: string | undefined,
	relative: string,
	adornment: string | undefined,
): string {
	const fields = (identity ? 1 : 0) | (relative.length === 0 ? 0 : 2) | (adornment ? 4 : 0);
	switch (fields) {
		case 0:
			return label;
		case 1:
			return l10n.t('{0}, {1}', label, identity!);
		case 2:
			return l10n.t('{0}, {1}', label, relative);
		case 3:
			return l10n.t('{0}, {1}, {2}', label, identity!, relative);
		case 4:
			return l10n.t('{0}, {1}', label, adornment!);
		case 5:
			return l10n.t('{0}, {1}, {2}', label, identity!, adornment!);
		case 6:
			return l10n.t('{0}, {1}, {2}', label, relative, adornment!);
		default:
			return l10n.t('{0}, {1}, {2}, {3}', label, identity!, relative, adornment!);
	}
}

function formatCommitAriaLabel(
	header: string,
	author: string | undefined,
	relative: string,
	summary: string,
	adornment: string | undefined,
): string {
	const fields =
		(author ? 1 : 0) | (relative.length === 0 ? 0 : 2) | (summary.length === 0 ? 0 : 4) | (adornment ? 8 : 0);

	switch (fields) {
		case 0:
			return header;
		case 1:
			return l10n.t('{0}, by {1}', header, author!);
		case 2:
			return l10n.t('{0}, {1}', header, relative);
		case 3:
			return l10n.t('{0}, by {1}, {2}', header, author!, relative);
		case 4:
			return l10n.t('{0}, {1}', header, summary);
		case 5:
			return l10n.t('{0}, by {1}, {2}', header, author!, summary);
		case 6:
			return l10n.t('{0}, {1}, {2}', header, relative, summary);
		case 7:
			return l10n.t('{0}, by {1}, {2}, {3}', header, author!, relative, summary);
		case 8:
			return l10n.t('{0}, {1}', header, adornment!);
		case 9:
			return l10n.t('{0}, by {1}, {2}', header, author!, adornment!);
		case 10:
			return l10n.t('{0}, {1}, {2}', header, relative, adornment!);
		case 11:
			return l10n.t('{0}, by {1}, {2}, {3}', header, author!, relative, adornment!);
		case 12:
			return l10n.t('{0}, {1}, {2}', header, summary, adornment!);
		case 13:
			return l10n.t('{0}, by {1}, {2}, {3}', header, author!, summary, adornment!);
		case 14:
			return l10n.t('{0}, {1}, {2}, {3}', header, relative, summary, adornment!);
		default:
			return l10n.t('{0}, by {1}, {2}, {3}, {4}', header, author!, relative, summary, adornment!);
	}
}

// A commit's accessible name uses only the SUMMARY (first line): it matches the row's visible
// single-line (ellipsized) text and keeps screen-reader row navigation scannable — the full body is
// read in the details panel when the row is opened. Trims the whole message first (matching
// `splitMessage().summary`), so a leading blank line still yields the real subject; returns ''
// for an empty/whitespace-only message (callers guard on the result).
function firstLine(message: string): string {
	const trimmed = message.trim();
	const i = trimmed.indexOf('\n');
	return i === -1 ? trimmed : trimmed.slice(0, i);
}
