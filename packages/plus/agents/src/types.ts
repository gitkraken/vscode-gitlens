import type { IpcHandler } from '@gitlens/ipc/ipcServer.js';
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

/**
 * Returns whether the given phase represents an agent that is actively doing work or
 * awaiting input (as opposed to fully idle). Uses an explicit allowlist so new phases
 * default to "not active" rather than being silently treated as live.
 */
export function isActiveAgentPhase(phase: AgentSessionPhase): boolean {
	return phase === 'working' || phase === 'waiting';
}

export interface PermissionSuggestion {
	readonly type: string;
	readonly tool?: string;
	readonly rules?: readonly { readonly toolName: string; readonly ruleContent?: string }[];
	readonly destination?: string;
}

/** Classification of what the agent is awaiting input for. Drives kind-aware UI: action button
 *  labels, phase wording, and which payload field carries the body. Detected at the provider
 *  boundary from the tool name / event so webviews don't grow their own classifiers.
 *  - `tool`: a regular tool permission (Bash, Edit, Read, …) — body is `toolDescription`.
 *  - `plan`: ExitPlanMode — body is `planSummary`; `planFilePath` may link the written plan.
 *  - `question`: AskUserQuestion — body is `questionText`; `questionCount` describes the batch.
 *  - `elicitation`: MCP elicitation — body is just `toolName`; user must respond in-session. */
export type PendingPermissionKind = 'tool' | 'plan' | 'question' | 'elicitation';

export interface PendingPermission {
	readonly kind: PendingPermissionKind;
	readonly toolName: string;
	readonly toolDescription: string;
	readonly toolInputDescription?: string;
	readonly suggestions?: readonly PermissionSuggestion[];
	/** Plan-mode (`kind === 'plan'`): on-disk path of the plan markdown, when the agent wrote one. */
	readonly planFilePath?: string;
	/** Plan-mode: short summary extracted from the plan content (first heading or leading sentence). */
	readonly planSummary?: string;
	/** Question-mode (`kind === 'question'`): the leading question text. */
	readonly questionText?: string;
	/** Question-mode: total number of questions in the batch. */
	readonly questionCount?: number;
}

export interface AgentSession {
	readonly id: string;
	readonly providerId: string;
	readonly providerName: string;
	readonly name?: string;
	readonly status: AgentSessionStatus;
	readonly phase: AgentSessionPhase;
	readonly statusDetail?: string;
	readonly worktreePath?: string;
	/** Common (parent) repo path shared by every worktree in this session's repo. Set together
	 *  with `worktreePath` by `resolveGitInfo` — equal to `worktreePath` for a default-worktree
	 *  session, otherwise the parent repo's common path. Use this for "same repo" identity
	 *  checks; {@link workspacePath} is the matched workspace folder, not repo identity.
	 *
	 *  `undefined` carries two meanings the host distinguishes internally (via the
	 *  `gitInfoUnresolvable` bookkeeping flag) but consumers should treat identically: either
	 *  "not yet resolved" (no probe completed) or "resolved but cwd is not inside any git repo".
	 *  Either way, no repo identity is available — never attempt to `path.join`/`path.resolve`
	 *  against it without an explicit `!= null` check. */
	readonly commonPath?: string;
	readonly pid?: number;
	readonly lastActivity: Date;
	readonly phaseSince: Date;
	readonly isSubagent: boolean;
	readonly parentId?: string;
	readonly subagents?: readonly AgentSession[];
	readonly pendingPermission?: PendingPermission;
	/** The VS Code workspace folder containing the agent's cwd, or `undefined` if cwd is outside
	 *  any open workspace folder. Used for `isInWorkspace` and "Open Folder" only — NOT for repo
	 *  identity. For "what repo is this session in", use {@link commonPath}. */
	readonly workspacePath?: string;
	readonly cwd?: string;
	readonly planFile?: string;
	readonly isInWorkspace: boolean;
	readonly lastPrompt?: string;
	readonly firstPrompt?: string;
	/** Absolute paths of files targeted by in-flight file-editing tool calls (Edit/Write/MultiEdit/
	 *  NotebookEdit). Populated on PreToolUse, drained on PostToolUse/PermissionDenied, cleared on
	 *  Stop/SessionEnd. Empty/undefined when no file-editing tool is active.
	 *
	 *  Mutable array form so `Shape<AgentSession>` projects it as `string[]` (the `Shape<>` type
	 *  mangles `readonly T[]` into a mapped object that loses its iterator). Treat as immutable. */
	currentFiles?: string[];
	/** Absolute paths of files the agent recently *read* (Read/NotebookRead). Populated on
	 *  PreToolUse, drained on PostToolUse/PermissionDenied with the same cooldown as
	 *  `currentFiles`. Distinct from `currentFiles` which tracks write-class tools so consumers can
	 *  visualize "looking at" vs "working on" differently. Treat as immutable. */
	currentReads?: string[];
	/** `true` when the session was discovered via peer IPC sync (i.e. another GitLens window hosts
	 *  the agent's hook flow and Claude Code extension panel). Locally-owned sessions leave this
	 *  unset. The dispatcher uses this to route opens through the peer's IPC route + an OS-level
	 *  window focus, since calling `claude-vscode.editor.open` in *our* extension only opens an
	 *  inert local view that isn't connected to the live session running in the peer.
	 *
	 *  Window-local: never serialized faithfully across the IPC wire. Each window decides locally
	 *  based on how it received the session — `querySiblingWindowSessions` always overrides to
	 *  `true` regardless of what the peer published. */
	readonly isPeerOwned?: boolean;
	/**
	 * Titles discovered by tailing the Claude Code transcript JSONL at
	 * `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Populated by
	 * `ClaudeCodeTranscriptReader`; used by `getSessionDisplayName` as a fallback when no
	 * harness-supplied `name` is available. Last occurrence in the transcript wins per type.
	 */
	readonly transcriptTitles?: {
		readonly custom?: string;
		readonly ai?: string;
		readonly agent?: string;
	};
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

