import type { GraphCommit } from '@gitkraken/commit-graph/engine/types.js';
import type { ZoneId, ZoneSpec } from '@gitkraken/commit-graph/view.js';
import { defaultZones } from '@gitkraken/commit-graph/view.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import type { GkProviderId } from '@gitlens/git/models/repositoryIdentities.js';
import type {
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
} from '../../../../plus/graph/protocol.js';
import { pickRowUndoTarget } from '../utils/row.utils.js';
import {
	isUnpublishedRow,
	needsDynamicRowContext,
	rowHasChildren,
	serializeRowAvatarContext,
	serializeRowCommitContext,
} from '../utils/rowContext.utils.js';

/**
 * Framework-agnostic data-shaping helpers shared by the Lit graph host: GitLens `GitGraphRow`
 * → commit-graph `GraphCommit` conversion and the legacy `GraphZoneType` ↔ commit-graph `ZoneId`
 * column-name translation. Lifted verbatim from the React adapter (`gl-lit-graph.react.tsx`)
 * so the engine sees identical input and persisted column settings stay interoperable.
 */

/**
 * A row's ref carried STRUCTURED (not flattened to a git-log token string + re-parsed). Built once
 * in `toGraphCommit` straight from the rich `GitGraphRow.heads/remotes/tags`, preserving the metadata
 * the ref pill + scroll markers need (current checkout, upstream, worktree, remote owner) so the
 * primary-ref ordering is exact and there's no lossy tokenize↔re-parse round-trip.
 */
export interface GraphCommitRef {
	kind: 'head' | 'remote' | 'tag';
	name: string;
	/** Stable ref id (e.g. `<repo>|heads/main`) — keys `refsMetadata` (ahead/behind) and locates the
	 * ref's row for the split-pill jump. */
	id?: string;
	/** Head checked out as the current branch (HEAD), or the current remote. */
	current?: boolean;
	/** Remote owner (e.g. `origin`). */
	owner?: string;
	/** The head's upstream branch identifier (for the upstream ordering tiers). */
	upstreamName?: string;
	/** A head's upstream ref id (e.g. `<repo>|remotes/origin/main`) — links a local branch to the
	 * remote it tracks (matched against a remote ref's `id` to find + jump to its row). */
	upstreamId?: string;
	/** Set when this head is checked out in another worktree (for the worktree ordering tiers). */
	worktreeId?: string;
	/** True when this head is the repo's default branch. */
	isDefault?: boolean;
	/** Remote-only: the hosting provider, when known — drives the ref pill's provider icon. */
	hostingServiceType?: GkProviderId;
	/** JSON-stringified `data-vscode-context` for this ref's pill (right-click menu). */
	context?: string;
	/** The ref's INDIVIDUAL serialized context — never the refGROUP one `context` may carry for
	 *  grouped refs. The branch sheet's kebab + action links need row-menu parity for THIS ref
	 *  (a group context yields the "Hide All" menu and no-ops the ref-scoped command links). */
	refContext?: string;
}

export interface GraphCommitView extends GraphCommit {
	type: GitGraphRow['type'];
	/** Structured refs (replaces the engine's flattened `refs` token strings, which stay `[]`). */
	commitRefs: GraphCommitRef[];
	/** Commit/merge-only: the commit is ahead of HEAD's upstream — drives the at-rest Push-to-Commit
	 *  indicator (the colorized unpushed badge). False for WIP/stash rows. */
	isUnpublished: boolean;
	/** Resolved Undo Commit target for a leaf tip (active or single owning worktree), when undo is
	 *  offered. `worktreePath`/`branchName` are set only when a non-active worktree owns the tip; an
	 *  active-worktree HEAD yields an empty object (undo targets the active workspace). `undefined`
	 *  when undo doesn't apply (non-leaf, no qualifying head, or non-commit row). */
	undo?: { worktreePath?: string; branchName?: string };
	/** Right-click context for the author avatar zone (contributor menu), lazily resolved same as
	 *  {@link contextData} — set only for rows that need a dynamically-reconstructed context. Stamped
	 *  directly on the avatar element so it's NEARER than the row's own `contextData` and wins there. */
	avatarVscodeContext?: string;
}

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
 * Convert a GitLens `GitGraphRow` into the commit-graph `GraphCommit` shape `processCommits` expects.
 * `idLength` carries `gitlens.advanced.abbreviatedShaLength` into the rendered `shortHash`.
 */
