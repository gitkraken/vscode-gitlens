import type { Disposable, QuickPickItem } from 'vscode';
import { commands, EventEmitter, Uri, window, workspace } from 'vscode';
import type { Container } from '../container.js';
import { createQuickPickSeparator } from '../quickpicks/items/common.js';
import { registerCommand } from '../system/-webview/command.js';
import type { AgentSession, AgentSessionProvider, PermissionDecision, PermissionSuggestion } from './provider.js';

export class AgentStatusService implements Disposable {
	private readonly _onDidChange = new EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _disposables: Disposable[] = [];
	private readonly _providers: AgentSessionProvider[];

	constructor(
		private readonly container: Container,
		providers: AgentSessionProvider[],
	) {
		this._providers = providers;

		for (const provider of this._providers) {
			this._disposables.push(provider.onDidChangeSessions(() => this._onDidChange.fire()));
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
	}

	get sessions(): readonly AgentSession[] {
		return this._providers.flatMap(p => p.sessions);
	}

	resolvePermission(
		sessionId: string,
		decision: PermissionDecision,
		updatedPermissions?: PermissionSuggestion[],
	): void {
		for (const provider of this._providers) {
			const session = provider.sessions.find(s => s.id === sessionId);
			if (session != null) {
				// Sessions outside this workspace are owned by another GitLens instance; let it resolve them.
				if (!session.isInWorkspace) return;
				provider.resolvePermission?.(sessionId, decision, updatedPermissions);
				return;
			}
		}
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.agents.installClaudeHook', async () => {
				try {
					const { installClaudeHook } = await import('@env/agents/installClaudeHook.js');
					await installClaudeHook();
					this.container.telemetry.sendEvent('agents/hookInstalled', { 'agent.provider': 'claudeCode' });
				} catch (ex) {
					void window.showErrorMessage(
						`Failed to install Claude hook: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
				}
			}),
			registerCommand('gitlens.agents.uninstallClaudeHook', async () => {
				try {
					const { uninstallClaudeHook } = await import('@env/agents/uninstallClaudeHook.js');
					await uninstallClaudeHook();
					this.container.telemetry.sendEvent('agents/hookUninstalled', { 'agent.provider': 'claudeCode' });
				} catch (ex) {
					void window.showErrorMessage(
						`Failed to uninstall Claude hook: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
				}
			}),
			registerCommand('gitlens.agents.openSession', (sessionId?: string) => this.openSession(sessionId)),
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
					items.push({
						label: `$(hubot) ${s.name}`,
						description: s.status,
						detail: s.branch ? `on ${s.branch}` : undefined,
						session: s,
					} satisfies SessionPickItem);
				}
			}

			if (externalSessions.length > 0) {
				items.push(createQuickPickSeparator('Other workspaces'));
				for (const s of externalSessions) {
					items.push({
						label: `$(hubot) ${s.name}`,
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

		interface ActionPickItem extends QuickPickItem {
			action: string;
		}

		const actions: ActionPickItem[] = [];

		if (session.pid != null) {
			actions.push({
				label: '$(window) Focus Agent Window',
				description: 'Bring the terminal running the agent to the foreground',
				action: 'focus',
			});
		}

		if (session.isInWorkspace) {
			actions.push({
				label: '$(edit) Open in Claude Code Extension',
				description: 'Open session in the Claude Code VS Code extension',
				action: 'open-extension',
			});
		}

		if (!session.isInWorkspace && session.workspacePath != null) {
			actions.push({
				label: '$(folder-opened) Switch to Workspace',
				description: session.workspacePath,
				action: 'switch-workspace',
			});
		}

		if (actions.length === 0) return;

		let action: string;
		if (actions.length === 1) {
			action = actions[0].action;
		} else {
			const actionPick = await window.showQuickPick(actions, {
				placeHolder: `Action for ${session.name}`,
			});
			if (actionPick == null) return;
			action = actionPick.action;
		}

		switch (action) {
			case 'focus':
				if (session.pid != null) {
					const { focusProcessWindow } = await import('@env/focusWindow.js');
					await focusProcessWindow(session.pid);
				}
				break;
			case 'open-extension':
				try {
					await commands.executeCommand('claude-vscode.editor.open', session.id);
				} catch {
					try {
						await commands.executeCommand('claude-vscode.sidebar.open');
					} catch {
						void window.showWarningMessage(
							'Unable to open session. Is the Claude Code extension installed?',
						);
					}
				}
				break;
			case 'switch-workspace':
				if (session.workspacePath != null) {
					void commands.executeCommand('vscode.openFolder', Uri.file(session.workspacePath), {
						forceNewWindow: false,
					});
				}
				break;
		}
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
