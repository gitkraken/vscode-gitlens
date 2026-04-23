import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';

export const claudeCodeNonBlockingHookEvents = [
	'SessionStart',
	'SessionEnd',
	'UserPromptSubmit',
	'PreToolUse',
	'PostToolUse',
	'PostToolUseFailure',
	'Notification',
	'Stop',
	'StopFailure',
	'SubagentStart',
	'SubagentStop',
	'TeammateIdle',
	'TaskCompleted',
	'InstructionsLoaded',
	'ConfigChange',
	'WorktreeCreate',
	'WorktreeRemove',
	'PreCompact',
	'PostCompact',
	'Elicitation',
	'ElicitationResult',
	'PermissionDenied',
	'CwdChanged',
] as const;

export const claudeCodeBlockingHookEvents = ['PermissionRequest'] as const;

export type ClaudeCodeHookEvent =
	| (typeof claudeCodeNonBlockingHookEvents)[number]
	| (typeof claudeCodeBlockingHookEvents)[number];

export type PermissionDecision = 'allow' | 'deny';

export type AgentSessionStatus =
	| 'thinking'
	| 'tool_use'
	| 'responding'
	| 'waiting'
	| 'idle'
	| 'compacting'
	| 'permission_requested';

export type AgentSessionPhase = 'idle' | 'working' | 'waiting';

export function getPhaseForStatus(status: AgentSessionStatus): AgentSessionPhase {
	switch (status) {
		case 'thinking':
		case 'tool_use':
		case 'responding':
		case 'compacting':
			return 'working';
		case 'waiting':
		case 'permission_requested':
			return 'waiting';
		case 'idle':
			return 'idle';
	}
}

export interface PermissionSuggestion {
	readonly type: string;
	readonly tool?: string;
	readonly rules?: readonly { readonly toolName: string; readonly ruleContent?: string }[];
	readonly destination?: string;
}

export interface PendingPermission {
	readonly toolName: string;
	readonly toolDescription: string;
	readonly toolInputDescription?: string;
	readonly suggestions?: readonly PermissionSuggestion[];
}

export interface AgentSession {
	readonly id: string;
	readonly providerId: string;
	readonly name: string;
	readonly status: AgentSessionStatus;
	readonly phase: AgentSessionPhase;
	readonly statusDetail?: string;
	readonly branch?: string;
	readonly worktreeName?: string;
	readonly pid?: number;
	readonly lastActivity: Date;
	readonly phaseSince: Date;
	readonly isSubagent: boolean;
	readonly parentId?: string;
	readonly subagents?: readonly AgentSession[];
	readonly pendingPermission?: PendingPermission;
	readonly workspacePath?: string;
	readonly cwd?: string;
	readonly planFile?: string;
	readonly isInWorkspace: boolean;
	readonly lastPrompt?: string;
}

export interface AgentSessionProvider extends UnifiedDisposable {
	readonly id: string;
	readonly name: string;
	readonly icon: string;

	readonly onDidChangeSessions: Event<void>;
	readonly sessions: readonly AgentSession[];

	start(workspacePaths: string[]): void;
	stop(): void;
	updateWorkspacePaths?(workspacePaths: string[]): void;

	resolvePermission?(
		sessionId: string,
		decision: PermissionDecision,
		updatedPermissions?: PermissionSuggestion[],
	): void;
}

export interface AgentProviderCallbacks {
	/** Report that an agent session started. No-op if the host has no telemetry. */
	onSessionStarted?(provider: string): void;

	/** Report that an agent session ended. No-op if the host has no telemetry. */
	onSessionEnded?(provider: string): void;

	/** Report that a permission request was resolved. No-op if the host has no telemetry. */
	onPermissionResolved?(info: { provider: string; tool: string; decision: PermissionDecision }): void;

	/** Notify the host that a branch has agent activity. */
	onBranchAgentActivity?(cwd: string): void;

	/**
	 * Run the GK CLI with the given args. Returns stdout.
	 *
	 * Host responsibilities:
	 * - Resolve the CLI executable path (e.g. via `resolveCLIExecutable`)
	 * - Provide the default `cwd` if `options.cwd` is not set (e.g. `globalStorageUri.fsPath` in VS Code)
	 * - Inject any environment-specific flags (e.g. `--insiders` when the host has insiders mode enabled)
	 */
	runCLICommand(args: string[], options?: { cwd?: string }): Promise<string>;

	/**
	 * Resolve git metadata (branch, worktree, repo root) for a session's cwd.
	 * Optional — if omitted, sessions won't have branch/worktree metadata.
	 */
	resolveGitInfo?(cwd: string): Promise<
		| {
				branch?: string;
				repoRoot: string;
				isWorktree: boolean;
				worktreeName?: string;
		  }
		| undefined
	>;
}
