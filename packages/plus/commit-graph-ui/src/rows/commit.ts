import type { ZoneId, ZoneSpec } from '@gitkraken/commit-graph/zones.js';
import { defaultZones } from '@gitkraken/commit-graph/zones.js';
import type { CommitGraphRef, CommitGraphView } from '../contracts/rows.js';
import type {
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
} from '../contracts/state.js';
import { getExcludedRemotes, refPillKey } from '../extensions/refs/pills.js';

export type GraphCommitRef = CommitGraphRef;
export type GraphCommitView = CommitGraphView;

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
	return ref.kind === 'remote' && (downstreams?.[downstreamKey(ref)]?.length ?? 0) > 0;
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
 *
 * The CLICK-pinned ref (transient focus) is deliberately NOT here: focusing a ref must not reorder the
 * row, so it never participates in the tier ladder below. It's applied at partition time instead
 * (`partitionRowRefs`' last-slot substitution) — see that function's doc comment.
 */
export interface RowRefOrder {
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

/** An in-sync remote is carried by its LOCAL: the two render as one combined pill, so promoting the
 *  remote alone would split it (`isUpstreamRemoteOf` needs the head second). Falls back to the ref
 *  itself when no local tracks it. */
function carrierFor(refs: readonly GraphCommitRef[], matched: GraphCommitRef | undefined): GraphCommitRef | undefined {
	if (matched?.kind !== 'remote') return matched;

	return refs.find(ref => ref.kind === 'head' && isUpstreamRemoteOf(matched, ref)) ?? matched;
}

/**
 * Order a row's refs for display, primary first: ref-find hit → current ref → edge-pinned → current
 * upstream → worktree ref → worktree upstream → default branch → local → remote → tag. Ties break on the
 * BARE name (numeric collation, so `v1.9.0` precedes `v1.10.0`) then the remote owner — never the
 * rendered label, so the order can't shift when the host's show-remote-names option toggles and same-named
 * remotes from different owners stay adjacent. The upstream tiers match a remote ref to the
 * current/worktree head's upstream; they (and the worktree/default tiers) activate as the host carries
 * `upstream` / `worktree` / a default flag (additive, legacy-safe) — until then those refs simply fall
 * through to local/remote/tag, which is what virtual/GitHub repos get since their provider ships none
 * of those fields.
 *
 * The current-upstream tier reads `order.currentUpstreamName` as well as the row's own current head,
 * because the row-local match only fires when HEAD and its upstream sit on the SAME commit (in sync).
 * The ref-find hit outranks the current checkout: only the primary pill is visible inline, and only it
 * takes the find fill, so a buried match would land with nothing to show. The CLICK pin is deliberately
 * NOT an ordering input here at all — focusing a ref must not reorder the row, so it never ranks; it's
 * applied at partition time instead (`partitionRowRefs`' last-slot substitution).
 *
 * Shared by the ref pill (`refAdornmentProvider`) and the lane-tip ghost ref so the two can't name
 * different branches for the same row.
 */
export function sortRowRefs(refs: readonly GraphCommitRef[], order?: RowRefOrder): GraphCommitRef[] {
	if (refs.length < 2) return refs.slice();

	const currentHead = refs.find(ref => ref.kind === 'head' && ref.current);
	const worktreeHeads = refs.filter(ref => ref.kind === 'head' && ref.secondaryWorktreeId != null);
	// A ref-find hit landing on a remote that's the in-sync upstream of a local head HERE ranks the pair by
	// its LOCAL, for the same reason as the edge pin below: the two render as one combined pill, so
	// promoting the remote alone would split it in two. The find fill still lands on the matched remote —
	// the combined pill's upstream segment.
	const findHit =
		order?.findHitRefKey != null ? refs.find(ref => refPillKey(ref) === order.findHitRefKey) : undefined;
	const findHitCarrier = carrierFor(refs, findHit);
	// An edge pin landing on a remote that's the in-sync upstream of a local head HERE ranks the pair by its
	// LOCAL: the two render as one combined pill, so promoting the remote alone would split it in two and the
	// absorbed remote could never be matched back (`isUpstreamRemoteOf` needs the head second). The pin still
	// shows — on that pill's upstream segment, which IS the pinned remote.
	const edgePinned = order?.pinnedRefId != null ? refs.find(ref => ref.id === order.pinnedRefId) : undefined;
	const edgePinCarrier = carrierFor(refs, edgePinned);
	const tier = (ref: GraphCommitRef): number => {
		// Either pin (edge here; the click pin is NOT an ordering input at all — see the doc comment above)
		// can land on a head OR a remote, so it straddles the kind switch below.
		if (findHitCarrier != null && ref === findHitCarrier) return 0; // ref-find hit
		if (ref.kind === 'head' && ref.current) return 1; // the current checkout
		if (edgePinCarrier != null && ref === edgePinCarrier) return 2; // pinned to the edge
		if (ref.kind === 'head') {
			if (ref.secondaryWorktreeId != null) return 4; // checked out in another worktree
			if (ref.isDefault) return 6; // the repo's default branch
			return 7; // local branch
		}
		if (ref.kind === 'remote') {
			// The row-local match covers an in-sync HEAD (its local pill is right here); the name match
			// covers every other row — which is all of them once HEAD is ahead of or behind its upstream.
			if (isUpstreamRemoteOf(ref, currentHead)) return 3; // upstream of the current branch
			if (order?.currentUpstreamName != null && remoteFullName(ref) === order.currentUpstreamName) return 3;
			if (worktreeHeads.some(head => isUpstreamRemoteOf(ref, head))) return 5; // upstream of a worktree branch
			if (ref.isDefault) return 6; // the repo's default branch (remote-only — no local checkout)
			return 8; // remote branch
		}

		return 9; // tag
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

	const visible = refs.filter(ref => !isRefHidden(ref, excludeTypes, excludeRefs, downstreams));
	return visible.length === 0 ? undefined : sortRowRefs(visible, order)[0];
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
	const defaultsById = new Map<ZoneId, ZoneSpec>(defaultZones.map(zone => [zone.id, zone]));
	const output: ZoneSpec[] = [];
	for (const [name, column] of Object.entries(columns)) {
		const defaults = defaultsById.get(name as ZoneId);
		if (defaults == null) continue;

		output.push({
			...defaults,
			width: typeof column.width === 'number' && column.width > 0 ? column.width : defaults.width,
			hidden: column.isHidden === true,
			mode: column.mode ?? defaults.mode,
		});
	}
	const columnMap = columns as Record<string, { order?: number } | undefined>;
	output.sort((a, b) => (columnMap[a.id]?.order ?? 0) - (columnMap[b.id]?.order ?? 0));
	return output;
}

/** Build a GitLens `GraphColumnsConfig` from a commit-graph `ZoneSpec[]` (for persistence). */
export function zonesToColumnsConfig(zones: readonly ZoneSpec[]): GraphColumnsConfig {
	const output: GraphColumnsConfig = {};
	for (let i = 0; i < zones.length; i++) {
		const zone = zones[i];
		output[zone.id] = {
			width: zone.width,
			isHidden: zone.hidden,
			mode: zone.mode,
			order: i,
		};
	}
	return output;
}
