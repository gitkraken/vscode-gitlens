import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { gate } from '@gitlens/utils/decorators/gate.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { disposableInterval } from '@gitlens/utils/disposable.js';
import { Emitter } from '@gitlens/utils/event.js';
import { Logger } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { prepareStoredPrompt } from '../sanitizePrompt.js';
import {
	classifyPermissionKind,
	deriveStatusFromEvent,
	describeToolInput,
	extractPlanSummary,
	extractQuestionDetails,
	getToolFilePath,
	getToolReadPath,
	isProcessAlive,
	rehydrateSubagents,
} from '../stateMachine.js';
import type {
	AgentProviderCallbacks,
	AgentSession,
	AgentSessionPhase,
	AgentSessionProvider,
	AgentSessionStatus,
	ClaudeCodeHookEvent,
	PendingPermission,
	PendingPermissionKind,
	PermissionDecision,
	PermissionSuggestion,
} from '../types.js';
import { getPhaseForStatus } from '../types.js';
import { ClaudeCodeTranscriptReader } from './claudeCodeTranscript.js';

interface AgentSessionEvent {
	event: ClaudeCodeHookEvent;
	sessionId: string;
	cwd: string;
	/** The agent's launch directory, captured first-hand by the CLI and preserved across events.
	 *  Optional — older CLIs don't send it, in which case consumers fall back to deriving it from
	 *  the first-seen `cwd`. */
	initialCwd?: string;
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
	firstPrompt?: string;
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
	/** Refcount of in-flight file-mutating tool calls per absolute path. Keyed by path (not
	 *  `tool_use_id`) because the GK CLI hook payload doesn't reliably surface `tool_use_id` —
	 *  refcounting per path is order-independent and tolerant of out-of-order Pre/Post pairs. */
	currentFileCounts: Map<string, number>;
	/** Per-path cooldown timers scheduled when a path's refcount hits zero, so back-to-back
	 *  Edit/Write to the same path doesn't flicker the WIP decoration. A fresh Pre on the same
	 *  path cancels its pending clear. */
	pendingFileClears: Map<string, NodeJS.Timeout>;
	/** Refcount of in-flight read-only file tool calls (Read/NotebookRead) per absolute path.
	 *  Mirrors {@link currentFileCounts} so consumers can distinguish "looking at" from "working
	 *  on". */
	currentReadCounts: Map<string, number>;
	/** Per-path cooldown timers for reads — same semantics as {@link pendingFileClears}, keeps a
	 *  recently-read file visible briefly after the read completes. */
	pendingReadClears: Map<string, NodeJS.Timeout>;
	/** Epoch-ms timestamps of the last `PreToolUse` for each kind, per absolute path. Stamped on
	 *  every Pre; the per-path `edit`/`read` slot survives through the cooldown window and is
	 *  dropped only when the corresponding count map drops the path. Serialized into
	 *  `AgentSession.fileActivity` as `editedAt = now - timestamp.edit` (relative ms), so the
	 *  webview can compute heat decay without dealing with host clock skew. */
	lastTouchedAt: Map<string, { edit?: number; read?: number }>;
	/** Set to true when `resolveGitInfo` for the session's current cwd returned `undefined`
	 *  (cwd is not a git repo). Prevents the `ensureSession` retry from firing forever on
	 *  every subsequent hook event. Cleared when the session's cwd changes (re-resolution
	 *  warranted) or on resetBookkeeping (Stop/SessionStart). */
	gitInfoUnresolvable: boolean;
	/** Phase that immediately preceded the current one, with its original `phaseSince`. Used by
	 *  `resolvePhaseSince` to restore continuity when phase oscillates back within a short
	 *  window (e.g., Stop → idle → working after a continuation crosses the debounce). */
	priorPhase?: { phase: AgentSessionPhase; phaseSince: Date };
}

const staleCheckIntervalMs = 15 * 60 * 1000; // 15 minutes
/** Default cooldown between PostToolUse and dropping the file from `fileActivity`. Held long
 *  enough that the treemap activity overlay can render a decay tail well past the moment the tool
 *  call completed. The host may override per-call via `AgentProviderCallbacks.getActivityDecayMs`
 *  (driven by the user's `gitlens.graph.experimental.visualizations.activityDecay` setting). */
const defaultActivityDecayMs = 5 * 60 * 1000; // 5 minutes

/** Grace period before `Stop` commits to `idle`. Long enough to absorb a same-turn continuation
 *  (hook-driven re-prompt, IPC event reordering, auto-resume); short enough that legitimate idle
 *  is visible promptly. */
const stopToIdleDebounceMs = 750;

/** If a phase transitions away and then back within this window, restore the prior `phaseSince`
 *  so the displayed elapsed time doesn't snap to 0 on transient oscillations. Slightly longer
 *  than `stopToIdleDebounceMs` so a continuation that just barely crosses the debounce still
 *  restores continuity. */
const phaseSinceRestoreWindowMs = 2000;

interface SessionFileData {
	sessionId: string;
	event: string;
	cwd: string;
	/** CLI-provided launch directory; absent on older CLIs (fall back to `cwd`). */
	initialCwd?: string;
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
	firstPrompt?: string | null;
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
	/** CLI-provided launch directory (authoritative when present). */
	initialCwd?: string;
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

/** Normalize a workspace path to GitLens canonical form (forward slashes, lower-case drive letter
 *  on Windows). Comparisons throughout the home view assume this form, but `_workspacePaths` and
 *  peer-session `workspacePath` values originate from `Uri.fsPath`, which on Windows uses
 *  backslashes and preserves drive-letter casing. Without this, `session.workspacePath ===
 *  repository.path` always fails on Windows. */
function normalizeWorkspacePath(value: string | null | undefined): string | undefined {
	return value ? normalizePath(value) : undefined;
}

type FileActivityEntry = NonNullable<AgentSession['fileActivity']>[number];

/** Structural comparison of two `fileActivity` arrays — same set of paths, same kinds present,
 *  same `reading`/`editing` flags. Ignores numeric timestamp values because those drift between
 *  every call (Date.now() advances) even when nothing has actually changed. Used to gate event
 *  firing: timestamps still get refreshed via the `_sessions[]` write, but a fire only happens
 *  when the structural shape changed. Treats `undefined` and `[]` as equal. */
function fileActivityStructurallyEqual(
	a: readonly FileActivityEntry[] | undefined,
	b: readonly FileActivityEntry[] | undefined,
): boolean {
	const aLen = a?.length ?? 0;
	const bLen = b?.length ?? 0;
	if (aLen !== bLen) return false;
	if (aLen === 0) return true;

	const byPath = new Map<string, FileActivityEntry>();
	for (const entry of a!) {
		byPath.set(entry.path, entry);
	}
	for (const entry of b!) {
		const other = byPath.get(entry.path);
		if (other == null) return false;
		if ((entry.readAt != null) !== (other.readAt != null)) return false;
		if ((entry.editedAt != null) !== (other.editedAt != null)) return false;
		if ((entry.reading ?? false) !== (other.reading ?? false)) return false;
		if ((entry.editing ?? false) !== (other.editing ?? false)) return false;
	}
	return true;
}

export class ClaudeCodeProvider implements AgentSessionProvider {
	readonly id = 'claudeCode';
	readonly name = 'Claude Code';
	readonly icon = 'robot';

	private readonly _onDidChangeSessions = new Emitter<void>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _sessions: AgentSession[] = [];
	private _ipcStarted = false;
	private _disposed = false;
	private _handlerDisposables: UnifiedDisposable[] = [];
	private readonly _pendingPermissions = new Map<string, PendingPermissionEntry>();
	private readonly _resolveGitInfoInFlight = new Set<string>();
	private readonly _sessionBookkeeping = new Map<string, SessionBookkeeping>();
	/** Per-session timers for the deferred `Stop → idle` commit. The handle is cleared (and the
	 *  transition cancelled) by any non-idle status update arriving before the timer fires. */
	private readonly _pendingIdleTimers = new Map<string, NodeJS.Timeout>();
	private _workspacePaths: string[] = [];
	private _staleCheckTimer: UnifiedDisposable | undefined;
	/** Whether Claude hooks are installed, pushed by the host via {@link setClaudeHooksInstalled}.
	 *  Fail-open (`true`) until the first push lands so a fresh window with real hooks isn't
	 *  suppressed on its first ticks. Gates the reconciliation poll in {@link syncSessions}. */
	private _claudeHooksInstalled = true;
	protected _transcriptReader: ClaudeCodeTranscriptReader = new ClaudeCodeTranscriptReader();

	constructor(private readonly callbacks: AgentProviderCallbacks) {}

	get sessions(): readonly AgentSession[] {
		return this._sessions;
	}

	start(workspacePaths: string[]): void {
		this._workspacePaths = workspacePaths.map(p => normalizePath(p));
		void this.ensureIpcServer();
	}

	stop(): void {
		// IPC server stays up intentionally — hooks fire even when the window is unfocused
	}

