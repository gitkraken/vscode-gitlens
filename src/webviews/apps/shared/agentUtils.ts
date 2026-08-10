import type { PastAgentSessionsResult } from '../../../agents/models/agentSessionState.js';
import type { AgentSessionPhase } from '../../../agents/provider.js';
import { createCommandLink } from '../../../system/commands.js';
import type { AgentSessionState } from '../../home/protocol.js';
import type { OverviewBranch } from '../../shared/overviewBranches.js';

const phaseRank: Record<AgentSessionPhase, number> = {
	waiting: 0,
	working: 1,
	idle: 2,
	// Terminal sessions sort last so live agents always lead the list.
	completed: 3,
};

export type AgentSessionCategory = 'working' | 'needs-input' | 'idle' | 'completed';

export const agentPhaseToCategory: Record<AgentSessionPhase, AgentSessionCategory> = {
	working: 'working',
	waiting: 'needs-input',
	idle: 'idle',
	completed: 'completed',
};

/** Whether a surface may offer Allow / Deny for this session's ask.
 *
 *  An unresolvable ask is still *shown* — the user needs to know what the agent is waiting on — but
 *  must not be offered actions: `resolvePermission` holds no blocking hook entry to route, so the
 *  buttons would dead-end. `resolvable` is optional and undefined means resolvable, the common case,
 *  so this tests `!== false` rather than truthiness. */
export function canResolvePermission(
	category: AgentSessionCategory,
	permission: AgentSessionState['pendingPermission'],
): permission is NonNullable<AgentSessionState['pendingPermission']> {
	return category === 'needs-input' && permission != null && permission.resolvable !== false;
}

export function getAgentCategoryLabel(category: AgentSessionCategory): string {
	switch (category) {
		case 'needs-input':
			return 'Needs input';
		case 'working':
			return 'Working';
		case 'idle':
			return 'Idle';
		case 'completed':
			return 'Completed';
	}
}

/** Corner-badge glyph overlaid on the `robot` identity icon. `idle` has no badge — the bare robot
 *  in its color carries the meaning. Shared by the graph's WIP row indicator and the file tree's
 *  agent decoration so both read the same. Callers holding an `AgentSessionPhase` must map through
 *  {@link agentPhaseToCategory} first (`waiting` → `needs-input`). Pair `working`'s `sync` with
 *  `modifier="spin"`. */
export function agentSuffixIconFor(category: AgentSessionCategory): string | undefined {
	switch (category) {
		case 'needs-input':
			return 'warning';
		case 'working':
			return 'sync';
		case 'idle':
			return undefined;
		case 'completed':
			return 'pass';
	}
}

/** The "open" affordance for an agent session — `Open Session` for every live phase, `Resume
 *  Session` for a completed one that has a directory to resume into. */
export type AgentSessionOpenAction =
	| {
			label: 'Open Session';
			icon: 'link-external';
			command: 'gitlens.agents.openSession';
			/** Args exactly as the command receives them — the sidebar passes this array straight
			 *  through; the href surfaces feed `args[0]` to `createCommandLink`. */
			args: [string];
	  }
	| {
			label: 'Resume Session';
			icon: 'debug-restart';
			command: 'gitlens.agents.resumeSession';
			args: [{ sessionId: string; cwd: string }];
	  };

/** Picks between `Open Session` (there's a live process to attach to) and `Resume Session`
 *  (the process is gone, but the transcript can be replayed into a fresh one). Only a completed
 *  session with a resolvable cwd gets `Resume Session` — a completed session with nowhere to
 *  resume from has nothing to offer but the openSession modal's terminal fallback.
 *
 *  cwd resolution mirrors {@link toResumableSessionRef}'s cascade (`claudeResume.ts`): live `cwd`
 *  wins over `initialCwd` because Claude migrates the transcript file to follow the session's
 *  current directory, not its launch directory. */
