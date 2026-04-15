import { readdir, readFile } from 'fs/promises';
import { join, sep } from 'path';
import { gate } from '@gitlens/utils/decorators/gate.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { Emitter } from '@gitlens/utils/event.js';
import { Logger } from '@gitlens/utils/logger.js';
import { agentDiscoveryDir, AgentIpcServer } from '../agentIpcServer.js';
import { deriveStatusFromEvent, describeToolInput, isProcessAlive, rehydrateSubagents } from '../stateMachine.js';
import type {
	AgentProviderCallbacks,
	AgentSession,
	AgentSessionProvider,
	AgentSessionStatus,
	PendingPermission,
	PermissionSuggestion,
} from '../types.js';
import { getPhaseForStatus } from '../types.js';

interface AgentSessionEvent {
	event:
		| 'SessionStart'
		| 'SessionEnd'
		| 'UserPromptSubmit'
		| 'PreToolUse'
		| 'PostToolUse'
		| 'PostToolUseFailure'
		| 'Notification'
		| 'Stop'
		| 'StopFailure'
		| 'SubagentStart'
		| 'SubagentStop'
		| 'TeammateIdle'
		| 'TaskCompleted'
		| 'InstructionsLoaded'
		| 'ConfigChange'
		| 'WorktreeCreate'
		| 'WorktreeRemove'
		| 'PreCompact'
		| 'PostCompact'
		| 'Elicitation'
		| 'ElicitationResult'
		| 'PermissionRequest'
		| 'PermissionDenied'
		| 'CwdChanged';
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
	notificationType?: string;
	sessionName?: string;
	prompt?: string;
	toolInput?: Record<string, unknown>;
	permissionSuggestions?: PermissionSuggestion[];
	hookInput?: Record<string, unknown>;
}

interface PermissionResponse {
	hookSpecificOutput: {
		hookEventName: 'PermissionRequest';
		decision: {
			behavior: 'allow' | 'deny';
			updatedPermissions?: PermissionSuggestion[];
		};
	};
}

interface PendingPermissionEntry {
	resolve(response: PermissionResponse): void;
	reject(reason: Error): void;
	toolName: string;
	toolDescription: string;
}

interface SessionBookkeeping {
	activeToolCount: number;
	pendingPermission?: PendingPermission;
	phaseSince: Date;
}

const staleCheckIntervalMs = 60 * 1000; // 1 minute

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
	sessionName?: string | null;
	prompt?: string | null;
}

interface DiscoveryFile {
	token: string;
	address: string;
	port?: number;
	workspacePaths?: string[];
}

type SerializedAgentSession = Omit<AgentSession, 'lastActivity' | 'phaseSince' | 'subagents'> & {
	lastActivity: string;
	phaseSince: string;
	subagents?: (Omit<AgentSession, 'lastActivity' | 'phaseSince'> & {
		lastActivity: string;
		phaseSince: string;
	})[];
};

export class ClaudeCodeProvider implements AgentSessionProvider {
	readonly id = 'claudeCode';
	readonly name = 'Claude Code';
	readonly icon = 'hubot';

