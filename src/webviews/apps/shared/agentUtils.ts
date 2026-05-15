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

/** "Last active …" granularity helper used by the graph details panel and the graph agents
 *  sidebar panel — short-and-stable formatting (no seconds past 1 minute). The agent-status pill
 *  has its own slightly more granular variant inline. */
export function formatAgentElapsed(timestamp: number | undefined): string | undefined {
	if (timestamp == null) return undefined;
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** Per-session "what is it doing" line. Mirrors the contract used by the graph details panel:
 *  needs-input → awaiting tool; working tool_use → current tool; otherwise last-active timestamp
 *  or the most-recent prompt. */
export function describeAgentSession(
	session: AgentSessionState,
	category: AgentSessionCategory,
	elapsed: string | undefined,
	options: { awaitingPrefix?: 'long' | 'short'; idleFallback?: 'lastActive' | 'lastPrompt' } = {},
): string | undefined {
	const awaitingPrefix = options.awaitingPrefix ?? 'long';
	const idleFallback = options.idleFallback ?? 'lastActive';
	const detail = session.pendingPermissionDetail;

	if (category === 'needs-input' && detail != null) {
		if (detail.toolName == null) return 'Awaiting permission';
		const prefix = awaitingPrefix === 'long' ? 'Awaiting permission:' : 'Awaiting:';
		return `${prefix} ${detail.toolName}${detail.toolDescription ? ` — ${detail.toolDescription}` : ''}`;
	}
	if (category === 'working' && session.status === 'tool_use' && session.statusDetail) {
		return `Running ${session.statusDetail}`;
	}
	if (idleFallback === 'lastActive' && elapsed != null) return `Last active ${elapsed} ago`;
	return session.lastPrompt || undefined;
}

/** Canonical sort order for agent sessions across every UI surface. Category-actionability first
 *  (needs-input → working → idle), then most-recent activity within a category, then alphabetical
 *  by name. Applied once at each state-entry point so all consumers — banners, pills, cards,
 *  hovers — render the same order. Actionable always wins: a fresh idle session never outranks a
 *  session that's actually waiting on you. */
export function sortAgentSessions(sessions: readonly AgentSessionState[]): AgentSessionState[] {
	return sessions.toSorted((a, b) => {
		const ra = phaseRank[a.phase];
		const rb = phaseRank[b.phase];
		if (ra !== rb) {
			return ra - rb;
		}
		const ta = a.lastActivityTimestamp ?? a.phaseSinceTimestamp ?? 0;
		const tb = b.lastActivityTimestamp ?? b.phaseSinceTimestamp ?? 0;

		if (ta !== tb) {
			return tb - ta;
		}

		return (a.name ?? '').localeCompare(b.name ?? '');
	});
}

/** Identifies the worktree the matcher should resolve sessions for. `repoPath` must be the path
 *  that `session.workspacePath` is normalized to on the host — i.e. the **main repo's path** for
 *  any branch in any of its worktrees. `worktreePath` is the worktree's full normalized path;
 *  `undefined` and `worktreePath === repoPath` both denote the default worktree (Home keeps the
 *  path on `OverviewBranch.worktree`; Graph strips the default from its `worktreesByBranch` map
 *  to preserve `+checkedout` vs `+worktree` semantics, so it surfaces as `undefined`). */
export interface AgentSessionWorktreeTarget {
	repoPath: string;
	worktreePath?: string;
}

export type AgentSessionWorktreeIndex = Map<string, AgentSessionState[]>;

/** Default-worktree representations differ across producers — Home keeps `worktree.path` equal to
 *  the repo path, Graph leaves `worktree` undefined for default-worktree branches but produces the
 *  full path for sessions. We collapse only the *known* default-worktree form (`worktreePath ===
 *  repoPath`) to `''` so default-worktree producers from either side meet.
 *
 *  A `null`/`undefined` worktreePath means **unknown** — either an unresolved agent session
 *  (resolveGitInfo hasn't finished or failed) or a branch with no worktree mapping (not checked
 *  out anywhere). Those cases must NOT collide with the default-worktree key; we return `undefined`
 *  so equality with any normalized key is false. */
function normalizeWorktreeKey(repoPath: string, worktreePath: string | undefined): string | undefined {
	if (worktreePath == null) return undefined;
	return worktreePath === repoPath ? '' : worktreePath;
}

/** Builds a lookup index for batch matching across many worktrees in one render (overview cards).
 *  Single-shot consumers can call {@link matchAgentSessionsForWorktree} directly with the array. */
export function indexAgentSessionsByRepoAndWorktree(
	sessions: readonly AgentSessionState[] | undefined,
): AgentSessionWorktreeIndex | undefined {
	if (sessions == null || sessions.length === 0) return undefined;

	const index: AgentSessionWorktreeIndex = new Map();
	for (const session of sessions) {
		if (session.workspacePath == null) continue;
		const wtKey = normalizeWorktreeKey(session.workspacePath, session.worktree?.path);
		// Skip sessions whose worktree hasn't resolved yet — they can't be reliably attributed.
		if (wtKey === undefined) continue;
		const key = `${session.workspacePath}\0${wtKey}`;
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
 *  (batch, O(1) lookup). Matches by `(repoPath, worktreePath)` with default-worktree normalization
 *  so Home (explicit path) and Graph (absent) targets resolve to the same sessions without
 *  cross-associating with named worktrees. */
export function matchAgentSessionsForWorktree(
	source: readonly AgentSessionState[] | AgentSessionWorktreeIndex | undefined,
	target: AgentSessionWorktreeTarget,
): AgentSessionState[] | undefined {
	if (source == null) return undefined;

	const targetKey = normalizeWorktreeKey(target.repoPath, target.worktreePath);
	// Branch isn't checked out anywhere — no agent can be running on it, regardless of state.
	if (targetKey === undefined) return undefined;

	let candidates: readonly AgentSessionState[];
	if (source instanceof Map) {
		const found = source.get(`${target.repoPath}\0${targetKey}`);
		if (found == null) return undefined;
		candidates = found;
	} else {
		if (source.length === 0) return undefined;
		candidates = source;
	}

	const matches = candidates.filter(session => {
		if (session.workspacePath !== target.repoPath) return false;
		const sessionKey = normalizeWorktreeKey(session.workspacePath, session.worktree?.path);
		// Unresolved session worktree → can't attribute reliably; skip.
		return sessionKey !== undefined && sessionKey === targetKey;
	});

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
	if (branches == null || session.workspacePath == null || session.worktree?.path == null) return undefined;

	const sessionKey = normalizeWorktreeKey(session.workspacePath, session.worktree.path);
	if (sessionKey === undefined) return undefined;
	for (const candidate of [...branches.active, ...branches.recent]) {
		if (candidate.repoPath !== session.workspacePath) continue;
		const candidateKey = normalizeWorktreeKey(candidate.repoPath, candidate.worktree?.path);
		if (candidateKey === undefined || candidateKey !== sessionKey) continue;
		return candidate;
	}

	return undefined;
}