	/** Resolves a pending permission. Returns `true` when the resolve was routed (the local IPC
	 *  owns the session's pending entry); `false` when no local entry exists (typically a peer-
	 *  discovered session owned by another GitLens window). Callers use this to give the user
	 *  feedback rather than a silent no-op. */
	resolvePermission?(
		sessionId: string,
		decision: PermissionDecision,
		updatedPermissions?: PermissionSuggestion[],
	): boolean;

	/** Asks the peer GitLens window that has `workspacePath` open (or any peer whose workspacePath
	 *  contains, or is contained by, it) to open the given session in its Claude Code extension
	 *  via the `agents/sessions/open` IPC route. Resolves to `true` when at least one peer claimed
	 *  the workspace AND was reachable; `false` otherwise. Best-effort: never rejects. The boolean
	 *  is currently a diagnostic signal only — the dispatcher fires this in parallel with
	 *  `vscode.openFolder` and relies on VS Code's window-folder matching to focus the owning
	 *  window (which works whether or not the peer runs GitLens). */
	notifyPeerOpenSession?(workspacePath: string, sessionId: string): Promise<boolean>;
}

/**
 * Host-supplied IPC service. The agents package registers handlers and publishes
 * the agents discovery file via this interface so it doesn't depend on the host's
 * IPC service directly.
 *
 * The agents package is the source of truth for the workspacePaths advertised in
 * the agents discovery file — `publishAgents` takes them as an argument and the host
 * is expected to re-publish whenever those paths change.
 */
export interface IpcRegistrar {
	readonly port: number | undefined;
	/** Directory scanned for peer-window agent discovery files. Omit to disable peer discovery (tests). */
	readonly agentDiscoveryDir?: string;
	registerHandler<Request = unknown, Response = unknown>(
		name: string,
		handler: IpcHandler<Request, Response>,
	): UnifiedDisposable;
	publishAgents(workspacePaths: string[]): Promise<void>;
	unpublishAgents(): Promise<void>;
}

export interface AgentProviderCallbacks {
	/** Host-supplied IPC service. Required for agents to receive hook events from the GK CLI. */
	ipc: IpcRegistrar;

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
	 * Resolve git metadata for a session's cwd. Returns the stable worktree path; the worktree's
	 * display name (branch name for branch-type worktrees) is intentionally NOT returned — it's
	 * resolved live at serialization time so `git checkout` updates display without restarting.
	 * Optional — if omitted, sessions won't have worktree metadata.
	 */
	resolveGitInfo?(cwd: string): Promise<
		| {
				repoRoot: string;
				isWorktree: boolean;
				worktreePath?: string;
		  }
		| undefined
	>;

	/**
	 * Open a Claude Code session in the Claude Code VS Code extension. Invoked by the IPC handler
	 * when a peer GitLens window asks this window to open a session on its behalf — the host wires
	 * this to `claude-vscode.editor.open`. Throws if the extension isn't installed/active.
	 */
	openSessionInClaudeExtension?(sessionId: string): Promise<void>;
}
