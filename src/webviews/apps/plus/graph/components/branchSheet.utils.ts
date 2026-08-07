import type { GitGraphRow, GitGraphRowHead } from '@gitlens/git/models/graph.js';
import type { GitBranchReference, GitTagReference } from '@gitlens/git/models/reference.js';
import type { GraphExcludedRef, GraphItemContext, GraphScopeBranch } from '../../../../plus/graph/protocol.js';
import type { BranchSheetRef } from './gl-graph-branch-sheet-pane.js';

// Pure branch/tag sheet helpers shared by the chrome component (`gl-graph-branch-sheet.ts`) and the
// details panel (selection auto-close + repoPath resolution at open) — living here instead of either
// component avoids a dependency between them.

/** A sheet ref's serialized context with `+pinned` re-stamped to `pinned` — what the branch kebab's menu is
 *  gated on. The context string is captured when the sheet opens, so its own flag can't track a later pin
 *  change; the caller passes the live pin state in. */
export function withPinnedFlag(context: string | undefined, pinned: boolean): string | undefined {
	if (context == null) return undefined;
	if (context.includes('+pinned') === pinned) return context;

	try {
		const parsed = JSON.parse(context) as GraphItemContext;
		const item = parsed.webviewItem;
		if (item == null) return context;

		return JSON.stringify({
			...parsed,
			webviewItem: pinned ? `${item}+pinned` : item.replace('+pinned', ''),
		});
	} catch {
		return context;
	}
}

/**
 * The git reference inside a sheet ref's serialized graph context, when it carries one.
 *
 * The object + `in` guards both earn their keep: `GraphItemContextValue` includes the columns
 * context, which is a bare `string`, so the union has neither a common discriminant nor a guaranteed
 * object shape to test `type` against.
 */
export function branchSheetContextRef(
	context: GraphItemContext | undefined,
): GitBranchReference | GitTagReference | undefined {
	const value = context?.webviewItemValue;
	if (value == null || typeof value !== 'object' || !('type' in value)) return undefined;
	if (value.type !== 'branch' && value.type !== 'tag') return undefined;

	return value.ref;
}

/**
 * The exclusion entry for a sheet ref — the same shape the host's `hideRef` (graphCommands.ts) writes,
 * since that's what the `excludeRefs` record we test against is keyed and populated by. `BranchSheetRef`
 * already carries the bare name and the remote alias, so nothing needs re-splitting here.
 *
 * Returns undefined when the ref has no id: an id-less ref comes from a provider that computes no
 * branch metadata (see `GitGraphRowHead.id`), and exclusions are id-keyed, so there's nothing to toggle.
 */
export function resolveBranchSheetExcludeRef(
	ref: BranchSheetRef,
	context: GraphItemContext | undefined,
): GraphExcludedRef | undefined {
	const id = branchSheetContextRef(context)?.id;
	if (id == null) return undefined;

	return {
		id: id,
		name: ref.name,
		owner: ref.refType === 'remote' ? (ref.remote ?? undefined) : undefined,
		type: ref.refType === 'tag' ? 'tag' : ref.refType === 'remote' ? 'remote' : 'head',
	};
}

/** The ref's serialized `data-vscode-context`, parsed; undefined when absent or malformed. */
export function parseBranchSheetContext(context: string | undefined): GraphItemContext | undefined {
	if (context == null) return undefined;

	try {
		return JSON.parse(context) as GraphItemContext;
	} catch {
		return undefined;
	}
}

/** First head across the loaded rows matching `predicate`. Heads live on rows, so a branch whose tip
 *  hasn't paged in yet isn't found — callers degrade (drop the upstream, scope the remote ref) rather
 *  than guess at a ref id. Runs once per Focus click, never per render. */
export function findRowHead(
	rows: GitGraphRow[] | undefined,
	predicate: (head: GitGraphRowHead) => boolean,
): GitGraphRowHead | undefined {
	for (const row of rows ?? []) {
		const head = row.heads?.find(predicate);
		if (head != null) return head;
	}
	return undefined;
}

/** Scope payload for the sheet's Focus chip. Scope is keyed on local heads, so a remote ref focuses
 *  the local branch tracking it when there is one and scopes the remote ref itself otherwise. Tags
 *  have no branch to scope to — the Focus chip keeps the chip off them. */
export function resolveBranchSheetScope(
	ref: BranchSheetRef,
	rows: GitGraphRow[] | undefined,
): GraphScopeBranch | undefined {
	if (ref.refType === 'head') {
		const upstream = findRowHead(rows, h => h.name === ref.name)?.upstream;
		return {
			branchName: ref.name,
			upstreamName: upstream?.missing ? undefined : upstream?.name,
		};
	}

	if (ref.refType !== 'remote' || ref.remote == null) return undefined;

	// `ref.name` is the bare name shared with the local counterpart — qualify it, same as the title.
	const name = `${ref.remote}/${ref.name}`;
	const local = findRowHead(rows, h => h.upstream != null && !h.upstream.missing && h.upstream.name === name);
	return local != null ? { branchName: local.name, upstreamName: name } : { branchName: name, remote: true };
}