export function getAgentSessionOpenAction(session: AgentSessionState): AgentSessionOpenAction {
	if (session.phase === 'completed') {
		const cwd = session.cwd ?? session.initialCwd ?? session.worktreePath ?? session.workspacePath;
		if (cwd != null) {
			return {
				label: 'Resume Session',
				icon: 'debug-restart',
				command: 'gitlens.agents.resumeSession',
				args: [{ sessionId: session.id, cwd: cwd }],
			};
		}
	}

	return { label: 'Open Session', icon: 'link-external', command: 'gitlens.agents.openSession', args: [session.id] };
}

/** `createCommandLink` form of {@link getAgentSessionOpenAction}, for `href=` surfaces. The two
 *  commands take asymmetric arg shapes: openSession's existing link form passes the session id as
 *  a bare JSON-stringified string, while resumeSession passes the `{ sessionId, cwd }` object
 *  directly (see `gl-details-agent-status.ts`'s past-row resume chip). */
export function createAgentSessionOpenHref(session: AgentSessionState): string {
	const action = getAgentSessionOpenAction(session);
	if (action.command === 'gitlens.agents.resumeSession') return createCommandLink(action.command, action.args[0]);

	// A bare string reaches the command link unquoted, which isn't valid JSON for the arg parser.
	return createCommandLink(action.command, JSON.stringify(action.args[0]));
}

/** Kind-aware label for a needs-input phase. Surfaces "Plan ready" / "Question" / "Input needed"
 *  / "Permission" on chips, card phase labels, and status pills so the user can tell at a glance
 *  whether they need to read a plan, answer a question, or just allow a tool call. Falls back to
 *  the generic category label when no permission payload is available (cold-state needs-input). */
export function getAgentPhaseLabel(
	category: AgentSessionCategory,
	permission: AgentSessionState['pendingPermission'] | undefined,
): string {
	if (category !== 'needs-input' || permission == null) return getAgentCategoryLabel(category);

	switch (permission.kind) {
		case 'plan':
			return 'Plan ready';
		case 'question':
			return 'Question';
		case 'elicitation':
			return 'Input needed';
		case 'tool':
		default:
			return 'Permission';
	}
}

/** "Last active …" granularity helper used by the graph details panel and the graph agents
 *  sidebar panel — short-and-stable formatting (no seconds past 1 minute). Accepts either a
 *  `Date` (the wire-shape's `phaseSince`/`lastActivity` fields) or a numeric timestamp. Rolls the
 *  top unit over as it crosses each boundary (`m → h → d → w`) so an hours-old completed session
 *  reads `2d 3h` rather than `51h`. The agent-status pill has its own slightly more granular
 *  variant inline. `now` defaults to `Date.now()`; pass it to pin the instant (a caller deriving
 *  `value` from its own clock read otherwise sits one unpredictable tick away from the bucket it
 *  expects). */
export function formatAgentElapsed(value: Date | number | undefined, now: number = Date.now()): string | undefined {
	if (value == null) return undefined;

	const timestamp = typeof value === 'number' ? value : value.getTime();
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const remainingMinutes = minutes % 60;
		return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
	}

	// Past sessions can be days or weeks old; keep rolling so "3d" beats "72h".
	const days = Math.floor(hours / 24);
	if (days < 7) {
		const remainingHours = hours % 24;
		return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
	}

	const weeks = Math.floor(days / 7);
	const remainingDays = days % 7;
	return remainingDays > 0 ? `${weeks}w ${remainingDays}d` : `${weeks}w`;
}

/** Per-session "what is it doing" line. Mirrors the contract used by the graph details panel:
 *  needs-input → kind-aware leading line (permission / plan / question / elicitation);
 *  working tool_use → current tool; otherwise the most-recent prompt or, for `idleFallback:
 *  'lastActive'`, how long ago the session last did anything (`session.lastActivity` — never
 *  `phaseSince`, which measures the current phase, not activity). */
