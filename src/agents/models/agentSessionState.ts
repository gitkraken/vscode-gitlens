import type { AgentSession, AgentSessionPhase, AgentSessionStatus } from '@gitlens/agents/types.js';

/**
 * Serialized snapshot of an `AgentSession` suitable for sending across the webview boundary.
 *
 * Webviews and other consumers that don't have direct access to the host-side `AgentSession`
 * (with its `Date` instances and provider references) read this DTO instead.
 */
export interface AgentSessionState {
	readonly id: string;
	readonly name: string;
	readonly status: AgentSessionStatus;
	readonly phase: AgentSessionPhase;
	readonly statusDetail?: string;
	/**
	 * Worktree the session lives in. `path` is the stable matching key (full normalized
	 * worktree directory path). `name` is the live display label resolved at serialization
	 * time from the loaded `Repository`'s worktrees — for branch-type worktrees that's the
	 * branch name; for detached/bare it's the canonical display form. Recomputed each
	 * serialization, never persisted on the host `AgentSession`.
	 */
	readonly worktree?: {
		readonly path: string;
		readonly name?: string;
	};
	readonly isInWorkspace: boolean;
	readonly hasPermissionRequest: boolean;
	readonly subagentCount: number;
	readonly workspacePath?: string;
	readonly cwd?: string;
	readonly lastActivityTimestamp?: number;
	readonly phaseSinceTimestamp?: number;
	readonly pendingPermissionDetail?: {
		readonly toolName: string;
		readonly toolDescription: string;
		readonly toolInputDescription?: string;
		readonly hasSuggestions?: boolean;
	};
	readonly lastPrompt?: string;
}

export function serializeAgentSession(session: AgentSession, worktreeName: string | undefined): AgentSessionState {
	return {
		id: session.id,
		name: session.name,
		status: session.status,
		phase: session.phase,
		statusDetail: session.statusDetail,
		worktree: session.worktreePath != null ? { path: session.worktreePath, name: worktreeName } : undefined,
		isInWorkspace: session.isInWorkspace,
		hasPermissionRequest: session.pendingPermission != null,
		subagentCount: session.subagents?.length ?? 0,
		workspacePath: session.workspacePath,
		cwd: session.cwd,
		lastActivityTimestamp: session.lastActivity.getTime(),
		phaseSinceTimestamp: session.phaseSince.getTime(),
		pendingPermissionDetail:
			session.pendingPermission != null
				? {
						toolName: session.pendingPermission.toolName,
						toolDescription: session.pendingPermission.toolDescription,
						toolInputDescription: session.pendingPermission.toolInputDescription,
						hasSuggestions:
							session.pendingPermission.suggestions != null &&
							session.pendingPermission.suggestions.length > 0,
					}
				: undefined,
		lastPrompt: session.lastPrompt,
	};
}