	updateWorkspacePaths(workspacePaths: string[]): void {
		this._workspacePaths = workspacePaths.map(p => normalizePath(p));

		let changed = false;
		for (let i = 0; i < this._sessions.length; i++) {
			const s = this._sessions[i];
			const nextWorkspacePath = s.cwd != null ? this.resolveWorkspacePath(s.cwd) : undefined;
			const nextIsInWorkspace = nextWorkspacePath != null;
			let subagentsChanged = false;
			const subagents = s.subagents?.map(sub => {
				const subNextWorkspacePath = sub.cwd != null ? this.resolveWorkspacePath(sub.cwd) : nextWorkspacePath;
				const subNextIsInWorkspace = sub.cwd != null ? subNextWorkspacePath != null : nextIsInWorkspace;
				if (sub.isInWorkspace === subNextIsInWorkspace && sub.workspacePath === subNextWorkspacePath) {
					return sub;
				}

				subagentsChanged = true;
				return { ...sub, isInWorkspace: subNextIsInWorkspace, workspacePath: subNextWorkspacePath };
			});
			if (s.isInWorkspace !== nextIsInWorkspace || s.workspacePath !== nextWorkspacePath || subagentsChanged) {
				this._sessions[i] = {
					...s,
					isInWorkspace: nextIsInWorkspace,
					workspacePath: nextWorkspacePath,
					subagents: subagents,
				};
				changed = true;
			}
		}
		if (changed) {
			this._onDidChangeSessions.fire();
		}

		if (!this._ipcStarted) {
			// IPC wasn't bootstrapped yet — start it. ensureIpcServer publishes with the
			// current `_workspacePaths`.
			void this.ensureIpcServer();
		} else {
			// Re-publish so the agents discovery file reflects the new workspacePaths.
			this.callbacks.ipc
				.publishAgents(this._workspacePaths)
				.catch((ex: unknown) =>
					Logger.error(ex, 'ClaudeCodeProvider.updateWorkspacePaths: publishAgents failed'),
				);
		}
	}

	setClaudeHooksInstalled(installed: boolean): void {
		const wasOff = !this._claudeHooksInstalled;
		this._claudeHooksInstalled = installed;
		// On a fresh off→on transition, reconcile immediately rather than waiting up to a full
		// interval — picks up any session that was already running before hooks were installed.
		// This is a deliberate discovery pass (like the cold-start bootstrap), not a routine tick:
		// hooks were just off, so the live path couldn't have seen these sessions and anything we
		// find here is expected, not drift. Run it ungated so it neither skips nor reports drift
		// telemetry (an ungated `syncSessions()` always polls and never emits `onSyncDiscrepancy`).
		if (installed && wasOff) {
			void this.syncSessions();
		}
	}

