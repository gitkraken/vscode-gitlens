import type { ConfigurationChangeEvent, Terminal } from 'vscode';
import { Disposable, Uri, window } from 'vscode';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { arePathsEqual } from '@gitlens/utils/path.js';
import { pickMostRecentSession } from '../../agents/agentStatusService.js';
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
 *  only the manual `showTerminalWorktree` command does that. */
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

	/** Terminal flow: resolves the active terminal's cwd to a repository/worktree and, if a local
	 *  agent session is running there, enriches the delivery with that session's id. */
	private async onTerminalChanged(terminal: Terminal | undefined): Promise<void> {
		if (terminal == null || !this.hasVisibleGraphSurface) return;

		const cwd = getTerminalCwd(terminal);
		if (cwd == null) return;

		const gen = ++this._generation;
		const repo = await this.container.git.getOrAddRepository(cwd, { opened: false, detectNested: true });
		if (gen !== this._generation || repo == null) return;

		const sessions = this.container.agentStatus?.sessions ?? [];
		const winner = pickMostRecentSession(
			sessions.filter(s => s.worktreePath != null && arePathsEqual(s.worktreePath, repo.path)),
		);

		this.deliver(repo.path, winner?.id, { source: 'terminal' });
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
		const worktreePath = await this.resolveTerminalWorktreePath(terminal);
		if (worktreePath == null) return;

		void showWorktreeInGraph(this.container, worktreePath, { source: 'terminal' });
	}

	/** Manual, graph-raising Focus: opens the graph at the terminal's worktree AND scopes it to that
	 *  worktree's branch. A detached worktree (no branch) just reveals without scoping; `revealOnly`
	 *  keeps the details panel closed, matching the in-graph Focus commands. */
	private async onFocusTerminalWorktree(terminal?: unknown): Promise<void> {
		const worktreePath = await this.resolveTerminalWorktreePath(terminal);
		if (worktreePath == null) return;

		void showWorktreeInGraph(this.container, worktreePath, { source: 'terminal', focus: true });
	}

	private async onOpenTerminalWorktreeInNewWindow(terminal?: unknown): Promise<void> {
		const worktreePath = await this.resolveTerminalWorktreePath(terminal);
		if (worktreePath == null) return;

		openWorktreeInNewWindow(worktreePath);
	}

	/** Resolves the terminal-menu command arg to its worktree root, showing an informational message
	 *  when none is found. The arg is the clicked `Terminal` from `terminal/title/context`, or the
	 *  clicked tab's `vscode-terminal:` resource from the terminal-editor surfaces — matched back to
	 *  a terminal by title so the actions target the clicked editor, not just the focused terminal —
	 *  falling back to the active terminal. */
	private async resolveTerminalWorktreePath(terminal?: unknown): Promise<string | undefined> {
		const target = isTerminal(terminal) ? terminal : (findTerminalForResource(terminal) ?? window.activeTerminal);
		const cwd = target != null ? getTerminalCwd(target) : undefined;
		const repo =
			cwd != null
				? await this.container.git.getOrAddRepository(cwd, { opened: false, detectNested: true })
				: undefined;
		if (repo == null) {
			void window.showInformationMessage('No repository was found for this terminal.');
			return undefined;
		}

		return repo.path;
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