export function describeAgentSession(
	session: AgentSessionState,
	category: AgentSessionCategory,
	options: { awaitingPrefix?: 'long' | 'short'; idleFallback?: 'lastActive' | 'lastPrompt' | 'none' } = {},
): string | undefined {
	const awaitingPrefix = options.awaitingPrefix ?? 'long';
	const idleFallback = options.idleFallback ?? 'lastActive';
	const permission = session.pendingPermission;

	if (category === 'needs-input' && permission != null) {
		return describePendingPermission(permission, awaitingPrefix);
	}
	if (category === 'working' && session.status === 'tool_use' && session.statusDetail) {
		// Surfaces that can render an icon prefix the value with `<code-icon icon="tools">` —
		// plain-text consumers (sidebar leaf description) read this as just the call signature,
		// with the adjacent phase decoration ("Working · 7m") carrying the state context.
		return session.statusDetail;
	}
	if (idleFallback === 'none') return undefined;

	if (idleFallback === 'lastActive') {
		const lastActive = formatAgentElapsed(session.lastActivity);
		if (lastActive != null) return `Last active ${lastActive} ago`;
	}

	return session.lastPrompt || undefined;
}

/** Single-line summary for any pending-permission kind. Plan / question / elicitation get
 *  readable leading text instead of the bare tool name `ExitPlanMode` / `AskUserQuestion` /
 *  whatever the elicitation toolName is. Used by row-density surfaces (popover hover row, pill
 *  summary row) where the full {@link GlAgentPromptDetail} composite would be too heavy. */
function describePendingPermission(
	permission: NonNullable<AgentSessionState['pendingPermission']>,
	awaitingPrefix: 'long' | 'short',
): string {
	switch (permission.kind) {
		case 'plan':
			return permission.planSummary
				? `${awaitingPrefix === 'long' ? 'Plan ready:' : 'Plan:'} ${permission.planSummary}`
				: 'Plan ready for review';
		case 'question': {
			const text = permission.questionText ?? 'Awaiting your answer';
			const count = permission.questionCount ?? 0;
			if (count > 1) return `${awaitingPrefix === 'long' ? 'Question:' : 'Q:'} ${text} (1 of ${count})`;
			return `${awaitingPrefix === 'long' ? 'Question:' : 'Q:'} ${text}`;
		}
		case 'elicitation':
			return permission.toolName ? `Awaiting input: ${permission.toolName}` : 'Awaiting input';
		case 'tool':
		default: {
			if (!permission.toolName) return 'Awaiting permission';

			const prefix = awaitingPrefix === 'long' ? 'Awaiting permission:' : 'Awaiting:';
			return `${prefix} ${permission.toolName}${permission.toolDescription ? ` — ${permission.toolDescription}` : ''}`;
		}
	}
}

/** Canonical sort order for agent sessions across every UI surface. Category-actionability first
 *  (needs-input → working → idle → completed), then most-recent phase entry within a category, then
 *  alphabetical by name. Applied once at each state-entry point so all consumers — banners,
 *  pills, cards, hovers — render the same order. Actionable always wins: a fresh idle session
 *  never outranks a session that's actually waiting on you.
 *
 *  Within-phase key is `phaseSince` (when this phase started) rather than `lastActivity` (the
 *  noisy tool-event tick) — that way working/waiting rows stay put while the agent works,
 *  instead of leapfrogging each other on every status update. The semantic reads naturally for
 *  every phase: "most-recently started working", "most-recently started waiting", "most-recently
 *  went idle" — which is also the order the user last interacted with each session in. */
export function sortAgentSessions(sessions: readonly AgentSessionState[]): AgentSessionState[] {
	return sessions.toSorted((a, b) => {
		const ra = phaseRank[a.phase];
		const rb = phaseRank[b.phase];
		if (ra !== rb) {
			return ra - rb;
		}

		const ta = a.phaseSince.getTime();
		const tb = b.phaseSince.getTime();
		if (ta !== tb) {
			return tb - ta;
		}

		return a.displayName.localeCompare(b.displayName);
	});
}

/** Identifies the worktree the matcher should resolve sessions for. `repoPath` is the workspace's
 *  selected-repo path (main-repo path in most cases, but can be a worktree path if the workspace
 *  opens a worktree directly). `worktreePath` is the worktree's full normalized path; `undefined`
 *  and `worktreePath === repoPath` both denote the default worktree (Home keeps the path on
 *  `OverviewBranch.worktree`; Graph strips the default from its `worktreesByBranch` map to
 *  preserve `+checkedout` vs `+worktree` semantics, so it surfaces as `undefined`). */
