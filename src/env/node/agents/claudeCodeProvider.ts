import { execFile } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { kill } from 'process';
import type { Disposable } from 'vscode';
import { EventEmitter } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type {
	AgentSession,
	AgentSessionProvider,
	AgentSessionStatus,
	PendingPermission,
	PermissionSuggestion,
} from '../../../agents/provider.js';
import type { Container } from '../../../container.js';
import { gate } from '../../../system/decorators/gate.js';
import { runCLICommand } from '../gk/cli/utils.js';
import { AgentIpcServer } from './agentIpcServer.js';

interface AgentSessionEvent {
	event:
		| 'session-start'
		| 'session-end'
		| 'user-prompt'
		| 'pre-tool-use'
		| 'post-tool-use'
		| 'post-tool-use-failure'
		| 'stop'
		| 'subagent-start'
		| 'subagent-stop'
		| 'pre-compact'
		| 'notification';
	sessionId: string;
	cwd: string;
	pid?: number;
	source?: string;
	model?: string;
	reason?: string;
	toolName?: string;
	agentId?: string;
	agentType?: string;
	matchedWorkspacePath?: string;
	planFile?: string;
}

interface PermissionRequestEvent {
	sessionId: string;
	pid?: number;
	toolName: string;
	toolInput: Record<string, unknown>;
	permissionSuggestions?: PermissionSuggestion[];
}

interface PermissionResponse {
	decision: 'allow' | 'deny';
	updatedPermissions?: PermissionSuggestion[];
}

interface HookDecisionRequest {
	hookEventName: string;
	sessionId: string;
	pid?: number;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	permissionSuggestions?: PermissionSuggestion[];
}

interface PendingPermissionEntry {
	resolve(response: PermissionResponse): void;
	reject(reason: Error): void;
	toolName: string;
	toolDescription: string;
}

const staleCheckIntervalMs = 60 * 1000; // 1 minute
const discoveryDir = join(tmpdir(), 'gitkraken', 'gitlens', 'agents');

interface SessionFileData {
	sessionId: string;
	event: string;
	cwd: string;
	pid: number;
	matchedWorkspacePath?: string;
	toolName?: string | null;
	agentId?: string | null;
	agentType?: string | null;
	source?: string | null;
	model?: string | null;
	updatedAt: string;
	subagents?: { agentId: string; agentType: string }[];
	planFile?: string | null;
}

interface DiscoveryFile {
	token: string;
	address: string;
	port?: number;
	workspacePaths?: string[];
}

type SerializedAgentSession = Omit<AgentSession, 'lastActivity' | 'subagents'> & {
	lastActivity: string;
	subagents?: (Omit<AgentSession, 'lastActivity'> & { lastActivity: string })[];
};

export class ClaudeCodeProvider implements AgentSessionProvider {
	readonly id = 'claudeCode';
	readonly name = 'Claude Code';
	readonly icon = 'hubot';

