import type {
	CommitGraphRef as CanonicalGraphCommitRef,
	CommitGraphView as CanonicalGraphCommitView,
} from '@gitkraken/commit-graph-ui/contracts/rows.js';
import { pickRowUndoTarget } from '@gitkraken/commit-graph-ui/rows.js';
import type { CommitKind } from '@gitkraken/commit-graph/engine/types.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import {
	serializeBranchRefContext,
	serializeRemoteBranchRefContext,
	serializeTagRefContext,
} from '../utils/refContext.utils.js';
import {
	isUnpublishedRow,
	isUnpulledRow,
	needsDynamicRowContext,
	rowHasChildren,
	serializeRowAvatarContext,
	serializeRowCommitContext,
} from '../utils/rowContext.utils.js';

/**
 * Lit-free GitLens host adapter from `GitGraphRow` to the package's canonical commit view. Kept out
 * of the element so the conversion stays unit-testable without a DOM.
 */

/**
 * A row's ref carried STRUCTURED (not flattened to a git-log token string + re-parsed). Built once
 * in `toGraphCommit` straight from the rich `GitGraphRow.heads/remotes/tags`, preserving the metadata
 * the ref pill + scroll markers need (current checkout, upstream, worktree, remote owner) so the
 * primary-ref ordering is exact and there's no lossy tokenize↔re-parse round-trip.
 */
type GraphCommitRef = CanonicalGraphCommitRef;
type GraphCommitView = CanonicalGraphCommitView;

function serializeContext(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value === 'string') return value;

	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

/**
 * Merge a ref's own item context (`webviewItem`/`webviewItemValue`) with its refGROUP context
 * (`webviewItemGroup`/`webviewItemGroupValue`) into a single `data-vscode-context` object. The keys don't
 * collide, so a grouped pill's right-click menu exposes BOTH the branch/remote `when` clauses AND the
 * refGroup "Hide". VS Code merges `data-vscode-context` up the ancestor chain, but the pill renders as
 * ONE element — nothing above it carries the group keys — so they have to be merged here. Falls back to the
 * group context (prior behavior) if either isn't valid JSON.
 */
function mergeSerializedContexts(individual: string, group: string): string {
	try {
		return JSON.stringify({ ...JSON.parse(individual), ...JSON.parse(group) });
	} catch {
		return group;
	}
}

/**
 * Convert a GitLens `GitGraphRow` into the commit-graph's canonical topology + payload shape.
 * `idLength` carries `gitlens.advanced.abbreviatedShaLength` into the rendered `shortSha`.
 *
 * `pinnedRefId` mirrors the host's own `getPinnedRefId()` — it only participates in the ref contexts, and
 * only when they are built here rather than taken from the wire.
 */
