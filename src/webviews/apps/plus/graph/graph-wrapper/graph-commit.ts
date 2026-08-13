import type { CommitKind, GraphCommit } from '@gitkraken/commit-graph/engine/types.js';
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
import { getExcludedRemotes } from '../hiddenRefs.utils.js';
import {
	serializeBranchRefContext,
	serializeRemoteBranchRefContext,
	serializeTagRefContext,
} from '../utils/refContext.utils.js';
import { refPillKey } from '../utils/refKey.utils.js';
import { pickRowUndoTarget } from '../utils/row.utils.js';
import {
	isUnpublishedRow,
	isUnpulledRow,
	needsDynamicRowContext,
	rowHasChildren,
	serializeRowAvatarContext,
	serializeRowCommitContext,
} from '../utils/rowContext.utils.js';

/**
 * Lit-free data-shaping helpers shared by the graph host, its adornment providers, and the
 * scroll-marker builder: GitLens `GitGraphRow` → commit-graph `GraphCommit`, and persisted
 * `GraphColumnsSettings` ↔ engine `ZoneSpec[]`. Kept out of the element so every consumer shapes
 * rows the same way and the conversions stay unit-testable without a DOM.
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
	/** Set only when the branch is checked out in a worktree OTHER than the default one — the
	 *  ref-ordering tier and the worktree glyph both mean "checked out elsewhere". */
	secondaryWorktreeId?: string;
	/** True when this head is the repo's default branch. */
	isDefault?: boolean;
	/** Remote-only: the hosting provider, when known — drives the ref pill's provider icon. */
	hostingServiceType?: GkProviderId;
	/** JSON-stringified `data-vscode-context` for this ref's pill (right-click menu). For a grouped ref
	 *  this MERGES the ref's own item context (`webviewItem…`) with its refGROUP context
	 *  (`webviewItemGroup…`) so the pill exposes BOTH the branch/remote actions AND the refGroup's "Hide"
	 *  (`gitlens.graph.hideRefGroup`) — the pill
	 *  is a single element, so there's no wrapper to carry the group keys separately. */
	context?: string;
	/** The ref's INDIVIDUAL serialized context — never the refGROUP keys `context` may also carry for
	 *  grouped refs. The branch sheet's kebab + action links need row-menu parity for THIS ref
	 *  (the `webviewItemGroup` keys yield only the refGroup "Hide" and no-op the ref-scoped command links). */
	refContext?: string;
}

