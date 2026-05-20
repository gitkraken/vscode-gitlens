import type { Disposable, QuickPickItem } from 'vscode';
import { commands, EventEmitter, Uri, window, workspace } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Container } from '../container.js';
import { createQuickPickSeparator } from '../quickpicks/items/common.js';
import { registerCommand } from '../system/-webview/command.js';
import type { AgentSessionState, AgentSessionWorktreeMetadata } from './models/agentSessionState.js';
import { getSessionDisplayName, serializeAgentSession } from './models/agentSessionState.js';
import type { AgentSession, AgentSessionProvider, PermissionDecision, PermissionSuggestion } from './provider.js';
import { isClaudeExtensionAvailable } from './utils/-webview/claudeExtension.js';

export class AgentStatusService implements Disposable {
	private readonly _onDidChange = new EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidChangeHooksInstallState = new EventEmitter<void>();
	/**
	 * Fires after the user installs or uninstalls Claude Code hooks. Webviews subscribe so banners
	 * and integration chips reflect the new state without waiting for the 30s cache to expire.
	 */
	readonly onDidChangeHooksInstallState = this._onDidChangeHooksInstallState.event;

	private readonly _onDidChangeSessions = new EventEmitter<AgentSessionState[]>();
	/**
	 * Fires only when the session snapshot has actually changed (deep equality on the
	 * wire-shape). Lets multiple webviews subscribe without each re-implementing dedup against
	 * the noisier `onDidChange` event.
	 */
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _lastSerialized: string = '';

	/**
	 * Transient cache of `worktreePath -> live GitWorktree metadata`. Populated by
	 * `refreshWorktreeNameCache()` via `getWorktrees()` on the parent repo, which is cached by
	 * the git layer (keyed by `commonPath`, invalidated on `heads`/`remotes`/`worktrees`).
	 * Never persisted on `AgentSession` — every field is the worktree's *current* identity so
	 * `git checkout` / worktree renames / upstream changes flow to the UI without restarting.
	 */
	private readonly _worktreeNameByPath = new Map<string, AgentSessionWorktreeMetadata>();
	private _worktreeRefreshPromise: Promise<boolean> | undefined;
	/** Stable signature of the session worktree path set resolved by the last refresh. Lets the
	 *  noisy `onDidChangeSessions` trigger skip the refresh when only phase/activity changed. */
	private _resolvedWorktreePathsKey: string | undefined;

	private readonly _disposables: Disposable[] = [];
	private readonly _providers: AgentSessionProvider[];

	constructor(
		private readonly container: Container,
		providers: AgentSessionProvider[],
	) {
		this._providers = providers;

		for (const provider of this._providers) {
			this._disposables.push(
				provider.onDidChangeSessions(() => {
					// Always fire the cheap _onDidChange so non-name consumers (badge counts, agent
					// status row) stay snappy.
					this._onDidChange.fire();

					// If any session has a worktree path we haven't resolved yet, defer the rich
					// snapshot publish until the refresh completes so webviews don't paint with a
					// cold-fallback name (`On <path-basename>`) and then re-paint a moment later
					// with the proper branch name. The refresh publishes itself when metadata
					// changed; we only fire here when it didn't (couldn't resolve the path) or
					// failed, so the new session is never permanently swallowed.
					if (this.hasUnresolvedWorktreePaths()) {
						this.refreshWorktreeNameCache().then(
							changed => {
								if (!changed) {
									this.maybeFireSessionsChanged();
								}
							},
							() => this.maybeFireSessionsChanged(),
						);
					} else {
						this.maybeFireSessionsChanged();
						this.refreshWorktreeNameCacheIfSessionsChanged();
					}
				}),
			);
		}

		this._disposables.push(
			window.onDidChangeWindowState(e => {
				if (e.focused) {
					this.startProviders();
				} else {
					this.stopProviders();
				}
			}),
			workspace.onDidChangeWorkspaceFolders(() => this.onWorkspaceFoldersChanged()),
			this.container.git.onDidChangeRepository(e => {
				// Refresh when the worktree set or branch state of any repo we care about changes.
				// The underlying `getWorktrees()` cache already invalidates on these same signals.
				if (!e.changed('heads', 'remotes', 'worktrees')) return;

				void this.refreshWorktreeNameCache();
			}),
			this.container.git.onDidChangeRepositories(() => {
				// New repos may have just become resolvable for sessions that were previously
				// pending; existing repos may have been removed. Refresh either way.
				void this.refreshWorktreeNameCache();
			}),
			...this.registerCommands(),
		);

		this.startProviders();
	}