	dispose(): void {
		this._disposed = true;
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
		for (const bk of this._sessionBookkeeping.values()) {
			this.cancelPendingFileClears(bk);
			this.cancelPendingReadClears(bk);
		}
		for (const timer of this._pendingIdleTimers.values()) {
			clearTimeout(timer);
		}
		this._pendingIdleTimers.clear();
		this._sessionBookkeeping.clear();
		if (this._ipcStarted) {
			void this.callbacks.ipc.unpublishAgents();
			this._ipcStarted = false;
		}
		this._onDidChangeSessions.dispose();
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	@gate<typeof ClaudeCodeProvider.prototype.ensureIpcServer>()
	private async ensureIpcServer(): Promise<void> {
		if (this._ipcStarted || this._disposed) return;

		// Register handlers before any async work so blocking permission requests aren't delayed.
		const handlers: UnifiedDisposable[] = [
			this.callbacks.ipc.registerHandler('agents/session', (request, searchParams) => {
				if (request != null) {
					const isBlocking = searchParams.get('blocking') === 'true';
					return this.handleSessionEvent(request as AgentSessionEvent, isBlocking);
				}
				return Promise.resolve();
			}),
			this.callbacks.ipc.registerHandler('agents/sessions/list', () =>
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
			this.callbacks.ipc.registerHandler('agents/sessions/open', async request => {
				const sessionId = (request as { sessionId?: string } | undefined)?.sessionId;
				if (!sessionId || this.callbacks.openSessionInClaudeExtension == null) {
					return { opened: false };
				}

				try {
					await this.callbacks.openSessionInClaudeExtension(sessionId);
					return { opened: true };
				} catch (ex) {
					Logger.warn(
						`ClaudeCodeProvider.agents/sessions/open: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
					return { opened: false };
				}
			}),
		];

		try {
			await this.callbacks.ipc.publishAgents(this._workspacePaths);
		} catch (ex) {
			// Unwind so a retry can re-register without hitting "already registered".
			for (const d of handlers) {
				d.dispose();
			}
			Logger.error(ex, 'ClaudeCodeProvider.ensureIpcServer');
			return;
		}

		// `publishAgents` no-ops silently if the IPC server failed to start; don't seal
		// retries in that case — the next call should re-attempt.
		if (this.callbacks.ipc.port == null) {
			for (const d of handlers) {
				d.dispose();
			}
			return;
		}

		if (this._disposed) {
			for (const d of handlers) {
				d.dispose();
			}
			return;
		}

		this._handlerDisposables = handlers;
		this._ipcStarted = true;

		try {
			await this.syncSessions();
			if (this._disposed) return;

			void this.querySiblingWindowSessions();

			this._staleCheckTimer?.dispose();
			this._staleCheckTimer = disposableInterval(
				() => void this.syncSessions({ gate: true }),
				staleCheckIntervalMs,
			);
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
			initialCwd: event.initialCwd,
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
				const wasNew = this._sessions.findIndex(s => s.id === event.sessionId) < 0;
				const { index } = this.ensureSession(event.sessionId, eventContext);

				if (wasNew) {
					// ensureSession created the session at 'idle' already. Just refresh pid if
					// the event carries one — bookkeeping was implicitly clean.
					this.resetBookkeeping(event.sessionId);
					if (event.pid != null) {
						const prev = this._sessions[index];
						if (prev.pid !== event.pid) {
							this._sessions[index] = { ...prev, pid: event.pid };
						}
					}
				} else {
					// SessionStart for a session we already track is almost always a CLI replay
					// (resume/reconnect/hook re-init). Don't clobber live state — the next real
					// event will re-establish status. Refresh pid only.
					const prev = this._sessions[index];
					if (event.pid != null && event.pid !== prev.pid) {
						this._sessions[index] = { ...prev, pid: event.pid, lastActivity: new Date() };
					}
				}

				this._onDidChangeSessions.fire();
				void this.resolveTranscriptTitles(event.sessionId, event.cwd);
				this.callbacks.onSessionStarted?.(this.id);
				break;
			}

			case 'SessionEnd': {
				const pending = this._pendingPermissions.get(event.sessionId);
				if (pending != null) {
					pending.reject(new Error('Session ended'));
					this._pendingPermissions.delete(event.sessionId);
				}
				this.cancelPendingIdleTransition(event.sessionId);

				const index = this._sessions.findIndex(s => s.id === event.sessionId);
				if (index >= 0) {
					this._sessions.splice(index, 1);
					this._onDidChangeSessions.fire();
				}
				const bk = this._sessionBookkeeping.get(event.sessionId);
				if (bk != null) {
					this.cancelPendingFileClears(bk);
					this.cancelPendingReadClears(bk);
				}

				this._sessionBookkeeping.delete(event.sessionId);
				this._transcriptReader.forget(event.sessionId);
				this.callbacks.onSessionEnded?.(this.id);
				break;
			}

			case 'UserPromptSubmit': {
				const { index } = this.ensureSession(event.sessionId, eventContext);
				const cleaned = prepareStoredPrompt(event.prompt);
				// A `UserPromptSubmit` whose payload sanitizes to nothing is harness-synthetic
				// (e.g. background-bash <task-notification>, slash-command stdout echo). Treat it
				// as informational so it doesn't flip the session to `thinking` or wipe a pending
				// permission when no real user activity occurred.
				if (!cleaned) break;

				const existing = this._sessions[index];
				this._sessions[index] = {
					...existing,
					lastPrompt: cleaned,
					firstPrompt: existing.firstPrompt ?? prepareStoredPrompt(event.firstPrompt),
				};
				this.clearStalePermission(event.sessionId, 'UserPromptSubmit');
				this.updateSessionStatus(event.sessionId, 'thinking', eventContext);
				break;
			}

			case 'PreToolUse': {
				const bk = this.getBookkeeping(event.sessionId);
				bk.activeToolCount++;
				const filesChanged = this.trackToolUseFile(event.sessionId, event);
				const readsChanged = this.trackToolUseRead(event.sessionId, event);
				// Resolve a rich `Bash(grep …)`-style detail via the same tool_input passthrough the
				// PermissionRequest handler uses, so working sessions surface what their tool is
				// actually doing — not just the bare tool name. Falls back to bare name when no
				// toolInput is available (older CLI / unhandled tool).
				const hookInput = event.hookInput;
				const toolInput = (hookInput?.tool_input as Record<string, unknown> | undefined) ?? event.toolInput;
				const toolName = (hookInput?.tool_name as string | undefined) ?? event.toolName ?? '';
				const statusDetail =
					toolInput != null && toolName ? describeToolInput(toolName, toolInput) : toolName || undefined;
				// Capture pre-update status so we can tell whether the upcoming updateSessionStatus
				// will fire on its own — needed to avoid dropping fileActivity changes when the
				// session is already in tool_use (back-to-back tool calls).
				const sessionIndex = this._sessions.findIndex(s => s.id === event.sessionId);
				const prevStatus = sessionIndex >= 0 ? this._sessions[sessionIndex].status : undefined;
				const prevDetail = sessionIndex >= 0 ? this._sessions[sessionIndex].statusDetail : undefined;
				const statusWillFire = prevStatus !== 'tool_use' || prevDetail !== statusDetail;
				this.updateSessionStatus(event.sessionId, 'tool_use', {
					...eventContext,
					statusDetail: statusDetail,
				});
				if ((filesChanged || readsChanged) && !statusWillFire) {
					this._onDidChangeSessions.fire();
				}
				break;
			}

			case 'PostToolUse':
			case 'PostToolUseFailure': {
				this.clearStalePermission(event.sessionId, event.event);
				const bk = this.getBookkeeping(event.sessionId);
				bk.activeToolCount = Math.max(0, bk.activeToolCount - 1);
				// Cooldown the file-edit decoration instead of dropping it immediately, so a quick
				// follow-up Edit/Write to the same path doesn't blink. The deferred clear fires its
				// own change event when it expires. The immediate re-sync inside each flips
				// `editing`/`reading` off the moment refcount hits zero, though — capture whether that
				// changed the published list so we fire it ourselves when the status update below short-
				// circuits (a parallel tool is still in flight, so activeToolCount stays > 0).
				const filesChanged = this.scheduleClearToolUseFile(event.sessionId, event);
				const readsChanged = this.scheduleClearToolUseRead(event.sessionId, event);
				if (bk.activeToolCount === 0) {
					// updateSessionStatus short-circuits without firing when status+detail are unchanged
					// (already 'thinking' with no detail) — which would drop the editing/reading flag-flip
					// above and leave a stale live pulse. Capture whether it will fire on its own and, if
					// not, fire explicitly — mirrors the PreToolUse / PermissionDenied guards.
					const idx = this._sessions.findIndex(s => s.id === event.sessionId);
					const statusWillFire =
						idx < 0 ||
						this._sessions[idx].status !== 'thinking' ||
						this._sessions[idx].statusDetail != null;
					this.updateSessionStatus(event.sessionId, 'thinking', eventContext);
					if ((filesChanged || readsChanged) && !statusWillFire) {
						this._onDidChangeSessions.fire();
					}
				} else if (filesChanged || readsChanged) {
					this._onDidChangeSessions.fire();
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
				// Turn ended: stop the "live" pulse but keep the per-operation decay tail fading over
				// the configured window (anchored at each tool's completion, not at the turn end). A full
				// reset here would wipe the tail the instant the agent finishes a response.
				this.settleBookkeeping(event.sessionId);
				// Apply Stop's metadata synchronously so we don't carry stale context through the
				// debounce window — any in-window mutations (e.g. CwdChanged) survive when the
				// timer fires. ensureSession doesn't fire on metadata-only updates of existing
				// sessions, so fire here to match the original Stop-handler's UI-update semantics.
				const { changed } = this.ensureSession(event.sessionId, eventContext);
				if (changed) {
					this._onDidChangeSessions.fire();
				}
				// Defer the status change — if the agent continues within the debounce window
				// (hook-driven re-prompt, IPC reordering, auto-resume), the next non-idle event
				// cancels this and we never flick through idle.
				this.scheduleIdleTransition(event.sessionId);
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
					const kind: PendingPermissionKind = classifyPermissionKind(toolName);

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

						// Plan-kind body: prefer the existing session's planFile (set via SessionStart/
						// PostToolUse) and fall back to the event's planFile for cold-start cases.
						const planFilePath =
							kind === 'plan'
								? (this._sessions.find(s => s.id === event.sessionId)?.planFile ?? event.planFile)
								: undefined;
						const planSummary = kind === 'plan' ? extractPlanSummary(toolInput) : undefined;
						const questionDetails = kind === 'question' ? extractQuestionDetails(toolInput) : undefined;

						const permission: PendingPermission = {
							kind: kind,
							toolName: toolName,
							toolDescription: toolDescription,
							toolInputDescription: toolInputDescription,
							suggestions:
								(hookInput?.permission_suggestions as PermissionSuggestion[] | undefined) ??
								event.permissionSuggestions,
							planFilePath: planFilePath,
							planSummary: planSummary,
							questionText: questionDetails?.text,
							questionCount: questionDetails?.count,
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
				const filesChanged = this.untrackToolUseFile(event.sessionId, event);
				const readsChanged = this.untrackToolUseRead(event.sessionId, event);
				// When a parallel tool is still active the next status equals the current one and
				// updateSessionStatus short-circuits — without an explicit fire, the dropped path
				// would never reach subscribers (treemap activity overlay, WIP decoration).
				const nextStatus = bk.activeToolCount > 0 ? 'tool_use' : 'thinking';
				const sessionIndex = this._sessions.findIndex(s => s.id === event.sessionId);
				const prevStatus = sessionIndex >= 0 ? this._sessions[sessionIndex].status : undefined;
				const statusWillFire = prevStatus !== nextStatus;
				this.updateSessionStatus(event.sessionId, nextStatus, eventContext);
				if ((filesChanged || readsChanged) && !statusWillFire) {
					this._onDidChangeSessions.fire();
				}
				break;
			}

			case 'Elicitation': {
				const bk = this.getBookkeeping(event.sessionId);
				bk.pendingPermission = {
					kind: 'elicitation',
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
					// Clear the unresolvable flag so the new cwd actually gets re-probed — without
					// this, a session that started in a non-git cwd would stay flagged forever even
					// after moving into a git repo.
					this.getBookkeeping(event.sessionId).gitInfoUnresolvable = false;
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
						providerName: this.name,
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
			bk = {
				activeToolCount: 0,
				currentFileCounts: new Map(),
				pendingFileClears: new Map(),
				currentReadCounts: new Map(),
				pendingReadClears: new Map(),
				lastTouchedAt: new Map(),
				gitInfoUnresolvable: false,
			};
			this._sessionBookkeeping.set(sessionId, bk);
		}
		return bk;
	}

	/** Returns the active decay window in milliseconds — the cooldown between PostToolUse and
	 *  dropping the path from the bookkeeping. Reads through the host callback every time so a
	 *  setting change takes effect on the next Pre/Post pair without re-wiring (existing timers
	 *  keep their original timeout — acceptable since they're short-lived relative to the setting). */
	private get activityDecayMs(): number {
		return this.callbacks.getActivityDecayMs?.() ?? defaultActivityDecayMs;
	}

	/** Locates the *parent* session id that owns the given session id — returns the id itself when
	 *  it matches a top-level session, otherwise the `id` of the parent that holds it under
	 *  `subagents[]`. Returns `undefined` when neither match (session no longer exists). Used to
	 *  route per-session bookkeeping changes to the right top-level `syncSessionFileActivity` call.
	 *  Tool events are parent-keyed (the CLI sends a sub-agent's tool events under the parent id),
	 *  so the `subagents[]` branch is a defensive fallback for any other-keyed caller. */
	private findOwningParentId(sessionId: string): string | undefined {
		for (const s of this._sessions) {
			if (s.id === sessionId) return s.id;

			if (s.subagents != null) {
				for (const sub of s.subagents) {
					if (sub.id === sessionId) return s.id;
				}
			}
		}
		return undefined;
	}

	private resetBookkeeping(sessionId: string): void {
		const bk = this.getBookkeeping(sessionId);
		bk.activeToolCount = 0;
		bk.pendingPermission = undefined;
		this.cancelPendingFileClears(bk);
		bk.currentFileCounts.clear();
		this.cancelPendingReadClears(bk);
		bk.currentReadCounts.clear();
		bk.lastTouchedAt.clear();
		bk.gitInfoUnresolvable = false;
		const parentId = this.findOwningParentId(sessionId);
		if (parentId != null) {
			this.syncSessionFileActivity(parentId);
		}
	}

	/** Turn-end settle (Stop): the agent finished its turn, so nothing is "live" anymore — but
	 *  the per-operation decay tail must survive. Heat fades over {@link activityDecayMs} measured
	 *  from when each *tool* finished (the PostToolUse cooldown), NOT from when the turn ends, so a
	 *  Stop must not cancel those cooldowns or clear `lastTouchedAt`. We only reset turn-scoped
	 *  state and force-finish any path whose PostToolUse never arrived before Stop: drop its
	 *  refcount to 0 (flipping `editing`/`reading` off so the pulse stops) and schedule the same
	 *  decay eviction a normal completion would. Contrast {@link resetBookkeeping}, which hard-
	 *  wipes everything for SessionStart/SessionEnd (the agent is gone, not merely between turns). */
	private settleBookkeeping(sessionId: string): void {
		const bk = this.getBookkeeping(sessionId);
		bk.activeToolCount = 0;
		bk.pendingPermission = undefined;
		// Allow git re-resolution next turn (matches the prior reset-on-Stop intent).
		bk.gitInfoUnresolvable = false;
		for (const [path, count] of bk.currentFileCounts) {
			if (count > 0) {
				bk.currentFileCounts.set(path, 0);
				this.scheduleFileDecayEviction(bk, sessionId, path);
			}
		}
		for (const [path, count] of bk.currentReadCounts) {
			if (count > 0) {
				bk.currentReadCounts.set(path, 0);
				this.scheduleReadDecayEviction(bk, sessionId, path);
			}
		}
		const parentId = this.findOwningParentId(sessionId);
		if (parentId != null && this.syncSessionFileActivity(parentId)) {
			this._onDidChangeSessions.fire();
		}
	}

	private cancelPendingFileClears(bk: SessionBookkeeping): void {
		for (const timer of bk.pendingFileClears.values()) {
			clearTimeout(timer);
		}
		bk.pendingFileClears.clear();
	}

	private cancelPendingReadClears(bk: SessionBookkeeping): void {
		for (const timer of bk.pendingReadClears.values()) {
			clearTimeout(timer);
		}
		bk.pendingReadClears.clear();
	}

	/** Extracts the targeted file path from a PreToolUse/PostToolUse event. Tries the raw
	 *  `hookInput.tool_input` passthrough first, falls back to the projected `event.toolInput`
	 *  for older CLI versions that only fill the top-level fields. Treats an empty-object
	 *  `hookInput.tool_input` as missing — `??` would have kept it (truthy) and shadowed a
	 *  populated `event.toolInput`. */
	private getEventFilePath(event: AgentSessionEvent): string | undefined {
		const toolName = (event.hookInput?.tool_name as string | undefined) ?? event.toolName;
		if (toolName == null) return undefined;

		const rawHookInput = event.hookInput?.tool_input as Record<string, unknown> | undefined;
		const hookInputPopulated = rawHookInput != null && Object.keys(rawHookInput).length > 0;
		const toolInput = hookInputPopulated ? rawHookInput : event.toolInput;
		return getToolFilePath(toolName, toolInput);
	}

	/** Stamps the per-path/per-kind `lastTouchedAt[kind]` to the current epoch ms. Stamped on every
	 *  PreToolUse for the matching kind so `serializeFileActivity` can emit `readAt`/`editedAt` as
	 *  a relative `now - timestamp` delta. */
	private stampLastTouched(bk: SessionBookkeeping, filePath: string, kind: 'read' | 'edit'): void {
		const existing = bk.lastTouchedAt.get(filePath);
		const next: { edit?: number; read?: number } = existing != null ? { ...existing } : {};
		next[kind] = Date.now();
		bk.lastTouchedAt.set(filePath, next);
	}

	/** Drops the `lastTouchedAt[kind]` slot for `filePath`, and the whole entry when neither kind
	 *  remains. Mirrors the cooldown-timer eviction in `scheduleClear*` — once the path is gone
	 *  from the count map for that kind, its timestamp is no longer load-bearing. */
	private clearLastTouched(bk: SessionBookkeeping, filePath: string, kind: 'read' | 'edit'): void {
		const existing = bk.lastTouchedAt.get(filePath);
		if (existing == null) return;
		if (existing[kind] == null) return;

		const next: { edit?: number; read?: number } = { ...existing, [kind]: undefined };
		if (next.edit == null && next.read == null) {
			bk.lastTouchedAt.delete(filePath);
		} else {
			bk.lastTouchedAt.set(filePath, next);
		}
	}

	/** Records that a file-mutating tool call is in flight against `filePath` so consumers can
	 *  highlight the path. Refcounts per path — keyed by path (not `tool_use_id`, which the GK CLI
	 *  doesn't reliably surface) so parallel calls bump the count and Post/Pre order doesn't matter.
	 *  Returns whether the parent's published `fileActivity` actually changed so callers can fire
	 *  when the surrounding {@link updateSessionStatus} short-circuits. */
	private trackToolUseFile(sessionId: string, event: AgentSessionEvent): boolean {
		const filePath = this.getEventFilePath(event);
		if (filePath == null) return false;

		const bk = this.getBookkeeping(sessionId);
		// A fresh Pre during a pending Post-cooldown means the file is live again — cancel the
		// scheduled clear so the deferred drop doesn't run after the new tool already finished.
		const pendingClear = bk.pendingFileClears.get(filePath);
		if (pendingClear != null) {
			clearTimeout(pendingClear);
			bk.pendingFileClears.delete(filePath);
		}
		bk.currentFileCounts.set(filePath, (bk.currentFileCounts.get(filePath) ?? 0) + 1);
		this.stampLastTouched(bk, filePath, 'edit');
		return this.syncSessionFileActivityForChild(sessionId);
	}

	/** Decrements the in-flight refcount for a finished tool call's file. While the count stays
	 *  above zero (overlapping parallel calls) the path remains marked. When the count drops to
	 *  zero, leaves the entry in place at count `0` and schedules a {@link activityDecayMs}
	 *  cooldown before actually dropping it — so a recently-edited file lingers as a decay tail
	 *  on the treemap. A Pre arriving during cooldown cancels the timer and bumps the count back
	 *  above zero. Returns whether the parent's published `fileActivity` changed (i.e. `editing`
	 *  flipped off) so the PostToolUse caller can fire when its `updateSessionStatus` short-
	 *  circuits (a parallel tool still in flight keeps activeToolCount > 0). */
	private scheduleClearToolUseFile(sessionId: string, event: AgentSessionEvent): boolean {
		const filePath = this.getEventFilePath(event);
		if (filePath == null) return false;

		const bk = this.getBookkeeping(sessionId);
		const count = bk.currentFileCounts.get(filePath);
		// A duplicate / out-of-order Post during cooldown (count is already 0) would drive the
		// refcount negative and schedule a second timer — ignore those so the cooldown stays
		// authoritative until either its timer fires or a fresh Pre bumps the count back up.
		if (count == null || count <= 0) return false;

		const next = count - 1;
		bk.currentFileCounts.set(filePath, next);
		// Re-sync so `editing` drops from `true` to `undefined` the moment refcount hits zero —
		// the cooldown only governs when the path itself leaves the snapshot, not when the
		// "live" boolean flips off.
		const changed = this.syncSessionFileActivityForChild(sessionId);
		if (next > 0) return changed;

		// Refcount just hit zero — keep the path in `currentFileCounts` for the cooldown window,
		// then drop it.
		this.scheduleFileDecayEviction(bk, sessionId, filePath);
		return changed;
	}

	/** Schedules (replacing any prior timer) the {@link activityDecayMs} cooldown that finally
	 *  drops `filePath` from the edit bookkeeping once it has fully decayed. Shared by the
	 *  PostToolUse cooldown path and the Stop settle ({@link settleBookkeeping}); the path stays
	 *  in `currentFileCounts` at count 0 meanwhile so its `editedAt` keeps aging on the client. */
	private scheduleFileDecayEviction(bk: SessionBookkeeping, sessionId: string, filePath: string): void {
		const existing = bk.pendingFileClears.get(filePath);
		if (existing != null) {
			clearTimeout(existing);
		}

		const timer = setTimeout(() => {
			if (this._disposed) return;

			const cur = this._sessionBookkeeping.get(sessionId);
			if (cur == null) return;

			cur.pendingFileClears.delete(filePath);
			// Re-check: a Pre during cooldown bumped the count and cancelled this timer, but a
			// concurrent reset could have cleared everything — bail in either case.
			if ((cur.currentFileCounts.get(filePath) ?? 0) > 0) return;

			cur.currentFileCounts.delete(filePath);
			this.clearLastTouched(cur, filePath, 'edit');
			if (this.syncSessionFileActivityForChild(sessionId)) {
				this._onDidChangeSessions.fire();
			}
		}, this.activityDecayMs);
		bk.pendingFileClears.set(filePath, timer);
	}

	/** Drops a tracked tool call's file immediately (no cooldown). Used for PermissionDenied,
	 *  where the tool never ran — keeping the "live" badge would be misleading.
	 *  Returns whether the published list changed. */
	private untrackToolUseFile(sessionId: string, event: AgentSessionEvent): boolean {
		const filePath = this.getEventFilePath(event);
		if (filePath == null) return false;

		const bk = this.getBookkeeping(sessionId);
		const count = bk.currentFileCounts.get(filePath);
		if (count == null) return false;
		if (count > 1) {
			bk.currentFileCounts.set(filePath, count - 1);
			return this.syncSessionFileActivityForChild(sessionId);
		}

		const pending = bk.pendingFileClears.get(filePath);
		if (pending != null) {
			clearTimeout(pending);
			bk.pendingFileClears.delete(filePath);
		}
		bk.currentFileCounts.delete(filePath);
		this.clearLastTouched(bk, filePath, 'edit');
		return this.syncSessionFileActivityForChild(sessionId);
	}

	/** Mirror of {@link getEventFilePath} for read-only file tools. */
	private getEventReadPath(event: AgentSessionEvent): string | undefined {
		const toolName = (event.hookInput?.tool_name as string | undefined) ?? event.toolName;
		if (toolName == null) return undefined;

		const rawHookInput = event.hookInput?.tool_input as Record<string, unknown> | undefined;
		const hookInputPopulated = rawHookInput != null && Object.keys(rawHookInput).length > 0;
		const toolInput = hookInputPopulated ? rawHookInput : event.toolInput;
		return getToolReadPath(toolName, toolInput);
	}

	/** Refcount mirror of {@link trackToolUseFile} for read-only file tools. */
	private trackToolUseRead(sessionId: string, event: AgentSessionEvent): boolean {
		const filePath = this.getEventReadPath(event);
		if (filePath == null) return false;

		const bk = this.getBookkeeping(sessionId);
		const pendingClear = bk.pendingReadClears.get(filePath);
		if (pendingClear != null) {
			clearTimeout(pendingClear);
			bk.pendingReadClears.delete(filePath);
		}
		bk.currentReadCounts.set(filePath, (bk.currentReadCounts.get(filePath) ?? 0) + 1);
		this.stampLastTouched(bk, filePath, 'read');
		return this.syncSessionFileActivityForChild(sessionId);
	}

	/** Cooldown mirror of {@link scheduleClearToolUseFile} for read-only file tools. Returns
	 *  whether the parent's published `fileActivity` changed (i.e. `reading` flipped off). */
	private scheduleClearToolUseRead(sessionId: string, event: AgentSessionEvent): boolean {
		const filePath = this.getEventReadPath(event);
		if (filePath == null) return false;

		const bk = this.getBookkeeping(sessionId);
		const count = bk.currentReadCounts.get(filePath);
		// Same guard as scheduleClearToolUseFile — duplicate / out-of-order Posts during cooldown
		// would otherwise drive the refcount negative and stack up redundant clear timers.
		if (count == null || count <= 0) return false;

		const next = count - 1;
		bk.currentReadCounts.set(filePath, next);
		// Re-sync so `reading` drops to `undefined` the moment refcount hits zero.
		const changed = this.syncSessionFileActivityForChild(sessionId);
		if (next > 0) return changed;

		this.scheduleReadDecayEviction(bk, sessionId, filePath);
		return changed;
	}

	/** Read-class mirror of {@link scheduleFileDecayEviction}. */
	private scheduleReadDecayEviction(bk: SessionBookkeeping, sessionId: string, filePath: string): void {
		const existing = bk.pendingReadClears.get(filePath);
		if (existing != null) {
			clearTimeout(existing);
		}

		const timer = setTimeout(() => {
			if (this._disposed) return;

			const cur = this._sessionBookkeeping.get(sessionId);
			if (cur == null) return;

			cur.pendingReadClears.delete(filePath);
			if ((cur.currentReadCounts.get(filePath) ?? 0) > 0) return;

			cur.currentReadCounts.delete(filePath);
			this.clearLastTouched(cur, filePath, 'read');
			if (this.syncSessionFileActivityForChild(sessionId)) {
				this._onDidChangeSessions.fire();
			}
		}, this.activityDecayMs);
		bk.pendingReadClears.set(filePath, timer);
	}

	/** Immediate-drop mirror of {@link untrackToolUseFile} for read-only file tools. */
	private untrackToolUseRead(sessionId: string, event: AgentSessionEvent): boolean {
		const filePath = this.getEventReadPath(event);
		if (filePath == null) return false;

		const bk = this.getBookkeeping(sessionId);
		const count = bk.currentReadCounts.get(filePath);
		if (count == null) return false;
		if (count > 1) {
			bk.currentReadCounts.set(filePath, count - 1);
			return this.syncSessionFileActivityForChild(sessionId);
		}

		const pending = bk.pendingReadClears.get(filePath);
		if (pending != null) {
			clearTimeout(pending);
			bk.pendingReadClears.delete(filePath);
		}
		bk.currentReadCounts.delete(filePath);
		this.clearLastTouched(bk, filePath, 'read');
		return this.syncSessionFileActivityForChild(sessionId);
	}

	/** Convenience wrapper that resolves the parent for a possibly-sub-agent session id, then calls
	 *  {@link syncSessionFileActivity}. Tool-call handlers call this without knowing whether the
	 *  session is a top-level or sub-agent session. Returns `false` when the session isn't found
	 *  (already pruned / unknown peer id). */
	private syncSessionFileActivityForChild(sessionId: string): boolean {
		const parentId = this.findOwningParentId(sessionId);
		if (parentId == null) return false;
		return this.syncSessionFileActivity(parentId);
	}

	/** Rebuilds the parent session's `fileActivity` array from its bookkeeping and writes it onto
	 *  the session in place. Returns whether the *structural* shape changed (paths/kinds/flags) —
	 *  timestamps are always refreshed regardless, but a fire is gated on structural change so
	 *  non-meaningful drift doesn't churn the wire.
	 *
	 *  No separate sub-agent rollup is needed: the GK CLI keys a sub-agent's tool events under its
	 *  PARENT session id (with `agentId` set), so they accumulate in the parent's own bookkeeping
	 *  directly and are already reflected here. Sub-agent serialized objects carry no `fileActivity`. */
	private syncSessionFileActivity(parentSessionId: string): boolean {
		const index = this._sessions.findIndex(s => s.id === parentSessionId);
		if (index < 0) return false;

		const parent = this._sessions[index];
		const parentBk = this._sessionBookkeeping.get(parentSessionId);

		type Contrib = { editCount: number; readCount: number; editAt?: number; readAt?: number };
		const merged = new Map<string, Contrib>();

		const contributeFrom = (bk: SessionBookkeeping | undefined): void => {
			if (bk == null) return;

			for (const [path, count] of bk.currentFileCounts) {
				let entry = merged.get(path);
				if (entry == null) {
					entry = { editCount: 0, readCount: 0 };
					merged.set(path, entry);
				}
				entry.editCount += count;
				const ts = bk.lastTouchedAt.get(path)?.edit;
				if (ts != null && (entry.editAt == null || ts > entry.editAt)) {
					entry.editAt = ts;
				}
			}
			for (const [path, count] of bk.currentReadCounts) {
				let entry = merged.get(path);
				if (entry == null) {
					entry = { editCount: 0, readCount: 0 };
					merged.set(path, entry);
				}
				entry.readCount += count;
				const ts = bk.lastTouchedAt.get(path)?.read;
				if (ts != null && (entry.readAt == null || ts > entry.readAt)) {
					entry.readAt = ts;
				}
			}
		};

		contributeFrom(parentBk);

		const now = Date.now();
		let next: FileActivityEntry[] | undefined;
		if (merged.size > 0) {
			next = [];
			for (const [path, contrib] of merged) {
				const entry: FileActivityEntry = { path: path };
				if (contrib.editAt != null) {
					entry.editedAt = Math.max(0, now - contrib.editAt);
				}
				if (contrib.readAt != null) {
					entry.readAt = Math.max(0, now - contrib.readAt);
				}
				if (contrib.editCount > 0) {
					entry.editing = true;
				}
				if (contrib.readCount > 0) {
					entry.reading = true;
				}
				next.push(entry);
			}
		}

		const changed = !fileActivityStructurallyEqual(parent.fileActivity, next);
		// Always replace so timestamps reflect the latest serialization, even when the structural
		// shape is unchanged (so a downstream fire from anywhere else carries fresh `sinceMs`).
		this._sessions[index] = { ...parent, fileActivity: next };
		return changed;
	}

	/** Defer the `Stop → idle` commit. If the agent produces a non-idle event within
	 *  `stopToIdleDebounceMs`, `cancelPendingIdleTransition` (called from `updateSessionStatus`)
	 *  cancels this and the session stays in its prior phase — no working → idle → working flicker.
	 *
	 *  Intentionally takes no context: the caller is expected to apply any event metadata
	 *  synchronously before scheduling. Carrying Stop-time context into the timer would let
	 *  in-window metadata mutations (e.g. `CwdChanged` updating `_sessions[i].cwd` directly)
	 *  get reverted when the deferred commit replays the stale context through `ensureSession`. */
	private scheduleIdleTransition(sessionId: string): void {
		this.cancelPendingIdleTransition(sessionId);
		const timer = setTimeout(() => {
			this._pendingIdleTimers.delete(sessionId);
			// Session may have been removed (SessionEnd, prune) during the window.
			if (this._sessions.findIndex(s => s.id === sessionId) < 0) return;

			this.updateSessionStatus(sessionId, 'idle');
		}, stopToIdleDebounceMs);
		this._pendingIdleTimers.set(sessionId, timer);
	}

	private cancelPendingIdleTransition(sessionId: string): void {
		const timer = this._pendingIdleTimers.get(sessionId);
		if (timer == null) return;

		clearTimeout(timer);
		this._pendingIdleTimers.delete(sessionId);
	}

	/** Stable phase-since: if we're oscillating back into the phase we were just in (within a
	 *  short window), restore its original timestamp so the displayed elapsed time doesn't snap
	 *  to 0. Otherwise records the current phase as the new "prior" and returns `now`. */
	private resolvePhaseSince(
		sessionId: string,
		prevPhase: AgentSessionPhase,
		prevPhaseSince: Date,
		newPhase: AgentSessionPhase,
	): Date {
		if (prevPhase === newPhase) return prevPhaseSince;

		const bk = this.getBookkeeping(sessionId);
		const now = new Date();

		if (bk.priorPhase?.phase === newPhase && now.getTime() - prevPhaseSince.getTime() < phaseSinceRestoreWindowMs) {
			const restored = bk.priorPhase.phaseSince;
			bk.priorPhase = { phase: prevPhase, phaseSince: prevPhaseSince };
			return restored;
		}

		bk.priorPhase = { phase: prevPhase, phaseSince: prevPhaseSince };
		return now;
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
	): boolean {
		const pending = this._pendingPermissions.get(sessionId);
		if (pending == null) return false;

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
		return true;
	}

	private matchesWorkspace(workspacePath: string | undefined): boolean {
		if (!workspacePath) return false;

		// `_workspacePaths` is normalized; normalize the input so prefix comparisons work
		// regardless of whether the caller passed a raw `fsPath` (CLI hook cwd, peer-session
		// workspacePath) or an already-normalized path.
		const normalized = normalizePath(workspacePath);
		return this._workspacePaths.some(
			p => normalized === p || normalized.startsWith(`${p}/`) || p.startsWith(`${normalized}/`),
		);
	}

	private resolveWorkspacePath(cwd: string | undefined): string | undefined {
		if (!cwd) return undefined;

		const normalized = normalizePath(cwd);
		return this._workspacePaths.find(
			p => normalized === p || normalized.startsWith(`${p}/`) || p.startsWith(`${normalized}/`),
		);
	}

	private updateSessionWithPermission(sessionId: string, permission: PendingPermission, pid?: number): void {
		// A pending permission is a working/waiting transition — cancel any deferred Stop → idle
		// commit so the session doesn't briefly flip to idle before showing the prompt.
		this.cancelPendingIdleTransition(sessionId);

		const { index } = this.ensureSession(sessionId, { pid: pid });

		const prev = this._sessions[index];
		const newPhase = getPhaseForStatus('permission_requested');
		this.getBookkeeping(sessionId).pendingPermission = permission;
		this._sessions[index] = {
			...prev,
			status: 'permission_requested',
			phase: newPhase,
			phaseSince: this.resolvePhaseSince(sessionId, prev.phase, prev.phaseSince, newPhase),
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
		// Any non-idle status update implicitly cancels a deferred Stop → idle commit. The
		// timer is owned here so the schedule/cancel pair is uniformly enforced regardless of
		// which event path produced the next status.
		if (status !== 'idle') {
			this.cancelPendingIdleTransition(sessionId);
		}

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
			phaseSince: this.resolvePhaseSince(sessionId, prev.phase, prev.phaseSince, newPhase),
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

		// On a fresh transition into idle, recheck transcript titles — Claude typically (re-)writes
		// `ai-title` right after finishing a response, so this is the prime moment to pick it up.
		// Tail-read caching makes repeated checks cheap.
		if (status === 'idle' && prev.status !== 'idle') {
			void this.resolveTranscriptTitles(sessionId, this._sessions[index].cwd);
		}
	}

	private ensureSession(sessionId: string, context?: SessionContext): { index: number; changed: boolean } {
		const { pid, workspacePath, isInWorkspace, cwd, initialCwd, planFile, sessionName } = context ?? {};

		let index = this._sessions.findIndex(s => s.id === sessionId);
		if (index < 0) {
			const now = new Date();
			index = this._sessions.length;
			this._sessions.push({
				id: sessionId,
				providerId: this.id,
				providerName: this.name,
				name: sessionName || undefined,
				status: 'idle',
				phase: getPhaseForStatus('idle'),
				phaseSince: now,
				pid: pid,
				lastActivity: now,
				isSubagent: false,
				workspacePath: workspacePath,
				cwd: cwd,
				initialCwd: initialCwd ?? cwd,
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
			void this.resolveTranscriptTitles(sessionId, cwd);
			return { index: index, changed: true };
		}

		const existing = this._sessions[index];
		const updatedPid = pid != null && existing.pid == null ? pid : existing.pid;
		const updatedWorkspacePath = workspacePath || existing.workspacePath;
		const updatedIsInWorkspace = workspacePath ? (isInWorkspace ?? existing.isInWorkspace) : existing.isInWorkspace;
		const updatedPlanFile = planFile ?? existing.planFile;
		const updatedName = sessionName || existing.name;
		const updatedCwd = cwd ?? existing.cwd;
		// Prefer the CLI's authoritative `initialCwd` (the true launch dir it captured first-hand,
		// even for sessions that started before this window opened); otherwise keep whatever we
		// already captured, and only as a last resort backfill from the current cwd (older CLIs that
		// don't send `initialCwd`, or a cold-create before any cwd was known). Comparing live `cwd`
		// against `initialCwd` is how consumers detect launch-vs-current drift, so it stays stable.
		const updatedInitialCwd = initialCwd ?? existing.initialCwd ?? cwd;

		let changed = false;
		if (
			updatedPid !== existing.pid ||
			updatedWorkspacePath !== existing.workspacePath ||
			updatedIsInWorkspace !== existing.isInWorkspace ||
			updatedPlanFile !== existing.planFile ||
			updatedName !== existing.name ||
			updatedCwd !== existing.cwd ||
			updatedInitialCwd !== existing.initialCwd
		) {
			this._sessions[index] = {
				...existing,
				name: updatedName,
				pid: updatedPid,
				workspacePath: updatedWorkspacePath,
				cwd: updatedCwd,
				initialCwd: updatedInitialCwd,
				planFile: updatedPlanFile,
				isInWorkspace: updatedIsInWorkspace,
			};
			changed = true;
		}

		// Re-fire `resolveGitInfo` if the session is missing either `worktreePath` or `commonPath`.
		// Peer-synced sessions arrive with `worktreePath` already set (from the peer that owns the
		// hook flow) but may lack `commonPath` if the peer was running pre-commonPath code; this
		// gives us a chance to fill it in locally. Idempotent — `resolveGitInfo` only mutates the
		// session when one of `cwd`/`worktreePath`/`commonPath` actually changes. The
		// `gitInfoUnresolvable` bookkeeping flag (see `SessionBookkeeping`) is set once
		// `resolveGitInfo` confirms the cwd isn't a git repo, preventing a retry storm on every
		// hook event for non-git-repo cwds. The flag is cleared on cwd change (`CwdChanged`) and
		// on `resetBookkeeping` (Stop/SessionStart) so re-resolution can happen when warranted.
		if (
			cwd != null &&
			(existing.worktreePath == null || existing.commonPath == null) &&
			!this.getBookkeeping(sessionId).gitInfoUnresolvable
		) {
			void this.resolveGitInfo(sessionId, cwd);
		}
		return { index: index, changed: changed };
	}

	private async resolveGitInfo(sessionId: string, cwd: string): Promise<void> {
		const resolveGitInfo = this.callbacks.resolveGitInfo;
		if (resolveGitInfo == null) return;

		// Dedupe concurrent calls for the same session — every hook event (PreToolUse, PostToolUse,
		// UserPromptSubmit, etc.) flows through `ensureSession`, which retries `resolveGitInfo`
		// whenever `commonPath`/`worktreePath` is missing. Without this guard a non-git-repo cwd
		// would spawn a fresh git probe per hook event. The `gitInfoUnresolvable` bookkeeping flag
		// (set below when `info == null`) is the long-lived suppressor across hook events; this
		// in-flight set only dedupes concurrent overlapping probes within a single resolution.
		if (this._resolveGitInfoInFlight.has(sessionId)) return;

		this._resolveGitInfoInFlight.add(sessionId);
		try {
			let info: Awaited<ReturnType<typeof resolveGitInfo>> | undefined;
			try {
				info = await resolveGitInfo(cwd);
			} catch {
				// Git not available or not a git repo — fall through to mark unresolvable below
				info = undefined;
			}

			const index = this._sessions.findIndex(s => s.id === sessionId);
			if (index < 0) return;

			const session = this._sessions[index];

			// `workspacePath` stays as the matched workspace folder (or undefined). Repo identity
			// flows through `commonPath`, populated here from `info.repoRoot` at the same step as
			// `worktreePath` — both available together from `resolveGitInfo`, much earlier than the
			// follow-on worktree-name refresh (which needs `getWorktrees()` on the parent repo).
			//
			// When `info == null` (cwd is not inside any git repo), set the `gitInfoUnresolvable`
			// bookkeeping flag so subsequent `ensureSession`/peer-sync retry checks skip re-firing.
			// We deliberately do NOT write a tombstone onto the session DTO — keeping `commonPath`
			// as `undefined` (a) keeps the wire-shape unambiguous for peers, (b) lets consumers
			// safely treat undefined as "no repo identity", and (c) means peers can still attempt
			// their own local resolution. The flag is cleared on cwd change (`CwdChanged`) and on
			// `resetBookkeeping` so re-resolution happens when warranted (e.g. user runs `git init`
			// followed by a new session start).
			if (info == null) {
				this.getBookkeeping(sessionId).gitInfoUnresolvable = true;
				if (cwd !== session.cwd) {
					this._sessions[index] = { ...session, cwd: cwd };
					this._onDidChangeSessions.fire();
				}
				return;
			}

			// Capture the worktree/commonPath at the first successful resolve so consumers can
			// detect drift (e.g. an agent that `cd`'d into a sibling worktree after launch). Gated
			// on `initialCommonPath` — captured together with `initialWorktreePath` so a first
			// resolve where `info.worktreePath` happens to be undefined doesn't leave the latter
			// open to a later overwrite. Once set, never overwritten.
			const firstResolve = session.initialCommonPath == null;
			const updatedInitialWorktreePath = firstResolve ? info.worktreePath : session.initialWorktreePath;
			const updatedInitialCommonPath = firstResolve ? info.repoRoot : session.initialCommonPath;

			if (
				cwd !== session.cwd ||
				info.worktreePath !== session.worktreePath ||
				info.repoRoot !== session.commonPath ||
				updatedInitialWorktreePath !== session.initialWorktreePath ||
				updatedInitialCommonPath !== session.initialCommonPath
			) {
				this._sessions[index] = {
					...session,
					cwd: cwd,
					worktreePath: info.worktreePath,
					commonPath: info.repoRoot,
					initialWorktreePath: updatedInitialWorktreePath,
					initialCommonPath: updatedInitialCommonPath,
				};
				this._onDidChangeSessions.fire();
			}
		} finally {
			this._resolveGitInfoInFlight.delete(sessionId);
		}
	}

	private async resolveTranscriptTitles(sessionId: string, cwd: string | undefined): Promise<void> {
		let titles;
		try {
			titles = await this._transcriptReader.resolve(sessionId, cwd);
		} catch {
			return;
		}
		if (titles == null) return;

		const index = this._sessions.findIndex(s => s.id === sessionId);
		if (index < 0) return;

		const session = this._sessions[index];
		const prev = session.transcriptTitles;
		if (prev?.custom === titles.custom && prev?.ai === titles.ai && prev?.agent === titles.agent) return;

		this._sessions[index] = {
			...session,
			transcriptTitles: { custom: titles.custom, ai: titles.ai, agent: titles.agent },
		};
		this._onDidChangeSessions.fire();
	}

	private pruneDeadSessions(): boolean {
		const kept: AgentSession[] = [];
		const removedIds: string[] = [];
		for (const s of this._sessions) {
			// A session blocking on us for a permission decision is by definition alive,
			// even if `kill(pid, 0)` says otherwise (e.g. transient EPERM/ESRCH). Dropping
			// it here loses pendingPermission and lastPrompt; the next syncSessions then
			// re-adds it as a stale shell with `permission_requested` status but no detail.
			if (s.pid == null || isProcessAlive(s.pid) || this._pendingPermissions.has(s.id)) {
				kept.push(s);
			} else {
				removedIds.push(s.id);
			}
		}
		if (removedIds.length === 0) return false;

		this._sessions = kept;
		for (const id of removedIds) {
			const pending = this._pendingPermissions.get(id);
			if (pending != null) {
				pending.reject(new Error('Session pruned'));
				this._pendingPermissions.delete(id);
			}
			this.cancelPendingIdleTransition(id);
			// Cancel any in-flight decay-eviction timers before dropping the bookkeeping (mirrors
			// SessionEnd). A Stopped-then-killed session reaches here with armed cooldown timers
			// (settleBookkeeping leaves them running), so without this they'd leak until they fire.
			const bk = this._sessionBookkeeping.get(id);
			if (bk != null) {
				this.cancelPendingFileClears(bk);
				this.cancelPendingReadClears(bk);
			}
			this._sessionBookkeeping.delete(id);
			this._transcriptReader.forget(id);
		}
		Logger.debug(
			`ClaudeCodeProvider.syncSessions: removed ${removedIds.length} stale session(s): ${removedIds.map(id => id.substring(0, 8)).join(', ')}`,
		);
		return true;
	}

	protected async syncSessions(options?: { gate?: boolean }): Promise<void> {
		// Recurring (gated) calls skip the CLI spawn when there's nothing to reconcile: no tracked
		// sessions AND no installed hooks. Sessions only ever appear via the IPC push path or a peer,
		// so an empty list with hooks off means no agents are reachable here. We still poll whenever
		// sessions exist — that's the only local backstop for pruning agents that die without firing
		// `SessionEnd`, and it keeps us correct even if hook detection is stale/wrong. The bootstrap
		// call in `ensureIpcServer` passes no options, so cold-start discovery always runs.
		if (options?.gate && this._sessions.length === 0 && !this._claudeHooksInstalled) return;

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

		// Snapshot what the live IPC path had already tracked, so we can detect drift between it and
		// what the poll returns. Ideally they match exactly — any difference means the live push path
		// missed an add (poll discovers it) or a teardown (poll no longer reports a session we track).
		const trackedBefore = new Set(this._sessions.map(s => s.id));
		const polledAlive = new Set<string>();
		// Mutable copy of `trackedBefore` that also accumulates ids added during this poll, so the
		// membership check below is O(1) and duplicate ids within a single poll response are only
		// added once. `trackedBefore` itself stays the pre-poll snapshot used by the `missing` calc.
		const known = new Set(trackedBefore);

		let changed = false;
		let discovered = 0;

		for (const data of sessions) {
			if (!data.sessionId || !data.pid || !isProcessAlive(data.pid)) {
				continue;
			}

			polledAlive.add(data.sessionId);

			if (known.has(data.sessionId)) continue;

			known.add(data.sessionId);

			const workspacePath = this.resolveWorkspacePath(data.cwd);
			const isInWorkspace = workspacePath != null;
			const status = deriveStatusFromEvent(data.event);
			const phase = getPhaseForStatus(status);
			const activityDate = new Date(data.updatedAt);

			const subagents: AgentSession[] | undefined = data.subagents?.map(sub => ({
				id: sub.agentId,
				providerId: this.id,
				providerName: this.name,
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
				providerName: this.name,
				name: data.sessionName || undefined,
				status: status,
				phase: phase,
				phaseSince: activityDate,
				pid: data.pid,
				lastActivity: activityDate,
				isSubagent: false,
				workspacePath: workspacePath,
				cwd: data.cwd,
				// Prefer the CLI's launch dir; fall back to the snapshot's (possibly drifted) cwd on
				// older CLIs that don't record it. Without this, a window that cold-starts after the
				// agent drifted would stamp the drifted cwd as the launch dir.
				initialCwd: data.initialCwd ?? data.cwd,
				planFile: data.planFile ?? undefined,
				isInWorkspace: isInWorkspace,
				lastPrompt: prepareStoredPrompt(data.prompt ?? undefined),
				firstPrompt: prepareStoredPrompt(data.firstPrompt ?? undefined),
				subagents: subagents,
			});
			changed = true;
			discovered++;

			if (data.cwd) {
				void this.resolveGitInfo(data.sessionId, data.cwd);
			}
			void this.resolveTranscriptTitles(data.sessionId, data.cwd);
		}

		if (this.pruneDeadSessions()) {
			changed = true;
		}

		if (changed) {
			this._onDidChangeSessions.fire();
		}

		// Report any drift between the live-synced set and the poll. Only on the recurring (gated)
		// poll — the ungated bootstrap call runs before the live path has had a chance to receive
		// any events, so its discoveries are expected cold-start state, not drift. `missing` counts
		// sessions we still track that the poll no longer reports alive (a teardown the live path
		// missed, e.g. an agent killed without firing `SessionEnd`).
		if (options?.gate) {
			let missing = 0;
			for (const id of trackedBefore) {
				if (!polledAlive.has(id)) {
					missing++;
				}
			}
			if (discovered > 0 || missing > 0) {
				this.callbacks.onSyncDiscrepancy?.({
					provider: this.id,
					discovered: discovered,
					missing: missing,
					polled: polledAlive.size,
					tracked: trackedBefore.size,
				});
			}
		}
	}

	private async querySiblingWindowSessions(): Promise<void> {
		const discoveryDir = this.callbacks.ipc.agentDiscoveryDir;
		if (discoveryDir == null) return;

		let files: string[];
		try {
			files = await readdir(discoveryDir);
		} catch {
			return;
		}

		const ownPort = this.callbacks.ipc.port;

		const peerBatches = await Promise.all(
			files
				.filter(f => f.startsWith('gitlens-ipc-server-') && f.endsWith('.json'))
				.map(async f => this.fetchPeerSessions(join(discoveryDir, f), ownPort)),
		);

		let changed = false;
		// Peer sessions that arrived with `cwd` but no `commonPath` (peer was running pre-
		// commonPath code, OR the peer's own `resolveGitInfo` failed and we get to retry locally).
		// Resolved after the merge loop so the local Repository registry is consulted only once
		// per unique session, off the hot merge path. Keyed by id (value = cwd) so the same
		// session appearing in multiple peer responses (or re-queued within this loop) only
		// triggers a single backfill probe.
		const sessionsNeedingResolve = new Map<string, string>();

		for (const peerSessions of peerBatches) {
			if (peerSessions == null) continue;

			for (const peerSession of peerSessions) {
				const peerActivity = new Date(peerSession.lastActivity);
				const peerPhaseSince = new Date(peerSession.phaseSince);

				const existing = this._sessions.find(s => s.id === peerSession.id);

				if (existing != null) {
					// If the peer reports a different `cwd` than we last saw, the agent moved
					// (peer fired a `CwdChanged` event we don't receive locally). Pick up the new
					// cwd AND reset our local `gitInfoUnresolvable` flag — the new cwd might be a
					// git repo even if the previous one wasn't.
					const cwdChanged = peerSession.cwd != null && existing.cwd !== peerSession.cwd;
					if (cwdChanged && this._sessionBookkeeping.get(peerSession.id)?.gitInfoUnresolvable) {
						this.getBookkeeping(peerSession.id).gitInfoUnresolvable = false;
					}

					if (peerActivity > existing.lastActivity) {
						const idx = this._sessions.indexOf(existing);
						// Peer is the authoritative hook recipient for this session, so wipe any
						// local bookkeeping that survived from a previous local-ownership window.
						// Without this, refcounts/timers from a prior local-hosting stretch would
						// resurface stale paths if ownership ever flips back to us.
						const bk = this._sessionBookkeeping.get(peerSession.id);
						if (bk != null) {
							this.cancelPendingFileClears(bk);
							this.cancelPendingReadClears(bk);
							bk.currentFileCounts.clear();
							bk.currentReadCounts.clear();
							bk.lastTouchedAt.clear();
						}
						this._sessions[idx] = {
							...existing,
							status: peerSession.status,
							phase: peerSession.phase,
							phaseSince: peerPhaseSince,
							statusDetail: peerSession.statusDetail,
							lastActivity: peerActivity,
							subagents: rehydrateSubagents(peerSession.subagents),
							// Carry the peer's published fileActivity across so peer-window WIP
							// decorations + treemap heatmap follow the agent. Owned by the peer (it's
							// the hook recipient); we never originate this field for a remote session.
							fileActivity: peerSession.fileActivity,
							// Track the peer's resolved repo identity. The peer owns the hook flow and
							// re-resolves both on `CwdChanged`, so a worktree move (e.g. the agent
							// `cd`'d into a sibling worktree of the same repo — `commonPath` unchanged
							// but `worktreePath` changed) only reaches us if we carry BOTH. Carrying
							// `commonPath` alone froze the displayed worktree at first-discovery.
							worktreePath: peerSession.worktreePath ?? existing.worktreePath,
							commonPath: peerSession.commonPath ?? existing.commonPath,
							// Pick up the peer's latest cwd so our backfill probe (queued below)
							// targets the right path. Stale-cwd locally would just re-probe the
							// non-repo dir and hit the gitInfoUnresolvable retry guard again.
							cwd: cwdChanged ? peerSession.cwd : existing.cwd,
							// Launch-state fields are immutable per session: prefer whichever side
							// already set them (peer that owns the hook flow typically sets first),
							// and never overwrite a populated local value with the peer's.
							initialCwd: existing.initialCwd ?? peerSession.initialCwd,
							initialWorktreePath: existing.initialWorktreePath ?? peerSession.initialWorktreePath,
							initialCommonPath: existing.initialCommonPath ?? peerSession.initialCommonPath,
							// Forward peer-discovered transcript titles. Both windows can resolve them
							// independently against the same on-disk transcript, but only the peer's
							// hook flow drives its updates — without this, we'd freeze the snapshot
							// taken at first discovery.
							transcriptTitles: peerSession.transcriptTitles ?? existing.transcriptTitles,
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
						// Override whatever the peer published — this is OUR ownership view: the peer
						// (or some other window) hosts the live session, not us. Drives the dispatcher
						// to route opens through the peer's IPC + OS-level window focus instead of
						// calling `claude-vscode.editor.open` locally (which would just open an inert
						// view in our window).
						isPeerOwned: true,
					});
					changed = true;
				}

				// Queue a local resolveGitInfo for any peer session that arrived without a
				// commonPath but has a cwd — we can fill it in from our own git registry. Skip
				// if our own bookkeeping already marked this session's cwd unresolvable (we tried
				// locally and the cwd isn't a git repo from our vantage point either).
				const merged = this._sessions.find(s => s.id === peerSession.id);
				if (
					merged?.commonPath == null &&
					merged?.cwd != null &&
					!this.getBookkeeping(merged.id).gitInfoUnresolvable
				) {
					sessionsNeedingResolve.set(merged.id, merged.cwd);
				}
			}
		}

		if (changed) {
			this._onDidChangeSessions.fire();
		}

		// Backfill commonPath for peer-synced sessions whose owning peer didn't populate it.
		// `resolveGitInfo` is idempotent — only mutates + fires if it actually finds new info,
		// so the worst case here is a few wasted git probes for unresolvable cwds.
		for (const [id, cwd] of sessionsNeedingResolve) {
			void this.resolveGitInfo(id, cwd);
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

	/** Find the peer GitLens window whose discovery file claims `workspacePath`, and POST to its
	 *  `/agents/sessions/open` route to ask its Claude Code extension to open the session.
	 *
	 *  Resolves to `true` when at least one peer claimed the workspace AND was reachable (the POST
	 *  completed with any HTTP status). The peer's response shape (`{ opened: boolean }`) is logged
	 *  for diagnostics but does NOT affect the return value — an `opened: false` peer is still the
	 *  right window for the caller to focus, since it's the window that owns the session. Resolves
	 *  to `false` when no peer claimed the workspace OR every claimer was unreachable; the caller
	 *  treats that as "no peer to focus" and opens a new window instead of replacing the current
	 *  one. Best-effort: swallows scan, JSON-parse errors. */
	async notifyPeerOpenSession(workspacePath: string, sessionId: string): Promise<boolean> {
		const discoveryDir = this.callbacks.ipc.agentDiscoveryDir;
		if (discoveryDir == null) return false;

		const target = normalizePath(workspacePath);
		const ownPort = this.callbacks.ipc.port;

		let files: string[];
		try {
			files = await readdir(discoveryDir);
		} catch {
			return false;
		}

		const results = await Promise.all(
			files
				.filter(f => f.startsWith('gitlens-ipc-server-') && f.endsWith('.json'))
				.map(async f => {
					let discovery: DiscoveryFile;
					try {
						discovery = JSON.parse(await readFile(join(discoveryDir, f), 'utf8')) as DiscoveryFile;
					} catch {
						return false;
					}
					if (ownPort != null && discovery.port === ownPort) return false;
					// Symmetric prefix containment — same shape as `matchesWorkspace()` above.
					// Strict equality misses the common case where the dispatcher passes a `cwd`
					// inside the peer's workspace folder (or, less commonly, a parent dir that
					// contains the peer's workspace).
					if (
						!discovery.workspacePaths?.some(p => {
							const normalized = normalizePath(p);
							return (
								normalized === target ||
								target.startsWith(`${normalized}/`) ||
								normalized.startsWith(`${target}/`)
							);
						})
					) {
						return false;
					}

					try {
						const response = await fetch(`${discovery.address}/agents/sessions/open`, {
							method: 'POST',
							headers: {
								Authorization: `Bearer ${discovery.token}`,
								'Content-Type': 'application/json',
							},
							body: JSON.stringify({ sessionId: sessionId }),
							signal: AbortSignal.timeout(2000),
						});
						if (!response.ok) {
							Logger.warn(
								`ClaudeCodeProvider.notifyPeerOpenSession: peer at ${discovery.address} returned ${response.status}`,
							);
						} else {
							// Log a peer that failed to open the specific session, but still treat it
							// as a reachable claimer of the workspace — focusing that window is still
							// what the user wants.
							const body = (await response.json().catch(() => undefined)) as
								| { opened?: boolean }
								| undefined;
							if (body?.opened === false) {
								Logger.warn(
									`ClaudeCodeProvider.notifyPeerOpenSession: peer at ${discovery.address} could not open session ${sessionId}`,
								);
							}
						}
						return true;
					} catch (ex) {
						// Peer advertised but unreachable (timeout, RST, etc.). Treat as no match so
						// the caller opens a new window instead of trying to focus a dead window.
						Logger.warn(
							`ClaudeCodeProvider.notifyPeerOpenSession: peer at ${discovery.address} unreachable: ${
								ex instanceof Error ? ex.message : String(ex)
							}`,
						);
						return false;
					}
				}),
		);

		return results.some(Boolean);
	}
}