export interface GraphCommitView extends GraphCommit {
	/** Structured refs (replaces the engine's flattened `refs` token strings, which stay `[]`). */
	commitRefs: GraphCommitRef[];
	/** Commit/merge-only: the commit is ahead of HEAD's upstream — drives the at-rest Push-to-Commit
	 *  indicator (the colorized unpushed badge). False for WIP/stash rows. */
	isUnpublished: boolean;
	/** Commit/merge-only: the commit is on HEAD's upstream but not on HEAD — drives the at-rest unpulled
	 *  indicator (the read-only mirror of the unpushed badge). False for WIP/stash rows. */
	isUnpulled: boolean;
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
 * Whether a ref pill/scroll-marker should be hidden by the active visibility filters. The current HEAD
 * branch is ALWAYS kept; otherwise a ref is hidden when it's listed by id (`excludeRefs`), its remote is
 * wildcard-hidden via a whole-remote "Hide Remote" entry (`type: 'remote'`, `name: '*'` — see
 * `getExcludedRemotes`) and it isn't in that wildcard's exception list, or its type is excluded
 * (`excludeTypes`) — EXCEPT a remote that's a tracked upstream survives the type-level "Hide Remote
 * Branches" toggle (hiding it would silently break the split-pill's upstream segment). The
 * tracked-upstream exception applies ONLY to that type-level toggle: a whole-remote wildcard hides every
 * non-excepted ref of that remote, tracked upstreams included. Label-level only — commit rows are never
 * removed by this (stash-ROW hiding via `excludeTypes.stashes` is handled separately on the row set).
 */
export function isRefHidden(
	ref: GraphCommitRef,
	excludeTypes: GraphExcludeTypes | undefined,
	excludeRefs: GraphExcludeRefs | undefined,
	downstreams?: GraphDownstreams,
): boolean {
	if (ref.kind === 'head' && ref.current) return false;
	if (ref.id != null && excludeRefs?.[ref.id] != null) return true;
	if (ref.kind === 'remote' && ref.owner != null) {
		const excludedRemote = getExcludedRemotes(excludeRefs)?.get(ref.owner);
		if (excludedRemote != null && (ref.id == null || !excludedRemote.exceptIds.has(ref.id))) return true;
	}
	if (excludeTypes?.[excludeKindKey(ref.kind)] !== true) return false;

	return ref.kind !== 'remote' || !isTrackedUpstream(ref, downstreams);
}

/** A remote ref's full `owner/name` — what an upstream is named by (`origin/main`). */
function remoteFullName(ref: GraphCommitRef): string {
	return ref.owner != null ? `${ref.owner}/${ref.name}` : ref.name;
}

/**
 * True when `remote` is the upstream that `head` tracks. Prefers the exact ref-id match (a local and
 * its remote share a `name`, so the id disambiguates); falls back to the full `owner/name` for legacy
 * rows that don't carry ids, and finally — only for a head with NO upstream configured at all — to a
 * bare name match. That last fallback pairs an untracked local with a same-named remote sitting on the
 * SAME commit (so they're in sync by definition) into one pill instead of two, matching the legacy
 * engine's name-keyed grouping. Configured tracking always wins, so a local tracking `upstream/foo` is
 * never hijacked by a co-located `origin/foo`.
 */
export function isUpstreamRemoteOf(remote: GraphCommitRef, head: GraphCommitRef | undefined): boolean {
	if (head == null || remote.kind !== 'remote' || head.kind !== 'head') return false;
	if (head.upstreamId != null && remote.id != null) return head.upstreamId === remote.id;
	if (head.upstreamName != null) {
		return head.upstreamName === remoteFullName(remote) || head.upstreamName === remote.name;
	}

	return head.upstreamId == null && remote.name === head.name;
}

/**
 * The order inputs that are NOT ref data — runtime state a row can't know about on its own. Held as
 * one object rebuilt only when an input changes, so the per-row calls allocate nothing and consumers
 * can invalidate their projection caches on identity alone.
 */
export interface RowRefOrder {
	/** `refPillKey` of the CLICK-pinned ref (transient focus). */
	pinnedRefKey?: string;
	/** `id` of the ref pinned to the EDGE (persisted host state). */
	pinnedRefId?: string;
	/** `refPillKey` of the ref the ref-find widget landed on. Ranks like a pin: only the PRIMARY pill is
	 *  visible inline and only it takes the find fill, so a buried match would land with nothing to show. */
	findHitRefKey?: string;
	/** Full `owner/name` of the current branch's upstream (`branchState.upstream`). Ranks that remote
	 *  even on rows the local HEAD pill ISN'T on — i.e. whenever HEAD is ahead of or behind it, which
	 *  is precisely when the two land on different rows. */
	currentUpstreamName?: string;
}

/**
 * Order a row's refs for display, primary first: click-pinned → ref-find hit → current ref → edge-pinned
 * → current upstream → worktree ref → worktree upstream → default branch → local → remote → tag. Ties
 * break on the BARE name (numeric collation, so `v1.9.0` precedes `v1.10.0`) then the remote owner —
 * never the rendered label, so the order can't shift when `gitlens.graph.showRemoteNames` toggles and
 * same-named remotes from different owners stay adjacent. The upstream tiers match a remote ref to the
 * current/worktree head's upstream; they (and the worktree/default tiers) activate as the host carries
 * `upstream` / `worktree` / a default flag (additive, legacy-safe) — until then those refs simply fall
 * through to local/remote/tag, which is what virtual/GitHub repos get since their provider ships none
 * of those fields.
 *
 * The current-upstream tier reads `order.currentUpstreamName` as well as the row's own current head,
 * because the row-local match only fires when HEAD and its upstream sit on the SAME commit (in sync).
 * The click pin outranks the ref-find hit and the current checkout — it's an explicit, transient focus
 * act, and only the PRIMARY pill carries `.is-pinned`, so burying it would leave the click with no
 * visible effect. The ref-find hit in turn outranks the current checkout for the same reason: only the
 * primary pill is visible inline, and only it takes the find fill.
 *
 * Shared by the ref pill (`refAdornmentProvider`) and the lane-tip ghost ref so the two can't name
 * different branches for the same row.
 */
/** An in-sync remote is carried by its LOCAL: the two render as one combined pill, so promoting the
 *  remote alone would split it (`isUpstreamRemoteOf` needs the head second). Falls back to the ref
 *  itself when no local tracks it. */
function carrierFor(refs: readonly GraphCommitRef[], matched: GraphCommitRef | undefined): GraphCommitRef | undefined {
	if (matched?.kind !== 'remote') return matched;

	return refs.find(r => r.kind === 'head' && isUpstreamRemoteOf(matched, r)) ?? matched;
}

export function sortRowRefs(refs: readonly GraphCommitRef[], order?: RowRefOrder): GraphCommitRef[] {
	if (refs.length < 2) return refs.slice();

	const currentHead = refs.find(r => r.kind === 'head' && r.current);
	const worktreeHeads = refs.filter(r => r.kind === 'head' && r.secondaryWorktreeId != null);
	// A ref-find hit landing on a remote that's the in-sync upstream of a local head HERE ranks the pair by
	// its LOCAL, for the same reason as the edge pin below: the two render as one combined pill, so
	// promoting the remote alone would split it in two. The find fill still lands on the matched remote —
	// the combined pill's upstream segment.
	const findHit = order?.findHitRefKey != null ? refs.find(r => refPillKey(r) === order.findHitRefKey) : undefined;
	const findHitCarrier = carrierFor(refs, findHit);
	// An edge pin landing on a remote that's the in-sync upstream of a local head HERE ranks the pair by its
	// LOCAL: the two render as one combined pill, so promoting the remote alone would split it in two and the
	// absorbed remote could never be matched back (`isUpstreamRemoteOf` needs the head second). The pin still
	// shows — on that pill's upstream segment, which IS the pinned remote.
	const edgePinned = order?.pinnedRefId != null ? refs.find(r => r.id === order.pinnedRefId) : undefined;
	const edgePinCarrier = carrierFor(refs, edgePinned);
	const tier = (r: GraphCommitRef): number => {
		// Either pin can land on a head OR a remote, so both straddle the kind switch below. Click before
		// edge: it's the more recent, explicitly-expressed intent when a row carries both.
		if (order?.pinnedRefKey != null && refPillKey(r) === order.pinnedRefKey) return 0; // click-pinned
		if (findHitCarrier != null && r === findHitCarrier) return 1; // ref-find hit
		if (r.kind === 'head' && r.current) return 2; // the current checkout
		if (edgePinCarrier != null && r === edgePinCarrier) return 3; // pinned to the edge
		if (r.kind === 'head') {
			if (r.secondaryWorktreeId != null) return 5; // checked out in another worktree
			if (r.isDefault) return 7; // the repo's default branch
			return 8; // local branch
		}
		if (r.kind === 'remote') {
			// The row-local match covers an in-sync HEAD (its local pill is right here); the name match
			// covers every other row — which is all of them once HEAD is ahead of or behind its upstream.
			if (isUpstreamRemoteOf(r, currentHead)) return 4; // upstream of the current branch
			if (order?.currentUpstreamName != null && remoteFullName(r) === order.currentUpstreamName) return 4;
			if (worktreeHeads.some(h => isUpstreamRemoteOf(r, h))) return 6; // upstream of a worktree branch
			if (r.isDefault) return 7; // the repo's default branch (remote-only — no local checkout)
			return 9; // remote branch
		}

		return 10; // tag
	};

	return refs.toSorted(
		(a, b) =>
			tier(a) - tier(b) ||
			a.name.localeCompare(b.name, undefined, { numeric: true }) ||
			(a.owner ?? '').localeCompare(b.owner ?? ''),
	);
}

/**
 * Picks the ghost-ref pill's primary ref from a lane-tip commit's refs — the SAME `sortRowRefs` ranking
 * the row's ref pill uses, so the ghost label and the pill can never name different branches. Hidden
 * refs (Hide Branch / Hide Remotes·Tags·Stashes) are skipped so the ghost never surfaces a ref the user
 * explicitly hid. Returns `undefined` when the tip has no visible ref at all — the caller never falls
 * back to a sha.
 */
export function pickGhostRef(
	refs: readonly GraphCommitRef[] | undefined,
	excludeTypes: GraphExcludeTypes | undefined,
	excludeRefs: GraphExcludeRefs | undefined,
	downstreams: GraphDownstreams | undefined,
	order?: RowRefOrder,
): GraphCommitRef | undefined {
	if (refs == null || refs.length === 0) return undefined;

	const visible = refs.filter(r => !isRefHidden(r, excludeTypes, excludeRefs, downstreams));
	if (visible.length === 0) return undefined;

	return sortRowRefs(visible, order)[0];
}

/**
 * Translate persisted GitLens column settings into a commit-graph `ZoneSpec[]` overlay (sorted by
 * the host-supplied `order`). Returns `undefined` when there are no persisted columns.
 */
export function columnsToZones(columns: GraphColumnsSettings | undefined): readonly ZoneSpec[] | undefined {
	if (columns == null || Object.keys(columns).length === 0) return undefined;

	// Spread the matching defaultZones entry so the human label, minWidth, and flex flag are
	// preserved (the persisted settings only carry width / hidden / mode / order). Zeroing minWidth
	// here previously let fixed columns shrink to nothing in narrow panes.
	// Persisted column keys ARE the engine's zone ids (both use `ref`/`author`/`datetime`/`message`/
	// `changes`/`sha`), so they map across directly — no name translation. `graph` is the only
	// remaining non-zone key (the gutter, not a content column) and has no matching default, so it's
	// skipped here.
	const defaultsById = new Map<ZoneId, ZoneSpec>(defaultZones.map(z => [z.id, z]));
	const out: ZoneSpec[] = [];
	for (const [name, c] of Object.entries(columns)) {
		const d = defaultsById.get(name as ZoneId);
		if (d == null) continue;

		out.push({
			...d,
			width: typeof c.width === 'number' && c.width > 0 ? c.width : d.width,
			hidden: c.isHidden === true,
			mode: c.mode ?? d.mode,
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
			mode: z.mode,
			order: i,
		};
	}
	return out;
}