	dispose(): void {
		this.stopProviders();
		for (const provider of this._providers) {
			provider.dispose();
		}
		for (const d of this._disposables) {
			d.dispose();
		}
		this._onDidChange.dispose();
		this._onDidChangeHooksInstallState.dispose();
		this._onDidChangeSessions.dispose();
	}

	private async invalidateHooksState(): Promise<void> {
		try {
			const env = await import('@env/providers.js');
			env.invalidateAgentsCache();
			// Warm the cache so the next read returns the new state without a delay.
			await env.getClaudeAgent();
		} catch {
			// Browser build: silently skip — webviews will refresh on the next state pull.
		}
		this._onDidChangeHooksInstallState.fire();
	}

	get sessions(): readonly AgentSession[] {
		return this._providers.flatMap(p => p.sessions);
	}

	getSerializedSessions(): AgentSessionState[] {
		return this.sessions.map(s => serializeAgentSession(s, this.getWorktreeMetadataForSession(s)));
	}

	private getWorktreeMetadataForSession(session: AgentSession): AgentSessionWorktreeMetadata | undefined {
		if (session.worktreePath == null) return undefined;
		return this._worktreeNameByPath.get(session.worktreePath);
	}

	private maybeFireSessionsChanged(): void {
		const serialized = this.getSerializedSessions();
		const stringified = JSON.stringify(serialized);
		if (stringified === this._lastSerialized) return;

		this._lastSerialized = stringified;
		this._onDidChangeSessions.fire(serialized);
	}

	/** True iff at least one session has a `worktreePath` we haven't resolved metadata for yet.
	 *  Used to defer the snapshot publish for brand-new paths so the webview never paints the
	 *  cold-fallback name first; resolved paths skip the deferral and publish immediately. */
	private hasUnresolvedWorktreePaths(): boolean {
		for (const s of this.sessions) {
			if (s.worktreePath != null && !this._worktreeNameByPath.has(s.worktreePath)) return true;
		}
		return false;
	}

	/** Order-independent signature of the set of session worktree paths. The worktree-name cache
	 *  depends only on this set — not on session phase/activity — so it gates the noisy trigger. */
	private getSessionWorktreePathsKey(): string {
		const paths: string[] = [];
		for (const s of this.sessions) {
			if (s.worktreePath != null) {
				paths.push(s.worktreePath);
			}
		}
		return paths.sort().join('\0');
	}

	/**
	 * Gated entry point for the `onDidChangeSessions` trigger, which fires on every phase/activity
	 * tick. Skips the refresh entirely when the set of session worktree paths is unchanged —
	 * checkout-driven name changes still arrive via the `onDidChangeRepository` trigger, which
	 * calls `refreshWorktreeNameCache()` directly.
	 */
	private refreshWorktreeNameCacheIfSessionsChanged(): void {
		if (this.getSessionWorktreePathsKey() === this._resolvedWorktreePathsKey) return;

		void this.refreshWorktreeNameCache();
	}