export interface AgentSessionWorktreeTarget {
	repoPath: string;
	worktreePath?: string;
}

export type AgentSessionWorktreeIndex = Map<string, AgentSessionState[]>;

/** Effective worktree path for a target — falls back to `repoPath` for default-worktree targets
 *  whose producer leaves `worktreePath` undefined. */
function targetWorktreeKey(target: AgentSessionWorktreeTarget): string {
	return target.worktreePath ?? target.repoPath;
}

/** Effective worktree path for a session. Returns `undefined` until `resolveGitInfo` resolves —
 *  intentionally does NOT fall back to `workspacePath` (matched workspace folder, not a worktree
 *  identifier) nor to `cwd` (typically deeper than the worktree boundary). Cold-cache sessions
 *  are simply unmatched until the host fills the worktree in — a narrow window in practice
 *  (resolveGitInfo runs on first hook).
 *
 *  Reads `session.worktreePath` directly rather than `session.worktree?.path` — both carry the
 *  same value (the wire serializer sets them together), but `worktreePath` doesn't tempt anyone
 *  to think the worktree-name cache needs to be populated first. Reserve `session.worktree.*`
 *  for code that also needs `name` / `branch` / `isDefault` (display labels, tooltips). */
function sessionWorktreeKey(session: AgentSessionState): string | undefined {
	return session.worktreePath;
}

/** Builds a lookup index for batch matching across many worktrees in one render (overview cards).
 *  Single-shot consumers can call {@link matchAgentSessionsForWorktree} directly with the array.
 *  Keyed by the session's effective worktree path so the lookup is robust to whether the agent's
 *  workspace folder is the main repo or the worktree itself. */
export function indexAgentSessionsByRepoAndWorktree(
	sessions: readonly AgentSessionState[] | undefined,
): AgentSessionWorktreeIndex | undefined {
	if (sessions == null || sessions.length === 0) return undefined;

	const index: AgentSessionWorktreeIndex = new Map();
	for (const session of sessions) {
		const key = sessionWorktreeKey(session);
		if (key == null) continue;

		const existing = index.get(key);
		if (existing != null) {
			existing.push(session);
		} else {
			index.set(key, [session]);
		}
	}
	return index;
}

/** Returns the agent sessions running in the worktree the target represents. Accepts either the
 *  full `AgentSessionState[]` (single-shot, O(n)) or a prebuilt {@link AgentSessionWorktreeIndex}
 *  (batch, O(1) lookup). Matches strictly by `session.worktree.path` (host-resolved from the
 *  agent's cwd) — the only stable identifier of where the agent actually lives. `workspacePath`
 *  is intentionally not consulted: it's a synthesized field that holds either the matching
 *  VS Code workspace folder or the common-path fallback, depending on Claude Code's launch dir.
 *  Sessions whose worktree hasn't been resolved yet (cold-cache window) won't match — narrow in
 *  practice since `resolveGitInfo` runs on the first hook. */
export function matchAgentSessionsForWorktree(
	source: readonly AgentSessionState[] | AgentSessionWorktreeIndex | undefined,
	target: AgentSessionWorktreeTarget,
): AgentSessionState[] | undefined {
	if (source == null) return undefined;

	const targetKey = targetWorktreeKey(target);

	if (source instanceof Map) {
		const found = source.get(targetKey);
		return found != null && found.length > 0 ? found : undefined;
	}

	if (!source.length) return undefined;

	const matches = source.filter(session => sessionWorktreeKey(session) === targetKey);
	return matches.length > 0 ? matches : undefined;
}

/** Reverse of {@link matchAgentSessionsForWorktree}: given a session, find the `OverviewBranch`
 *  representing the currently-checked-out branch of the session's worktree. Iterates `active`
 *  first then `recent` because a named worktree that isn't opened in the workspace ends up in
 *  `recent` (see `getBranchOverviewType`) even though it is the current branch of *some* worktree
 *  — agents running in it need their card to be resolvable. */
