import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { ScopeSelection } from '../../../../plus/graph/graphService.js';
import type { TreeItemCheckedDetail } from '../../../shared/components/tree/base.js';
import type { GlCommitsScopePane } from './gl-commits-scope-pane.js';
import { getScopeSplitPickerChrome } from './shared-panel-templates.js';

/** Next file-exclusion set after a per-file check toggle (`file-checked`): checking includes the
 *  file (drops it from the exclusion set), unchecking excludes it. Returns `undefined` when the
 *  edit must not happen — the `canExclude` predicate vetoed it, or the event carries no usable
 *  file — so the caller leaves its state untouched.
 *
 *  `canExclude` carries the interior-scope contract that some panels enforce and others don't:
 *  compose vetoes ALL exclusion edits while the WIP scope is an interior commit range (newer
 *  commits build on the range, so excluding files would violate its whole-plan contract — see the
 *  compose panel's `isInteriorScope`); review imposes no restriction and relies on the default. */
export function fileCheckedExclusion(
	event: CustomEvent<TreeItemCheckedDetail>,
	excludedFiles: ReadonlySet<string>,
	canExclude: () => boolean = () => true,
): Set<string> | undefined {
	if (!canExclude()) return undefined;

	if (!event.detail.context) return undefined;

	const [file] = event.detail.context as unknown as GitFileChangeShape[];
	if (!file) return undefined;

	const next = new Set(excludedFiles);
	if (event.detail.checked) {
		next.delete(file.path);
	} else {
		next.add(file.path);
	}
	return next;
}

/** Next file-exclusion set after a check/uncheck-all (`gl-check-all`); see
 *  {@link fileCheckedExclusion} for the `canExclude` contract and the `undefined` return. */
export function checkAllExclusion(
	event: CustomEvent<{ checked: boolean; paths: readonly string[] }>,
	excludedFiles: ReadonlySet<string>,
	canExclude: () => boolean = () => true,
): Set<string> | undefined {
	if (!canExclude()) return undefined;

	const next = new Set(excludedFiles);
	if (event.detail.checked) {
		for (const path of event.detail.paths) {
			next.delete(path);
		}
	} else {
		for (const path of event.detail.paths) {
			next.add(path);
		}
	}
	return next;
}

/** Clamp for the scope split divider: keeps the picker track within [15%, 70%] of the split, and
 *  caps it at the scope picker's intrinsic height so it can't expand beyond its content.
 *  `contentHeight` measures only the inner scroll pane; the `.scope-split__picker` wrapper adds
 *  padding + a border-bottom, so {@link getScopeSplitPickerChrome} is included — otherwise the
 *  fit-content track clamps short of the picker's true height, clipping its content / desyncing
 *  the divider. */
export function scopeSplitSnap(scopeEl: GlCommitsScopePane | null | undefined, pos: number, size: number): number {
	if (!scopeEl || size <= 0) return Math.max(15, Math.min(pos, 70));

	const maxPercent = Math.min(70, ((scopeEl.contentHeight + getScopeSplitPickerChrome(scopeEl)) / size) * 100);
	return Math.max(15, Math.min(pos, maxPercent));
}

/** Scope-picker selection IDs for a WIP scope — its include toggles + SHAs, bound back to the pane
 *  via `.selection` so re-renders restore the user's picker selection. Non-WIP scopes have no
 *  picker state. */
export function wipScopeSelectionIds(scope: ScopeSelection | undefined): readonly string[] | undefined {
	if (scope?.type !== 'wip') return undefined;

	return [
		...(scope.includeUnstaged ? ['unstaged'] : []),
		...(scope.includeStaged ? ['staged'] : []),
		...scope.includeShas,
	];
}

/** Live Refine posture, read by the host on mode-leave to persist onto the engaged entry. Only
 *  meaningful in the ready state (the gate/refine input only exist there); other states report the
 *  default so a non-ready leave can't clobber a captured posture. */
export function liveRefineMode(status: string, refineMode: boolean): boolean {
	return status === 'ready' ? refineMode : false;
}

/** Live unsubmitted Refine text, read by the host on mode-leave. Empty unless the refine input is
 *  actually mounted (ready + refine posture). `getDraft` is invoked lazily so panels don't query
 *  their shadow DOM on states where the result is '' regardless. */
export function liveRefineDraft(status: string, refineMode: boolean, getDraft: () => string | undefined): string {
	if (status !== 'ready' || !refineMode) return '';

	return getDraft() ?? '';
}

/**
 * Shared Refine-posture lifecycle for `willUpdate` in the compose and resolve panels: derives the
 * next value of the panel's live `_refineMode` from the two triggers both panels share — a
 * ready-entry reset and a reseed from the persisted `refineMode` property — returning `undefined`
 * when neither fired, in which case the caller leaves its state untouched.
 *
 * The reset trigger encodes each panel's deliberate, differing contract via
 * `resetOnEveryReadyEntry`:
 * - resolve resets on ANY entry into ready — "ready always opens in Apply posture", including
 *   re-runs returning through loading→ready;
 * - compose resets only when a run SUCCEEDS (previous status `loading` → `ready`, gated on the
 *   live posture being set) so a FAILED recompose keeps the Refine posture for a retry, and the
 *   initial compose (posture already false) is a no-op.
 *
 * When both triggers fire in one update the seed wins — applied after the reset, matching the
 * original statement order in each panel.
 */
export function syncRefinePosture(
	changedProperties: Map<string, unknown>,
	options: {
		/** Current `status` value. */
		status: string;
		/** Current live posture (the panel's `_refineMode` state). */
		refineMode: boolean;
		/** Seed pushed from the engaged entry (the panel's `refineMode` property). */
		persistedRefineMode: boolean;
		/** `true` = resolve contract (any ready entry); `false` = compose contract (successful run only). */
		resetOnEveryReadyEntry: boolean;
	},
): boolean | undefined {
	let updated: boolean | undefined;

	const previousStatus = changedProperties.get('status');
	const resetFired =
		changedProperties.has('status') &&
		(options.resetOnEveryReadyEntry
			? options.status === 'ready'
			: previousStatus === 'loading' && options.status === 'ready' && options.refineMode);
	if (resetFired) {
		updated = false;
	}

	if (changedProperties.has('refineMode')) {
		updated = options.persistedRefineMode;
	}

	return updated;
}