	private readonly _onDidChangeSessions = new EventEmitter<void>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _sessions: AgentSession[] = [];
	private _ipcServer: AgentIpcServer | undefined;
	private _handlerDisposables: Disposable[] = [];
	private readonly _pendingPermissions = new Map<string, PendingPermissionEntry>();
	private readonly _sessionCwds = new Map<string, string>();
	private _workspacePaths: string[] = [];
	private _staleCheckTimer: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly container: Container) {}

	get sessions(): readonly AgentSession[] {
		return this._sessions;
	}

	start(workspacePaths: string[]): void {
		this._workspacePaths = workspacePaths;
		void this.ensureIpcServer(workspacePaths);
	}

	stop(): void {
		// IPC server stays up intentionally — hooks fire even when the window is unfocused
	}

	dispose(): void {
		this.stop();
		if (this._staleCheckTimer != null) {
			clearInterval(this._staleCheckTimer);
			this._staleCheckTimer = undefined;
		}
		for (const d of this._handlerDisposables) {
			d.dispose();
		}
		this._handlerDisposables = [];
		this._pendingPermissions.clear();
		this._ipcServer?.dispose();
		this._ipcServer = undefined;
		this._onDidChangeSessions.dispose();
	}

	@gate()
	private async ensureIpcServer(workspacePaths: string[]): Promise<void> {
		if (this._ipcServer != null) return;

		try {
			const server = new AgentIpcServer();
			await server.start({ workspacePaths: workspacePaths });

			// Register all handlers immediately after server start so the
			// server can accept requests (especially permission requests) with
			// zero delay — before any async restoration work.
			this._handlerDisposables = [
				server.registerHandler('agents/session', (request): Promise<void> => {
					if (request != null) {
						this.handleSessionEvent(request as AgentSessionEvent);
					}
					return Promise.resolve();
				}),
				server.registerHandler('agents/permission', request =>
					this.handlePermissionRequest(request as PermissionRequestEvent | undefined),
				),
				server.registerHandler('agents/hook', request =>
					this.handleHookDecision(request as HookDecisionRequest | undefined),
				),
				server.registerHandler('agents/sessions/list', () =>
					Promise.resolve(
						this._sessions.map(s => ({
							...s,
							lastActivity: s.lastActivity.toISOString(),
							subagents: s.subagents?.map(sub => ({
								...sub,
								lastActivity: sub.lastActivity.toISOString(),
							})),
						})),
					),
				),
			].filter((d): d is Disposable => d != null);

			this._ipcServer = server;

			// Restore sessions via gkcli after handlers are registered
			await this.syncSessions();

			// Query peers for sessions they know about (fire-and-forget)
			void this.queryPeersForSessions();

			// Start periodic sync to discover new sessions and remove phantom ones
			if (this._staleCheckTimer != null) {
				clearInterval(this._staleCheckTimer);
			}
			this._staleCheckTimer = setInterval(() => {
				void this.syncSessions();
			}, staleCheckIntervalMs);
		} catch (ex) {
			Logger.error(ex, 'ClaudeCodeProvider.ensureIpcServer');
		}
	}

	/**
	 * Derives session status directly from hook lifecycle events rather than
	 * reading the transcript file. The mapping follows the Claude Code hooks
	 * lifecycle:
	 *
	 * SessionStart → waiting
	 * UserPromptSubmit → thinking (Claude will process the prompt)
	 * PreToolUse → tool_use (tool is about to execute)
	 * PostToolUse / PostToolUseFailure → thinking (Claude is processing results)
	 * Stop → waiting (Claude finished, awaiting next prompt)
	 * SubagentStart / SubagentStop → manages subagent list
	 * PreCompact → compacting (context is being compacted)
	 * SessionEnd → removes session
	 */
	private handleSessionEvent(event: AgentSessionEvent): void {
		const isLocal = this.isLocalWorkspace(event.matchedWorkspacePath);

		switch (event.event) {
			case 'session-start': {
				const index = this.ensureSession(
					event.sessionId,
					event.pid,
					event.matchedWorkspacePath,
					isLocal,
					event.cwd,
					event.planFile,
				);
				// Reset to a clean 'waiting' state in case the session already
				// existed (e.g. implicitly created by an earlier hook event)
				this._sessions[index] = {
					...this._sessions[index],
					pid: event.pid ?? this._sessions[index].pid,
					status: 'waiting',
					statusDetail: undefined,
					pendingPermission: undefined,
					lastActivity: new Date(),
				};
				this._onDidChangeSessions.fire();
				this.container.telemetry.sendEvent('agents/session/started', { 'agent.provider': this.id });
				break;
			}

			case 'session-end': {
				const pending = this._pendingPermissions.get(event.sessionId);
				if (pending != null) {
					pending.reject(new Error('Session ended'));
					this._pendingPermissions.delete(event.sessionId);
				}

				const index = this._sessions.findIndex(s => s.id === event.sessionId);
				if (index >= 0) {
					this._sessions.splice(index, 1);
					this._onDidChangeSessions.fire();
				}
				this._sessionCwds.delete(event.sessionId);
				this.container.telemetry.sendEvent('agents/session/ended', { 'agent.provider': this.id });
				break;
			}

			case 'user-prompt':
				this.updateSessionStatus(
					event.sessionId,
					'thinking',
					undefined,
					event.pid,
					event.matchedWorkspacePath,
					isLocal,
					event.cwd,
					event.planFile,
				);
				break;

			case 'pre-tool-use':
				this.updateSessionStatus(
					event.sessionId,
					'tool_use',
					event.toolName,
					event.pid,
					event.matchedWorkspacePath,
					isLocal,
					event.cwd,
					event.planFile,
				);
				break;

			case 'post-tool-use':
			case 'post-tool-use-failure':
				this.updateSessionStatus(
					event.sessionId,
					'thinking',
					undefined,
					event.pid,
					event.matchedWorkspacePath,
					isLocal,
					event.cwd,
					event.planFile,
				);
				break;

			case 'stop':
				this.updateSessionStatus(
					event.sessionId,
					'waiting',
					undefined,
					event.pid,
					event.matchedWorkspacePath,
					isLocal,
					event.cwd,
					event.planFile,
				);
				break;

			case 'pre-compact':
				this.updateSessionStatus(
					event.sessionId,
					'compacting',
					undefined,
					event.pid,
					event.matchedWorkspacePath,
					isLocal,
					event.cwd,
					event.planFile,
				);
				break;

			case 'notification':
				// Reserved for future use
				break;

			case 'subagent-start': {
				const parentIdx = this.ensureSession(
					event.sessionId,
					event.pid,
					event.matchedWorkspacePath,
					isLocal,
					event.cwd,
					event.planFile,
				);
				const parent = this._sessions[parentIdx];
				if (event.agentId) {
					const subagent: AgentSession = {
						id: event.agentId,
						providerId: this.id,
						name: event.agentType ?? 'Subagent',
						status: 'thinking',
						lastActivity: new Date(),
						isSubagent: true,
						parentId: event.sessionId,
						isLocal: isLocal,
					};
					const existingSubs = parent.subagents ? [...parent.subagents] : [];
					existingSubs.push(subagent);
					this._sessions[parentIdx] = { ...parent, subagents: existingSubs };
					this._onDidChangeSessions.fire();
				}
				break;
			}

			case 'subagent-stop': {
				const parentIdx = this.ensureSession(
					event.sessionId,
					event.pid,
					event.matchedWorkspacePath,
					isLocal,
					event.cwd,
					event.planFile,
				);
				const parentSession = this._sessions[parentIdx];
				if (parentSession.subagents != null && event.agentId) {
					const filtered = parentSession.subagents.filter(s => s.id !== event.agentId);
					this._sessions[parentIdx] = {
						...parentSession,
						subagents: filtered.length > 0 ? filtered : undefined,
					};
					this._onDidChangeSessions.fire();
				}
				break;
			}
		}
	}

	/**
	 * Generic hook decision handler. Dispatches by `hookEventName` to the
	 * appropriate decision handler. Returns an empty response (no opinion)
	 * for unknown event types — the Go CLI treats an empty body as "no opinion"
	 * and the client closing the connection without responding has the same effect.
	 */
	private handleHookDecision(request: HookDecisionRequest | undefined): Promise<PermissionResponse | void> {
		if (request == null) {
			return Promise.resolve();
		}

		switch (request.hookEventName) {
			case 'PermissionRequest':
				return this.handlePermissionRequest({
					sessionId: request.sessionId,
					pid: request.pid,
					toolName: request.toolName ?? '',
					toolInput: request.toolInput ?? {},
					permissionSuggestions: request.permissionSuggestions,
				});
			default:
				return Promise.resolve();
		}
	}

	private handlePermissionRequest(request: PermissionRequestEvent | undefined): Promise<PermissionResponse> {
		if (request == null) {
			return Promise.resolve({ decision: 'deny' });
		}

		const { sessionId, pid, toolName, toolInput, permissionSuggestions } = request;
		const toolDescription = describeToolInput(toolName, toolInput);
		const toolInputDescription = (toolInput.description as string | undefined) || undefined;

		return new Promise<PermissionResponse>((resolve, reject) => {
			// If there's already a pending permission for this session, deny the old one
			const existing = this._pendingPermissions.get(sessionId);
			if (existing != null) {
				existing.resolve({ decision: 'deny' });
			}

			this._pendingPermissions.set(sessionId, {
				resolve: resolve,
				reject: reject,
				toolName: toolName,
				toolDescription: toolDescription,
			});

			const permission: PendingPermission = {
				toolName: toolName,
				toolDescription: toolDescription,
				toolInputDescription: toolInputDescription,
				suggestions: permissionSuggestions,
			};
			this.updateSessionWithPermission(sessionId, permission, pid);
		});
	}

	resolvePermission(
		sessionId: string,
		decision: 'allow' | 'deny',
		updatedPermissions?: PermissionSuggestion[],
	): void {
		const pending = this._pendingPermissions.get(sessionId);
		if (pending == null) return;

		pending.resolve({ decision: decision, updatedPermissions: updatedPermissions });
		this._pendingPermissions.delete(sessionId);

		// Revert session status back to thinking
		this.updateSessionStatus(sessionId, 'thinking');
	}

	private isLocalWorkspace(matchedWorkspacePath: string | undefined): boolean {
		if (matchedWorkspacePath == null) return false;
		return this._workspacePaths.some(
			p =>
				matchedWorkspacePath === p ||
				matchedWorkspacePath.startsWith(`${p}/`) ||
				p.startsWith(`${matchedWorkspacePath}/`),
		);
	}

	private updateSessionWithPermission(sessionId: string, permission: PendingPermission, pid?: number): void {
		const index = this.ensureSession(sessionId, pid);

		const prev = this._sessions[index];
		this._sessions[index] = {
			...prev,
			status: 'permission_requested',
			statusDetail: permission.toolDescription,
			pendingPermission: permission,
			lastActivity: new Date(),
		};
		this._onDidChangeSessions.fire();
	}

	private updateSessionStatus(
		sessionId: string,
		status: AgentSessionStatus,
		statusDetail?: string,
		pid?: number,
		matchedWorkspacePath?: string,
		isLocal?: boolean,
		cwd?: string,
		planFile?: string,
	): void {
		const index = this.ensureSession(sessionId, pid, matchedWorkspacePath, isLocal, cwd, planFile);

		const prev = this._sessions[index];
		if (prev.status === status && prev.statusDetail === statusDetail) return;

		this._sessions[index] = {
			...prev,
			status: status,
			statusDetail: statusDetail,
			pendingPermission: undefined,
			lastActivity: new Date(),
		};
		this._onDidChangeSessions.fire();

		if (status === 'thinking' || status === 'tool_use' || status === 'compacting') {
			const sessionCwd = this._sessionCwds.get(sessionId);
			if (sessionCwd != null) {
				const repo = this.container.git.getRepository(sessionCwd);
				if (repo != null) {
					queueMicrotask(() => repo.git.branches.onCurrentBranchAgentActivity?.());
				}
			}
		}
	}

	/**
	 * Returns the index of an existing session, or creates a new one if a
	 * session with this ID doesn't exist yet. This handles the case where a
	 * Claude Code session was already running before GitLens started —
	 * the `session-start` hook will have already fired, so we allow any
	 * subsequent hook event to implicitly start the session.
	 */
	private ensureSession(
		sessionId: string,
		pid?: number,
		workspacePath?: string,
		isLocal?: boolean,
		cwd?: string,
		planFile?: string,
	): number {
		let index = this._sessions.findIndex(s => s.id === sessionId);
		if (index < 0) {
			index = this._sessions.length;
			this._sessions.push({
				id: sessionId,
				providerId: this.id,
				name: this.name,
				status: 'waiting',
				pid: pid,
				lastActivity: new Date(),
				isSubagent: false,
				workspacePath: workspacePath,
				planFile: planFile,
				isLocal: isLocal ?? false,
			});
			this._onDidChangeSessions.fire();

			// Resolve branch & worktree info asynchronously from the cwd
			if (cwd != null) {
				this._sessionCwds.set(sessionId, cwd);
				void this.resolveGitInfo(sessionId, cwd);
			}
		} else {
			// Update fields that may have been missing or stale when the
			// session was first created (e.g. restored from disk without a
			// matched workspace, or created by the permission handler before
			// a session-start event arrived).
			const existing = this._sessions[index];
			const updatedPid = pid != null && existing.pid == null ? pid : existing.pid;
			const updatedWorkspacePath = workspacePath ?? existing.workspacePath;
			const updatedIsLocal = workspacePath != null ? (isLocal ?? existing.isLocal) : existing.isLocal;
			const updatedPlanFile = planFile ?? existing.planFile;

			if (
				updatedPid !== existing.pid ||
				updatedWorkspacePath !== existing.workspacePath ||
				updatedIsLocal !== existing.isLocal ||
				updatedPlanFile !== existing.planFile
			) {
				this._sessions[index] = {
					...existing,
					pid: updatedPid,
					workspacePath: updatedWorkspacePath,
					planFile: updatedPlanFile,
					isLocal: updatedIsLocal,
				};
			}

			// Re-resolve git info if we now have a cwd but didn't before
			if (cwd != null) {
				this._sessionCwds.set(sessionId, cwd);
				if (existing.branch == null) {
					void this.resolveGitInfo(sessionId, cwd);
				}
			}
		}
		return index;
	}

	private async resolveGitInfo(sessionId: string, cwd: string): Promise<void> {
		try {
			const [branch, worktreeName] = await Promise.all([
				gitExec(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'),
				gitExec(cwd, 'rev-parse', '--show-toplevel').then(
					toplevel => {
						// If the toplevel is different from the commondir, this is a worktree
						return gitExec(cwd, 'rev-parse', '--git-common-dir').then(commonDir => {
							// In a worktree, common-dir points to the main repo's .git dir;
							// in a normal repo, it equals --git-dir. Compare to detect worktree.
							return gitExec(cwd, 'rev-parse', '--git-dir').then(gitDir => {
								if (commonDir !== gitDir) {
									return basename(toplevel);
								}
								return undefined;
							});
						});
					},
					() => undefined,
				),
			]);

			const index = this._sessions.findIndex(s => s.id === sessionId);
			if (index < 0) return;

			const session = this._sessions[index];
			const resolvedBranch = branch || undefined;
			if (resolvedBranch !== session.branch || worktreeName !== session.worktreeName) {
				this._sessions[index] = {
					...session,
					branch: resolvedBranch,
					worktreeName: worktreeName,
				};
				this._onDidChangeSessions.fire();
			}
		} catch {
			// Git not available or not a git repo — leave branch/worktree undefined
		}
	}

	/**
	 * Queries gkcli for persisted session state, adding newly discovered
	 * alive sessions to memory and removing in-memory sessions whose
	 * processes are no longer alive.
	 */
	private async syncSessions(): Promise<void> {
		let sessions: SessionFileData[];
		try {
			const output = await runCLICommand(['ai', 'hook', 'list-sessions', '--json']);
			sessions = JSON.parse(output) as SessionFileData[];
		} catch {
			// CLI not available or command failed — only clean up stale in-memory sessions
			const before = this._sessions.length;
			const removedIds = new Set(
				this._sessions.filter(s => s.pid != null && !isProcessAlive(s.pid)).map(s => s.id),
			);
			this._sessions = this._sessions.filter(s => s.pid == null || isProcessAlive(s.pid));
			if (this._sessions.length !== before) {
				for (const id of removedIds) {
					this._sessionCwds.delete(id);
				}
				this._onDidChangeSessions.fire();
			}
			return;
		}

		let changed = false;

		for (const data of sessions) {
			if (!data.sessionId || !data.pid || !isProcessAlive(data.pid)) {
				continue;
			}

			// Skip if we already have this session
			if (this._sessions.some(s => s.id === data.sessionId)) continue;

			const isLocal = this.isLocalWorkspace(data.matchedWorkspacePath);
			const status = deriveStatusFromEvent(data.event);

			const subagents: AgentSession[] | undefined = data.subagents?.map(sub => ({
				id: sub.agentId,
				providerId: this.id,
				name: sub.agentType ?? 'Subagent',
				status: 'thinking',
				lastActivity: new Date(data.updatedAt),
				isSubagent: true,
				parentId: data.sessionId,
				isLocal: isLocal,
			}));

			this._sessions.push({
				id: data.sessionId,
				providerId: this.id,
				name: this.name,
				status: status,
				statusDetail: data.toolName ?? undefined,
				pid: data.pid,
				lastActivity: new Date(data.updatedAt),
				isSubagent: false,
				workspacePath: data.matchedWorkspacePath,
				planFile: data.planFile ?? undefined,
				isLocal: isLocal,
				subagents: subagents != null && subagents.length > 0 ? subagents : undefined,
			});
			changed = true;

			// Resolve branch & worktree info from the session's cwd
			if (data.cwd) {
				void this.resolveGitInfo(data.sessionId, data.cwd);
			}
		}

		// Remove in-memory sessions whose PIDs are no longer alive
		const before = this._sessions.length;
		const removedIds = new Set(this._sessions.filter(s => s.pid != null && !isProcessAlive(s.pid)).map(s => s.id));
		this._sessions = this._sessions.filter(s => s.pid == null || isProcessAlive(s.pid));
		if (this._sessions.length !== before) {
			for (const id of removedIds) {
				this._sessionCwds.delete(id);
			}
			changed = true;
		}

		if (changed) {
			this._onDidChangeSessions.fire();
		}
	}

	private async queryPeersForSessions(): Promise<void> {
		let files: string[];
		try {
			files = await readdir(discoveryDir);
		} catch {
			return;
		}

		const ownPort = this._ipcServer?.port;
		let changed = false;

		for (const file of files) {
			if (!file.startsWith('gitlens-ipc-server-') || !file.endsWith('.json')) continue;

			let discovery: DiscoveryFile;
			try {
				const raw = await readFile(join(discoveryDir, file), 'utf8');
				discovery = JSON.parse(raw) as DiscoveryFile;
			} catch {
				continue;
			}

			// Skip our own server
			if (ownPort != null && discovery.port === ownPort) continue;

			try {
				const response = await fetch(`${discovery.address}/agents/sessions/list`, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${discovery.token}`,
						'Content-Type': 'application/json',
					},
					body: '{}',
					signal: AbortSignal.timeout(2000),
				});

				if (!response.ok) continue;

				const peerSessions = (await response.json()) as SerializedAgentSession[];
				for (const peerSession of peerSessions) {
					const peerActivity = new Date(peerSession.lastActivity);
					const isLocal = this.isLocalWorkspace(peerSession.workspacePath);

					const existing = this._sessions.find(s => s.id === peerSession.id);
					if (existing != null) {
						// Only overwrite if peer has newer data
						if (peerActivity > existing.lastActivity) {
							const idx = this._sessions.indexOf(existing);
							this._sessions[idx] = {
								...existing,
								status: peerSession.status,
								statusDetail: peerSession.statusDetail,
								lastActivity: peerActivity,
								isLocal: isLocal,
								subagents: rehydrateSubagents(peerSession.subagents),
							};
							changed = true;
						}
					} else {
						this._sessions.push({
							...peerSession,
							lastActivity: peerActivity,
							isLocal: isLocal,
							subagents: rehydrateSubagents(peerSession.subagents),
						});
						changed = true;
					}
				}
			} catch {
				// Peer unavailable — skip
			}
		}

		if (changed) {
			this._onDidChangeSessions.fire();
		}
	}
}

function deriveStatusFromEvent(event: string): AgentSessionStatus {
	switch (event) {
		case 'session-start':
		case 'stop':
			return 'waiting';
		case 'pre-tool-use':
			return 'tool_use';
		case 'pre-compact':
			return 'compacting';
		case 'user-prompt':
		case 'post-tool-use':
		case 'post-tool-use-failure':
		case 'subagent-start':
		case 'subagent-stop':
			return 'thinking';
		default:
			return 'waiting';
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function rehydrateSubagents(
	subagents: (Omit<AgentSession, 'lastActivity'> & { lastActivity: string })[] | undefined,
): AgentSession[] | undefined {
	if (subagents == null || subagents.length === 0) return undefined;
	return subagents.map(s => ({
		...s,
		lastActivity: new Date(s.lastActivity),
	}));
}

function describeToolInput(toolName: string, toolInput: Record<string, unknown>): string {
	let detail: string | undefined;
	switch (toolName) {
		case 'Bash':
			detail = toolInput.command as string | undefined;
			break;
		case 'Edit':
		case 'Write':
		case 'Read':
			detail = toolInput.file_path as string | undefined;
			break;
		case 'Grep':
			detail = toolInput.pattern as string | undefined;
			break;
		case 'Glob':
			detail = toolInput.pattern as string | undefined;
			break;
		case 'WebFetch':
			detail = toolInput.url as string | undefined;
			break;
		case 'WebSearch':
			detail = toolInput.query as string | undefined;
			break;
		case 'NotebookEdit':
			detail = toolInput.notebook_path as string | undefined;
			break;
	}

	return detail != null ? `${toolName}(${detail})` : toolName;
}

function gitExec(cwd: string, ...args: string[]): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		execFile('git', args, { cwd: cwd, timeout: 5000 }, (error, stdout) => {
			if (error != null) {
				reject(error as Error);
				return;
			}
			resolve(stdout.trim());
		});
	});
}
