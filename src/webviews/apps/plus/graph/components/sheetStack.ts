import type { GraphSidebarPullRequest } from '../../../../plus/graph/protocol.js';
import type { FileChangeListItemDetail } from '../../../commitDetails/components/gl-details-base.js';
import type { BranchSheetRef } from './gl-graph-branch-sheet-pane.js';

export type SheetDescriptor =
	| { kind: 'branch'; ref: BranchSheetRef; repoPath: string | undefined }
	| { kind: 'conflict'; detail: FileChangeListItemDetail; fileName: string }
	| { kind: 'rebaseSummary'; repoPath: string }
	| { kind: 'compare' }
	| {
			kind: 'pullRequest';
			pr: GraphSidebarPullRequest;
			layers?: GraphSidebarPullRequest[];
			/** Renders the stack's own summary (all layers, top layer's state) instead of one layer's —
			 *  only ever set alongside a full `layers` load. */
			stackRoot?: boolean;
	  };

export type SheetKind = SheetDescriptor['kind'];

/**
 * Mirrors the details panel's top-of-stack transitions onto the graph keymap's Esc overlay stack.
 * `opened(key)` pushes a `pushOverlay` entry (id `sheet|${key}`) whose `onClose` pops the top
 * sheet; `closed(key)` disposes it. Esc ordering across sheets/hover/ref-find/drag is decided by
 * the registry's LIFO (`KeymapDispatcher`), not this type.
 */
export type SheetOverlayCoordinator = { opened(key: string): void; closed(key: string): void };

/** Stable identity for a sheet — same kind and identity fields collapse to "the same sheet".
 *  Serialized as a JSON tuple: Git ref names and filesystem paths can contain any ad-hoc delimiter,
 *  so joining would let distinct field sets collide. */
export function sheetKey(d: SheetDescriptor): string {
	switch (d.kind) {
		case 'branch':
			// repoPath included: identically named branches in different repositories are different sheets.
			return JSON.stringify([d.kind, d.repoPath, d.ref.refType, d.ref.name, d.ref.remote]);
		case 'conflict':
			return JSON.stringify([d.kind, d.detail.repoPath, d.detail.path]);
		case 'rebaseSummary':
			return JSON.stringify([d.kind, d.repoPath]);
		case 'compare':
			return d.kind;
		case 'pullRequest':
			return [d.kind, d.pr.number, d.stackRoot ? 'stack' : ''].join('|');
		default: {
			const _exhaustive: never = d;
			return _exhaustive;
		}
	}
}

/** Pushes a new sheet onto the stack; re-pushing the current top in place replaces it instead of stacking. */
export function pushSheet(stack: readonly SheetDescriptor[], d: SheetDescriptor): SheetDescriptor[] {
	const top = stack.at(-1);
	if (top != null && sheetKey(d) === sheetKey(top)) {
		return [...stack.slice(0, -1), d];
	}

	return [...stack, d];
}

/** Discards whatever is stacked and starts a fresh single-sheet stack. */
export function replaceStack(_stack: readonly SheetDescriptor[], d: SheetDescriptor): SheetDescriptor[] {
	return [d];
}

/** Pop on an empty stack is a no-op — returning the same reference lets callers skip a re-render. */
export function popSheet(stack: readonly SheetDescriptor[]): {
	stack: SheetDescriptor[];
	popped: SheetDescriptor | undefined;
} {
	if (stack.length === 0) {
		return { stack: stack as SheetDescriptor[], popped: undefined };
	}

	return { stack: stack.slice(0, -1), popped: stack.at(-1) };
}

/** Drops every sheet of the given kind, wherever it sits in the stack, preserving the order of survivors. */
export function removeKind(stack: readonly SheetDescriptor[], kind: SheetKind): SheetDescriptor[] {
	if (!stack.some(d => d.kind === kind)) {
		return stack as SheetDescriptor[];
	}

	return stack.filter(d => d.kind !== kind);
}

/**
 * Projects the compare-signal's open/closed state onto the descriptor stack — same reference when
 * already converged, so callers can apply it unconditionally every render.
 * - open && no 'compare' present → `replaceStack` to a single-entry `[{kind:'compare'}]`, same policy
 *   as any other external opener; `mode: 'push'` stacks it on instead, so the sheet it opened from
 *   (e.g. the pull request sheet's Compare Changes) stays underneath and closing returns there.
 * - open && 'compare' present anywhere → same reference.
 * - !open && 'compare' present → `removeKind(stack, 'compare')`.
 * - !open && none present → same reference.
 */
export function projectCompareSignal(
	stack: readonly SheetDescriptor[],
	open: boolean,
	mode: 'replace' | 'push' = 'replace',
): SheetDescriptor[] {
	const hasCompare = stack.some(d => d.kind === 'compare');
	if (open) {
		if (hasCompare) return stack as SheetDescriptor[];

		return mode === 'push' ? pushSheet(stack, { kind: 'compare' }) : replaceStack(stack, { kind: 'compare' });
	}

	return hasCompare ? removeKind(stack, 'compare') : (stack as SheetDescriptor[]);
}

/**
 * Selection-clear only inspects the root: sheets stacked above a branch sheet (e.g. a conflict opened
 * from within it) are scoped to that branch and clear with it; a root that isn't a branch sheet is
 * selection-decoupled and never clears here.
 */
export function reduceOnSelectionChange(
	stack: readonly SheetDescriptor[],
	belongsToBranch: (ref: BranchSheetRef) => boolean,
): SheetDescriptor[] {
	const root = stack[0];
	if (root?.kind === 'branch' && !belongsToBranch(root.ref)) {
		return [];
	}

	return stack as SheetDescriptor[];
}
