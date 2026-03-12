import type { QuickPickItem, StatusBarItem } from 'vscode';
import { commands, Disposable, MarkdownString, StatusBarAlignment, ThemeColor, Uri, window } from 'vscode';
import type { Container } from '../container.js';
import { registerCommand } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { once } from '../system/event.js';
import type { AgentStatusService } from './agentStatusService.js';
import type { AgentSession, AgentSessionStatus, PendingPermission, PermissionSuggestion } from './provider.js';

const statusDisplay: Record<AgentSessionStatus, { statusBarIcon: string; tooltipIcon: string; label: string }> = {
	thinking: { statusBarIcon: '$(loading~spin)', tooltipIcon: '$(loading~spin)', label: 'thinking' },
	tool_use: { statusBarIcon: '$(terminal)', tooltipIcon: '$(terminal)', label: 'running' },
	responding: { statusBarIcon: '$(comment)', tooltipIcon: '$(comment)', label: 'responding' },
	waiting: { statusBarIcon: '$(hubot)', tooltipIcon: '$(clock)', label: 'waiting for input' },
	idle: { statusBarIcon: '$(hubot)', tooltipIcon: '$(circle-outline)', label: 'idle' },
	compacting: { statusBarIcon: '$(loading~spin)', tooltipIcon: '$(loading~spin)', label: 'compacting context' },
	permission_requested: { statusBarIcon: '$(shield)', tooltipIcon: '$(shield)', label: 'awaiting approval' },
};

export class AgentStatusIndicator implements Disposable {
	private readonly _disposable: Disposable;
	private _statusBarItem: StatusBarItem | undefined;

	constructor(
		container: Container,
		private readonly service: AgentStatusService,
	) {
		this._disposable = Disposable.from(
			service.onDidChange(() => this.update()),
			once(container.onReady)(() => this.onReady()),
			...this.registerCommands(),
		);
	}

	dispose(): void {
		this._statusBarItem?.dispose();
		this._disposable.dispose();
	}

	private onReady(): void {
		this._statusBarItem = window.createStatusBarItem('gitlens.agents', StatusBarAlignment.Left, 10000 - 4);
		this._statusBarItem.name = 'GitLens AI Agents';

		this.update();
	}

	private update(): void {
		if (this._statusBarItem == null) return;

		const sessions = [...this.service.sessions];

		if (sessions.length === 0) {
			this._statusBarItem.hide();
			return;
		}

		// Sort: local first, then remote
		const sorted = sessions.toSorted((a, b) => {
			if (a.isLocal === b.isLocal) return 0;
			return a.isLocal ? -1 : 1;
		});

		const permissionSessions = sorted.filter(s => s.status === 'permission_requested' && s.isLocal);

		if (permissionSessions.length > 0) {
			// Permission requests take priority in the status bar
			if (permissionSessions.length === 1) {
				const session = permissionSessions[0];
				this._statusBarItem.text = `$(shield) ${session.name} awaiting approval`;
				this._statusBarItem.command = {
					title: 'Show Permission Request',
					command: 'gitlens.agents.showPermission',
					arguments: [session.id],
				};
				void this.showPermissionNotification(session.id, session.name, session.pendingPermission);
			} else {
				this._statusBarItem.text = `$(shield) ${permissionSessions.length} agents awaiting approval`;
				this._statusBarItem.command = {
					title: 'Show Permission Requests',
					command: 'gitlens.agents.showPermission',
				};
				// Show notification for the first pending permission
				const first = permissionSessions[0];
				void this.showPermissionNotification(first.id, first.name, first.pendingPermission);
			}
			this._statusBarItem.backgroundColor = new ThemeColor('statusBarItem.warningBackground');
		} else if (sorted.length === 1) {
			const session = sorted[0];
			this._statusBarItem.text = this.getSessionText(session);
			this._statusBarItem.command = {
				title: 'Open AI Agent Session',
				command: 'gitlens.agents.openSession',
				arguments: [session.id],
			};
			this._statusBarItem.backgroundColor = undefined;
		} else {
			const localSessions = sorted.filter(s => s.isLocal);
			if (localSessions.length === 1) {
				// Show the local agent's status with total agent count
				const otherCount = sorted.length - 1;
				this._statusBarItem.text = `${this.getSessionText(localSessions[0])} (+${otherCount} ${otherCount === 1 ? 'agent' : 'agents'})`;
				this._statusBarItem.command = {
					title: 'Open AI Agent Session',
					command: 'gitlens.agents.openSession',
					arguments: [localSessions[0].id],
				};
			} else {
				this._statusBarItem.text = `$(hubot) ${sorted.length} agents`;
				this._statusBarItem.command = {
					title: 'Open AI Agent Session',
					command: 'gitlens.agents.openSession',
				};
			}
			this._statusBarItem.backgroundColor = undefined;
		}

		this._statusBarItem.tooltip = this.getTooltip(sorted);
		this._statusBarItem.show();
	}

