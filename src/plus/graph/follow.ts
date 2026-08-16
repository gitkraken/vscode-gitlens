import type { ConfigurationChangeEvent, Terminal } from 'vscode';
import { Disposable, Uri, window } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { arePathsEqual } from '@gitlens/utils/path.js';
import { pickMostRecentSession } from '../../agents/agentStatusService.js';
import type { AgentSession } from '../../agents/provider.js';
import { isActiveClaudeTab } from '../../agents/utils/-webview/claudeExtension.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { registerCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { GraphWebviewShowingArgs } from '../../webviews/plus/graph/registration.js';
import type { WebviewPanelsProxy } from '../../webviews/webviewsController.js';
import { openWorktreeInNewWindow, showWorktreeInGraph } from './worktreeActions.js';

/** The single showing-args union member used to deliver a passive/manual `show-wip` reveal. */
type GraphShowWipArgs = NonNullable<GraphWebviewShowingArgs[0]>;

/** Follows the active terminal (and, when it's the active tab, a Claude Code conversation) and
 *  reveals the corresponding worktree's WIP row on any currently visible Commit Graph — a view
 *  and/or one or more editor-tab instances. Passive deliveries never raise/open a graph surface;
 *  only the manual `showTerminalWorktree` command does that. Deliveries that resolve to the
 *  graph's own WIP row are consumed only while a WIP row is selected (see
 *  DidRequestGraphActionParams.onlyIfWipSelected). A Claude session running inside the
 *  terminal (matched by process ancestry) takes precedence over the terminal's cwd — agents
 *  frequently work in a worktree the shell never cd'd into. */
export class GraphFollowController implements Disposable {
	private readonly _disposable: Disposable;
	private _followDisposable: Disposable | undefined;
	/** Guards the async hop in {@link onTerminalChanged} against a stale resolution winning a race
	 *  against a newer terminal/shell-integration event. */
	private _generation = 0;

	constructor(
		private readonly container: Container,
		private readonly panels: WebviewPanelsProxy<'gitlens.graph', GraphWebviewShowingArgs>,
	) {
		this._disposable = Disposable.from(
			registerCommand('gitlens.graph.followTerminalOn', () =>
				configuration.updateEffective('graph.followTerminal.enabled', true),
			),
			registerCommand('gitlens.graph.followTerminalOff', () =>
				configuration.updateEffective('graph.followTerminal.enabled', false),
			),
			registerCommand('gitlens.graph.showTerminalWorktree', (terminal?: unknown) =>
				this.onShowTerminalWorktree(terminal),
			),
			registerCommand('gitlens.graph.focusTerminalWorktree', (terminal?: unknown) =>
				this.onFocusTerminalWorktree(terminal),
			),
			registerCommand('gitlens.openTerminalWorktreeInNewWindow', (terminal?: unknown) =>
				this.onOpenTerminalWorktreeInNewWindow(terminal),
			),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);

		this.onConfigurationChanged();
	}

	dispose(): void {
		this._followDisposable?.dispose();
		this._disposable.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (e != null && !configuration.changed(e, 'graph.followTerminal.enabled')) return;

		if (configuration.get('graph.followTerminal.enabled')) {
			this.subscribe();
		} else {
			this.unsubscribe();
		}
	}

	private subscribe() {
		if (this._followDisposable != null) return;

		const debouncedTerminalChanged = debounce(
			(terminal: Terminal | undefined) => void this.onTerminalChanged(terminal),
			250,
		);
		const debouncedTabChanged = debounce(() => this.onTabChanged(), 250);

		this._followDisposable = Disposable.from(
			window.onDidChangeActiveTerminal(terminal => debouncedTerminalChanged(terminal)),
			window.onDidChangeTerminalShellIntegration(e => {
				if (e.terminal !== window.activeTerminal) return;

				debouncedTerminalChanged(e.terminal);
			}),
			window.tabGroups.onDidChangeTabs(() => debouncedTabChanged()),
			{
				dispose: () => {
					debouncedTerminalChanged.cancel();
					debouncedTabChanged.cancel();
				},
			},
		);

		if (window.activeTerminal != null) {
			void this.onTerminalChanged(window.activeTerminal);
		}
	}

	private unsubscribe() {
		// Invalidate any terminal resolution still in its async hop — without this, toggling the
		// feature off mid-resolution would still deliver (and move the selection) after the fact.
		this._generation++;
		this._followDisposable?.dispose();
		this._followDisposable = undefined;
	}

	/** Whether any graph surface could receive a passive delivery. Checked BEFORE the repo/session
	 *  resolution work: the listeners are window-wide and the config defaults on, so without this
	 *  every terminal switch would run git repo resolution even for users with the graph closed. */
	private get hasVisibleGraphSurface(): boolean {
		if (this.container.views.graph.visible) return true;

		for (const instance of this.panels.instances) {
			if (instance.visible) return true;
		}

		return false;
	}

