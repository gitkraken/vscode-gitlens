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
 *  Used by both the WIP-row adornment buttons (`gl-graph.react.tsx`) and the details-header
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
	const verb = kind === 'compose' ? 'Compose' : kind === 'review' ? 'Review' : 'Resolve';
	const idle =
		kind === 'compose' ? 'Compose Changes…' : kind === 'review' ? 'Review Changes…' : 'Resolve Conflicts with AI…';
	const view = kind === 'resolve' ? 'View Resolutions' : `View ${verb}`;
	switch (execState) {
		case 'generating':
			return kind === 'compose' ? 'Composing…' : kind === 'review' ? 'Reviewing…' : 'Resolving…';
		case 'complete':
			return view;
		case 'backed':
			return hasResult ? view : idle;
		case 'error':
			return `${verb} Failed — Click to View`;
		case 'orphaned':
			return `${verb} — Anchor Missing`;
		default:
			return idle;
	}
}

/** Tooltip suffix appended to a details-header chip's label when an operation is engaged at
 *  this anchor. The chip's underlying action is always "show/hide the panel", but a parenthetical
 *  state hint tells the user what's happening underneath (running / completed / etc.). `hasResult`
 *  suppresses the "(Completed)" suffix for a `'backed'`-no-result entry. */
export function chipStateSuffix(execState: RunningOperationExecState | undefined, hasResult: boolean = true): string {
	switch (execState) {
		case 'generating':
			return ' (Running)';
		case 'complete':
			return ' (Completed)';
		case 'backed':
			return hasResult ? ' (Completed)' : '';
		case 'error':
			return ' (Failed)';
		case 'orphaned':
			return ' (Orphaned)';
		default:
			return '';
	}
}
