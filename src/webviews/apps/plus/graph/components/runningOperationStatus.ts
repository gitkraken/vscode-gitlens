import type { RunningOperationExecState } from './detailsState.js';

/** Codicon name for a status-overlay icon driven by a {@link RunningOperationExecState}.
 *  Returned name maps to the GitLens code-icon font.
 *
 *  - `'generating'` → `'loading'` (spinner; pair with `modifier="spin"`)
 *  - `'complete'` / `'backed'` → `'pass'` (a result exists; `'backed'` means it's currently
 *    archived behind a Back, but the chip overlay still signals "this anchor has a completed run")
 *  - `'error'` → `'error'`
 *  - `'orphaned'` → `'warning'`
 *
 *  Used by both the WIP-row adornment buttons (`gl-graph.react.tsx`) and the details-header
 *  toggle chips (`gl-details-header.ts`) so the visual language is shared. */
export function statusIconFor(execState: RunningOperationExecState): string | null {
	switch (execState) {
		case 'generating':
			return 'loading';
		case 'complete':
		case 'backed':
			return 'pass';
		case 'error':
			return 'error';
		case 'orphaned':
			return 'warning';
		default:
			return null;
	}
}

/** Tooltip + aria-label for a WIP-row adornment button (Compose/Review entry point), reflecting
 *  the engaged operation's exec state. Reused by both `tooltip` and `aria-label` attributes so
 *  the spoken label matches the visible hint. */
export function rowAdornmentTooltipFor(
	kind: 'review' | 'compose',
	execState: RunningOperationExecState | undefined,
): string {
	const verb = kind === 'compose' ? 'Compose' : 'Review';
	switch (execState) {
		case 'generating':
			return kind === 'compose' ? 'Composing…' : 'Reviewing…';
		case 'complete':
		case 'backed':
			return `View ${verb}`;
		case 'error':
			return `${verb} Failed — Click to View`;
		case 'orphaned':
			return `${verb} — Anchor Missing`;
		default:
			return `${verb} Changes…`;
	}
}

/** Tooltip suffix appended to a details-header chip's label when an operation is engaged at
 *  this anchor. The chip's underlying action is always "show/hide the panel", but a parenthetical
 *  state hint tells the user what's happening underneath (running / completed / etc.). */
export function chipStateSuffix(execState: RunningOperationExecState | undefined): string {
	switch (execState) {
		case 'generating':
			return ' (Running)';
		case 'complete':
		case 'backed':
			return ' (Completed)';
		case 'error':
			return ' (Failed)';
		case 'orphaned':
			return ' (Orphaned)';
		default:
			return '';
	}
}
