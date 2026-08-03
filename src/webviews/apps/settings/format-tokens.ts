/**
 * Context-tagged catalog of format-string tokens for the Settings format editor.
 *
 * This is a HAND-AUTHORED, webview-safe catalog — the host formatters
 * (`CommitFormatter`, `StatusFileFormatter`) value-import `Container`,
 * `configuration`, and command classes, so they can NEVER enter the webview
 * bundle. Instead we mirror their token sets here and guard against drift at
 * COMPILE TIME: the label maps below are `satisfies Record<keyof …tokenOptions>`,
 * so adding or removing a formatter token without updating this file fails
 * `pnpm run check`. The `import type` below is fully erased by the bundler.
 *
 * Scope of the guard is commit + file tokens only — the 18 date tokens are
 * moment.js display tokens with no formatter getter behind them, so they can't
 * be drift-guarded and are documented as hand-authored.
 */
import type { CommitFormatOptions } from '../../../git/formatters/commitFormatter.js';
import type { StatusFormatOptions } from '../../../git/formatters/statusFormatter.js';

export interface FormatTokenInfo {
	token: string;
	label: string;
}

/**
 * The context a format field operates in — drives which tokens the editor offers.
 * - `commit` — plaintext commit/blame/status-bar formats (no hover-only tokens)
 * - `hover` — markdown hover/tooltip formats (commit tokens PLUS hover-only tokens)
 * - `file` — file-format strings (`StatusFileFormatter`)
 * - `date` — moment.js date-format strings
 */
export type FormatTokenContext = 'commit' | 'hover' | 'file' | 'date';

interface CommitTokenMeta {
	label: string;
	/**
	 * Hover/markdown-only token (`avatar`/`commands`/`footnotes`/`link`/`signature`).
	 * These render empty (or as raw markup) in plaintext contexts, so they are only
	 * offered in hover/markdown fields.
	 */
	hover?: boolean;
}

/** Token keys mirrored from the host formatters — the compile-time drift-guard anchors. */
type CommitTokenKey = keyof NonNullable<CommitFormatOptions['tokenOptions']>;
type FileTokenKey = keyof NonNullable<StatusFormatOptions['tokenOptions']>;

/**
 * Commit-context tokens. Non-hover entries are offered in every commit field;
 * `hover: true` entries are additionally offered in hover/markdown fields.
 *
 * COMPILE-TIME DRIFT GUARD: the `Record<CommitTokenKey, …>` annotation forces the
 * keys to equal `CommitFormatOptions['tokenOptions']` exactly — a missing key fails
 * (Record requires all keys); an extra key fails (object-literal excess-property check).
 */
const commitTokenMeta: Record<CommitTokenKey, CommitTokenMeta> = {
	// Identity
	id: { label: 'Commit SHA' },
	sha: { label: 'Commit SHA' },
	// Author
	author: { label: 'Commit Author' },
	authorFirst: { label: 'Commit Author First Name' },
	authorLast: { label: 'Commit Author Last Name' },
	authorNotYou: { label: 'Commit Author (except you)' },
	email: { label: 'Commit Author E-mail' },
	// Message
	message: { label: 'Commit Message' },
	// Dates — commit or authored
	ago: { label: 'Commit or Authored Date — relative' },
	date: { label: 'Commit or Authored Date — absolute' },
	agoOrDate: { label: 'Commit or Authored Date — based on date setting' },
	agoOrDateShort: { label: 'Commit or Authored Date (short)' },
	agoAndDate: { label: 'Commit or Authored Date — relative and absolute' },
	agoAndDateShort: { label: 'Commit or Authored Date — relative and absolute (short)' },
	agoAndDateBothSources: { label: 'Commit and Authored Dates — relative and absolute' },
	// Dates — authored
	authorAgo: { label: 'Authored Date — relative' },
	authorDate: { label: 'Authored Date — absolute' },
	authorAgoOrDate: { label: 'Authored Date — based on date setting' },
	authorAgoOrDateShort: { label: 'Authored Date (short)' },
	// Dates — committed
	committerAgo: { label: 'Commit Date — relative' },
	committerDate: { label: 'Commit Date — absolute' },
	committerAgoOrDate: { label: 'Commit Date — based on date setting' },
	committerAgoOrDateShort: { label: 'Commit Date (short)' },
	// Changes
	changes: { label: 'Changes Indicator, e.g. +1 ~3 -0' },
	changesShort: { label: 'Changes Indicator (short), e.g. +1~3' },
	changesDetail: { label: 'Changes Detail' },
	// Branch & tag tips
	tips: { label: 'Branch & Tag Tips' },
	// Pull request
	pullRequest: { label: 'Pull Request that introduced the commit' },
	pullRequestState: { label: 'Pull Request State (open, merged, closed)' },
	pullRequestDate: { label: 'Pull Request Date — absolute' },
	pullRequestAgo: { label: 'Pull Request Date — relative' },
	pullRequestAgoOrDate: { label: 'Pull Request Date — based on date setting' },
	// Stash
	stashName: { label: 'Stash Name' },
	stashNumber: { label: 'Stash Number' },
	stashOnRef: { label: 'Stash Base Ref' },
	// Hover/markdown-only (offered only in hover contexts)
	avatar: { label: 'Author Avatar', hover: true },
	link: { label: 'Commit Link', hover: true },
	commands: { label: 'Action Commands', hover: true },
	footnotes: { label: 'Footnotes', hover: true },
	signature: { label: 'Signature Verification', hover: true },
};