	private getSessionText(session: AgentSession): string {
		const subagentCount = session.subagents?.length ?? 0;
		const suffix = subagentCount > 0 ? ` $(organization) ${subagentCount}` : '';
		const display = statusDisplay[session.status];

		if (session.status === 'tool_use') {
			return `${display.statusBarIcon} ${session.name} ${display.label} ${session.statusDetail ?? 'tool'}${suffix}`;
		}
		if (session.status === 'idle') {
			return `${display.statusBarIcon} ${session.name}${suffix}`;
		}
		return `${display.statusBarIcon} ${session.name} ${display.label}${suffix}`;
	}

	private getTooltip(sessions: AgentSession[]): MarkdownString {
		const md = new MarkdownString('', true);
		md.supportHtml = true;
		md.isTrusted = true;

		md.appendMarkdown('## $(hubot) AI Agents\n\n');

		const localSessions = sessions.filter(s => s.isLocal);
		const remoteSessions = sessions.filter(s => !s.isLocal);

		if (localSessions.length > 0) {
			md.appendMarkdown('**This workspace**\n\n');
			for (const session of localSessions) {
				this.appendSessionToTooltip(md, session);
			}
		}

		if (remoteSessions.length > 0) {
			// Group remote sessions by workspace path basename
			const groups = new Map<string, AgentSession[]>();
			for (const session of remoteSessions) {
				const label =
					session.workspacePath != null
						? escapeMarkdown(getBasename(session.workspacePath))
						: 'Unknown workspace';
				let group = groups.get(label);
				if (group == null) {
					group = [];
					groups.set(label, group);
				}
				group.push(session);
			}

			for (const [label, group] of groups) {
				md.appendMarkdown(`**${label}**\n\n`);
				for (const session of group) {
					this.appendSessionToTooltip(md, session);
				}
			}
		}

		md.appendMarkdown('---\n\n');
		md.appendMarkdown(
			`[Toggle Indicator](command:gitlens.agents.indicator.toggle "Toggle AI Agent Status Indicator")`,
		);

		return md;
	}