export function toGraphCommit(
	row: GitGraphRow,
	idLength = 7,
	repoPath?: string,
	pinnedRefId?: string,
): GraphCommitView {
	// refGroups carries each grouped ref's refGROUP context (the "Hide" action), keyed by ref NAME. Seed it up
	// front so the single ref pass below can merge it onto each ref's own item context (see
	// `pillContextFor`) — grouped pills then expose both the ref actions and the refGroup actions.
	// Right-click context: prefer the host-serialized `contexts.row`; for lean commit rows (the host
	// now ships only `contexts.flags`, not the row blob — a perf change on main) reconstruct it from
	// the flags + repo path so the row context menu works. WIP/stash rows keep their host context.
	// The reconstruction (object build + JSON.stringify) applies to MOST rows and dominates this
	// bridge's cost at scale, so it resolves LAZILY on first read — only rows that actually render
	// (or get right-clicked) pay it; see the deferred property below.
	const rowContext = serializeContext(row.contexts?.row);
	const needsLazyRowContext = rowContext == null && repoPath != null && needsDynamicRowContext(row);
	let refContexts: Record<string, string> | undefined;
	const refGroups = row.contexts?.refGroups;
	if (refGroups) {
		for (const [name, ctx] of Object.entries(refGroups)) {
			const serialized = serializeContext(ctx);
			if (serialized == null) continue;

			refContexts ??= {};
			refContexts[name] = serialized;
		}
	}

	// Carry refs STRUCTURED (no flatten-to-token + re-parse): one pass over heads/remotes/tags builds
	// the GraphCommitRef list, preserving current/upstream/worktree/owner metadata, AND backfills any
	// per-ref context refGroups didn't already cover. The engine's `refs` token array stays `[]` (the
	// engine never reads it; nothing in the Lit path does either now).
	const commitRefs: GraphCommitRef[] = [];
	// Per-ref right-click context. Each ref's OWN item context is backfilled here, keyed by `kind:name`
	// so a tag and a same-named branch/remote on one commit don't inherit each other's context menu.
	// `pillContextFor` then merges it with the ref's refGROUP context (from `refContexts`, keyed by NAME)
	// when the ref is grouped, so a grouped pill exposes BOTH the branch/remote actions AND the refGroup
	// "Hide". `refContext` (the pure individual) stays separate for the branch sheet.
	let refContextsByKind: Record<string, string> | undefined;
	// The ref's own context is built HERE from the structured fields — the host does not serialize one,
	// and there is no fallback left to take: a snapshot written before the fields existed is discarded by
	// the schema-version check rather than restored half-shaped.
	const refState = pinnedRefId != null ? { pinnedRefId: pinnedRefId } : undefined;
	const setContext = (kind: string, name: string, serialized: string | undefined): void => {
		if (serialized == null) return;

		refContextsByKind ??= {};
		refContextsByKind[`${kind}:${name}`] = serialized;
	};
	const pillContextFor = (kind: string, name: string): string | undefined => {
		const individual = refContextsByKind?.[`${kind}:${name}`];
		const group = refContexts?.[name];
		if (group == null) return individual;
		if (individual == null) return group;
		return mergeSerializedContexts(individual, group);
	};

	for (const h of row.heads ?? []) {
		const headContext = repoPath != null ? serializeBranchRefContext(h, repoPath, refState) : undefined;
		setContext('head', h.name, headContext);
		commitRefs.push({
			kind: 'head',
			name: h.name,
			id: h.id,
			current: h.isCurrentHead,
			upstreamName: h.upstream?.name,
			upstreamId: h.upstream?.id,
			// The ordering tier and glyph mean "checked out in ANOTHER worktree" (see `sortRowRefs`), so
			// the default worktree's own checkout must NOT qualify.
			secondaryWorktreeId: h.worktree != null && !h.worktree.isDefault ? h.worktree.id : undefined,
			isDefault: h.isDefault,
			context: pillContextFor('head', h.name),
			refContext: headContext,
		});
	}
	for (const r of row.remotes ?? []) {
		const remoteContext = repoPath != null ? serializeRemoteBranchRefContext(r, repoPath, refState) : undefined;
		setContext('remote', r.name, remoteContext);
		commitRefs.push({
			kind: 'remote',
			name: r.name,
			id: r.id,
			owner: r.owner,
			current: r.current,
			isDefault: r.isDefault,
			hostingServiceType: r.hostingServiceType,
			context: pillContextFor('remote', r.name),
			refContext: remoteContext,
		});
	}
	for (const t of row.tags ?? []) {
		const tagContext = repoPath != null ? serializeTagRefContext(t, repoPath) : undefined;
		setContext('tag', t.name, tagContext);
		commitRefs.push({
			kind: 'tag',
			name: t.name,
			id: t.id,
			context: pillContextFor('tag', t.name),
			refContext: tagContext,
		});
	}

	// The producer's label, carried through unchanged — what the commit IS. Nothing re-derives merge-ness
	// from the parent count here: in first-parent mode a merge ships with one parent
	// (`git-cli/providers/graph.ts:873`) and re-deriving would report it as an ordinary commit to every
	// menu, glyph and screen reader. Anything that needs the topological question — how many parent edges
	// to lay out — asks `parents.length` directly, which is what the engine does.
	const kind: CommitKind = row.kind;

	// Inline row-action data, computed once here at the single git→view bridge (from the shared utils)
	// rather than per-render, so every consumer of the view row gets the same answer. For non-commit
	// rows these naturally resolve to false/undefined (no qualifying heads / flags).
	const { currentHead, worktreeHead } = pickRowUndoTarget(row.heads, rowHasChildren(row));
	const undo =
		currentHead != null || worktreeHead != null
			? { worktreePath: worktreeHead?.worktree?.path, branchName: worktreeHead?.name }
			: undefined;

	const view: GraphCommitView = {
		sha: row.sha,
		shortSha: row.sha.slice(0, Math.max(4, Math.min(40, idLength))),
		message: row.message,
		author: row.author,
		authorEmail: row.email,
		date: row.date,
		parents: row.parents,
		commitRefs: commitRefs,
		kind: kind,
		contextData: rowContext,
		refContexts: refContexts,
		isUnpublished: isUnpublishedRow(row),
		isUnpulled: isUnpulledRow(row),
		undo: undo,
	};
	if (needsLazyRowContext) {
		let resolved: string | undefined;
		Object.defineProperty(view, 'contextData', {
			enumerable: true,
			configurable: true,
			get: function (): string {
				resolved ??= serializeRowCommitContext(row, repoPath);
				return resolved;
			},
		});

		let resolvedAvatar: string | undefined;
		Object.defineProperty(view, 'avatarContextData', {
			enumerable: true,
			configurable: true,
			get: function (): string {
				resolvedAvatar ??= serializeRowAvatarContext(row, repoPath);
				return resolvedAvatar;
			},
		});
	}
	return view;
}
