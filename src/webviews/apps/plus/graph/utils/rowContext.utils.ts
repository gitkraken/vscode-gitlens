import type { GitGraphRow, GitGraphRowContextFlags, GitGraphRowType } from '@gitlens/git/models/graph.js';
import { GitGraphRowContextFlags as ContextFlags } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type {
	GraphCommitContextValue,
	GraphContributorContextValue,
	GraphItemContext,
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

/** True when the commit is ahead of HEAD's upstream — the `+unpublished` context segment. Reads the
 *  flag bit directly (single source of truth with {@link buildRowCommitContext}); drives the graph's
 *  at-rest unpushed indicator (the colorized Push to Commit button) and context-menu action. */
export function isUnpublishedRow(row: RowContextSource): boolean {
	return ((row.contexts?.flags ?? 0) & ContextFlags.Unpublished) !== 0;
}

/**
 * Builds the `gitlens:commit…` webview-item context for a commit row from its fields + `contexts.flags`.
 * Mirrors exactly what the host serialized pre-strip: `+HEAD`/`+worktreeHEAD` from `row.heads`,
 * `+current`/`+rewriteable`/`+unique`/`+unpublished` from the flag bits. `message` is intentionally OMITTED — the wire
 * `row.message` is emojified, and `Copy Message` refetches the raw message when `ref.message` is absent,
 * so omitting it preserves the original raw-message behavior instead of copying emojified text.
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
	}${flags & ContextFlags.ReachableFromHead ? '+current' : ''}${
		flags & ContextFlags.RewriteableFromHead ? '+rewriteable' : ''
	}${flags & ContextFlags.UniqueToBranch ? '+unique' : ''}${flags & ContextFlags.Unpublished ? '+unpublished' : ''}`;

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

/**
 * Reduces the per-row `webviewItem` context strings of a multi-row selection to a single least-common-
 * denominator string for the combined `webviewItems` context key. Context strings are of the form
 * `gitlens:<type>[+<addition>...]` — `<type>` may contain `:` but never `+`, so the segment before the
 * first `+` is the base type and the rest are additions. The result keeps the shared base type plus only
 * the additions present in EVERY distinct context, so a VS Code `when` clause that matches an addition
 * (e.g. `+current`) matches the selection only when all rows carry it.
 *
 * Returns `undefined` when the selection mixes more than one base type — a context-setup error that should
 * not happen at runtime for a single row type; callers treat it as "no combined context".
 *
 * Dedupes internally so the addition test is over DISTINCT contexts. This matters because a HEAD row's
 * extra `+HEAD` (from {@link buildRowCommitContext}) makes its context differ from its siblings: when
 * several non-HEAD rows collapse to the same string, the additions they all share (e.g. `+current`) must
 * still be retained — testing against the total row count instead would drop them and break the menu.
 */
export function reduceCommonWebviewItemsContext(contexts: Iterable<string>): string | undefined {
	const distinct = [...new Set(contexts)];
	if (distinct.length === 0) return undefined;
	if (distinct.length === 1) return distinct[0];

	const split = distinct.map(context => {
		const parts = context.split('+');
		return { baseType: parts[0], additions: parts.slice(1) };
	});

	// All rows of one selection group share a row type, so they must share a base type; bail if they don't.
	const baseType = split[0].baseType;
	if (!split.every(sc => sc.baseType === baseType)) return undefined;

	// If any context has no additions, the only thing common to all of them is the base type.
	if (split.some(sc => sc.additions.length === 0)) return baseType;

	// Tally additions across the distinct contexts, then keep those present in every one of them.
	const frequency = new Map<string, number>();
	for (const sc of split) {
		for (const add of sc.additions) {
			frequency.set(add, (frequency.get(add) ?? 0) + 1);
		}
	}
	const common: string[] = [];
	for (const [addition, count] of frequency) {
		if (count === split.length) {
			common.push(addition);
		}
	}

	return common.length > 0 ? `${baseType}+${common.join('+')}` : baseType;
}

/** Serializes the avatar-zone context to the string the `data-vscode-context` DOM attribute carries. */
export function serializeRowAvatarContext(row: RowContextSource, repoPath: string): string {
	return serializeWebviewItemContext(buildRowAvatarContext(row, repoPath));
}

/**
 * Builds the `gitlens:wip…` webview-item context for a working-changes row. The context carries the
 * worktree's path and the synthetic `uncommitted` ref, so the webview can build it for any WIP row it
 * renders, no host-serialized blob required. `+worktree` marks a secondary (non-selected) worktree's WIP
 * row; `+hasConflicts` marks a WIP with a paused merge/rebase that has conflicts — it gates the
 * Resolve Conflicts context-menu item so it only appears when there's something to resolve.
 */
function buildWipContext(
	worktreePath: string,
	secondary: boolean,
	hasConflicts: boolean,
): GraphItemTypedContext<GraphCommitContextValue> {
	return {
		webviewItem: `gitlens:wip${secondary ? '+worktree' : ''}${hasConflicts ? '+hasConflicts' : ''}`,
		webviewItemValue: {
			type: 'commit',
			ref: createReference(uncommitted, worktreePath, { refType: 'revision' }),
			worktreePath: worktreePath,
		},
	};
}

/** Serializes the WIP-row context to the string the `data-vscode-context` DOM attribute carries. */
export function serializeWipContext(worktreePath: string, secondary: boolean, hasConflicts: boolean): string {
	return serializeWebviewItemContext(buildWipContext(worktreePath, secondary, hasConflicts));
}

/** True when every row is reachable from exactly one local branch AND they all agree on that same
 *  branch — mirrors the React adapter's `checkUniqueBranchSelection`. Any row missing the flag (e.g. a
 *  WIP row, which carries no flags at all) fails the whole selection, matching the original early-exit. */
function isUniqueToBranchSelection(rows: readonly GitGraphRow[]): boolean {
	if (rows.length === 0) return false;

	const branchNames = new Set<string>();
	for (const row of rows) {
		if (!isUniqueToBranchRow(row)) return false;

		for (const head of row.heads ?? []) {
			branchNames.add(head.name);
		}
	}
	return branchNames.size <= 1;
}

/** Resolves a selected row's own webview-item context, mirroring the on-demand row-context build: a
 *  host-shipped `contexts.row` wins as-is; otherwise a lean row reconstructs it from its flags. `undefined`
 *  for rows with neither (e.g. WIP rows) — they're excluded from the type-group below. */
function parsedSelectionItem(row: GitGraphRow, repoPath: string): GraphItemContext | undefined {
	const raw = row.contexts?.row;
	if (raw != null) {
		return (typeof raw === 'string' ? JSON.parse(raw) : raw) as GraphItemContext;
	}
	return needsDynamicRowContext(row) ? buildRowCommitContext(row, repoPath) : undefined;
}

/** Per-row-type multi-selection context — mirrors the React adapter's `computeSelectionContext`.
 *  `webviewItems`/`webviewItemsValues` boil the type-group's own contexts down to a least-common-
 *  denominator string + the full per-row value list (multi-commit commands read the latter for every
 *  selected ref). The `list*Selection` flags gate `.multi` menu entries; `listContiguousSelection` and
 *  `listUniqueBranchSelection` are whole-selection properties (same value for every type-group). */
export interface GraphSelectionContext {
	webviewItems?: string;
	webviewItemsValues?: GraphItemContext[];
	listMultiSelection: boolean;
	listDoubleSelection: boolean;
	listContiguousSelection: boolean;
	listUniqueBranchSelection: boolean;
}

/**
 * Builds the per-row-type selection contexts for a multi-row right-click. `contiguous` is the caller-
 * computed display-order contiguity of `selectedRows` (this function is topology-agnostic — the caller
 * knows the render order). Returns `undefined` for a selection of 0 or 1 rows, matching the React
 * adapter's early exit (no multi-select context applies to a single selection).
 */
export function computeSelectionContexts(
	selectedRows: readonly GitGraphRow[],
	repoPath: string,
	contiguous: boolean,
): Map<GitGraphRowType, GraphSelectionContext> | undefined {
	if (selectedRows.length <= 1) return undefined;

	const isUniqueBranch = isUniqueToBranchSelection(selectedRows);

	const grouped = new Map<GitGraphRowType, GraphItemContext[]>();
	for (const row of selectedRows) {
		const item = parsedSelectionItem(row, repoPath);
		if (item == null) continue;

		const items = grouped.get(row.type);
		if (items != null) {
			items.push(item);
		} else {
			grouped.set(row.type, [item]);
		}
	}
	if (grouped.size === 0) return undefined;

	const contexts = new Map<GitGraphRowType, GraphSelectionContext>();
	for (const [type, items] of grouped) {
		const webviewItems = reduceCommonWebviewItemsContext(items.map(i => i.webviewItem));
		const count = webviewItems != null ? items.length : 0;
		contexts.set(type, {
			webviewItems: webviewItems,
			webviewItemsValues: count > 1 ? items : undefined,
			listMultiSelection: count > 1,
			listDoubleSelection: count === 2,
			listContiguousSelection: contiguous,
			listUniqueBranchSelection: isUniqueBranch,
		});
	}
	return contexts;
}

/** Serializes a {@link GraphSelectionContext} to the string the `data-vscode-context` DOM attribute
 *  carries. Additive keys only — no `webviewItem`/`webviewItemValue` — those come from the nearer
 *  row-level attribute, which VS Code's context-menu DOM walk merges with these wrapper-level keys. */
export function serializeSelectionContext(context: GraphSelectionContext): string {
	return JSON.stringify(context);
}
