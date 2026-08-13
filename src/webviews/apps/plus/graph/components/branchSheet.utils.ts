import type { GitGraphRow, GitGraphRowHead, GitGraphRowRemoteHead, GitGraphRowTag } from '@gitlens/git/models/graph.js';
import type { GitBranchReference, GitTagReference } from '@gitlens/git/models/reference.js';
import type {
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphItemContext,
	GraphScopeBranch,
} from '../../../../plus/graph/protocol.js';
import { buildBranchRefContext, buildRemoteBranchRefContext, buildTagRefContext } from '../utils/refContext.utils.js';
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

/** The whole-remote "Hide Remote" wildcard entry (`type: 'remote'`, `name: '*'`) covering `owner`, if
 *  one is stored. Returns the ENTRY itself — un-hiding removes by its own id, not the sheet ref's.
 *  Detection only: the entry's `except` (branches exempted from the hide) is the caller's to check —
 *  see `renderHideChip` in `gl-graph-branch-sheet.ts`. */
export function findWildcardRemoteExclude(
	excludeRefs: GraphExcludeRefs | undefined,
	owner: string | undefined,
): GraphExcludedRef | undefined {
	if (excludeRefs == null || owner == null) return undefined;

	return Object.values(excludeRefs).find(ref => ref.type === 'remote' && ref.name === '*' && ref.owner === owner);
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

/** First remote head across the loaded rows matching `predicate` — see {@link findRowHead}. */
export function findRowRemote(
	rows: GitGraphRow[] | undefined,
	predicate: (remote: GitGraphRowRemoteHead) => boolean,
): GitGraphRowRemoteHead | undefined {
	for (const row of rows ?? []) {
		const remote = row.remotes?.find(predicate);
		if (remote != null) return remote;
	}
	return undefined;
}

/** First tag across the loaded rows matching `predicate` — see {@link findRowHead}. */
export function findRowTag(
	rows: GitGraphRow[] | undefined,
	predicate: (tag: GitGraphRowTag) => boolean,
): GitGraphRowTag | undefined {
	for (const row of rows ?? []) {
		const tag = row.tags?.find(predicate);
		if (tag != null) return tag;
	}
	return undefined;
}

/** The sheet ref's CURRENT tip sha — the sha of the loaded row carrying the ref. `undefined` when the
 *  ref's row hasn't paged in; callers fall back to the open-time snapshot sha. */
export function findRefTipSha(ref: BranchSheetRef, rows: GitGraphRow[] | undefined): string | undefined {
	for (const row of rows ?? []) {
		const carries =
			ref.refType === 'head'
				? row.heads?.some(h => h.name === ref.name)
				: ref.refType === 'remote'
					? row.remotes?.some(r => r.owner === ref.remote && r.name === ref.name)
					: row.tags?.some(t => t.name === ref.name);
		if (carries) return row.sha;
	}
	return undefined;
}

/**
 * Rebuilds a sheet ref's context from the loaded row the same way the graph's own ref pills build theirs
 * (`buildBranchRefContext`/`buildRemoteBranchRefContext`/`buildTagRefContext`), instead of parsing the
 * sheet's open-time snapshot (`ref.context`). That snapshot freezes every flag — `+tracking`, `+remote`,
 * `+worktree`, `+current`, `+pinned`, … — at the moment the sheet opened, so e.g. publishing the branch
 * while the sheet is open leaves the kebab menu and chips offering stale actions.
 *
 * Returns `undefined` when the ref's tip row hasn't paged in yet (heads/remotes/tags only exist on loaded
 * rows) or the ref is id-less (see `serializeBranchRefContext`'s own suppression for lean refs) — callers
 * fall back to the snapshot in both cases.
 */
export function resolveLiveBranchSheetContext(
	ref: BranchSheetRef,
	rows: GitGraphRow[] | undefined,
	repoPath: string | undefined,
	pinnedRefId: string | undefined,
): GraphItemContext | undefined {
	if (repoPath == null) return undefined;

	const state = pinnedRefId != null ? { pinnedRefId: pinnedRefId } : undefined;

	if (ref.refType === 'head') {
		const head = findRowHead(rows, h => h.name === ref.name);
		return head?.id != null ? buildBranchRefContext(head, repoPath, state) : undefined;
	}

	if (ref.refType === 'remote') {
		if (ref.remote == null) return undefined;

		const remote = findRowRemote(rows, r => r.owner === ref.remote && r.name === ref.name);
		return remote?.id != null ? buildRemoteBranchRefContext(remote, repoPath, state) : undefined;
	}

	if (ref.refType === 'tag') {
		const tag = findRowTag(rows, t => t.name === ref.name);
		return tag?.id != null ? buildTagRefContext(tag, repoPath) : undefined;
	}

	return undefined;
}
