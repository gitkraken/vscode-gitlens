import { readdir, readFile } from 'fs/promises';
import { join, sep } from 'path';
import { gate } from '@gitlens/utils/decorators/gate.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { disposableInterval } from '@gitlens/utils/disposable.js';
import { Emitter } from '@gitlens/utils/event.js';
import { Logger } from '@gitlens/utils/logger.js';
import { truncate } from '@gitlens/utils/string.js';
import { agentDiscoveryDir, AgentIpcServer } from '../agentIpcServer.js';
import { deriveStatusFromEvent, describeToolInput, isProcessAlive, rehydrateSubagents } from '../stateMachine.js';
import type {
	AgentProviderCallbacks,
	AgentSession,
	AgentSessionProvider,
	AgentSessionStatus,
	ClaudeCodeHookEvent,
	PendingPermission,
	PermissionDecision,
	PermissionSuggestion,
} from '../types.js';
import { getPhaseForStatus } from '../types.js';

interface AgentSessionEvent {
	event: ClaudeCodeHookEvent;
	sessionId: string;
	cwd: string;
	pid?: number;
	source?: string;
	model?: string;
	reason?: string;
	toolName?: string;
	agentId?: string;
	agentType?: string;
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
			behavior: PermissionDecision;
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
}

const staleCheckIntervalMs = 60 * 1000; // 1 minute

interface SessionFileData {
	sessionId: string;
	event: string;
	cwd: string;
	pid: number;
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

interface SessionContext {
	pid?: number;
	workspacePath?: string;
	isInWorkspace?: boolean;
	cwd?: string;
	planFile?: string;
	sessionName?: string;
}

type SerializedAgentSession = Omit<AgentSession, 'lastActivity' | 'phaseSince' | 'subagents'> & {
	lastActivity: string;
	phaseSince: string;
	subagents?: (Omit<AgentSession, 'lastActivity' | 'phaseSince'> & {
		lastActivity: string;
		phaseSince: string;
	})[];
};

function normalizeWorkspacePath(value: string | null | undefined): string | undefined {
	return value ? value : undefined;
}

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
	private _staleCheckTimer: UnifiedDisposable | undefined;

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

	updateWorkspacePaths(workspacePaths: string[]): void {
		this._workspacePaths = workspacePaths;

		let changed = false;
		for (let i = 0; i < this._sessions.length; i++) {
			const s = this._sessions[i];
			const nextIsInWorkspace = this.matchesWorkspace(s.workspacePath);
			const subagents = s.subagents?.map(sub =>
				sub.isInWorkspace === nextIsInWorkspace ? sub : { ...sub, isInWorkspace: nextIsInWorkspace },
			);
			if (s.isInWorkspace !== nextIsInWorkspace || subagents !== s.subagents) {
				this._sessions[i] = { ...s, isInWorkspace: nextIsInWorkspace, subagents: subagents };
				changed = true;
			}
		}
		if (changed) {
			this._onDidChangeSessions.fire();
		}

		if (this._ipcServer == null) {
			// Server wasn't started yet — bootstrap. The `.then` re-issues the
			// path update after the (gated) `ensureIpcServer` completes, in
			// case it deduped with an in-flight `start()` that used stale paths.
			void this.ensureIpcServer(workspacePaths).then(() => this._ipcServer?.updateWorkspacePaths(workspacePaths));
		} else {
			void this._ipcServer.updateWorkspacePaths(workspacePaths);
		}
	}