	private appendSessionToTooltip(md: MarkdownString, session: AgentSession): void {
		const statusIcon = this.getStatusIcon(session.status);
		const statusText = this.getStatusText(session);
		const branchInfo = session.branch ? ` on \`${escapeMarkdown(session.branch)}\`` : '';

		if (session.status === 'permission_requested' && session.pendingPermission != null) {
			md.appendMarkdown(
				`${statusIcon} [**${session.name}**](command:gitlens.agents.showPermission?${encodeURIComponent(JSON.stringify(session.id))} "Show Permission Request")${branchInfo} — awaiting approval: \`${escapeMarkdown(session.pendingPermission.toolDescription)}\`\n\n`,
			);
		} else {
			md.appendMarkdown(
				`${statusIcon} [**${session.name}**](command:gitlens.agents.openSession?${encodeURIComponent(JSON.stringify(session.id))} "Open Session")${branchInfo} — ${statusText}\n\n`,
			);
		}

		if (session.subagents != null && session.subagents.length > 0) {
			for (const sub of session.subagents) {
				const subIcon = this.getStatusIcon(sub.status);
				const subText = this.getStatusText(sub);
				md.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;${subIcon} agent — ${subText}\n\n`);
			}
		}
	}

	private getStatusIcon(status: AgentSession['status']): string {
		return statusDisplay[status].tooltipIcon;
	}

	private getStatusText(session: AgentSession): string {
		const display = statusDisplay[session.status];
		if (session.status === 'tool_use') {
			return `${display.label} ${session.statusDetail ?? 'tool'}`;
		}
		if (session.status === 'permission_requested') {
			return `${display.label}: ${session.pendingPermission?.toolDescription ?? 'a tool'}`;
		}
		return display.label;
	}

	private async showPermissionNotification(
		sessionId: string,
		agentName: string,
		permission: PendingPermission | undefined,
	): Promise<void> {
		const desc = permission?.toolDescription ?? 'a tool';
		const subtext = permission?.toolInputDescription;
		const message =
			subtext != null ? `${agentName} wants to run: ${desc} — ${subtext}` : `${agentName} wants to run: ${desc}`;

		const alwaysAllowLabel = getAlwaysAllowLabel(permission?.suggestions);
		const buttons =
			alwaysAllowLabel != null
				? ['Allow', alwaysAllowLabel, 'Deny', 'Open Session']
				: ['Allow', 'Deny', 'Open Session'];

		const choice = await window.showWarningMessage(message, ...buttons);

		switch (choice) {
			case 'Allow':
				this.service.resolvePermission(sessionId, 'allow');
				break;
			case 'Deny':
				this.service.resolvePermission(sessionId, 'deny');
				break;
			case 'Open Session':
				void this.openSession(sessionId);
				break;
			default:
				if (choice === alwaysAllowLabel && permission?.suggestions != null) {
					this.service.resolvePermission(sessionId, 'allow', [...permission.suggestions]);
				}
				// Dismissed — status bar still shows pending; re-click shows notification again
				break;
		}
	}

	private showPermission(sessionId?: string): void {
		const permissionSessions = this.service.sessions.filter(s => s.status === 'permission_requested' && s.isLocal);
		if (permissionSessions.length === 0) return;

		let session: AgentSession | undefined;
		if (sessionId != null) {
			session = permissionSessions.find(s => s.id === sessionId);
		}
		session ??= permissionSessions[0];

		void this.showPermissionNotification(session.id, session.name, session.pendingPermission);
	}

	private async openSession(sessionId?: string): Promise<void> {
		const sessions = [...this.service.sessions];
		if (sessions.length === 0) return;

		let session: AgentSession | undefined;

		// Step 1: Session picker (skip if sessionId provided or only one session)
		if (sessionId != null) {
			session = sessions.find(s => s.id === sessionId);
		} else if (sessions.length === 1) {
			session = sessions[0];
		} else {
			const localSessions = sessions.filter(s => s.isLocal);
			const remoteSessions = sessions.filter(s => !s.isLocal);

			interface SessionPickItem extends QuickPickItem {
				session: AgentSession;
			}

			const items: (SessionPickItem | QuickPickItem)[] = [];

			if (localSessions.length > 0) {
				items.push({ label: 'This workspace', kind: -1 /* QuickPickItemKind.Separator */ });
				for (const s of localSessions) {
					items.push({
						label: `$(hubot) ${s.name}`,
						description: this.getStatusText(s),
						detail: s.branch ? `on ${s.branch}` : undefined,
						session: s,
					} satisfies SessionPickItem);
				}
			}

			if (remoteSessions.length > 0) {
				items.push({ label: 'Other workspaces', kind: -1 /* QuickPickItemKind.Separator */ });
				for (const s of remoteSessions) {
					items.push({
						label: `$(hubot) ${s.name}`,
						description: this.getStatusText(s),
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

		// Step 2: Action picker
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

		if (session.isLocal) {
			actions.push({
				label: '$(edit) Open in Claude Code Extension',
				description: 'Open session in the Claude Code VS Code extension',
				action: 'open-extension',
			});
		}

		if (!session.isLocal && session.workspacePath != null) {
			actions.push({
				label: '$(folder-opened) Switch to Workspace',
				description: session.workspacePath,
				action: 'switch-workspace',
			});
		}

		if (actions.length === 0) return;

		// If there's only one action, just do it
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

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.agents.indicator.toggle', () => {
				const current = configuration.get('agents.indicator.enabled');
				void configuration.updateEffective('agents.indicator.enabled', !current);
			}),
			registerCommand('gitlens.agents.openSession', (sessionId?: string) => this.openSession(sessionId)),
			registerCommand('gitlens.agents.showPermission', (sessionId?: string) => this.showPermission(sessionId)),
			registerCommand('gitlens.agents.installClaudeHook', async () => {
				const { installClaudeHook } = await import('../env/node/agents/installClaudeHook.js');
				await installClaudeHook();
			}),
		];
	}
}

function getBasename(path: string): string {
	const sep = path.includes('\\') ? '\\' : '/';
	const parts = path.split(sep);
	return parts.at(-1) || path;
}

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|~<>&]/g, '\\$&');
}

function getAlwaysAllowLabel(suggestions: readonly PermissionSuggestion[] | undefined): string | undefined {
	if (suggestions == null || suggestions.length === 0) return undefined;

	// Handle PermissionUpdate format (addRules/replaceRules with rules + destination)
	const ruleSuggestion = suggestions.find(s => s.type === 'addRules' || s.type === 'replaceRules');
	if (ruleSuggestion != null) {
		const rules = ruleSuggestion.rules;
		const scope = describeDestination(ruleSuggestion.destination);

		if (rules != null && rules.length > 0) {
			const rule = rules[0];
			const what = rule.ruleContent != null ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName;
			return scope != null ? `Allow ${what} ${scope}` : `Always allow ${what}`;
		}
	}

	// Handle legacy toolAlwaysAllow format
	const toolAlwaysAllow = suggestions.find(s => s.type === 'toolAlwaysAllow');
	if (toolAlwaysAllow?.tool != null) {
		return `Always allow ${toolAlwaysAllow.tool}`;
	}

	return 'Always allow';
}

function describeDestination(destination: string | undefined): string | undefined {
	switch (destination) {
		case 'projectSettings':
			return 'for this project';
		case 'userSettings':
			return 'globally';
		case 'localSettings':
			return 'locally';
		case 'session':
			return 'for this session';
		default:
			return undefined;
	}
}
