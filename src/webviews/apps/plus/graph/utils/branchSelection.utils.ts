import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { GraphIncludeOnlyRefs, GraphScope, GraphWipRowsById } from '../../../../plus/graph/protocol.js';
import { createWipRowId } from '../../../../plus/graph/protocol.js';
import { isScopeFocalHead, shouldShowPrimaryWipRow } from './wip.utils.js';

export interface SelectionContext {
	wipRowsById: GraphWipRowsById | undefined;
	/** The graph's own worktree's WIP row id, so the peer-row cases below can skip it: it now has a
	 *  `wipRowsById` entry like any other worktree, but it is reached by case (3) — which asks
	 *  {@link shouldShowPrimaryWipRow} and answers with `uncommitted`, the id the primary row is
	 *  selected by. Undefined when the selected repo path hasn't resolved yet. */
	primaryWipRowId: string | undefined;
	rows: readonly GitGraphRow[] | undefined;
	branchesVisibility: GraphBranchesVisibility | undefined;
	includeOnlyRefs: GraphIncludeOnlyRefs | undefined;
	scope: GraphScope | undefined;
	/** `state.branch` — the branch HEAD points at, which is what the primary WIP row belongs to and
	 *  what {@link shouldShowPrimaryWipRow} answers for. Distinct from the branch being PICKED. */
	currentBranch: { id?: string; name: string; detached?: boolean } | undefined;
}

/** Minimal shape `getOverviewBranchSelectionSha` reads from a branch — declared narrowly so the
 *  header-popover fallback path can synthesize a stand-in from a `branchName + repoPath` and
 *  route through the same helper as the overview-card path. */
export interface SelectionBranch {
	id: string;
	repoPath: string;
	opened: boolean;
	reference: { sha?: string };
	worktree?: { path: string };
}

/** Returns the graph-row SHA to select when the user picks a branch from a webview-side panel
 *  (overview cards, agents sidebar, header popover, etc.). Cascade:
 *    1. Peer worktree (path differs from `branch.repoPath`) AND a `wipRowsById` entry
 *       for that path exists AND its `parentSha` is in loaded rows → that worktree's WIP row.
 *    2. `wipRowsById` has any PEER entry whose `branchRef` matches `branch.id` AND its
 *       `parentSha` is in loaded rows → that worktree's WIP row. Picks up worktree WIPs whose
 *       OverviewBranch lost its `worktree` field at the graph-provider boundary (the host
 *       strips the default worktree from `worktreesByBranch`), so case (1) misses them.
 *    3. Picked branch IS the currently-opened branch AND the primary "Working Changes" row will
 *       actually render → `uncommitted`. Mirrors the wrapper's `shouldShowPrimaryWipRow`: with a
 *       scope on this branch the row ALWAYS renders (focus outranks `branchesVisibility`); with a
 *       scope on another branch it never does; unscoped, the `branchesVisibility` /
 *       `includeOnlyRefs` check decides. Without the prediction, the cascade returned an
 *       unrenderable WIP sha — `navigateToCommit` would otherwise remain pending for a synthetic
 *       row that cannot materialize — or, desynced the other way, the tip while the WIP row was
 *       on screen.
 *    4. Otherwise → the branch's tip commit.
 *
 *  The "parentSha in loaded rows" gate on (1) and (2) prevents the same silent-failure mode:
 *  the wrapper drops a WIP row from `decoratedRows` when its parent isn't anchorable, so
 *  handing back the unselectable WIP sha would spin the retry without any visible outcome.
 *
 *  Returns `undefined` only when the branch has no resolvable tip — callers treat that as a
 *  no-op navigation. */
export function getOverviewBranchSelectionSha(branch: SelectionBranch, ctx: SelectionContext): string | undefined {
	const { wipRowsById, primaryWipRowId, rows, branchesVisibility, includeOnlyRefs, scope, currentBranch } = ctx;
	const loadedShas: Set<string> | undefined = rows != null ? new Set(rows.map(r => r.sha)) : undefined;

	if (branch.worktree != null && branch.worktree.path !== branch.repoPath) {
		const wipSha = createWipRowId(branch.worktree.path);
		const row = wipSha !== primaryWipRowId ? wipRowsById?.[wipSha] : undefined;
		// Require BOTH a known anchor AND the anchor in loaded rows — without a row entry we can't
		// promise the synthetic row exists in `decoratedRows`, and the `row == null` short-
		// circuit would otherwise hand back an unselectable sha that `navigateToCommit` would
		// wait to materialize. Falls through to case (2) / tip when the topology is cold.
		if (row?.parentSha != null && (loadedShas == null || loadedShas.has(row.parentSha))) {
			return wipSha;
		}
	}

	if (wipRowsById != null) {
		for (const [sha, row] of Object.entries(wipRowsById)) {
			if (sha === primaryWipRowId) continue;
			if (row.branchRef !== branch.id) continue;
			if (row.parentSha == null) continue;
			if (loadedShas != null && !loadedShas.has(row.parentSha)) continue;

			return sha;
		}
	}

	// `branch.opened === true` means the picked branch is the current (primary worktree) branch, so
	// the primary "Working Changes" row is the one in question. Ask `shouldShowPrimaryWipRow` itself
	// rather than predicting it: this used to be a hand-copied twin kept in sync by comment, and it
	// silently fell out of sync twice — most recently when focus gained precedence over
	// `branchesVisibility`, after which the cascade selected the tip while the row was on screen.
	// Returning an unrenderable WIP sha is equally bad: `navigateToCommit` would wait for a synthetic
	// row that cannot materialize. Same rows-derived fallback the wrapper uses when the branch payload
	// is transiently absent, so both answer identically on that path too.
	if (branch.opened) {
		const scopeFocalIsHead = currentBranch == null ? isScopeFocalHead(rows, scope) : undefined;
		if (shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, currentBranch, scope, scopeFocalIsHead)) {
			return uncommitted;
		}
	}

	return branch.reference.sha;
}
