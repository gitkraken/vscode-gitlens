import * as l10n from '@vscode/l10n';
import type { RunningOperationExecState } from './detailsState.js';

/** Codicon name for a status-overlay icon driven by a {@link RunningOperationExecState}.
 *  Returned name maps to the GitLens code-icon font.
 *
 *  - `'generating'` → `'loading'` (spinner; pair with `modifier="spin"`)
 *  - `'complete'` → `'pass'`
 *  - `'backed'` + `hasResult` → `'pass'` (Restart from a completed run — a result is one click away)
 *  - `'backed'` + no result → `null` (cancelled / first-error Go Back — entry exists only to
 *    preserve the run's prompt for the AI-input seed; no successful result to advertise)
 *  - `'error'` → `'error'`
 *  - `'orphaned'` → `'warning'`
 *
 *  Used by both the WIP-row adornment buttons and the details-header
 *  toggle chips (`gl-details-header.ts`) so the visual language is shared. `hasResult` defaults
 *  to `true` for backward compatibility with callers that haven't been threaded through. */
export function statusIconFor(execState: RunningOperationExecState, hasResult: boolean = true): string | null {
	switch (execState) {
		case 'generating':
			return 'loading';
		case 'complete':
			return 'pass';
		case 'backed':
			return hasResult ? 'pass' : null;
		case 'error':
			return 'error';
		case 'orphaned':
			return 'warning';
		default:
			return null;
	}
}

/** Tooltip + aria-label for a WIP-row adornment button (Compose/Review/Resolve entry point),
 *  reflecting the engaged operation's exec state. Reused by both `tooltip` and `aria-label`
 *  attributes so the spoken label matches the visible hint. `hasResult` distinguishes a `'backed'`
 *  entry with a viewable result from a `'backed'`-no-result placeholder (cancelled / first-error
 *  Go Back), which should read as an idle entry point rather than "View Compose / Review". */
export function rowAdornmentTooltipFor(
	kind: 'review' | 'compose' | 'resolve',
	execState: RunningOperationExecState | undefined,
	hasResult: boolean = true,
): string {
	const idle =
		kind === 'compose'
			? l10n.t('Compose Changes…')
			: kind === 'review'
				? l10n.t('Review Changes…')
				: l10n.t('Resolve Conflicts…');
	const view =
		kind === 'compose'
			? l10n.t('View Compose')
			: kind === 'review'
				? l10n.t('View Review')
				: l10n.t('View Resolutions');
	switch (execState) {
		case 'generating':
			return kind === 'compose'
				? l10n.t('Composing…')
				: kind === 'review'
					? l10n.t('Reviewing…')
					: l10n.t('Resolving…');
		case 'complete':
			return view;
		case 'backed':
			return hasResult ? view : idle;
		case 'error':
			return kind === 'compose'
				? l10n.t('Compose Failed — Click to View')
				: kind === 'review'
					? l10n.t('Review Failed — Click to View')
					: l10n.t('Resolve Failed — Click to View');
		case 'orphaned':
			return kind === 'compose'
				? l10n.t('Compose — Anchor Missing')
				: kind === 'review'
					? l10n.t('Review — Anchor Missing')
					: l10n.t('Resolve — Anchor Missing');
		default:
			return idle;
	}
}

/** Complete details-header chip label when an operation is engaged at this anchor. The chip's
 *  underlying action is always "show/hide the panel", but a parenthetical state hint tells the user
 *  what's happening underneath (running / completed / etc.). `hasResult` suppresses the
 *  "(Completed)" suffix for a `'backed'`-no-result entry. */
export function chipStateLabel(
	label: string,
	execState: RunningOperationExecState | undefined,
	hasResult: boolean = true,
): string {
	switch (execState) {
		case 'generating':
			return l10n.t('{label} (Running)', { label: label });
		case 'complete':
			return l10n.t('{label} (Completed)', { label: label });
		case 'backed':
			return hasResult ? l10n.t('{label} (Completed)', { label: label }) : label;
		case 'error':
			return l10n.t('{label} (Failed)', { label: label });
		case 'orphaned':
			return l10n.t('{label} (Orphaned)', { label: label });
		default:
			return label;
	}
}
