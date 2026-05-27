import type { AgentSession } from '@gitlens/agents/types.js';
import { basename, normalizePath } from '@gitlens/utils/path.js';
import type { Shape } from '@gitlens/utils/types.js';
import { deriveNameFromPrompt } from '../utils/deriveNameFromPrompt.js';

/**
 * Live host-side resolution of the session's worktree, serialized into {@link AgentSessionState}
 * per snapshot so `git checkout` / worktree renames / upstream changes flow to the UI without
 * the agent restarting. Path is the only stable key; everything else is a snapshot.
 */
export interface AgentSessionWorktreeState {
	/** Full normalized worktree directory path. Stable matching key, always present. */
	readonly path: string;
	/** Display label — for branch-type worktrees that's the branch name; for detached/bare
	 *  the canonical display form (`(bare)` / `basename (shortSha)`). */
	readonly name?: string;
	/** Worktree kind, straight off `GitWorktree.type`. */
	readonly type?: 'bare' | 'detached' | 'branch';
	/** True iff this is the repo's default (primary) worktree, not a named one. */
	readonly isDefault?: boolean;
	/** Branch metadata, present only for branch-type worktrees. `name` is the branch's
	 *  display name; `upstreamName` is the raw `origin/foo` form — consumers build the
	 *  `upstreamRef` via `getBranchId(session.commonPath, true, upstreamName)`. */
	readonly branch?: {
		readonly name: string;
		readonly upstreamName?: string;
	};
}

/**
 * Wire DTO for an {@link AgentSession}. Near-1:1 projection via {@link Shape} so webviews see the
 * rich session shape (provider, pendingPermission with suggestions, prompts, planFile, dates,
 * isSubagent/parentId, etc.) without hand-projecting every field.
 *
 * Three deliberate divergences from `Shape<AgentSession>`:
 *  - **`subagents` → `subagentCount`** — only the count badge consumes them today. Sending the
 *    recursive subagent tree (each with its own pendingPermission/lastPrompt) would bloat every
 *    snapshot push for a UI that doesn't walk them. `isSubagent` and `parentId` still flow
 *    through, so consumers can tell whether the root session is itself a subagent and which
 *    parent it belongs to. Flip when there's a real subagent-tree surface.
 *  - **`worktree` is host-composed** from `session.worktreePath` + the host-only
 *    `_worktreeNameByPath` cache. Webviews can't resolve the worktree's display name themselves
 *    so the host fills it in here.
 *  - **`displayName` is added** as the cascade-resolved label ({@link getSessionDisplayName}).
 *    Computed once host-side so every consumer renders the same name without duplicating the
 *    cascade — the raw harness-supplied `name?: string` field still flows through for callers
 *    that want to distinguish "harness-named" from "fallback-named" sessions.
 */
export type AgentSessionState = Omit<Shape<AgentSession>, 'subagents'> & {
	readonly displayName: string;
	readonly subagentCount: number;
	readonly worktree?: AgentSessionWorktreeState;
};

/**
 * Resolves the user-facing name for a session. Prefers the harness-supplied `name`, then
 * transcript-discovered titles (user-set `customTitle`, then AI-generated `aiTitle`), then a
 * heuristic derived from `firstPrompt`, then the same heuristic on `lastPrompt` (so resumed/
 * headless sessions with no first prompt still get a content-derived label), then the
 * transcript-discovered `agentName` slug as a low-priority content name (it's a slug-twin of
 * `customTitle`, often auto-derived and less readable than a prompt-derived label). If no content
 * name resolves, falls back to a location anchor (`On <X>`) built from worktree/cwd basename.
 * Always returns a non-empty string so consumers don't need to repeat fallback logic.
 */
export function getSessionDisplayName(session: AgentSession, worktreeName: string | undefined): string {
	const titles = session.transcriptTitles;
	const name =
		session.name ||
		titles?.custom ||
		titles?.ai ||
		deriveNameFromPrompt(session.firstPrompt) ||
		deriveNameFromPrompt(session.lastPrompt) ||
		titles?.agent;
	if (name) return name;

	// normalizePath collapses backslashes and trailing slashes so basename (POSIX) returns the
	// final segment on either platform.
	const location =
		worktreeName ||
		(session.worktreePath ? basename(normalizePath(session.worktreePath)) : undefined) ||
		(session.cwd ? basename(normalizePath(session.cwd)) : undefined);
	if (location) return `On ${location}`;

	return session.providerName;
}

/** Host-side worktree resolution passed to {@link serializeAgentSession} — the same fields that
 *  end up on {@link AgentSessionWorktreeState} minus `path` (which comes from `session.worktreePath`).
 *  Pass `undefined` when the worktree hasn't been resolved yet (cold cache); the DTO carries `path`
 *  alone so consumers still get a stable matching key. */
export interface AgentSessionWorktreeMetadata {
	readonly name: string;
	readonly type: 'bare' | 'detached' | 'branch';
	readonly isDefault: boolean;
	readonly branch?: { readonly name: string; readonly upstreamName?: string };
}

export function serializeAgentSession(
	session: AgentSession,
	worktree: AgentSessionWorktreeMetadata | undefined,
): AgentSessionState {
	const { subagents, ...rest } = session;
	return {
		...rest,
		displayName: getSessionDisplayName(session, worktree?.name),
		subagentCount: subagents?.length ?? 0,
		worktree:
			session.worktreePath != null
				? {
						path: session.worktreePath,
						name: worktree?.name,
						type: worktree?.type,
						isDefault: worktree?.isDefault,
						branch: worktree?.branch,
					}
				: undefined,
	};
}