	private readonly _onDidChangeSessions = new Emitter<void>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _sessions: AgentSession[] = [];
	private _ipcServer: AgentIpcServer | undefined;
	private _handlerDisposables: UnifiedDisposable[] = [];
	private readonly _pendingPermissions = new Map<string, PendingPermissionEntry>();
	private readonly _sessionBookkeeping = new Map<string, SessionBookkeeping>();
	private _workspacePaths: string[] = [];
	private _staleCheckTimer: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly callbacks: AgentProviderCallbacks) {}

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
		for (const pending of this._pendingPermissions.values()) {
			pending.reject(new Error('Provider disposed'));
		}
		this._pendingPermissions.clear();
		this._sessionBookkeeping.clear();
		this._ipcServer?.dispose();
		this._ipcServer = undefined;
		this._onDidChangeSessions.dispose();
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	@gate<typeof ClaudeCodeProvider.prototype.ensureIpcServer>()
	private async ensureIpcServer(workspacePaths: string[]): Promise<void> {
		if (this._ipcServer != null) return;

		try {
			const server = new AgentIpcServer();
			await server.start({ workspacePaths: workspacePaths });

			// Register all handlers immediately after server start so the
			// server can accept requests (especially permission requests) with
			// zero delay — before any async restoration work.
			this._handlerDisposables = [
				server.registerHandler('agents/session', (request, searchParams) => {
					if (request != null) {
						const isBlocking = searchParams.get('blocking') === 'true';
						return this.handleSessionEvent(request as AgentSessionEvent, isBlocking);
					}
					return Promise.resolve();
				}),
				server.registerHandler('agents/sessions/list', () =>
					Promise.resolve(
						this._sessions.map(s => ({
							...s,
							lastActivity: s.lastActivity.toISOString(),
							phaseSince: s.phaseSince.toISOString(),
							subagents: s.subagents?.map(sub => ({
								...sub,
								lastActivity: sub.lastActivity.toISOString(),
								phaseSince: sub.phaseSince.toISOString(),
							})),
						})),
					),
				),
			].filter((d): d is UnifiedDisposable => d != null);

			this._ipcServer = server;

			// Restore sessions via gkcli after handlers are registered
			await this.syncSessions();

			// Query peers for sessions they know about (fire-and-forget)
			void this.querySiblingWindowSessions();

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
	 * reading the transcript file. Uses `activeToolCount` to correctly track
	 * parallel tool execution — status only transitions from `tool_use` to
	 * `thinking` when ALL concurrent tools have completed.
	 *
	 * SessionStart → waiting (resets tool count)
	 * UserPromptSubmit → thinking
	 * PreToolUse → tool_use (increments tool count)
	 * PostToolUse / PostToolUseFailure → thinking only when tool count reaches 0
	 * Stop / StopFailure → waiting (resets tool count)
	 * Notification → dispatches on notificationType (idle_prompt, permission_prompt, elicitation_dialog)
	 * PermissionDenied → decrements tool count, transitions accordingly
	 * Elicitation → permission_requested
	 * ElicitationResult → tool_use if tools active, else thinking
	 * CwdChanged → updates cwd only
	 * SubagentStart / SubagentStop → manages subagent list
	 * PreCompact → compacting
	 * PostCompact → thinking
	 * SessionEnd → removes session
	 */
	private handleSessionEvent(event: AgentSessionEvent, isBlocking: boolean): Promise<PermissionResponse | void> {
		const isInWorkspace = this.matchesWorkspace(event.matchedWorkspacePath);
		const eventContext = {
			pid: event.pid,
			matchedWorkspacePath: event.matchedWorkspacePath,
			isInWorkspace: isInWorkspace,
			cwd: event.cwd,
			planFile: event.planFile,
			sessionName: event.sessionName,
		};
		const sessionTag = `[session=${event.sessionId.substring(0, 8)}(${event.sessionName ?? 'unnamed'})]`;

		if (event.event === 'SessionStart' || event.event === 'SessionEnd') {
			Logger.info(`ClaudeCodeProvider.handleSessionEvent: ${event.event} ${sessionTag}`);
		} else {
			Logger.debug(
				`ClaudeCodeProvider.handleSessionEvent: ${event.event} ${sessionTag}${event.toolName ? ` tool=${event.toolName}` : ''}${event.agentId ? ` agent=${event.agentId}` : ''}${event.notificationType ? ` type=${event.notificationType}` : ''}`,
			);
		}

		switch (event.event) {
			case 'SessionStart': {
				const { index } = this.ensureSession(
					event.sessionId,
					event.pid,
					event.matchedWorkspacePath,
					isInWorkspace,
					event.cwd,
					event.planFile,
					event.sessionName,
				);
				// Reset to a clean 'idle' state in case the session already
				// existed (e.g. implicitly created by an earlier hook event)
				this.resetBookkeeping(event.sessionId, 'idle');
				this._sessions[index] = {
					...this._sessions[index],
					pid: event.pid ?? this._sessions[index].pid,
					status: 'idle',
					phase: getPhaseForStatus('idle'),
					phaseSince: this.getBookkeeping(event.sessionId).phaseSince,
					statusDetail: undefined,
					pendingPermission: undefined,
					lastActivity: new Date(),
				};
				this._onDidChangeSessions.fire();
				this.callbacks.sendTelemetryEvent?.('agents/session/started', { 'agent.provider': this.id });
				break;
			}

			case 'SessionEnd': {
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
				this._sessionBookkeeping.delete(event.sessionId);
				this.callbacks.sendTelemetryEvent?.('agents/session/ended', { 'agent.provider': this.id });
				break;
			}

			case 'UserPromptSubmit': {
				const { index } = this.ensureSession(
					event.sessionId,
					event.pid,
					event.matchedWorkspacePath,
					isInWorkspace,
					event.cwd,
					event.planFile,
					event.sessionName,
				);
				if (event.prompt) {
					this._sessions[index] = {
						...this._sessions[index],
						lastPrompt: event.prompt.length > 500 ? event.prompt.slice(0, 500) : event.prompt,
					};
				}
				this.clearStalePermission(event.sessionId, 'UserPromptSubmit');
				this.updateSessionStatus(event.sessionId, 'thinking', eventContext);
				break;
			}

			case 'PreToolUse': {
				const bk = this.getBookkeeping(event.sessionId);
				bk.activeToolCount++;
				this.updateSessionStatus(event.sessionId, 'tool_use', {
					...eventContext,
					statusDetail: event.toolName,
				});
				break;
			}

			case 'PostToolUse':
			case 'PostToolUseFailure': {
				this.clearStalePermission(event.sessionId, event.event);
				const bk = this.getBookkeeping(event.sessionId);
				bk.activeToolCount = Math.max(0, bk.activeToolCount - 1);
				if (bk.activeToolCount === 0) {
					this.updateSessionStatus(event.sessionId, 'thinking', eventContext);
				}
				break;
			}

			case 'Stop':
			case 'StopFailure': {
				const pending = this._pendingPermissions.get(event.sessionId);
				if (pending != null) {
					pending.reject(new Error('Session stopped'));
					this._pendingPermissions.delete(event.sessionId);
				}
				this.resetBookkeeping(event.sessionId, 'idle');
				this.updateSessionStatus(event.sessionId, 'idle', eventContext);
				break;
			}

			case 'PreCompact':
				this.updateSessionStatus(event.sessionId, 'compacting', eventContext);
				break;

			case 'PostCompact':
				this.updateSessionStatus(event.sessionId, 'thinking', eventContext);
				break;

			case 'Notification':
				switch (event.notificationType) {
					case 'idle_prompt':
						// No-op — session is already idle from the preceding stop/session-start event
						break;
					case 'permission_prompt':
					case 'elicitation_dialog':
						this.updateSessionStatus(event.sessionId, 'permission_requested', {
							...eventContext,
							statusDetail: event.toolName,
						});
						break;
					default:
						// auth_success, unknown, or missing: no status change, just update timestamp
						break;
				}
				break;

			case 'PermissionRequest': {
				// Read from hookInput (raw passthrough) with fallback to top-level
				// fields for backward compatibility with older CLI versions.
				const hookInput = event.hookInput;
				const toolInput = (hookInput?.tool_input as Record<string, unknown> | undefined) ?? event.toolInput;
				if (isBlocking && toolInput != null) {
					const toolName = (hookInput?.tool_name as string | undefined) ?? event.toolName ?? '';
					const toolDescription = describeToolInput(toolName, toolInput);
					const toolInputDescription = (toolInput.description as string | undefined) || undefined;

					return new Promise<PermissionResponse>((resolve, reject) => {
						// If there's already a pending permission for this session, deny the old one
						const existing = this._pendingPermissions.get(event.sessionId);
						if (existing != null) {
							Logger.debug(
								`ClaudeCodeProvider.handleSessionEvent: auto-denying stale permission ${sessionTag} tool=${existing.toolName}`,
							);
							existing.resolve({
								hookSpecificOutput: {
									hookEventName: 'PermissionRequest',
									decision: { behavior: 'deny' },
								},
							});
						}

						this._pendingPermissions.set(event.sessionId, {
							resolve: resolve,
							reject: reject,
							toolName: toolName,
							toolDescription: toolDescription,
						});

						const permission: PendingPermission = {
							toolName: toolName,
							toolDescription: toolDescription,
							toolInputDescription: toolInputDescription,
							suggestions:
								(hookInput?.permission_suggestions as PermissionSuggestion[] | undefined) ??
								event.permissionSuggestions,
						};
						this.updateSessionWithPermission(event.sessionId, permission, event.pid);
					});
				}

				this.updateSessionStatus(event.sessionId, 'permission_requested', {
					...eventContext,
					statusDetail: event.toolName,
				});
				break;
			}

			case 'PermissionDenied': {
				this.clearStalePermission(event.sessionId, 'PermissionDenied');
				const bk = this.getBookkeeping(event.sessionId);
				bk.activeToolCount = Math.max(0, bk.activeToolCount - 1);
				this.updateSessionStatus(
					event.sessionId,
					bk.activeToolCount > 0 ? 'tool_use' : 'thinking',
					eventContext,
				);
				break;
			}

			case 'Elicitation': {
				const bk = this.getBookkeeping(event.sessionId);
				bk.pendingPermission = {
					toolName: event.toolName ?? 'Input Required',
					toolDescription: event.toolName ?? 'Waiting for input',
				};
				this.updateSessionStatus(event.sessionId, 'permission_requested', {
					...eventContext,
					statusDetail: event.toolName,
				});
				break;
			}

			case 'ElicitationResult': {
				const bk = this.getBookkeeping(event.sessionId);
				bk.pendingPermission = undefined;
				this.updateSessionStatus(
					event.sessionId,
					bk.activeToolCount > 0 ? 'tool_use' : 'thinking',
					eventContext,
				);
				break;
			}

			case 'CwdChanged':
				if (event.cwd) {
					const index = this._sessions.findIndex(s => s.id === event.sessionId);
					if (index >= 0 && this._sessions[index].cwd !== event.cwd) {
						this._sessions[index] = { ...this._sessions[index], cwd: event.cwd };
						this._onDidChangeSessions.fire();
					}
					void this.resolveGitInfo(event.sessionId, event.cwd);
				}
				break;

			case 'SubagentStart': {
				const { index: parentIdx } = this.ensureSession(
					event.sessionId,
					event.pid,
					event.matchedWorkspacePath,
					isInWorkspace,
					event.cwd,
					event.planFile,
				);
				const parent = this._sessions[parentIdx];
				if (event.agentId) {
					const now = new Date();
					const subagent: AgentSession = {
						id: event.agentId,
						providerId: this.id,
						name: event.agentType ?? 'Subagent',
						status: 'thinking',
						phase: 'working',
						phaseSince: now,
						lastActivity: now,
						isSubagent: true,
						parentId: event.sessionId,
						isInWorkspace: isInWorkspace,
					};
					const existingSubs = parent.subagents ? [...parent.subagents] : [];
					existingSubs.push(subagent);
					this._sessions[parentIdx] = { ...parent, subagents: existingSubs };
					this._onDidChangeSessions.fire();
				}
				break;
			}

			case 'SubagentStop': {
				const { index: parentIdx } = this.ensureSession(
					event.sessionId,
					event.pid,
					event.matchedWorkspacePath,
					isInWorkspace,
					event.cwd,
					event.planFile,
				);
				const parentSession = this._sessions[parentIdx];
				if (parentSession.subagents != null && event.agentId) {
					const filtered = parentSession.subagents.filter(s => s.id !== event.agentId);
					if (filtered.length !== parentSession.subagents.length) {
						this._sessions[parentIdx] = {
							...parentSession,
							subagents: filtered.length > 0 ? filtered : undefined,
						};
						this._onDidChangeSessions.fire();
					}
				}
				break;
			}
		}

		return Promise.resolve();
	}

	private getBookkeeping(sessionId: string): SessionBookkeeping {
		let bk = this._sessionBookkeeping.get(sessionId);
		if (bk == null) {
			bk = { activeToolCount: 0, phaseSince: new Date() };
			this._sessionBookkeeping.set(sessionId, bk);
		}
		return bk;
	}

	private resetBookkeeping(sessionId: string, newStatus: AgentSessionStatus): void {
		const bk = this.getBookkeeping(sessionId);
		const oldPhase = this._sessions.find(s => s.id === sessionId)?.phase;
		const newPhase = getPhaseForStatus(newStatus);
		bk.activeToolCount = 0;
		bk.pendingPermission = undefined;
		if (oldPhase !== newPhase) {
			bk.phaseSince = new Date();
		}
	}

	/**
	 * Clears a pending permission that was resolved outside of GitLens (e.g.
	 * the user approved/denied in the CLI terminal). Resolves the blocking
	 * promise with 'deny' (safe no-op — the tool already ran or was denied)
	 * and clears the bookkeeping so the sticky guard in updateSessionStatus
	 * no longer blocks transitions.
	 */
	private clearStalePermission(sessionId: string, reason: string): void {
		const bk = this.getBookkeeping(sessionId);
		if (bk.pendingPermission == null) return;

		Logger.debug(`ClaudeCodeProvider.clearStalePermission: ${reason} [session=${sessionId.substring(0, 8)}]`);

		const pending = this._pendingPermissions.get(sessionId);
		if (pending != null) {
			pending.resolve({
				hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny' } },
			});
			this._pendingPermissions.delete(sessionId);
		}

		bk.pendingPermission = undefined;
	}

	resolvePermission(
		sessionId: string,
		decision: 'allow' | 'deny',
		updatedPermissions?: PermissionSuggestion[],
	): void {
		const pending = this._pendingPermissions.get(sessionId);
		if (pending == null) return;

		Logger.debug(
			`ClaudeCodeProvider.resolvePermission: ${decision} [session=${sessionId.substring(0, 8)}] tool=${pending.toolName}`,
		);
		pending.resolve({
			hookSpecificOutput: {
				hookEventName: 'PermissionRequest',
				decision: { behavior: decision, updatedPermissions: updatedPermissions },
			},
		});
		this.callbacks.sendTelemetryEvent?.('agents/permission/resolved', {
			'agent.provider': this.id,
			'permission.tool': pending.toolName,
			'permission.decision': decision,
		});
		this._pendingPermissions.delete(sessionId);

		const bk = this.getBookkeeping(sessionId);
		bk.pendingPermission = undefined;

		// Derive status from tool count instead of hardcoding 'thinking'
		const nextStatus = bk.activeToolCount > 0 ? 'tool_use' : 'thinking';
		this.updateSessionStatus(sessionId, nextStatus);
	}

	private matchesWorkspace(matchedWorkspacePath: string | undefined): boolean {
		if (!matchedWorkspacePath) return false;
		return this._workspacePaths.some(
			p =>
				matchedWorkspacePath === p ||
				matchedWorkspacePath.startsWith(`${p}${sep}`) ||
				p.startsWith(`${matchedWorkspacePath}${sep}`),
		);
	}

	private updateSessionWithPermission(sessionId: string, permission: PendingPermission, pid?: number): void {
		const { index } = this.ensureSession(sessionId, pid);

		const prev = this._sessions[index];
		const newPhase = getPhaseForStatus('permission_requested');
		const bk = this.getBookkeeping(sessionId);
		bk.pendingPermission = permission;
		if (prev.phase !== newPhase) {
			bk.phaseSince = new Date();
		}
		this._sessions[index] = {
			...prev,
			status: 'permission_requested',
			phase: newPhase,
			phaseSince: bk.phaseSince,
			statusDetail: permission.toolDescription,
			pendingPermission: permission,
			lastActivity: new Date(),
		};
		this._onDidChangeSessions.fire();
	}

	private updateSessionStatus(
		sessionId: string,
		status: AgentSessionStatus,
		options?: {
			statusDetail?: string;
			pid?: number;
			matchedWorkspacePath?: string;
			isInWorkspace?: boolean;
			cwd?: string;
			planFile?: string;
			sessionName?: string;
		},
	): void {
		const { index, changed: metadataChanged } = this.ensureSession(
			sessionId,
			options?.pid,
			options?.matchedWorkspacePath,
			options?.isInWorkspace,
			options?.cwd,
			options?.planFile,
			options?.sessionName,
		);

		const prev = this._sessions[index];
		const bk = this.getBookkeeping(sessionId);

		// If a permission/elicitation is pending, preserve permission_requested state.
		// Tool counts and other bookkeeping are still updated by callers before this
		// method, but the visible status remains locked until the wait is explicitly
		// resolved.
		if (bk.pendingPermission != null && status !== 'permission_requested') {
			this._sessions[index] = { ...prev, lastActivity: new Date() };
			if (metadataChanged) {
				this._onDidChangeSessions.fire();
			}
			return;
		}

		const statusDetail = options?.statusDetail;
		if (prev.status === status && prev.statusDetail === statusDetail) {
			if (metadataChanged) {
				this._onDidChangeSessions.fire();
			}
			return;
		}

		const newPhase = getPhaseForStatus(status);
		if (prev.phase !== newPhase) {
			bk.phaseSince = new Date();
		}

		this._sessions[index] = {
			...prev,
			status: status,
			phase: newPhase,
			phaseSince: bk.phaseSince,
			statusDetail: statusDetail,
			pendingPermission: status === 'permission_requested' ? bk.pendingPermission : undefined,
			lastActivity: new Date(),
		};
		this._onDidChangeSessions.fire();

		if (status === 'thinking' || status === 'tool_use' || status === 'compacting') {
			const sessionCwd = this._sessions[index].cwd;
			if (sessionCwd != null) {
				this.callbacks.onBranchAgentActivity?.(sessionCwd);
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
		isInWorkspace?: boolean,
		cwd?: string,
		planFile?: string,
		sessionName?: string,
	): { index: number; changed: boolean } {
		let index = this._sessions.findIndex(s => s.id === sessionId);
		if (index < 0) {
			const now = new Date();
			const bk = this.getBookkeeping(sessionId);
			bk.phaseSince = now;
			index = this._sessions.length;
			this._sessions.push({
				id: sessionId,
				providerId: this.id,
				name: sessionName || this.name,
				status: 'idle',
				phase: getPhaseForStatus('idle'),
				phaseSince: now,
				pid: pid,
				lastActivity: now,
				isSubagent: false,
				workspacePath: workspacePath,
				cwd: cwd,
				planFile: planFile,
				isInWorkspace: isInWorkspace ?? false,
			});
			Logger.debug(
				`ClaudeCodeProvider.ensureSession: implicitly created [session=${sessionId.substring(0, 8)}(${sessionName ?? 'unnamed'})]`,
			);
			this._onDidChangeSessions.fire();

			// Resolve branch & worktree info asynchronously from the cwd
			if (cwd != null) {
				void this.resolveGitInfo(sessionId, cwd);
			}
			return { index: index, changed: true };
		}

		// Update fields that may have been missing or stale when the
		// session was first created (e.g. restored from disk without a
		// matched workspace, or created by the permission handler before
		// a session-start event arrived).
		const existing = this._sessions[index];
		const updatedPid = pid != null && existing.pid == null ? pid : existing.pid;
		const updatedWorkspacePath = workspacePath || existing.workspacePath;
		const updatedIsInWorkspace = workspacePath ? (isInWorkspace ?? existing.isInWorkspace) : existing.isInWorkspace;
		const updatedPlanFile = planFile ?? existing.planFile;
		const updatedName = sessionName || existing.name;
		const updatedCwd = cwd ?? existing.cwd;

		let changed = false;
		if (
			updatedPid !== existing.pid ||
			updatedWorkspacePath !== existing.workspacePath ||
			updatedIsInWorkspace !== existing.isInWorkspace ||
			updatedPlanFile !== existing.planFile ||
			updatedName !== existing.name ||
			updatedCwd !== existing.cwd
		) {
			this._sessions[index] = {
				...existing,
				name: updatedName,
				pid: updatedPid,
				workspacePath: updatedWorkspacePath,
				cwd: updatedCwd,
				planFile: updatedPlanFile,
				isInWorkspace: updatedIsInWorkspace,
			};
			changed = true;
		}

		// Re-resolve git info if we now have a cwd but didn't before
		if (cwd != null && existing.branch == null) {
			void this.resolveGitInfo(sessionId, cwd);
		}
		return { index: index, changed: changed };
	}

	private async resolveGitInfo(sessionId: string, cwd: string): Promise<void> {
		const resolveGitInfo = this.callbacks.resolveGitInfo;
		if (resolveGitInfo == null) return;

		try {
			const info = await resolveGitInfo(cwd);
			if (info == null) return;

			const index = this._sessions.findIndex(s => s.id === sessionId);
			if (index < 0) return;

			const session = this._sessions[index];

			// If the session has no workspacePath (CLI didn't match a workspace),
			// use the resolved repository root so pills can match branch cards.
			const resolvedWorkspacePath = !session.workspacePath ? info.repoRoot : session.workspacePath;
			const resolvedIsInWorkspace =
				resolvedWorkspacePath !== session.workspacePath
					? this.matchesWorkspace(resolvedWorkspacePath)
					: session.isInWorkspace;

			if (
				cwd !== session.cwd ||
				info.branch !== session.branch ||
				info.worktreeName !== session.worktreeName ||
				resolvedWorkspacePath !== session.workspacePath
			) {
				this._sessions[index] = {
					...session,
					cwd: cwd,
					branch: info.branch,
					worktreeName: info.worktreeName,
					workspacePath: resolvedWorkspacePath,
					isInWorkspace: resolvedIsInWorkspace,
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
			const output = await this.callbacks.runCLICommand(['ai', 'hook', 'list-sessions', '--json']);
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
					this._sessionBookkeeping.delete(id);
				}
				Logger.debug(
					`ClaudeCodeProvider.syncSessions: removed ${removedIds.size} stale session(s): ${Array.from(removedIds, id => id.substring(0, 8)).join(', ')}`,
				);
				this._onDidChangeSessions.fire();
			}
			return;
		}

		let changed = false;

		for (const data of sessions) {
			if (!data.sessionId || !data.pid || !isProcessAlive(data.pid)) {
				continue;
			}

			if (this._sessions.some(s => s.id === data.sessionId)) continue;

			const isInWorkspace = this.matchesWorkspace(data.matchedWorkspacePath);
			const status = deriveStatusFromEvent(data.event);
			const phase = getPhaseForStatus(status);
			const activityDate = new Date(data.updatedAt);

			const subagents: AgentSession[] | undefined = data.subagents?.map(sub => ({
				id: sub.agentId,
				providerId: this.id,
				name: sub.agentType ?? 'Subagent',
				status: 'thinking' as AgentSessionStatus,
				phase: 'working' as const,
				phaseSince: activityDate,
				lastActivity: activityDate,
				isSubagent: true,
				parentId: data.sessionId,
				isInWorkspace: isInWorkspace,
			}));

			this._sessions.push({
				id: data.sessionId,
				providerId: this.id,
				name: data.sessionName || this.name,
				status: status,
				phase: phase,
				phaseSince: activityDate,
				pid: data.pid,
				lastActivity: activityDate,
				isSubagent: false,
				workspacePath: data.matchedWorkspacePath ?? undefined,
				cwd: data.cwd,
				planFile: data.planFile ?? undefined,
				isInWorkspace: isInWorkspace,
				lastPrompt: data.prompt ?? undefined,
				subagents: subagents,
			});
			changed = true;

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
				this._sessionBookkeeping.delete(id);
			}
			Logger.debug(
				`ClaudeCodeProvider.syncSessions: removed ${removedIds.size} stale session(s): ${Array.from(removedIds, id => id.substring(0, 8)).join(', ')}`,
			);
			changed = true;
		}

		if (changed) {
			this._onDidChangeSessions.fire();
		}
	}

	private async querySiblingWindowSessions(): Promise<void> {
		let files: string[];
		try {
			files = await readdir(agentDiscoveryDir);
		} catch {
			return;
		}

		const ownPort = this._ipcServer?.port;
		let changed = false;

		for (const file of files) {
			if (!file.startsWith('gitlens-ipc-server-') || !file.endsWith('.json')) continue;

			let discovery: DiscoveryFile;
			try {
				const raw = await readFile(join(agentDiscoveryDir, file), 'utf8');
				discovery = JSON.parse(raw) as DiscoveryFile;
			} catch {
				continue;
			}

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
					const peerPhaseSince = new Date(peerSession.phaseSince);

					const existing = this._sessions.find(s => s.id === peerSession.id);
					if (existing != null) {
						// Only overwrite if peer has newer data
						if (peerActivity > existing.lastActivity) {
							const idx = this._sessions.indexOf(existing);
							this._sessions[idx] = {
								...existing,
								status: peerSession.status,
								phase: peerSession.phase,
								phaseSince: peerPhaseSince,
								statusDetail: peerSession.statusDetail,
								lastActivity: peerActivity,
								subagents: rehydrateSubagents(peerSession.subagents),
							};
							changed = true;
						}
					} else {
						const isInWorkspace = this.matchesWorkspace(peerSession.workspacePath);
						this._sessions.push({
							...peerSession,
							lastActivity: peerActivity,
							phaseSince: peerPhaseSince,
							isInWorkspace: isInWorkspace,
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