export function findOverviewBranchForSession(
	branches: { active: readonly OverviewBranch[]; recent: readonly OverviewBranch[] } | undefined,
	session: AgentSessionState,
): OverviewBranch | undefined {
	if (branches == null) return undefined;

	const sessionKey = sessionWorktreeKey(session);
	if (sessionKey == null) return undefined;

	for (const candidate of [...branches.active, ...branches.recent]) {
		if (
			targetWorktreeKey({ repoPath: candidate.repoPath, worktreePath: candidate.worktree?.path }) === sessionKey
		) {
			return candidate;
		}
	}

	return undefined;
}

/** URL-encodes string fragments before they enter a `|`-delimited fingerprint so user-typed
 *  values (lastPrompt, statusDetail like `grep foo | bar`, tool descriptions with newlines, …)
 *  can't collide via embedded delimiters or row separators. `encodeURIComponent` escapes both
 *  `|` (→ `%7C`) and `\n` (→ `%0A`) deterministically and is faster than a custom replacer for
 *  the typical short strings we feed it. */
export function fpField(value: string | undefined | null): string {
	return value == null ? '' : encodeURIComponent(value);
}

/** Encodes every permission-typed field consumed by {@link describePendingPermission} (detail
 *  line), {@link permission-action button row} (Approve/Reject/Always-Allow/View Plan), and the
 *  shared `<gl-agent-prompt-detail>` composite (which renders `toolInputDescription` as the
 *  caption row for kind='tool'/'plan'/'question'/'elicitation' alike) into a stable string
 *  suitable for inclusion in a render-skip fingerprint.
 *
 *  Kept exhaustive deliberately: a new permission field added to the wire shape must also be
 *  added here, and a new {@link PendingPermissionKind} must be added to the switch — the
 *  default arm hits {@link assertNever} so the build fails when the union expands without this
 *  site being updated. Every string fragment is run through {@link fpField} so embedded `|` and
 *  `\n` characters (common in user prompts and shell commands) can't produce collisions. */
export function permissionFingerprint(permission: AgentSessionState['pendingPermission'] | undefined): string {
	if (permission == null) return '';

	// `toolInputDescription` is consumed by `<gl-agent-prompt-detail>` for every kind (it's the
	// caption row under the body), so it lives outside the kind-specific switch to ensure it's
	// always part of the fingerprint regardless of which branch fires. `resolvable` rides along for
	// the same reason: it decides whether the surface renders action buttons at all, so an ask that
	// becomes unanswerable without any other field moving must still invalidate the render.
	const inputDesc = `|i${fpField(permission.toolInputDescription)}${permission.resolvable === false ? '|r0' : ''}`;

	switch (permission.kind) {
		case 'plan':
			return `plan|${fpField(permission.planSummary)}|${fpField(permission.planFilePath)}${inputDesc}`;
		case 'question':
			return `question|${fpField(permission.questionText)}|${permission.questionCount ?? 0}${inputDesc}`;
		case 'elicitation':
			return `elicit|${fpField(permission.toolName)}${inputDesc}`;
		case 'tool': {
			const suggestionsKey = permission.suggestions != null ? `|s${permission.suggestions.length}` : '';
			return `tool|${fpField(permission.toolName)}|${fpField(permission.toolDescription)}${suggestionsKey}${inputDesc}`;
		}
		default:
			// Compile-time guard: a new PendingPermissionKind without a case here fails the build
			// before it can silently fall into a missing branch and drop kind-specific fields.
			// Passes `kind` (a discriminant string-literal union) rather than the wider
			// `PendingPermission` shape, which TS can't narrow to `never` because it's an
			// interface with optional fields rather than a tagged union.
			return assertPermissionKindNever(permission.kind);
	}
}

/** TypeScript exhaustiveness helper for the {@link permissionFingerprint} switch. Receiving a
 *  `never`-typed value at runtime means the static {@link PendingPermissionKind} union expanded
 *  without the switch being updated; we throw rather than return a generic encoding so the bug
 *  is caught loudly during development instead of producing silent fingerprint collisions in
 *  production. */