/**
 * File-context tokens (`StatusFileFormatter`).
 *
 * COMPILE-TIME DRIFT GUARD: keys must equal `StatusFormatOptions['tokenOptions']`
 * exactly (see the commit map above for the mechanism).
 */
const fileTokenMeta: Record<FileTokenKey, string> = {
	file: 'File Name',
	directory: 'File Directory',
	path: 'File Path (relative)',
	filePath: 'File Path (formatted)',
	originalPath: 'Original File Path (for renames)',
	status: 'File Status',
	working: 'Working Tree Status Indicator',
	changes: 'Changes Indicator, e.g. +1 ~3 -0',
	changesShort: 'Changes Indicator (short), e.g. +1~3',
	changesDetail: 'Changes Detail',
};

/** Moment.js display tokens for date-format strings (inserted bare, not wrapped in `${}`). */
export const dateFormatTokens: FormatTokenInfo[] = [
	{ token: 'YYYY', label: 'Year, 4-digit (2018)' },
	{ token: 'YY', label: 'Year, 2-digit (18)' },
	{ token: 'MMMM', label: 'Month, full (July)' },
	{ token: 'MMM', label: 'Month, short (Jul)' },
	{ token: 'MM', label: 'Month, 2-digit (07)' },
	{ token: 'Do', label: 'Day of month, ordinal (25th)' },
	{ token: 'DD', label: 'Day of month, 2-digit (25)' },
	{ token: 'D', label: 'Day of month (25)' },
	{ token: 'dddd', label: 'Day of week, full (Wednesday)' },
	{ token: 'ddd', label: 'Day of week, short (Wed)' },
	{ token: 'HH', label: 'Hour, 24-hour 2-digit (19)' },
	{ token: 'hh', label: 'Hour, 12-hour 2-digit (07)' },
	{ token: 'h', label: 'Hour, 12-hour (7)' },
	{ token: 'mm', label: 'Minute, 2-digit (18)' },
	{ token: 'ss', label: 'Second, 2-digit (00)' },
	{ token: 'a', label: 'am / pm' },
	{ token: 'A', label: 'AM / PM' },
	{ token: 'Z', label: 'UTC offset (+01:00)' },
];

/**
 * Commit tokens for the editor menu. Pass `includeHover` for hover/markdown
 * fields — those additionally offer the hover-only tokens.
 */
export function getCommitFormatTokens(includeHover: boolean): FormatTokenInfo[] {
	const tokens: FormatTokenInfo[] = [];
	for (const [token, meta] of Object.entries(commitTokenMeta)) {
		if (meta.hover && !includeHover) continue;

		tokens.push({ token: token, label: meta.label });
	}
	return tokens;
}

/** File tokens for the editor menu (`StatusFileFormatter`). */
export function getFileFormatTokens(): FormatTokenInfo[] {
	return Object.entries(fileTokenMeta).map(([token, label]) => ({ token: token, label: label }));
}

/** Resolves the token set for a given editor context. */
export function getFormatTokens(context: Exclude<FormatTokenContext, 'date'>): FormatTokenInfo[] {
	switch (context) {
		case 'commit':
			return getCommitFormatTokens(false);
		case 'hover':
			return getCommitFormatTokens(true);
		case 'file':
			return getFileFormatTokens();
	}
}