	/**
	 * Resolves the live display name for each session's worktree by calling `getWorktrees()` once
	 * per parent repo (the underlying cache means repeated calls within a stable repo are free).
	 * Updates `_worktreeNameByPath` and fires `onDidChangeSerializedSessions` if anything changed.
	 * Concurrent calls dedupe to a single in-flight refresh.
	 *
	 * Resolves to `true` iff metadata changed and the snapshot was published — callers who need
	 * to publish unconditionally (e.g. the deferred-publish path) can skip a redundant fire when
	 * this returns true.
	 */
	private refreshWorktreeNameCache(): Promise<boolean> {
		if (this._worktreeRefreshPromise != null) return this._worktreeRefreshPromise;

		this._worktreeRefreshPromise = (async () => {
			let changed = false;
			try {
				// Capture the path set this run resolves so the noisy session trigger can skip
				// no-op refreshes; the `finally` re-checks it to catch paths that appeared while
				// this run was in-flight (it snapshots `this.sessions` synchronously below).
				this._resolvedWorktreePathsKey = this.getSessionWorktreePathsKey();

				// Group by `commonPath` (set together with `worktreePath` by `resolveGitInfo`) so
				// every worktree sharing a common path queries `getWorktrees()` once. Falling back
				// to `worktreePath` for the cold-cache window keeps sessions resolvable even
				// before `resolveGitInfo` populates `commonPath` — `git worktree list` works from
				// any worktree dir. Deliberately NOT keyed by `workspacePath`: that's the matched
				// workspace folder (or undefined), not a repo identity.
				const worktreePathsByParent = new Map<string, Set<string>>();
				const referencedWorktreePaths = new Set<string>();
				for (const s of this.sessions) {
					if (s.worktreePath == null) continue;

					const parent = s.commonPath ?? s.worktreePath;

					let set = worktreePathsByParent.get(parent);
					if (set == null) {
						set = new Set<string>();
						worktreePathsByParent.set(parent, set);
					}

					set.add(s.worktreePath);
					referencedWorktreePaths.add(s.worktreePath);
				}

				// Prune entries for worktrees no session lives in anymore.
				for (const key of [...this._worktreeNameByPath.keys()]) {
					if (!referencedWorktreePaths.has(key)) {
						this._worktreeNameByPath.delete(key);
						changed = true;
					}
				}

				const results = await Promise.allSettled(
					Array.from(worktreePathsByParent, async ([parentPath, paths]) => {
						const worktrees = await this.container.git
							.getRepositoryService(parentPath)
							.worktrees?.getWorktrees();
						return { paths: paths, worktrees: worktrees ?? [] };
					}),
				);

				for (const r of results) {
					const value = getSettledValue(r);
					if (value == null) continue;

					for (const wt of value.worktrees) {
						if (!value.paths.has(wt.path)) continue;

						const next: AgentSessionWorktreeMetadata = {
							name: wt.name,
							type: wt.type,
							isDefault: wt.isDefault,
							branch:
								wt.type === 'branch' && wt.branch != null
									? {
											name: wt.branch.name,
											// `upstream.name` is the raw `origin/foo` form; consumers reconstruct
											// the full upstreamRef via `getBranchId(workspacePath, true, name)`.
											upstreamName:
												wt.branch.upstream != null && !wt.branch.upstream.missing
													? wt.branch.upstream.name
													: undefined,
										}
									: undefined,
						};
						const existing = this._worktreeNameByPath.get(wt.path);
						if (!isSameWorktreeMetadata(existing, next)) {
							this._worktreeNameByPath.set(wt.path, next);
							changed = true;
						}
					}
				}

				if (changed) {
					this.maybeFireSessionsChanged();
				}
			} finally {
				this._worktreeRefreshPromise = undefined;
				// A session worktree path may have appeared/changed while this run was in-flight
				// (it snapshotted `this.sessions` at the top, and `_worktreeRefreshPromise`
				// deduped any calls since). Re-run if the set no longer matches what we resolved.
				if (this.getSessionWorktreePathsKey() !== this._resolvedWorktreePathsKey) {
					void this.refreshWorktreeNameCache();
				}
			}
			return changed;
		})();

		return this._worktreeRefreshPromise;
	}

