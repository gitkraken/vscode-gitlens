import type { AgentSessionPhase } from '../../../agents/provider.js';
import type { AgentSessionState } from '../../home/protocol.js';
import type { OverviewBranch } from '../../shared/overviewBranches.js';

const phaseRank: Record<AgentSessionPhase, number> = {
	waiting: 0,
	working: 1,
	idle: 2,
};

export type AgentSessionCategory = 'working' | 'needs-input' | 'idle';

export const agentPhaseToCategory: Record<AgentSessionPhase, AgentSessionCategory> = {
	working: 'working',
	waiting: 'needs-input',
	idle: 'idle',
};

export function getAgentCategoryLabel(category: AgentSessionCategory): string {
	switch (category) {
		case 'needs-input':
			return 'Needs input';
		case 'working':
			return 'Working';
		case 'idle':
			return 'Idle';
	}
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
 *  `Date` (the wire-shape's `phaseSince`/`lastActivity` fields) or a numeric timestamp. The
 *  agent-status pill has its own slightly more granular variant inline. */
export function formatAgentElapsed(value: Date | number | undefined): string | undefined {
	if (value == null) return undefined;

	const timestamp = typeof value === 'number' ? value : value.getTime();
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** Per-session "what is it doing" line. Mirrors the contract used by the graph details panel:
 *  needs-input → kind-aware leading line (permission / plan / question / elicitation);
 *  working tool_use → current tool; otherwise last-active timestamp or the most-recent prompt. */
export function describeAgentSession(
	session: AgentSessionState,
	category: AgentSessionCategory,
	elapsed: string | undefined,
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
	if (idleFallback === 'lastActive' && elapsed != null) return `Last active ${elapsed} ago`;
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
 *  (needs-input → working → idle), then most-recent phase entry within a category, then
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
