import type { GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';
import { GitGraphRowContextFlags as ContextFlags } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type {
	GraphCommitContextValue,
	GraphContributorContextValue,
	GraphItemRefContext,
	GraphItemTypedContext,
} from '../../../../plus/graph/protocol.js';
import { pickRowUndoTarget } from './row.utils.js';

/**
 * Minimal row shape the context builders read. The lean graph payload ships `contexts.flags` (host-only
 * bits) plus the plain row fields; the full `contexts.row`/`contexts.avatar` blobs are reconstructed on
 * demand from these — at right-click / selection time — instead of being serialized per-row on the wire
 * and pre-built for every row.
 */
export type RowContextSource = {
	sha: string;
	author?: string;
	email?: string;
	heads?: ReadonlyArray<{ isCurrentHead?: boolean; worktree?: { id: string; path: string } }> | null;
	isCurrentUser?: boolean;
	contexts?: { flags?: GitGraphRowContextFlags; row?: string | object } | undefined;
};

/** True for a commit row whose right-click `contexts.row` is built dynamically on demand: the host
 *  ships only the compact `contexts.flags` (no serialized `row`), so the webview reconstructs it from
 *  the flags + row fields. Stash rows (and any row already carrying a host-built `contexts.row`) return
 *  false. WIP rows are handled separately — they're identified by `type`, not flags. */
export function needsDynamicRowContext(row: RowContextSource): boolean {
	return row.contexts?.flags != null && row.contexts.row == null;
}

/** True when the commit is reachable from exactly one local branch — the `+unique` context segment.
 *  Reads the flag bit directly (single source of truth with {@link buildRowCommitContext}) rather than
 *  substring-matching a serialized `contexts.row`, which lean rows no longer carry. */
export function isUniqueToBranchRow(row: RowContextSource): boolean {
	return ((row.contexts?.flags ?? 0) & ContextFlags.UniqueToBranch) !== 0;
}

/** True when the commit has children (is NOT a leaf) — the host sets this flag only on undo-eligible
 *  tip rows. Undo Commit is withheld for these. Shared by {@link buildRowCommitContext} (right-click)
 *  and the inline adornment so both apply the leaf rule from the same flag bit. */
export function rowHasChildren(row: RowContextSource): boolean {
	return ((row.contexts?.flags ?? 0) & ContextFlags.HasChildren) !== 0;
}

/**
 * Builds the `gitlens:commit…` webview-item context for a commit row from its fields + `contexts.flags`.
 * Mirrors exactly what the host serialized pre-strip: `+HEAD`/`+worktreeHEAD` from `row.heads`,
 * `+current`/`+unique` from the flag bits. `message` is intentionally OMITTED — the wire `row.message`
 * is emojified, and `Copy Message` refetches the raw message when `ref.message` is absent, so omitting
 * it preserves the original raw-message behavior instead of copying emojified text.
 *
 * `+worktreeHEAD` marks a row that is the HEAD of a non-active worktree (so Undo Commit can target it).
 * Both `+HEAD` and `+worktreeHEAD` are withheld for commits with children (the `HasChildren` flag) —
 * undo is offered only on leaf tips. `ref.repoPath` stays the primary repo so other right-click
 * commands don't retarget a worktree; the secondary worktree's path rides along on
 * `webviewItemValue.worktreePath`, which `_undoCommit` reads. `pickRowUndoTarget` is shared with the
 * inline adornment so both surfaces undo the same worktree (and apply the same leaf rule).
 */
export function buildRowCommitContext(row: RowContextSource, repoPath: string): GraphItemRefContext {
	const flags = row.contexts?.flags ?? 0;
	const { currentHead, worktreeHead } = pickRowUndoTarget(row.heads ?? undefined, rowHasChildren(row));
	const webviewItem = `gitlens:commit${currentHead != null ? '+HEAD' : ''}${
		worktreeHead != null ? '+worktreeHEAD' : ''
	}${flags & ContextFlags.ReachableFromHead ? '+current' : ''}${flags & ContextFlags.UniqueToBranch ? '+unique' : ''}`;

	return {
		webviewItem: webviewItem,
		webviewItemValue: {
			type: 'commit',
			ref: createReference(row.sha, repoPath, { refType: 'revision' }),
			worktreePath: worktreeHead?.worktree?.path,
		},
	};
}

/** Builds the `gitlens:contributor…` webview-item context for a commit row's avatar/author zone. */
function buildRowAvatarContext(
	row: RowContextSource,
	repoPath: string,
): GraphItemTypedContext<GraphContributorContextValue> {
	const isCurrentUser = row.isCurrentUser ?? false;
	return {
		webviewItem: `gitlens:contributor${isCurrentUser ? '+current' : ''}`,
		webviewItemValue: {
			type: 'contributor',
			repoPath: repoPath,
			name: row.author ?? '',
			email: row.email ?? '',
			current: isCurrentUser,
		},
	};
}

/** Serializes the commit-row context to the string the `data-vscode-context` DOM attribute carries. */
export function serializeRowCommitContext(row: RowContextSource, repoPath: string): string {
	return serializeWebviewItemContext<GraphItemRefContext>(buildRowCommitContext(row, repoPath));
}

/** Serializes the avatar-zone context to the string the `data-vscode-context` DOM attribute carries. */
export function serializeRowAvatarContext(row: RowContextSource, repoPath: string): string {
	return serializeWebviewItemContext(buildRowAvatarContext(row, repoPath));
}

/**
 * Builds the `gitlens:wip…` webview-item context for a working-changes row. The context is static — it
 * carries only the worktree's path and the synthetic `uncommitted` ref — so the webview can build it for
 * any WIP row it renders, no host-serialized blob required. `+worktree` marks a secondary (non-selected)
 * worktree's WIP row.
 */
function buildWipContext(worktreePath: string, secondary: boolean): GraphItemTypedContext<GraphCommitContextValue> {
	return {
		webviewItem: secondary ? 'gitlens:wip+worktree' : 'gitlens:wip',
		webviewItemValue: {
			type: 'commit',
			ref: createReference(uncommitted, worktreePath, { refType: 'revision' }),
			worktreePath: worktreePath,
		},
	};
}

/** Serializes the WIP-row context to the string the `data-vscode-context` DOM attribute carries. */
export function serializeWipContext(worktreePath: string, secondary: boolean): string {
	return serializeWebviewItemContext(buildWipContext(worktreePath, secondary));
}
