import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import { isPrimaryWipRowId } from '../../../../plus/graph/protocol.js';

/**
 * RowMarker ("where am I") vocabulary shared by the left-edge rail (on-row indicator) and the ref
 * pills' role emphasis. One vocabulary, one place: role → color class / icon / label, so the surfaces
 * can never drift.
 *
 * The roles the current worktree navigates by:
 *   - `head`     — the worktree HEAD tip (green, `vm-active` — the current local branch)
 *   - `upstream` — the upstream tracking tip (deeper green, ahead/behind)
 *   - `target`   — the merge-target tip (purple, `gl-merge-target`)
 *
 * …plus the two SCOPE-anchor roles, folded in here so a scoped graph shows ONE left-edge rail instead of
 * two competing ones (the scope anchor used to draw its own rail at the row's left edge while this one sat
 * at the graph column's — misaligned, and marking the same row twice in the same purple):
 *   - `focal`    — the scope's focal branch tip (brand)
 *   - `base`     — the scope's fork point / merge base (muted grey)
 *
 * The scope's own `target` anchor is NOT a separate role: it's the same commit, and the same purple, as
 * `target` above, so it folds into that one segment.
 */
export type RowMarkerRole = 'head' | 'upstream' | 'target' | 'focal' | 'base';

// Role bit flags. A row's roles are a MASK (not an array) so the per-row check on the render path
// allocates nothing — every row pays a few compares and a number, never an array. Consumers read the
// flags off `rowMarkerRoleSpecs` rather than importing them.
const rowMarkerHead = 1;
const rowMarkerUpstream = 2;
const rowMarkerTarget = 4;
const rowMarkerFocal = 8;
const rowMarkerBase = 16;

/**
 * The three tip shas (+ the merge-target's short name) the current worktree navigates by. Built
 * CLIENT-SIDE in gl-lit-graph from `this.headSha`, the upstream tip (`refRowIndex.get(upstreamId)`), and
 * the scope-pulled merge target — no host row-marker model. A row plays a role when its sha equals the
 * matching tip; the same object drives the rail, the ref-pill roles, and the WIP-row pill.
 */
export interface RowMarkerTips {
	headSha?: string;
	upstreamSha?: string;
	targetSha?: string;
	/** Short merge-target branch name (`main`, `origin/main`) — labels the ref pill's target segment. */
	targetName?: string;
}

/** Roles (as a mask) `sha` plays in `tips`. 0 = none — the answer for all but the handful of marked rows. A sha shared by
 *  several roles (HEAD === upstream when in sync) returns the COMBINED mask, which is what groups them
 *  into a single indicator instead of stacking duplicates. */
export function rowMarkerRolesFor(sha: string, tips: RowMarkerTips | undefined): number {
	if (tips == null) return 0;

	let roles = 0;
	if (sha === tips.headSha) {
		roles |= rowMarkerHead;
	}
	if (sha === tips.upstreamSha) {
		roles |= rowMarkerUpstream;
	}
	if (sha === tips.targetSha) {
		roles |= rowMarkerTarget;
	}
	return roles;
}

/** Per-role presentation. `icon` is a codicon/gl-icon name; `label` is the short role word. Colors live
 *  in graph.scss keyed by `role` (never inline — tokens). */
export const rowMarkerRoleSpecs: readonly {
	role: RowMarkerRole;
	flag: number;
	icon: string;
	label: string;
	/** Spelled-out role for the rail's tooltip — the expanded pill only has room for `label`. */
	description: string;
}[] = [
	{ role: 'head', flag: rowMarkerHead, icon: 'vm-active', label: 'HEAD', description: 'HEAD (Current Branch Tip)' },
	{ role: 'upstream', flag: rowMarkerUpstream, icon: 'cloud', label: 'Upstream', description: 'Upstream Tip' },
	{ role: 'focal', flag: rowMarkerFocal, icon: 'target', label: 'Focus', description: 'Focus Branch Tip' },
	{ role: 'target', flag: rowMarkerTarget, icon: 'gl-merge-target', label: 'Target', description: 'Merge Target' },
	{ role: 'base', flag: rowMarkerBase, icon: 'git-merge', label: 'Base', description: 'Fork Point (Base)' },
];