function assertPermissionKindNever(kind: never): never {
	throw new Error(`Unhandled permission kind in permissionFingerprint: ${String(kind)}`);
}

/** Per-session sticky-tool cache entry. `phase` busts the entry on transitions out of `working`;
 *  `until` is an absolute timestamp (ms) past which the entry is considered expired. */
interface StickyToolEntry {
	readonly detail: string;
	readonly phase: AgentSessionPhase;
	readonly until: number;
}

/** Smooths over the brief gaps between Claude Code tool calls when an agent is actively working.
 *  Between adjacent tool invocations, `session.status` momentarily leaves `'tool_use'` and
 *  `session.statusDetail` empties — without stickiness, every consumer that paints the current
 *  tool call (`renderRunningTool(statusDetail)` in the details panel, `card__detail` line in the
 *  kanban) flickers to its fallback for hundreds of ms before the next tool call latches.
 *
 *  Usage shape:
 *  ```ts
 *  const sticky = createStickyDetailResolver();           // construct once per component
 *  const tool = sticky.resolveLiveTool(session);          // call per session per render
 *  if (tool != null) renderRunningTool(tool);             // render as tool composite
 *  else renderFallback(...);                              // caller-specific fallback
 *  sticky.prune(sessions.map(s => s.id));                 // call once per render to GC orphans
 *  ```
 *
 *  Cache eviction triggers:
 *  - `phase !== 'working'` on next `resolveLiveTool` call (immediate)
 *  - `until` timestamp passed (lazy — only checked on subsequent calls)
 *  - explicit `prune` for sessions removed from the live set
 *
 *  Default `holdMs` of 7000 covers the common "run tool → think a few seconds → run next tool"
 *  cadence without holding the previous tool name on screen long after the agent has actually
 *  stopped. Phase transitions (working → idle/needs-input) always evict immediately regardless
 *  of TTL, so the hold only smooths within-`working` gaps, not real state changes. A new tool
 *  call (statusDetail differs) replaces the cached one immediately — no need to wait out the TTL. */
export interface StickyDetailResolver {
	/** Returns the sticky-aware live tool descriptor, or `undefined` when neither a live nor a
	 *  recently-cached tool detail is available for this session. Side-effecting: refreshes the
	 *  cache TTL when a live tool is present, evicts the entry on phase change or expiration. */
	resolveLiveTool(session: AgentSessionState): string | undefined;
	/** Explicitly drops the cache entry for a single session. Use when the caller routes the
	 *  session through a code path that bypasses {@link resolveLiveTool} (e.g., the needs-input
	 *  permission renderer) — otherwise the cached working-phase entry survives the permission
	 *  round-trip and re-paints as soon as the session returns to `working` without a fresh tool. */
	evict(sessionId: string): void;
	/** Removes cache entries for sessions whose ids are NOT in {@link liveIds}. Call after each
	 *  render pass so the cache stays bounded by the live session count instead of growing across
	 *  session lifecycles (start/stop/restart). */
	prune(liveIds: Iterable<string>): void;
	/** Test/diagnostic accessor — current cache size. Not part of the production contract. */
	readonly size: number;
}

