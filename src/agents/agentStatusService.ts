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
import { isClaudeExtensionAvailable, tryOpenClaudeSession } from './utils/-webview/claudeExtension.js';
import { canResumeSession, resumeClaudeSessionInTerminal } from './utils/-webview/claudeResume.js';

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
		// Resolve hooks-installed state once (async, off the providers' poll interval) and push it
		// down so providers can gate their reconciliation poll from the start.
		void this.pushHooksInstalledToProviders();
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
		// Drop the stale agent cache, re-read, and push the fresh state to providers (the re-read
		// also warms the cache so the next webview read returns the new state without a delay).
		await this.pushHooksInstalledToProviders({ invalidate: true });
		this._onDidChangeHooksInstallState.fire();
	}

	/** Resolves the host's Claude hooks-installed state and pushes it to all providers so they can
	 *  gate their reconciliation poll (the CLI `list-sessions` call). Resolves to `false` when the
	 *  agent can't be detected (e.g. the browser stub's `getClaudeAgent()` returns `undefined`); fails
	 *  *open* (`installed = true`) only if env resolution throws unexpectedly, so a transient failure
	 *  never wrongly suppresses polling. The browser has no providers to receive the push regardless.
	 *  Pass `invalidate` after an install/uninstall so the stale agent cache is dropped before re-reading.
	 *
	 *  Note: an external `gk ai hook install` (run outside GitLens) isn't observed here until
	 *  something else re-reads — acceptable per the staleness window documented in
	 *  `src/env/node/gk/cli/agents.ts`, and the poll gate opens anyway the moment any session
	 *  appears (a non-empty session list always polls). */
	private async pushHooksInstalledToProviders(options?: { invalidate?: boolean }): Promise<void> {
		let installed = true;
		try {
			const env = await import('@env/providers.js');
			if (options?.invalidate) {
				env.invalidateAgentsCache();
			}
			const claude = await env.getClaudeAgent();
			installed = claude?.hooksInstalled ?? false;
		} catch {
			// Unexpected env-resolution/detection failure — leave fail-open (assume installed) so a
			// transient error doesn't wrongly suppress polling. (The browser stub doesn't throw; it
			// returns undefined above, yielding installed=false, and has no providers anyway.)
		}
		for (const provider of this._providers) {
			provider.setClaudeHooksInstalled?.(installed);
		}
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
					const { installClaudeHook } = await import(
						/* webpackChunkName: "agents" */ '@env/agents/installClaudeHook.js'
					);
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
					const { uninstallClaudeHook } = await import(
						/* webpackChunkName: "agents" */ '@env/agents/uninstallClaudeHook.js'
					);
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
			registerCommand('gitlens.agents.switchDefaultAgent', async () => {
				const { pickAndSetDefaultAgent } = await import(
					/* webpackChunkName: "agents" */ '../plus/agents/agentPicker.js'
				);
				await pickAndSetDefaultAgent();
			}),
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
	 *  - Extension-hosted, owned by another VS Code window → notify the owning peer (if it has
	 *    GitLens running with the workspace) to open the session in its Claude Code extension,
	 *    then `vscode.openFolder` (different workspace) or an info message (same/no workspace,
	 *    where OS-level cross-window focus is unreliable on multi-window VS Code instances).
	 *  - Extension-hosted, owned by this window → open in our Claude Code extension.
	 *  - CLI-hosted → focus the terminal via `pid`.
	 *  - Neither workspace nor pid → warn.
	 *
	 *  Host classification reads `~/.claude/sessions/<pid>.json` for the `entrypoint` field; the
	 *  ownership check walks up to two parent-pid levels — for extension sessions the Claude
	 *  binary's direct parent is the owning extension host process, so `parent === process.pid`
	 *  ⇔ ours, with one extra hop reserved as a safety margin for a hypothetical Claude shim
	 *  between the binary and the extension host.
	 */
	private async dispatchSessionAction(session: AgentSession): Promise<void> {
		// Match by id, not object identity — provider session arrays are rebuilt on every update
		// (immutable spread), so a `.includes(session)` check would miss if the provider rebuilt
		// its array between the user's pick and this dispatch.
		const provider = this._providers.find(p => p.sessions.some(s => s.id === session.id));

		const { classifyClaudeSessionHost } = await import(
			/* webpackChunkName: "agents" */ '@env/agents/claudeSessionFile.js'
		);
		const host = session.pid != null ? await classifyClaudeSessionHost(session.pid) : undefined;

		// For extension-hosted sessions, determine whether this VS Code window owns the live
		// session (its Claude Code extension launched the Claude binary). The Claude binary's
		// direct parent IS the owning extension host process, so `parent === process.pid` ⇔ ours.
		// Authoritative even when the session arrived via `syncSessions` (which reads global
		// Claude session files without knowing which window owns each).
		const isExtensionLocal =
			host === 'extension' && session.pid != null
				? await this.isExtensionSessionLocallyHosted(session.pid)
				: true;

		// Peer-owned extension session, OR a peer-sync-discovered session. Either way the live
		// panel lives in another VS Code window; opening locally would just create an inert view.
		if ((host === 'extension' && !isExtensionLocal) || session.isPeerOwned) {
			await this.dispatchPeerOwnedSession(provider, session);
			return;
		}

		if (session.isInWorkspace) {
			// Always probe — when host is 'extension' we still need the real value to decide
			// between the actionable "Claude Code extension is not installed" warning below and
			// the generic "unable to open" fallback. Forcing `true` here would make the
			// extension-specific warning unreachable.
			const extensionAvailable = await isClaudeExtensionAvailable();
			const useExtension = host === 'extension' || (host == null && extensionAvailable);

			if (useExtension && (await tryOpenClaudeSession(session.id))) return;
			// Skip the terminal-focus fallback when we *know* the session is extension-hosted —
			// `pid` would be the extension host (VS Code itself), so focusing it is a no-op that
			// would falsely signal success and swallow the warning the user needs.
			if (host !== 'extension' && session.pid != null && (await this.tryFocusProcessWindow(session.pid))) {
				return;
			}

			Logger.warn(
				`AgentStatusService.dispatchSessionAction: in-workspace open failed for session ${session.id} (host=${host ?? 'unknown'}, pid=${session.pid ?? 'none'}, extensionAvailable=${extensionAvailable})`,
			);
			await this.offerResumeOrWarn(
				session,
				host === 'extension' && !extensionAvailable
					? 'The Claude Code extension is not installed or not available.'
					: 'Unable to open agent session.',
			);
			return;
		}

		// CLI-hosted out-of-workspace session — focus the terminal.
		if (session.pid != null && (await this.tryFocusProcessWindow(session.pid))) return;

		Logger.warn(
			`AgentStatusService.dispatchSessionAction: no actionable target for session ${session.id} (isInWorkspace=${session.isInWorkspace}, workspacePath=${session.workspacePath ?? 'none'}, pid=${session.pid ?? 'none'})`,
		);
		await this.offerResumeOrWarn(session, 'Unable to open agent session.');
	}

	/** Shared dead-end handler for every open path that can't reach the live session. When the
	 *  session is resumable (idle, or waiting on user input — see {@link canResumeSession}),
	 *  prompts the user to spawn a fresh terminal running `claude --resume <id>`; otherwise just
	 *  surfaces the original warning. Keeps the prompt single-action so a dismiss is the obvious
	 *  "no" — the warning text itself communicates the failure that triggered the fallback. */
	private async offerResumeOrWarn(session: AgentSession, warning: string): Promise<void> {
		if (!canResumeSession(session)) {
			void window.showWarningMessage(warning);
			return;
		}

		const action = 'Resume in Terminal';
		const choice = await window.showWarningMessage(`${warning} Resume it in a terminal?`, action);
		if (choice === action) {
			await resumeClaudeSessionInTerminal(session);
		}
	}

	/** Routes a session that's owned by another VS Code window. Notifies the owning peer (if it
	 *  has GitLens running with the workspace) so its Claude Code extension surfaces the session,
	 *  then either `vscode.openFolder` (different workspace — focuses the peer window via the
	 *  folder-already-open path) or an info message (same workspace or unknown workspace, where
	 *  OS-level cross-window focus across a multi-window VS Code app is unreliable). */
	private async dispatchPeerOwnedSession(
		provider: AgentSessionProvider | undefined,
		session: AgentSession,
	): Promise<void> {
		// Target folder to focus. Each step picks a more general fallback so out-of-workspace
		// sessions (cwd doesn't match any of OUR workspace folders) still resolve to a path some
		// peer window likely has open as its workspace root:
		//  - workspacePath: our matched folder (only set when isInWorkspace=true; unused here)
		//  - worktreePath:  the session's worktree root — correct for named worktrees where the
		//                   peer has the worktree dir open, not the common repo dir
		//  - commonPath:    the parent repo's common dir — correct for default-worktree sessions
		//  - cwd:           last-resort raw cwd. May be a subdir of the peer's workspace, in which
		//                   case `vscode.openFolder` would open the subdir as its own workspace
		//                   instead of focusing the peer. In practice Claude sessions run at the
		//                   workspace root so cwd usually equals what the peer holds; the residual
		//                   risk is documented rather than fixed (full fix would have
		//                   `notifyPeerOpenSession` return the matched workspacePath so this
		//                   function could pass that exact path to `openFolder` instead).
		const targetPath = session.workspacePath ?? session.worktreePath ?? session.commonPath ?? session.cwd;

		if (provider?.notifyPeerOpenSession != null && targetPath != null) {
			// Cap the wait so an unhealthy peer can't stall the user click for the full per-fetch
			// timeout. The peer only needs to *start* opening the session before the focus switch
			// lands. `.catch` is on the notify promise itself (not the race) so a late rejection
			// after the timeout wins is still observed. We don't use the return value: VS Code's
			// `openFolder` finds and focuses the owning window whether or not it has GitLens, so
			// peer match status isn't the right signal for `forceNewWindow`.
			const notifyPromise = provider.notifyPeerOpenSession(targetPath, session.id).catch((ex: unknown) => {
				Logger.warn(
					`AgentStatusService.dispatchPeerOwnedSession: notifyPeerOpenSession failed: ${
						ex instanceof Error ? ex.message : String(ex)
					}`,
				);
				return false;
			});
			await Promise.race([notifyPromise, new Promise<void>(resolve => setTimeout(resolve, 500))]);
		}

		// Different workspace → `vscode.openFolder` with `forceNewWindow: false` asks VS Code to
		// focus the existing window holding `targetPath` (this works across windows even if the
		// peer doesn't have GitLens). Peer-owned implies *some* live window holds the folder (the
		// session is running there), so VS Code's window-folder matching reliably hits it instead
		// of replacing the current window.
		if (!session.isInWorkspace && targetPath != null) {
			void commands.executeCommand('vscode.openFolder', Uri.file(targetPath), {
				forceNewWindow: false,
			});
			return;
		}

		// Same workspace (already open here, can't disambiguate) or no target at all. Surface a
		// clear hint with the cwd so the user can switch manually.
		Logger.warn(
			`AgentStatusService.dispatchPeerOwnedSession: routed via info hint (pid=${session.pid ?? 'none'}, workspacePath=${session.workspacePath ?? 'none'}, cwd=${session.cwd ?? 'none'})`,
		);
		const cwdHint = session.cwd ? ` (${session.cwd})` : '';
		await this.offerResumeOrWarn(
			session,
			`This session is running in another VS Code window${cwdHint}. Switch to it to view.`,
		);
	}

	/** Returns `true` iff the given `pid` (a Claude binary process for an extension-hosted session)
	 *  is a descendant of this VS Code window's extension host. For peer-owned sessions the parent
	 *  is a *different* extension host (another window's), so this resolves to `false` — that's the
	 *  dispatcher's signal to route through the peer-notify path instead of opening locally. */
	private async isExtensionSessionLocallyHosted(pid: number): Promise<boolean> {
		const { isDescendantOfThisExtensionHost } = await import(
			/* webpackChunkName: "agents" */ '@env/focusWindow.js'
		);
		return isDescendantOfThisExtensionHost(pid);
	}

	private async tryFocusProcessWindow(pid: number): Promise<boolean> {
		const { focusProcessWindow } = await import(/* webpackChunkName: "agents" */ '@env/focusWindow.js');
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