	/** Terminal flow: a session running inside the terminal (matched by process ancestry) is
	 *  authoritative for the worktree; only when none matches do we fall back to resolving the
	 *  terminal's cwd to a repository/worktree and enriching with a cwd-matched session. */
	private async onTerminalChanged(terminal: Terminal | undefined): Promise<void> {
		if (terminal == null || !this.hasVisibleGraphSurface) return;

		const gen = ++this._generation;

		const session = await this.findSessionForTerminal(terminal);
		if (gen !== this._generation) return;

		if (session?.worktreePath != null) {
			this.deliver(session.worktreePath, session.id, { source: 'terminal' });
			return;
		}

		const cwd = getTerminalCwd(terminal);
		if (cwd == null) return;

		const repo = await this.container.git.getOrAddRepository(cwd, { opened: false, detectNested: true });
		if (gen !== this._generation || repo == null) return;

		const sessions = this.container.agentStatus?.sessions ?? [];
		const winner = pickMostRecentSession(
			sessions.filter(s => s.worktreePath != null && arePathsEqual(s.worktreePath, repo.path)),
		);

		this.deliver(repo.path, winner?.id, { source: 'terminal' });
	}

	/** Ancestor-pid chains cached per live session pid. A process's ancestry is fixed at fork, so a
	 *  chain is computed ONCE per session (one process-table fetch — on Windows a PowerShell spawn)
	 *  and every later terminal switch is an in-memory lookup. Entries whose pid no longer backs a
	 *  live session are pruned on use, so a reused pid can never match a dead session's chain. */
	private readonly _sessionAncestorChains = new Map<number, number[]>();

	/** Finds a live agent session running INSIDE `terminal` by process ancestry: the session's pid
	 *  (the Claude binary) descends from the terminal's shell pid. A match is authoritative for the
	 *  worktree — agents frequently work in a different worktree than the shell's cwd. Best-effort:
	 *  returns undefined on web (no process table), when the terminal has no pid, or when nothing
	 *  matches (e.g. the process tree is severed by tmux). */
	private async findSessionForTerminal(terminal: Terminal): Promise<AgentSession | undefined> {
		const candidates = (this.container.agentStatus?.sessions ?? []).filter(
			(s): s is AgentSession & { pid: number; worktreePath: string } =>
				!s.isSubagent && s.status !== 'completed' && s.pid != null && s.worktreePath != null,
		);
		if (candidates.length === 0) {
			this._sessionAncestorChains.clear();
			return undefined;
		}

		const shellPid = await terminal.processId;
		if (shellPid == null) return undefined;

		for (const pid of [...this._sessionAncestorChains.keys()]) {
			if (!candidates.some(s => s.pid === pid)) {
				this._sessionAncestorChains.delete(pid);
			}
		}

		const unresolved = candidates.filter(s => !this._sessionAncestorChains.has(s.pid));
		if (unresolved.length > 0) {
			const { getProcessParentPidMap } = await import(/* webpackChunkName: "agents" */ '@env/focusWindow.js');
			const parentPidMap = await getProcessParentPidMap();
			if (parentPidMap != null) {
				for (const candidate of unresolved) {
					const chain = walkAncestorChain(candidate.pid, parentPidMap);
					// An empty chain (pid missing from the snapshot, e.g. a just-started session)
					// isn't cached, so it retries on the next lookup.
					if (chain.length > 0) {
						this._sessionAncestorChains.set(candidate.pid, chain);
					}
				}
			}
		}

		const matches = candidates.filter(
			s => s.pid === shellPid || this._sessionAncestorChains.get(s.pid)?.includes(shellPid),
		);
		if (matches.length === 0) return undefined;

		return matches.length === 1 ? matches[0] : pickMostRecentSession(matches);
	}

	/** Tab flow: only acts when the active tab is a Claude Code conversation, resolved to its
	 *  backing agent session without ever guessing (no `fallbackToMostRecent`). */
	private onTabChanged(): void {
		if (!this.hasVisibleGraphSurface || !isActiveClaudeTab()) return;

		const session = this.container.agentStatus?.resolveSessionForActiveClaudeTab();
		if (session?.worktreePath == null) return;

		// A tab delivery supersedes any terminal resolution still in its async hop — without this a
		// stale terminal switch could land after the tab's delivery and yank the selection back.
		this._generation++;
		this.deliver(session.worktreePath, session.id, { source: 'agents' });
	}

	/** Passive delivery: only ever selects/reveals on surfaces already visible — never opens one. */
	private deliver(worktreePath: string, agentSessionId: string | undefined, source: Source): void {
		const args: GraphShowWipArgs = {
			action: 'show-wip',
			target: { sha: uncommitted, worktreePath: worktreePath },
			agentSessionId: agentSessionId,
			revealOnly: true,
			followed: true,
			source: source,
		};

		if (this.container.views.graph.visible) {
			void this.container.views.graph.show({ preserveFocus: true, preserveVisibility: true }, args);
		}

		for (const instance of this.panels.instances) {
			if (!instance.visible) continue;

			void instance.show({ preserveFocus: true, preserveVisibility: true }, args);
		}
	}