	dispose(): void {
		this.stop();
		this._staleCheckTimer?.dispose();
		this._staleCheckTimer = undefined;
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

			// Register handlers before any async work so blocking permission requests aren't delayed.
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

			await this.syncSessions();
			void this.querySiblingWindowSessions();

			this._staleCheckTimer?.dispose();
			this._staleCheckTimer = disposableInterval(() => void this.syncSessions(), staleCheckIntervalMs);
		} catch (ex) {
			Logger.error(ex, 'ClaudeCodeProvider.ensureIpcServer');
		}
	}

	private handleSessionEvent(event: AgentSessionEvent, isBlocking: boolean): Promise<PermissionResponse | void> {
		const workspacePath = this.resolveWorkspacePath(event.cwd);
		const eventContext: SessionContext = {
			pid: event.pid,
			workspacePath: workspacePath,
			isInWorkspace: workspacePath != null,
			cwd: event.cwd,
			planFile: event.planFile,
			sessionName: event.sessionName,
		};
		const tag = this.sessionTag(event.sessionId, event.sessionName ?? 'unnamed');

		if (event.event === 'SessionStart' || event.event === 'SessionEnd') {
			Logger.info(`ClaudeCodeProvider.handleSessionEvent: ${event.event} ${tag}`);
		} else {
			Logger.debug(
				`ClaudeCodeProvider.handleSessionEvent: ${event.event} ${tag}${event.toolName ? ` tool=${event.toolName}` : ''}${event.agentId ? ` agent=${event.agentId}` : ''}${event.notificationType ? ` type=${event.notificationType}` : ''}`,
			);
		}

		switch (event.event) {
			case 'SessionStart': {
				const { index } = this.ensureSession(event.sessionId, eventContext);
				this.resetBookkeeping(event.sessionId);
				const prev = this._sessions[index];
				const newPhase = getPhaseForStatus('idle');
				this._sessions[index] = {
					...prev,
					pid: event.pid ?? prev.pid,
					status: 'idle',
					phase: newPhase,
					phaseSince: prev.phase !== newPhase ? new Date() : prev.phaseSince,
					statusDetail: undefined,
					pendingPermission: undefined,
					lastActivity: new Date(),
				};
				this._onDidChangeSessions.fire();
				this.callbacks.onSessionStarted?.(this.id);
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
				this.callbacks.onSessionEnded?.(this.id);
				break;
			}

			case 'UserPromptSubmit': {
				const { index } = this.ensureSession(event.sessionId, eventContext);
				if (event.prompt) {
					this._sessions[index] = {
						...this._sessions[index],
						lastPrompt: truncate(event.prompt, 500),
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
				this.resetBookkeeping(event.sessionId);
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
				// hookInput is the raw passthrough; fall back to top-level fields for older CLI versions.
				const hookInput = event.hookInput;
				const toolInput = (hookInput?.tool_input as Record<string, unknown> | undefined) ?? event.toolInput;
				if (isBlocking && toolInput != null) {
					const toolName = (hookInput?.tool_name as string | undefined) ?? event.toolName ?? '';
					const toolDescription = describeToolInput(toolName, toolInput);
					const toolInputDescription = (toolInput.description as string | undefined) || undefined;

					return new Promise<PermissionResponse>((resolve, reject) => {
						const existing = this._pendingPermissions.get(event.sessionId);
						if (existing != null) {
							Logger.debug(
								`ClaudeCodeProvider.handleSessionEvent: auto-denying stale permission ${tag} tool=${existing.toolName}`,
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
				const { index: parentIdx } = this.ensureSession(event.sessionId, eventContext);
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
						isInWorkspace: workspacePath != null,
					};
					const existingSubs = parent.subagents ? [...parent.subagents] : [];
					existingSubs.push(subagent);
					this._sessions[parentIdx] = { ...parent, subagents: existingSubs };
					this._onDidChangeSessions.fire();
				}
				break;
			}

			case 'SubagentStop': {
				const { index: parentIdx } = this.ensureSession(event.sessionId, eventContext);
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

			case 'TeammateIdle':
			case 'TaskCompleted':
			case 'InstructionsLoaded':
			case 'ConfigChange':
			case 'WorktreeCreate':
			case 'WorktreeRemove':
				// Not yet handled — intentional no-op.
				break;
		}

		return Promise.resolve();
	}

	private sessionTag(sessionId: string, name?: string): string {
		return name != null
			? `[session=${sessionId.substring(0, 8)}(${name})]`
			: `[session=${sessionId.substring(0, 8)}]`;
	}

	private getBookkeeping(sessionId: string): SessionBookkeeping {
		let bk = this._sessionBookkeeping.get(sessionId);
		if (bk == null) {
			bk = { activeToolCount: 0 };
			this._sessionBookkeeping.set(sessionId, bk);
		}
		return bk;
	}

	private resetBookkeeping(sessionId: string): void {
		const bk = this.getBookkeeping(sessionId);
		bk.activeToolCount = 0;
		bk.pendingPermission = undefined;
	}

	// Called when a pending permission was resolved outside GitLens (e.g. via the CLI terminal).
	// The 'deny' response is a safe no-op since the tool has already run or been denied upstream.
	private clearStalePermission(sessionId: string, reason: string): void {
		const bk = this.getBookkeeping(sessionId);
		if (bk.pendingPermission == null) return;

		Logger.debug(`ClaudeCodeProvider.clearStalePermission: ${reason} ${this.sessionTag(sessionId)}`);

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
		decision: PermissionDecision,
		updatedPermissions?: PermissionSuggestion[],
	): void {
		const pending = this._pendingPermissions.get(sessionId);
		if (pending == null) return;

		Logger.debug(
			`ClaudeCodeProvider.resolvePermission: ${decision} ${this.sessionTag(sessionId)} tool=${pending.toolName}`,
		);
		pending.resolve({
			hookSpecificOutput: {
				hookEventName: 'PermissionRequest',
				decision: { behavior: decision, updatedPermissions: updatedPermissions },
			},
		});
		this.callbacks.onPermissionResolved?.({
			provider: this.id,
			tool: pending.toolName,
			decision: decision,
		});
		this._pendingPermissions.delete(sessionId);

		const bk = this.getBookkeeping(sessionId);
		bk.pendingPermission = undefined;

		const nextStatus = bk.activeToolCount > 0 ? 'tool_use' : 'thinking';
		this.updateSessionStatus(sessionId, nextStatus);
	}

	private matchesWorkspace(workspacePath: string | undefined): boolean {
		if (!workspacePath) return false;
		return this._workspacePaths.some(
			p =>
				workspacePath === p || workspacePath.startsWith(`${p}${sep}`) || p.startsWith(`${workspacePath}${sep}`),
		);
	}

	private resolveWorkspacePath(cwd: string | undefined): string | undefined {
		if (!cwd) return undefined;
		return this._workspacePaths.find(
			p => cwd === p || cwd.startsWith(`${p}${sep}`) || p.startsWith(`${cwd}${sep}`),
		);
	}

	private updateSessionWithPermission(sessionId: string, permission: PendingPermission, pid?: number): void {
		const { index } = this.ensureSession(sessionId, { pid: pid });

		const prev = this._sessions[index];
		const newPhase = getPhaseForStatus('permission_requested');
		this.getBookkeeping(sessionId).pendingPermission = permission;
		this._sessions[index] = {
			...prev,
			status: 'permission_requested',
			phase: newPhase,
			phaseSince: prev.phase !== newPhase ? new Date() : prev.phaseSince,
			statusDetail: permission.toolDescription,
			pendingPermission: permission,
			lastActivity: new Date(),
		};
		this._onDidChangeSessions.fire();
	}

	private updateSessionStatus(
		sessionId: string,
		status: AgentSessionStatus,
		options?: SessionContext & { statusDetail?: string },
	): void {
		const { index, changed: metadataChanged } = this.ensureSession(sessionId, options);

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
		this._sessions[index] = {
			...prev,
			status: status,
			phase: newPhase,
			phaseSince: prev.phase !== newPhase ? new Date() : prev.phaseSince,
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

	private ensureSession(sessionId: string, context?: SessionContext): { index: number; changed: boolean } {
		const { pid, workspacePath, isInWorkspace, cwd, planFile, sessionName } = context ?? {};

		let index = this._sessions.findIndex(s => s.id === sessionId);
		if (index < 0) {
			const now = new Date();
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
				`ClaudeCodeProvider.ensureSession: implicitly created ${this.sessionTag(sessionId, sessionName ?? 'unnamed')}`,
			);
			this._onDidChangeSessions.fire();

			if (cwd != null) {
				void this.resolveGitInfo(sessionId, cwd);
			}
			return { index: index, changed: true };
		}

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

	private pruneDeadSessions(): boolean {
		const kept: AgentSession[] = [];
		const removedIds: string[] = [];
		for (const s of this._sessions) {
			if (s.pid == null || isProcessAlive(s.pid)) {
				kept.push(s);
			} else {
				removedIds.push(s.id);
			}
		}
		if (removedIds.length === 0) return false;

		this._sessions = kept;
		for (const id of removedIds) {
			this._sessionBookkeeping.delete(id);
		}
		Logger.debug(
			`ClaudeCodeProvider.syncSessions: removed ${removedIds.length} stale session(s): ${removedIds.map(id => id.substring(0, 8)).join(', ')}`,
		);
		return true;
	}

	private async syncSessions(): Promise<void> {
		let sessions: SessionFileData[];
		try {
			const output = await this.callbacks.runCLICommand(['ai', 'hook', 'list-sessions', '--json']);
			sessions = JSON.parse(output) as SessionFileData[];
		} catch {
			if (this.pruneDeadSessions()) {
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

			const workspacePath = this.resolveWorkspacePath(data.cwd);
			const isInWorkspace = workspacePath != null;
			const status = deriveStatusFromEvent(data.event);
			const phase = getPhaseForStatus(status);
			const activityDate = new Date(data.updatedAt);

			const subagents: AgentSession[] | undefined = data.subagents?.map(sub => ({
				id: sub.agentId,
				providerId: this.id,
				name: sub.agentType ?? 'Subagent',
				status: 'thinking',
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
				workspacePath: workspacePath,
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

		if (this.pruneDeadSessions()) {
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

		const peerBatches = await Promise.all(
			files
				.filter(f => f.startsWith('gitlens-ipc-server-') && f.endsWith('.json'))
				.map(async f => this.fetchPeerSessions(join(agentDiscoveryDir, f), ownPort)),
		);

		let changed = false;
		for (const peerSessions of peerBatches) {
			if (peerSessions == null) continue;

			for (const peerSession of peerSessions) {
				const peerActivity = new Date(peerSession.lastActivity);
				const peerPhaseSince = new Date(peerSession.phaseSince);

				const existing = this._sessions.find(s => s.id === peerSession.id);
				if (existing != null) {
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
					this._sessions.push({
						...peerSession,
						lastActivity: peerActivity,
						phaseSince: peerPhaseSince,
						workspacePath: normalizeWorkspacePath(peerSession.workspacePath),
						isInWorkspace: this.matchesWorkspace(peerSession.workspacePath),
						subagents: rehydrateSubagents(peerSession.subagents),
					});
					changed = true;
				}
			}
		}

		if (changed) {
			this._onDidChangeSessions.fire();
		}
	}

	private async fetchPeerSessions(
		path: string,
		ownPort: number | undefined,
	): Promise<SerializedAgentSession[] | undefined> {
		let discovery: DiscoveryFile;
		try {
			discovery = JSON.parse(await readFile(path, 'utf8')) as DiscoveryFile;
		} catch {
			return undefined;
		}
		if (ownPort != null && discovery.port === ownPort) return undefined;

		try {
			const response = await fetch(`${discovery.address}/agents/sessions/list`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${discovery.token}`, 'Content-Type': 'application/json' },
				body: '{}',
				signal: AbortSignal.timeout(2000),
			});
			if (!response.ok) return undefined;
			return (await response.json()) as SerializedAgentSession[];
		} catch {
			return undefined;
		}
	}
}
