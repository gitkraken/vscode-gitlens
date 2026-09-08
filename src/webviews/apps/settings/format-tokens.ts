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
import * as l10n from '@vscode/l10n';
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
	id: { label: l10n.t('Commit SHA') },
	sha: { label: l10n.t('Commit SHA') },
	// Author
	author: { label: l10n.t('Commit Author') },
	authorFirst: { label: l10n.t('Commit Author First Name') },
	authorLast: { label: l10n.t('Commit Author Last Name') },
	authorNotYou: { label: l10n.t('Commit Author (except you)') },
	email: { label: l10n.t('Commit Author E-mail') },
	// Message
	message: { label: l10n.t('Commit Message') },
	// Dates — commit or authored
	ago: { label: l10n.t('Commit or Authored Date — relative') },
	date: { label: l10n.t('Commit or Authored Date — absolute') },
	agoOrDate: { label: l10n.t('Commit or Authored Date — based on date setting') },
	agoOrDateShort: { label: l10n.t('Commit or Authored Date (short)') },
	agoAndDate: { label: l10n.t('Commit or Authored Date — relative and absolute') },
	agoAndDateShort: { label: l10n.t('Commit or Authored Date — relative and absolute (short)') },
	agoAndDateBothSources: { label: l10n.t('Commit and Authored Dates — relative and absolute') },
	// Dates — authored
	authorAgo: { label: l10n.t('Authored Date — relative') },
	authorDate: { label: l10n.t('Authored Date — absolute') },
	authorAgoOrDate: { label: l10n.t('Authored Date — based on date setting') },
	authorAgoOrDateShort: { label: l10n.t('Authored Date (short)') },
	// Dates — committed
	committerAgo: { label: l10n.t('Commit Date — relative') },
	committerDate: { label: l10n.t('Commit Date — absolute') },
	committerAgoOrDate: { label: l10n.t('Commit Date — based on date setting') },
	committerAgoOrDateShort: { label: l10n.t('Commit Date (short)') },
	// Changes
	changes: { label: l10n.t('Changes Indicator, e.g. {example}', { example: '+1 ~3 -0' }) },
	changesShort: { label: l10n.t('Changes Indicator (short), e.g. {example}', { example: '+1~3' }) },
	changesDetail: { label: l10n.t('Changes Detail') },
	// Branch & tag tips
	tips: { label: l10n.t('Branch & Tag Tips') },
	// Pull request
	pullRequest: { label: l10n.t('Pull Request that introduced the commit') },
	pullRequestState: {
		label: l10n.t('Pull Request State ({states})', { states: 'open, merged, closed' }),
	},
	pullRequestDate: { label: l10n.t('Pull Request Date — absolute') },
	pullRequestAgo: { label: l10n.t('Pull Request Date — relative') },
	pullRequestAgoOrDate: { label: l10n.t('Pull Request Date — based on date setting') },
	// Stash
	stashName: { label: l10n.t('Stash Name') },
	stashNumber: { label: l10n.t('Stash Number') },
	stashOnRef: { label: l10n.t('Stash Base Ref') },
	// Hover/markdown-only (offered only in hover contexts)
	avatar: { label: l10n.t('Author Avatar'), hover: true },
	link: { label: l10n.t('Commit Link'), hover: true },
	commands: { label: l10n.t('Action Commands'), hover: true },
	footnotes: { label: l10n.t('Footnotes'), hover: true },
	signature: { label: l10n.t('Signature Verification'), hover: true },
};

/**
 * File-context tokens (`StatusFileFormatter`).
 *
 * COMPILE-TIME DRIFT GUARD: keys must equal `StatusFormatOptions['tokenOptions']`
 * exactly (see the commit map above for the mechanism).
 */
const fileTokenMeta: Record<FileTokenKey, string> = {
	file: l10n.t('File Name'),
	directory: l10n.t('File Directory'),
	path: l10n.t('File Path (relative)'),
	filePath: l10n.t('File Path (formatted)'),
	originalPath: l10n.t('Original File Path (for renames)'),
	status: l10n.t('File Status'),
	working: l10n.t('Working Tree Status Indicator'),
	changes: l10n.t('Changes Indicator, e.g. {example}', { example: '+1 ~3 -0' }),
	changesShort: l10n.t('Changes Indicator (short), e.g. {example}', { example: '+1~3' }),
	changesDetail: l10n.t('Changes Detail'),
};

/** Moment.js display tokens for date-format strings (inserted bare, not wrapped in `${}`). */
export const dateFormatTokens: FormatTokenInfo[] = [
	{ token: 'YYYY', label: l10n.t('Year, 4-digit ({example})', { example: '2018' }) },
	{ token: 'YY', label: l10n.t('Year, 2-digit ({example})', { example: '18' }) },
	{ token: 'MMMM', label: l10n.t('Month, full ({example})', { example: 'July' }) },
	{ token: 'MMM', label: l10n.t('Month, short ({example})', { example: 'Jul' }) },
	{ token: 'MM', label: l10n.t('Month, 2-digit ({example})', { example: '07' }) },
	{ token: 'Do', label: l10n.t('Day of month, ordinal ({example})', { example: '25th' }) },
	{ token: 'DD', label: l10n.t('Day of month, 2-digit ({example})', { example: '25' }) },
	{ token: 'D', label: l10n.t('Day of month ({example})', { example: '25' }) },
	{ token: 'dddd', label: l10n.t('Day of week, full ({example})', { example: 'Wednesday' }) },
	{ token: 'ddd', label: l10n.t('Day of week, short ({example})', { example: 'Wed' }) },
	{ token: 'HH', label: l10n.t('Hour, 24-hour 2-digit ({example})', { example: '19' }) },
	{ token: 'hh', label: l10n.t('Hour, 12-hour 2-digit ({example})', { example: '07' }) },
	{ token: 'h', label: l10n.t('Hour, 12-hour ({example})', { example: '7' }) },
	{ token: 'mm', label: l10n.t('Minute, 2-digit ({example})', { example: '18' }) },
	{ token: 'ss', label: l10n.t('Second, 2-digit ({example})', { example: '00' }) },
	{ token: 'a', label: 'am / pm' },
	{ token: 'A', label: 'AM / PM' },
	{ token: 'Z', label: l10n.t('UTC offset ({example})', { example: '+01:00' }) },
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