export function createStickyDetailResolver(options?: { holdMs?: number }): StickyDetailResolver {
	const holdMs = options?.holdMs ?? 7 * 1000;
	const cache = new Map<string, StickyToolEntry>();

	const resolveLiveTool = (session: AgentSessionState): string | undefined => {
		const cacheKey = session.id;
		// `performance.now()` is monotonic — Date.now() drifts on NTP sync / DST / suspend-resume,
		// any of which could pin a cache entry as "still fresh" past its real TTL or evict it
		// prematurely after a backward clock jump. Monotonic time is the only correct choice
		// for a hold-window TTL.
		const now = performance.now();

		// Live tool present — refresh sticky TTL and return. `statusDetail != null` mirrors
		// `shouldRenderRunningTool` (agent-status-render.ts) so the resolver and the bare predicate
		// agree on the same inputs (matters for agent-status-pill, which still uses the predicate).
		if (session.phase === 'working' && session.status === 'tool_use' && session.statusDetail != null) {
			cache.set(cacheKey, { detail: session.statusDetail, phase: session.phase, until: now + holdMs });
			return session.statusDetail;
		}

		// Still working but no live tool — let the cache cover the gap if it's recent enough AND
		// still in the same phase. A phase change (working → idle/needs-input) evicts even inside
		// the TTL window so genuine transitions surface without delay.
		if (session.phase === 'working') {
			const cached = cache.get(cacheKey);
			if (cached?.phase === session.phase && cached.until > now) {
				return cached.detail;
			}

			if (cached != null) {
				cache.delete(cacheKey);
			}
			return undefined;
		}

		// Not working — drop any leftover entry so the next working transition starts clean.
		cache.delete(cacheKey);
		return undefined;
	};

	const prune = (liveIds: Iterable<string>): void => {
		if (cache.size === 0) return;

		const live = liveIds instanceof Set ? liveIds : new Set(liveIds);
		for (const id of cache.keys()) {
			if (!live.has(id)) {
				cache.delete(id);
			}
		}
	};

	const evict = (sessionId: string): void => {
		cache.delete(sessionId);
	};

	return {
		resolveLiveTool: resolveLiveTool,
		evict: evict,
		prune: prune,
		get size(): number {
			return cache.size;
		},
	};
}

/** Reconciles a cached past-session list against the live session list — see
 *  {@link createPastAgentSessionsResolver}. */
export interface PastAgentSessionsResolver {
	/** The past result to both gate visibility on and render, with rows dropped for sessions that
	 *  are currently tracked and for those that have departed the tracked set. `total` is reduced by
	 *  what was dropped so the "N more" footer stays honest. Side-effecting: records departures. */
	resolve(
		past: PastAgentSessionsResult | undefined,
		live: readonly AgentSessionState[] | undefined,
	): PastAgentSessionsResult | undefined;
}

/**
 * Past sessions are a pull-only resource, fetched once per worktree — the host never re-pushes them
 * when the session list changes. So a session that leaves the tracked set (archived, or a pruned
 * record) is still in the cached list, and the live-id dedup that had been masking it stops the
 * instant it departs — painting a just-archived session as a "Past" row, which reads as the archive
 * having failed.
 *
 * Callers resolve ONCE per cycle and use the result for both the visibility/sizing gate and the
 * rendered rows: filtering only at render (inside `gl-details-agent-status`) would let a parent
 * decide to show a section from the unfiltered count that the child then renders as empty.
 *
 * Departures are tracked against the FULL tracked set rather than a worktree-matched subset, so
 * changing which worktree is displayed isn't mistaken for sessions disappearing. A freshly
 * delivered result (the host filters archived ids at fetch time) retires every suppression.
 */
export function createPastAgentSessionsResolver(): PastAgentSessionsResolver {
	let seenIds: Set<string> | undefined;
	let lastPast: PastAgentSessionsResult | undefined;
	const departed = new Set<string>();

	return {
		resolve: (past, live) => {
			if (past !== lastPast) {
				lastPast = past;
				departed.clear();
			}

			// `undefined` means "not loaded" (context not yet populated, or a graph-state reset),
			// which is NOT the same as "no sessions". Treating it as an empty set would retire every
			// seen id as departed and permanently suppress the matching Past rows, so hold the prior
			// snapshot and only diff against a real list.
			if (live != null) {
				const nextIds = new Set(live.map(s => s.id));
				if (seenIds != null) {
					for (const id of seenIds) {
						if (!nextIds.has(id)) {
							departed.add(id);
						}
					}
				}
				seenIds = nextIds;
			}
			const liveIds = seenIds;

			if (past == null) return undefined;

			const sessions = past.sessions.filter(p => !liveIds?.has(p.id) && !departed.has(p.id));
			const dropped = past.sessions.length - sessions.length;
			// Preserve reference identity when nothing was dropped — the common case.
			if (dropped === 0) return past;

			return { sessions: sessions, total: Math.max(0, past.total - dropped) };
		},
	};
}
