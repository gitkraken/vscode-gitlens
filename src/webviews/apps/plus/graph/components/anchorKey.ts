import { uncommitted } from '@gitlens/git/models/revision.js';

/** Stable per-anchor key. Branded so loose strings can't flow in by mistake.
 *
 *  Format:
 *  - WIP (primary or secondary worktree): `wip|{repoPath}` — secondary WIPs use the
 *    worktree's path, so rows in different worktrees get distinct keys despite all sharing
 *    `sha === uncommitted`.
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
	if (sha === uncommitted) return `wip|${repoPath}` as AnchorKey;
	return `commit|${repoPath}|${sha}` as AnchorKey;
}