/**
 * The rail's hover tooltip: every role the row plays, spelled out and joined — `Merge Target (main) & Fork
 * Point (Base)`. Says what the expanded pill CAN'T: the full wording, and WHICH ref the merge target is
 * (the pill only has room for `TARGET`). Restores the wording the scope anchor's own rail used to carry
 * before the two rails were unified. Empty string when the row plays no role.
 */
export function rowMarkerRolesTooltip(roles: number, targetName?: string): string {
	if (roles === 0) return '';

	const parts: string[] = [];
	for (const spec of rowMarkerRoleSpecs) {
		if ((roles & spec.flag) === 0) continue;

		parts.push(
			spec.role === 'target' && targetName != null && targetName.length > 0
				? `${spec.description} (${shortRefName(targetName)})`
				: spec.description,
		);
	}
	return parts.join(' & ');
}

/**
 * The scope anchor's roles for a row, as the same mask — so the rail can render scope and row marker in one
 * indicator. `target` deliberately maps onto the ROW-MARKER target flag (identical commit, identical color).
 *
 * Additive, not a precedence ladder: a row is routinely more than one anchor (a branch level with its target
 * is all three at once), and each is a distinct fact — where you are vs. where you diverged. The row's
 * primary LOOK still picks one winner; that's `anchorKind`'s job, not this one's.
 *
 * Allocation-free, and the caller already has these booleans on the row context — no extra work per row.
 */
export function scopeAnchorRoles(
	isFocalAnchor: boolean | undefined,
	isForkAnchor: boolean | undefined,
	isTargetAnchor: boolean | undefined,
): number {
	let roles = 0;
	if (isFocalAnchor === true) {
		roles |= rowMarkerFocal;
	}
	if (isTargetAnchor === true) {
		roles |= rowMarkerTarget;
	}
	if (isForkAnchor === true) {
		roles |= rowMarkerBase;
	}
	return roles;
}

/**
 * Fold the scope-anchor roles into the row-marker roles for one row. Row markers are the PRIMARY vocabulary,
 * so where the two name the same commit the row-marker role wins and the scope one is dropped rather than
 * drawing a second segment for the same fact: scoping to the current branch makes the focal tip literally the
 * HEAD row, so `focal` is suppressed when `head` is present. (`target` needs no such rule — both vocabularies
 * already share that flag.)
 */
export function combineRowMarkerRoles(rowMarkerRoles: number, scopeRoles: number): number {
	const roles = rowMarkerRoles | scopeRoles;
	return (roles & rowMarkerHead) !== 0 ? roles & ~rowMarkerFocal : roles;
}

/** The single role a grouped row's rail takes its color from — HEAD > upstream > focus > merge target >
 *  base (the spec order). The rail never stacks colors; it enumerates every
 *  role the row plays as segments, but the connector band takes just this one.
 *  Allocation-free (a scan of the static specs); callers pass a non-zero mask, so the ~97% of rows with
 *  none never reach it. */
export function primaryRowMarkerRole(roles: number): RowMarkerRole | undefined {
	for (const spec of rowMarkerRoleSpecs) {
		if ((roles & spec.flag) !== 0) return spec.role;
	}
	return undefined;
}

/** Trailing name of a ref id / ref name (`{repoPath}|remotes/origin/x` → `origin/x`). */
export function shortRefName(ref: string): string {
	const idx = ref.indexOf('|');
	const name = idx >= 0 ? ref.slice(idx + 1) : ref;
	return name.replace(/^(refs\/)?(heads|remotes|tags)\//, '');
}

/** The graph's own worktree's WIP row — the only row that may carry the row-marker ref pill. A peer
 *  worktree's WIP row carries no row marker. Used by the pill placement AND the sticky-timeline yield
 *  check so both read the same decision. */
export function isPrimaryWipRow(
	kind: ProcessedGraphRow['kind'],
	sha: string,
	selectedRepoPath: string | undefined,
): boolean {
	return kind === 'workdir' && isPrimaryWipRowId(sha, selectedRepoPath);
}

/** Screen-reader prefix for a row playing one or more row-marker roles ("HEAD, Upstream"). Built for
 *  a handful of rows per render, so a plain join is fine. Empty string when the row plays none. */
export function rowMarkerRolesAriaLabel(roles: number): string {
	if (roles === 0) return '';

	const parts: string[] = [];
	for (const spec of rowMarkerRoleSpecs) {
		if ((roles & spec.flag) !== 0) {
			parts.push(spec.label);
		}
	}
	return parts.join(', ');
}