	resolvePermission(
		sessionId: string,
		decision: PermissionDecision,
		updatedPermissions?: PermissionSuggestion[],
	): void {
		for (const provider of this._providers) {
			const session = provider.sessions.find(s => s.id === sessionId);
			if (session == null) continue;

			// `false` means the session is peer-discovered (owned by another GitLens window);
			// our local provider has no `_pendingPermissions` entry to fulfil. Surface a hint so
			// the user knows where to act rather than seeing a silent no-op.
			const resolved = provider.resolvePermission?.(sessionId, decision, updatedPermissions) ?? false;
			if (!resolved) {
				const target = session.workspacePath
					? `the GitLens window for ${session.workspacePath}`
					: 'another GitLens window';
				void window.showInformationMessage(
					`This agent session is owned by ${target}. Resolve the request from there.`,
				);
			}
			return;
		}
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.agents.installClaudeHook', async () => {
				try {
					const { installClaudeHook } = await import('@env/agents/installClaudeHook.js');
					await installClaudeHook();
					await this.invalidateHooksState();
					this.container.telemetry.sendEvent('agents/hookInstalled', { 'agent.provider': 'claudeCode' });
				} catch (ex) {
					Logger.error(ex, 'AgentStatusService.installClaudeHook');
					void window.showErrorMessage(
						`Failed to install Claude Hooks: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
				}
			}),
			registerCommand('gitlens.agents.uninstallClaudeHook', async () => {
				try {
					const { uninstallClaudeHook } = await import('@env/agents/uninstallClaudeHook.js');
					await uninstallClaudeHook();
					await this.invalidateHooksState();
					this.container.telemetry.sendEvent('agents/hookUninstalled', { 'agent.provider': 'claudeCode' });
				} catch (ex) {
					Logger.error(ex, 'AgentStatusService.uninstallClaudeHook');
					void window.showErrorMessage(
						`Failed to uninstall Claude Hooks: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
				}
			}),
			registerCommand('gitlens.agents.openSession', (sessionId?: string) => this.openSession(sessionId)),
			registerCommand('gitlens.agents.openPlanFile', async (planFilePath?: string) => {
				if (!planFilePath) return;

				try {
					await commands.executeCommand('vscode.open', Uri.file(planFilePath));
				} catch (ex) {
					Logger.error(ex, 'AgentStatusService.openPlanFile');
					void window.showErrorMessage(
						`Failed to open plan: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
				}
			}),
			registerCommand(
				'gitlens.agents.resolvePermission',
				(args?: { sessionId: string; decision: PermissionDecision; alwaysAllow?: boolean }) => {
					if (args?.sessionId == null || args.decision == null) return;

					let updatedPermissions: PermissionSuggestion[] | undefined;
					if (args.alwaysAllow) {
						const session = this.sessions.find(s => s.id === args.sessionId);
						const suggestions = session?.pendingPermission?.suggestions;
						if (suggestions != null && suggestions.length > 0) {
							updatedPermissions = [...suggestions];
						}
					}

					this.resolvePermission(args.sessionId, args.decision, updatedPermissions);
				},
			),
		];
	}

	private async openSession(sessionId?: string): Promise<void> {
		const sessions = [...this.sessions];
		if (sessions.length === 0) return;

		let session: AgentSession | undefined;

		if (sessionId != null) {
			session = sessions.find(s => s.id === sessionId);
		} else if (sessions.length === 1) {
			session = sessions[0];
		} else {
			const workspaceSessions = sessions.filter(s => s.isInWorkspace);
			const externalSessions = sessions.filter(s => !s.isInWorkspace);

			interface SessionPickItem extends QuickPickItem {
				session: AgentSession;
			}

			const items: (SessionPickItem | QuickPickItem)[] = [];

			if (workspaceSessions.length > 0) {
				items.push(createQuickPickSeparator('This workspace'));
				for (const s of workspaceSessions) {
					const worktreeName = this.getWorktreeMetadataForSession(s)?.name;
					items.push({
						label: `$(robot) ${getSessionDisplayName(s, worktreeName)}`,
						description: s.status,
						detail: worktreeName ? `worktree: ${worktreeName}` : undefined,
						session: s,
					} satisfies SessionPickItem);
				}
			}

			if (externalSessions.length > 0) {
				items.push(createQuickPickSeparator('Other workspaces'));
				for (const s of externalSessions) {
					items.push({
						label: `$(robot) ${getSessionDisplayName(s, this.getWorktreeMetadataForSession(s)?.name)}`,
						description: s.status,
						detail: s.workspacePath ?? undefined,
						session: s,
					} satisfies SessionPickItem);
				}
			}

			const pick = await window.showQuickPick<SessionPickItem | QuickPickItem>(items, {
				placeHolder: 'Select an agent session',
			});
			if (pick == null || !('session' in pick)) return;

			session = pick.session;
		}

		if (session == null) return;

		await this.dispatchSessionAction(session);
	}

	/**
	 * Deterministically picks the right action for a resolved session — no quickpick:
	 *  - Session belongs to a different workspace → notify a peer GitLens window that has it open
	 *    (so its Claude Code extension opens the session), then `vscode.openFolder` (VS Code auto-
	 *    focuses the peer window when the folder is already open there; otherwise the current
	 *    window switches to the folder).
	 *  - Session is in the current workspace → open in the Claude Code extension when the session
	 *    is extension-hosted; focus the terminal via `pid` when CLI-hosted.
	 *  - No workspace match but we have a `pid` → focus the terminal.
	 *  - Neither workspace nor pid → warn.
	 *
	 *  Host classification reads `~/.claude/sessions/<pid>.json` for the `entrypoint` field
	 *  (`claude-vscode` = extension, anything else = CLI). When the file is missing/unreadable,
	 *  we fall back to "extension if installed, else CLI" so users still get a sensible action.
	 */
	private async dispatchSessionAction(session: AgentSession): Promise<void> {
		if (!session.isInWorkspace && session.workspacePath != null) {
			// Match by id, not object identity — provider session arrays are rebuilt on every
			// update (immutable spread), so a `.includes(session)` check would miss if the
			// provider rebuilt its array between the user's pick and this dispatch.
			const provider = this._providers.find(p => p.sessions.some(s => s.id === session.id));
			if (provider?.notifyPeerOpenSession != null) {
				// Cap the wait so an unhealthy peer (e.g. paused/unresponsive but not RST) can't
				// stall the user click for the full per-fetch timeout. The peer only needs to
				// *start* opening the session before `vscode.openFolder` focuses its window — the
				// outstanding POST keeps running in the background after we move on. `.catch` is
				// attached to the notify promise itself (not to the race) so a late rejection
				// after the timeout wins is still observed instead of escaping as an unhandled
				// rejection.
				const notifyPromise = provider
					.notifyPeerOpenSession(session.workspacePath, session.id)
					.catch((ex: unknown) =>
						Logger.warn(
							`AgentStatusService.dispatchSessionAction: notifyPeerOpenSession failed: ${
								ex instanceof Error ? ex.message : String(ex)
							}`,
						),
					);
				await Promise.race([notifyPromise, new Promise<void>(resolve => setTimeout(resolve, 500))]);
			}
			void commands.executeCommand('vscode.openFolder', Uri.file(session.workspacePath), {
				forceNewWindow: false,
			});
			return;
		}

		if (session.isInWorkspace) {
			const { classifyClaudeSessionHost } = await import('@env/agents/claudeSessionFile.js');
			const host = session.pid != null ? await classifyClaudeSessionHost(session.pid) : undefined;
			const useExtension = host === 'extension' || (host == null && (await isClaudeExtensionAvailable()));

			if (useExtension && (await this.tryOpenInClaudeExtension(session.id))) return;
			// Skip the terminal-focus fallback when we *know* the session is extension-hosted —
			// `pid` would be the extension host (VS Code itself), so focusing it is a no-op that
			// would falsely signal success and swallow the warning the user needs.
			if (host !== 'extension' && session.pid != null && (await this.tryFocusProcessWindow(session.pid))) {
				return;
			}

			void window.showWarningMessage('Unable to open agent session.');
			return;
		}

		if (session.pid != null && (await this.tryFocusProcessWindow(session.pid))) return;

		void window.showWarningMessage('Unable to open agent session.');
	}

	private async tryOpenInClaudeExtension(sessionId: string): Promise<boolean> {
		try {
			await commands.executeCommand('claude-vscode.editor.open', sessionId);
			return true;
		} catch {
			try {
				await commands.executeCommand('claude-vscode.sidebar.open');
				return true;
			} catch {
				return false;
			}
		}
	}

	private async tryFocusProcessWindow(pid: number): Promise<boolean> {
		const { focusProcessWindow } = await import('@env/focusWindow.js');
		return focusProcessWindow(pid);
	}

	private getWorkspacePaths(): string[] {
		return workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
	}

	private startProviders(): void {
		const paths = this.getWorkspacePaths();
		if (paths.length === 0) return;

		for (const provider of this._providers) {
			provider.start(paths);
		}
	}

	private stopProviders(): void {
		for (const provider of this._providers) {
			provider.stop();
		}
	}

	private onWorkspaceFoldersChanged(): void {
		// Do NOT early-return on an empty list — providers need to reclassify
		// existing sessions' `isInWorkspace` when the last folder is removed.
		const paths = this.getWorkspacePaths();

		for (const provider of this._providers) {
			if (provider.updateWorkspacePaths != null) {
				provider.updateWorkspacePaths(paths);
			} else if (paths.length > 0) {
				provider.start(paths);
			}
		}
	}
}

/** Field-by-field equality for the worktree metadata cache. Keeps the refresh's `changed` flag
 *  precise (and `maybeFireSerializedChange`'s JSON-diff downstream rare) without paying for
 *  per-worktree `JSON.stringify` round-trips on the host hot path. */
function isSameWorktreeMetadata(a: AgentSessionWorktreeMetadata | undefined, b: AgentSessionWorktreeMetadata): boolean {
	if (a == null) return false;
	if (a.name !== b.name || a.type !== b.type || a.isDefault !== b.isDefault) return false;
	if (a.branch == null) return b.branch == null;
	if (b.branch == null) return false;
	return a.branch.name === b.branch.name && a.branch.upstreamName === b.branch.upstreamName;
}