export function toGraphCommit(row: GitGraphRow, idLength = 7, repoPath?: string): GraphCommitView {
	// refGroups is the authoritative per-ref context source when the row ships it; the per-ref
	// `context`/`contextGroup` fields are the fallback. Seed it up front so the single ref pass
	// below can skip the backfill for any ref the map already covers.
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
	// Per-ref right-click context. The host's `refGroups` (keyed by ref NAME) is the authoritative
	// override; otherwise backfill from each ref's own `context`/`contextGroup`, keyed by `kind:name`
	// so a tag and a same-named branch/remote on one commit don't inherit each other's context menu.
	let refContextsByKind: Record<string, string> | undefined;
	const addContext = (kind: string, name: string, ref: { context?: unknown; contextGroup?: unknown }): void => {
		if (refContexts?.[name] != null) return;

		const serialized = serializeContext(ref.context) ?? serializeContext(ref.contextGroup);
		if (serialized == null) return;

		refContextsByKind ??= {};
		refContextsByKind[`${kind}:${name}`] = serialized;
	};
	const contextFor = (kind: string, name: string): string | undefined =>
		refContexts?.[name] ?? refContextsByKind?.[`${kind}:${name}`];

	for (const h of row.heads ?? []) {
		addContext('head', h.name, h);
		commitRefs.push({
			kind: 'head',
			name: h.name,
			id: h.id,
			current: h.isCurrentHead,
			upstreamName: h.upstream?.name,
			upstreamId: h.upstream?.id,
			worktreeId: h.worktreeId,
			isDefault: h.isDefault,
			context: contextFor('head', h.name),
			refContext: serializeContext(h.context),
		});
	}
	for (const r of row.remotes ?? []) {
		addContext('remote', r.name, r);
		commitRefs.push({
			kind: 'remote',
			name: r.name,
			id: r.id,
			owner: r.owner,
			current: r.current,
			isDefault: r.isDefault,
			hostingServiceType: r.hostingServiceType,
			context: contextFor('remote', r.name),
			refContext: serializeContext(r.context),
		});
	}
	for (const t of row.tags ?? []) {
		addContext('tag', t.name, t);
		commitRefs.push({
			kind: 'tag',
			name: t.name,
			id: t.id,
			context: contextFor('tag', t.name),
			refContext: serializeContext(t.context),
		});
	}

	const kind: 'commit' | 'merge' | 'stash' | 'workdir' =
		row.type === 'work-dir-changes' || row.type === 'merge-conflict-node'
			? 'workdir'
			: row.type === 'stash-node'
				? 'stash'
				: row.parents.length > 1
					? 'merge'
					: 'commit';

	// Inline row-action data, computed at the single git→view bridge (mirrors the legacy React
	// adornment's per-row logic via the SAME shared utils, so the two surfaces can't drift). For
	// non-commit rows these naturally resolve to false/undefined (no qualifying heads / flags).
	const { currentHead, worktreeHead } = pickRowUndoTarget(row.heads, rowHasChildren(row));
	const undo =
		currentHead != null || worktreeHead != null
			? { worktreePath: worktreeHead?.worktree?.path, branchName: worktreeHead?.name }
			: undefined;

	const view: GraphCommitView = {
		hash: row.sha,
		shortHash: row.sha.slice(0, Math.max(4, Math.min(40, idLength))),
		message: row.message,
		author: row.author,
		authorEmail: row.email,
		date: row.date,
		parents: row.parents,
		refs: [],
		commitRefs: commitRefs,
		kind: kind,
		type: row.type,
		contextData: rowContext,
		refContexts: refContexts,
		isUnpublished: isUnpublishedRow(row),
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
		Object.defineProperty(view, 'avatarVscodeContext', {
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

/** Map a ref's kind onto its `ExcludeByType` flag key (`head`→`heads`, `remote`→`remotes`, `tag`→`tags`). */
function excludeKindKey(kind: GraphCommitRef['kind']): keyof GraphExcludeTypes {
	return kind === 'head' ? 'heads' : kind === 'remote' ? 'remotes' : 'tags';
}

/** Key format matching packages/git-cli's `downstreamMap`: `${remoteOwner}/${branchName}` — the same
 *  string a local branch's `upstream.name` carries (e.g. `origin/main`). */
function downstreamKey(ref: Pick<GraphCommitRef, 'owner' | 'name'>): string {
	return `${ref.owner ?? ''}/${ref.name}`;
}

/** True when a remote ref is the tracked upstream of at least one local branch (a non-empty
 *  `downstreams` entry) — excepts it from the "Hide Remote Branches" type filter and flags the
 *  scroll-rail `upstream` marker. */
export function isTrackedUpstream(ref: GraphCommitRef, downstreams: GraphDownstreams | undefined): boolean {
	if (downstreams == null || ref.kind !== 'remote') return false;

	return (downstreams[downstreamKey(ref)]?.length ?? 0) > 0;
}

/**
 * Whether a ref pill/scroll-marker should be hidden by the active visibility filters. Mirrors the
 * legacy engine's `getFilteredHeads/RemotesForGraphRow`: the current HEAD branch is ALWAYS kept;
 * otherwise a ref is hidden when it's listed by id (`excludeRefs`) or its type is excluded
 * (`excludeTypes`) — EXCEPT a remote that's a tracked upstream survives the type-level "Hide Remote
 * Branches" toggle (hiding it would silently break the split-pill's upstream segment). Label-level
 * only — commit rows are never removed by this (stash-ROW hiding via `excludeTypes.stashes` is
 * handled separately on the row set).
 */
export function isRefHidden(
	ref: GraphCommitRef,
	excludeTypes: GraphExcludeTypes | undefined,
	excludeRefs: GraphExcludeRefs | undefined,
	downstreams?: GraphDownstreams,
): boolean {
	if (ref.kind === 'head' && ref.current) return false;
	if (ref.id != null && excludeRefs?.[ref.id] != null) return true;
	if (excludeTypes?.[excludeKindKey(ref.kind)] !== true) return false;

	return ref.kind !== 'remote' || !isTrackedUpstream(ref, downstreams);
}

/**
 * Picks the ghost-ref pill's primary ref from a lane-tip commit's refs: prefers a local head, then a
 * remote, then a tag (first match per kind — commitRefs already lists heads/remotes/tags in that
 * order). Hidden refs (Hide Branch / Hide Remotes·Tags·Stashes) are skipped so the ghost never
 * surfaces a ref the user explicitly hid. Returns `undefined` when the tip has no visible ref at all —
 * the caller never falls back to a sha.
 */
export function pickGhostRef(
	refs: readonly GraphCommitRef[] | undefined,
	excludeTypes: GraphExcludeTypes | undefined,
	excludeRefs: GraphExcludeRefs | undefined,
	downstreams: GraphDownstreams | undefined,
): GraphCommitRef | undefined {
	if (refs == null || refs.length === 0) return undefined;

	let head: GraphCommitRef | undefined;
	let remote: GraphCommitRef | undefined;
	let tag: GraphCommitRef | undefined;
	for (const r of refs) {
		if (isRefHidden(r, excludeTypes, excludeRefs, downstreams)) continue;

		if (r.kind === 'head') {
			head ??= r;
		} else if (r.kind === 'remote') {
			remote ??= r;
		} else {
			tag ??= r;
		}
	}
	return head ?? remote ?? tag;
}

/**
 * Translate persisted GitLens column settings into a commit-graph `ZoneSpec[]` overlay (sorted by
 * the host-supplied `order`). Returns `undefined` when there are no persisted columns.
 */
export function columnsToZones(columns: GraphColumnsSettings | undefined): readonly ZoneSpec[] | undefined {
	if (columns == null || Object.keys(columns).length === 0) return undefined;

	// Spread the matching defaultZones entry so the human label, minWidth, and flex flag are
	// preserved (the persisted settings only carry width / hidden / order). Zeroing minWidth
	// here previously let fixed columns shrink to nothing in narrow panes.
	// Persisted column keys ARE the engine's zone ids (both use `ref`/`author`/`datetime`/`message`/`sha`),
	// so they map across directly — no name translation. Unknown keys (e.g. a legacy `graph`/`changes`
	// column) have no matching default and are skipped.
	const defaultsById = new Map<ZoneId, ZoneSpec>(defaultZones.map(z => [z.id, z]));
	const out: ZoneSpec[] = [];
	for (const [name, c] of Object.entries(columns)) {
		const d = defaultsById.get(name as ZoneId);
		if (d == null) continue;

		out.push({
			...d,
			width: typeof c.width === 'number' && c.width > 0 ? c.width : d.width,
			hidden: c.isHidden === true,
		});
	}
	const colMap = columns as Record<string, { order?: number } | undefined>;
	out.sort((a, b) => {
		const ao = colMap[a.id]?.order ?? 0;
		const bo = colMap[b.id]?.order ?? 0;
		return ao - bo;
	});
	return out;
}

/** Build a GitLens `GraphColumnsConfig` from a commit-graph `ZoneSpec[]` (for persistence). */
export function zonesToColumnsConfig(zones: readonly ZoneSpec[]): GraphColumnsConfig {
	const out: GraphColumnsConfig = {};
	for (let i = 0; i < zones.length; i++) {
		const z = zones[i];
		out[z.id] = {
			width: z.width,
			isHidden: z.hidden,
			order: i,
		};
	}
	return out;
}