	/** Manual, graph-raising reveal backing `gitlens.graph.showTerminalWorktree`. */
	private async onShowTerminalWorktree(terminal?: unknown): Promise<void> {
		const resolved = await this.resolveTerminalWorktreePath(terminal);
		if (resolved == null) return;

		void showWorktreeInGraph(this.container, resolved.worktreePath, {
			source: 'terminal',
			agentSessionId: resolved.agentSessionId,
		});
	}

	/** Manual, graph-raising Focus: opens the graph at the terminal's worktree AND scopes it to that
	 *  worktree's branch. A detached worktree (no branch) just reveals without scoping; `revealOnly`
	 *  keeps the details panel closed, matching the in-graph Focus commands. */
	private async onFocusTerminalWorktree(terminal?: unknown): Promise<void> {
		const resolved = await this.resolveTerminalWorktreePath(terminal);
		if (resolved == null) return;

		void showWorktreeInGraph(this.container, resolved.worktreePath, {
			source: 'terminal',
			agentSessionId: resolved.agentSessionId,
			focus: true,
		});
	}

	private async onOpenTerminalWorktreeInNewWindow(terminal?: unknown): Promise<void> {
		const resolved = await this.resolveTerminalWorktreePath(terminal);
		if (resolved == null) return;

		openWorktreeInNewWindow(resolved.worktreePath);
	}

	/** Resolves the terminal-menu command arg to its worktree root, showing an informational message
	 *  when none is found. The arg is the clicked `Terminal` from `terminal/title/context`, or the
	 *  clicked tab's `vscode-terminal:` resource from the terminal-editor surfaces — matched back to
	 *  a terminal by title so the actions target the clicked editor, not just the focused terminal —
	 *  falling back to the active terminal. A session running inside the target terminal (matched by
	 *  process ancestry) is tried first and wins over the terminal's cwd; only when none matches do
	 *  we fall back to resolving the cwd to a repository/worktree. */
	private async resolveTerminalWorktreePath(
		terminal?: unknown,
	): Promise<{ worktreePath: string; agentSessionId?: string } | undefined> {
		const target = isTerminal(terminal) ? terminal : (findTerminalForResource(terminal) ?? window.activeTerminal);

		if (target != null) {
			const session = await this.findSessionForTerminal(target);
			if (session?.worktreePath != null) {
				return { worktreePath: session.worktreePath, agentSessionId: session.id };
			}
		}

		const cwd = target != null ? getTerminalCwd(target) : undefined;
		const repo =
			cwd != null
				? await this.container.git.getOrAddRepository(cwd, { opened: false, detectNested: true })
				: undefined;
		if (repo == null) {
			void window.showInformationMessage('No repository was found for this terminal.');
			return undefined;
		}

		return { worktreePath: repo.path };
	}
}

/** Best-effort mapping of a terminal EDITOR surface's command arg — the clicked tab's
 *  `vscode-terminal:` resource — back to its `Terminal`. The extension API exposes no terminal
 *  instance ids (`TabInputTerminal` is an empty marker); the workbench freezes the terminal's
 *  title into the URI fragment AT CONSTRUCTION, so a UNIQUE match identifies the clicked terminal
 *  only when it was created with an explicit name that hasn't changed (agent-dispatch and named
 *  worktree shells — the common case here). Plain shells (empty ctor title), renames, and
 *  duplicate names return undefined and the caller falls back to the active terminal. */
function findTerminalForResource(value: unknown): Terminal | undefined {
	if (!(value instanceof Uri) || value.scheme !== 'vscode-terminal' || !value.fragment) return undefined;

	const matches = window.terminals.filter(t => t.name === value.fragment);
	return matches.length === 1 ? matches[0] : undefined;
}

/** Duck-types the terminal-menu command arg — `Terminal` is an interface, so `instanceof` isn't
 *  available; VS Code passes the real `Terminal` instance for `terminal/context`/`terminal/title/context`. */
function isTerminal(value: unknown): value is Terminal {
	return value != null && typeof value === 'object' && 'creationOptions' in value && 'processId' in value;
}

/** Walks `pid`'s parent chain through a process-table snapshot, returning its ancestor pids
 *  nearest-first (bounded, cycle-guarded). Empty when `pid` has no parent in the snapshot. */
function walkAncestorChain(pid: number, parentPidMap: Map<number, number>): number[] {
	const maxHops = 8;
	const chain: number[] = [];
	const visited = new Set<number>([pid]);

	let current = parentPidMap.get(pid);
	while (current != null && chain.length < maxHops && !visited.has(current)) {
		chain.push(current);
		visited.add(current);
		current = parentPidMap.get(current);
	}

	return chain;
}

/** Shell integration's reported cwd wins (covers in-terminal `cd`); falls back to the terminal's
 *  creation cwd, which may arrive as a plain string. */
function getTerminalCwd(terminal: Terminal): Uri | undefined {
	const shellCwd = terminal.shellIntegration?.cwd;
	if (shellCwd != null) return shellCwd;

	const options = terminal.creationOptions;
	const optionsCwd = 'cwd' in options ? options.cwd : undefined;
	if (optionsCwd == null) return undefined;

	return typeof optionsCwd === 'string' ? Uri.file(optionsCwd) : optionsCwd;
}
