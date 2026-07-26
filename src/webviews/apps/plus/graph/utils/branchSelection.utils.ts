import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { GraphIncludeOnlyRefs, GraphScope, GraphWipMetadataBySha } from '../../../../plus/graph/protocol.js';
import { createSecondaryWipSha } from '../../../../plus/graph/protocol.js';
import { isScopeFocalHead, shouldShowPrimaryWipRow } from './wip.utils.js';

export interface SelectionContext {
	wipMetadataBySha: GraphWipMetadataBySha | undefined;
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
 *    1. Secondary worktree (path differs from `branch.repoPath`) AND a `wipMetadataBySha` entry
 *       for that path exists AND its `parentSha` is in loaded rows → that worktree's WIP row.
 *    2. `wipMetadataBySha` has any entry whose `branchRef` matches `branch.id` AND its
 *       `parentSha` is in loaded rows → that worktree's WIP row. Picks up worktree WIPs whose
 *       OverviewBranch lost its `worktree` field at the graph-provider boundary (the host
 *       strips the default worktree from `worktreesByBranch`), so case (1) misses them.
 *    3. Picked branch IS the currently-opened branch AND the primary "Working Changes" row will
 *       actually render → `uncommitted`. Mirrors the wrapper's `shouldShowPrimaryWipRow`: with a
 *       scope on this branch the row ALWAYS renders (focus outranks `branchesVisibility`); with a
 *       scope on another branch it never does; unscoped, the `branchesVisibility` /
 *       `includeOnlyRefs` check decides. Without the prediction, the cascade returned an
 *       unrenderable WIP sha — `ensureAndSelectCommit` would retry 10 RAFs and silently give up —
 *       or, desynced the other way, the tip while the WIP row was on screen.
 *    4. Otherwise → the branch's tip commit.
 *
 *  The "parentSha in loaded rows" gate on (1) and (2) prevents the same silent-failure mode:
 *  the wrapper drops a WIP row from `decoratedRows` when its parent isn't anchorable, so
 *  handing back the unselectable WIP sha would spin the retry without any visible outcome.
 *
 *  Returns `undefined` only when the branch has no resolvable tip — callers treat that as a
 *  no-op navigation. */
export function getOverviewBranchSelectionSha(branch: SelectionBranch, ctx: SelectionContext): string | undefined {
	const { wipMetadataBySha, rows, branchesVisibility, includeOnlyRefs, scope, currentBranch } = ctx;
	const loadedShas: Set<string> | undefined = rows != null ? new Set(rows.map(r => r.sha)) : undefined;

	if (branch.worktree != null && branch.worktree.path !== branch.repoPath) {
		const wipSha = createSecondaryWipSha(branch.worktree.path);
		const meta = wipMetadataBySha?.[wipSha];
		// Require BOTH a known anchor AND the anchor in loaded rows — without metadata we can't
		// promise the synthetic row exists in `decoratedRows`, and the `meta == null` short-
		// circuit would otherwise hand back an unselectable sha that `ensureAndSelectCommit`
		// spins 10 RAFs trying to find. Falls through to case (2) / tip when metadata is cold.
		if (meta != null && (loadedShas == null || loadedShas.has(meta.parentSha))) {
			return wipSha;
		}
	}

	if (wipMetadataBySha != null) {
		for (const [sha, meta] of Object.entries(wipMetadataBySha)) {
			if (meta.branchRef !== branch.id) continue;
			if (loadedShas != null && !loadedShas.has(meta.parentSha)) continue;

			return sha;
		}
	}

	// `branch.opened === true` means the picked branch is the current (primary worktree) branch, so
	// the primary "Working Changes" row is the one in question. Ask `shouldShowPrimaryWipRow` itself
	// rather than predicting it: this used to be a hand-copied twin kept in sync by comment, and it
	// silently fell out of sync twice — most recently when focus gained precedence over
	// `branchesVisibility`, after which the cascade selected the tip while the row was on screen.
	// Returning an unrenderable WIP sha is equally bad: `ensureAndSelectCommit` retries 10 RAFs and
	// gives up with nothing selected. Same rows-derived fallback the wrapper uses when the branch
	// payload is transiently absent, so both answer identically on that path too.
	if (branch.opened) {
		const scopeFocalIsHead = currentBranch == null ? isScopeFocalHead(rows, scope) : undefined;
		if (shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, currentBranch, scope, scopeFocalIsHead)) {
			return uncommitted;
		}
	}

	return branch.reference.sha;
}
