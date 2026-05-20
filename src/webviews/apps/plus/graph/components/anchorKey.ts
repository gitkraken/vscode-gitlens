import { isWipSha } from '../../../../plus/graph/protocol.js';

/** Stable per-anchor key. Branded so loose strings can't flow in by mistake.
 *
 *  Format:
 *  - WIP (primary or secondary worktree): `wip|{repoPath}` — both share the `wip|` shape;
 *    `repoPath` distinguishes the primary from any secondary and disambiguates rows across
 *    worktrees.
 *  - Single commit: `commit|{repoPath}|{sha}`
 *  - Multi-commit: `multicommit|{repoPath}|{sortedShas.join(',')}` — sorted so {A,B} and
 *    {B,A} collapse to the same key. */
export type AnchorKey = string & { readonly __anchorKey: unique symbol };

export interface AnchorSelection {
	sha?: string;
	shas?: string[];
	repoPath?: string;
}

export function anchorKey(selection: AnchorSelection): AnchorKey {
	const repoPath = selection.repoPath ?? '';
	if (selection.shas != null && selection.shas.length > 0) {
		return `multicommit|${repoPath}|${selection.shas.toSorted().join(',')}` as AnchorKey;
	}

	const sha = selection.sha ?? '';
	if (isWipSha(sha)) return `wip|${repoPath}` as AnchorKey;
	return `commit|${repoPath}|${sha}` as AnchorKey;
}
