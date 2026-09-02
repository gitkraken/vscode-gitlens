/**
 * Shared a11y helpers for the commit graph surface — screen-reader-facing strings, testable without a DOM.
 */

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
 * Fragments are joined with `, ` so screen readers pause naturally between them.
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
): string {
	const parts: string[] = [];
	const isMerge = kind === 'merge' || commit.parents.length > 1;
	// Prefer the renderer's already-formatted relative date so the spoken label matches the VISIBLE
	// date exactly; fall back to the package's own short formatter when the caller supplies none.
	const rel = relativeDate ?? (commit.date ? relativeTimeShort(commit.date) : '');

	// For workdir rows the message ("Working Changes") is generic — `identity` carries the actually
	// disambiguating branch/worktree name, spoken right after it. Fall back to the generic "Working
	// directory" header only when the summary is empty.
	if (kind === 'workdir') {
		parts.push(firstLine(commit.message) || 'Working directory');
		if (identity) {
			parts.push(identity);
		}
		if (rel) {
			parts.push(rel);
		}
		if (adornmentLabel) {
			parts.push(adornmentLabel);
		}
		return parts.join(', ');
	}

	let header: string;
	if (kind === 'stash') {
		header = `Stash ${commit.shortSha}`;
	} else if (isMerge) {
		header = `Merge commit ${commit.shortSha}`;
	} else {
		header = `Commit ${commit.shortSha}`;
	}
	parts.push(header);

	if (commit.author) {
		parts.push(`by ${commit.author}`);
	}
	if (rel) {
		parts.push(rel);
	}
	const summary = firstLine(commit.message);
	if (summary) {
		parts.push(summary);
	}
	if (adornmentLabel) {
		parts.push(adornmentLabel);
	}
	return parts.join(', ');
}

// A commit's accessible name uses only the SUMMARY (first line): it matches the row's visible
// single-line (ellipsized) text and keeps screen-reader row navigation scannable — the full body is
// read in the details panel when the row is opened. Trims the whole message first (matching
// `splitCommitMessage().summary`), so a leading blank line still yields the real subject; returns ''
// for an empty/whitespace-only message (callers guard on the result).
function firstLine(message: string): string {
	const trimmed = message.trim();
	const i = trimmed.indexOf('\n');
	return i === -1 ? trimmed : trimmed.slice(0, i);
}
