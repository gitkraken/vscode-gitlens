import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { AgentSessionStatus } from '../../../../../agents/provider.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import type { HomeState } from '../../../home/state.js';
import { homeStateContext } from '../../../home/state.js';
import '../../../shared/components/code-icon.js';
import './branch-section.js';

const statusDisplay: Record<AgentSessionStatus, { icon: string; label: string; spin?: boolean }> = {
	thinking: { icon: 'loading', label: 'thinking', spin: true },
	tool_use: { icon: 'terminal', label: 'running' },
	responding: { icon: 'comment', label: 'responding' },
	waiting: { icon: 'clock', label: 'waiting for input' },
	idle: { icon: 'circle-outline', label: 'idle' },
	compacting: { icon: 'loading', label: 'compacting context', spin: true },
	permission_requested: { icon: 'shield', label: 'awaiting approval' },
};

@customElement('gl-agent-status')
export class GlAgentStatus extends SignalWatcher(LitElement) {
	static override styles = [
		css`
			:host {
				display: block;
				margin-bottom: 2.4rem;
			}

			.workspace-group {
				margin-block-start: 0.4rem;
			}

			.workspace-group__label {
				margin-block: 0 0.2rem;
				font-size: 0.9em;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
			}

			.sessions {
				display: flex;
				flex-direction: column;
				gap: 0.2rem;
			}

			.status {
				display: flex;
				align-items: center;
				gap: 0.6rem;
				margin-block: 0;
				color: var(--vscode-foreground);
				text-decoration: none;
			}

			.status:hover {
				color: var(--vscode-textLink-activeForeground);
			}

			.status--warning {
				color: var(--vscode-editorWarning-foreground);
			}

			.icon {
				flex: none;
			}

			.label {
				flex: 1;
				min-width: 0;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.subagents {
				flex: none;
				color: var(--vscode-descriptionForeground);
			}

			.context {
				flex: none;
				color: var(--vscode-descriptionForeground);
				font-size: 0.9em;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
		`,
	];

	@consume({ context: homeStateContext })
	@state()
	private _homeState!: HomeState;

	override render(): unknown {
		const sessions = this._homeState.agentSessions.get();
		if (sessions == null || sessions.length === 0) return nothing;

		// Group all sessions by workspace path basename
		const groups = new Map<string, AgentSessionState[]>();
		for (const session of sessions) {
			const label = session.workspacePath != null ? getBasename(session.workspacePath) : 'Unknown workspace';
			let group = groups.get(label);
			if (group == null) {
				group = [];
				groups.set(label, group);
			}
			group.push(session);
		}

		return html`
			<gl-section>
				<span slot="heading">AI Agents</span>
				${Array.from(
					groups,
					([label, sessions]) => html`
						<div class="workspace-group">
							<p class="workspace-group__label">${label}</p>
							<div class="sessions">${sessions.map(s => this.renderSession(s))}</div>
						</div>
					`,
				)}
			</gl-section>
		`;
	}

	private getSessionContext(session: AgentSessionState): string | undefined {
		const parts: string[] = [];
		if (session.branch != null) {
			parts.push(session.branch);
		}
		if (session.worktreeName != null) {
			parts.push(`worktree: ${session.worktreeName}`);
		}
		return parts.length > 0 ? parts.join(' · ') : undefined;
	}

	private renderSession(session: AgentSessionState): unknown {
		const display = statusDisplay[session.status];
		const isWarning = session.status === 'permission_requested';
		const commandName = isWarning ? 'gitlens.agents.showPermission' : 'gitlens.agents.openSession';
		// Pre-stringify so the string gets JSON-quoted in the command URI (bare strings fail JSON.parse)
		const href = createCommandLink(commandName, JSON.stringify(session.id));

		const label =
			session.status === 'tool_use'
				? `${session.name} ${display.label} ${session.statusDetail ?? 'tool'}`
				: session.status === 'idle'
					? session.name
					: `${session.name} ${display.label}`;

		const context = this.getSessionContext(session);

		return html`
			<a class="status ${isWarning ? 'status--warning' : ''}" href=${href}>
				<code-icon
					class="icon"
					icon="${display.icon}"
					modifier=${ifDefined(display.spin ? 'spin' : undefined)}
				></code-icon>
				<span class="label">${label}</span>
				${context != null ? html`<span class="context">${context}</span>` : nothing}
				${session.subagentCount > 0
					? html`<span class="subagents">
							<code-icon icon="organization"></code-icon>
							${session.subagentCount}
						</span>`
					: nothing}
			</a>
		`;
	}
}

function getBasename(path: string): string {
	const sep = path.includes('\\') ? '\\' : '/';
	const parts = path.split(sep);
	return parts.at(-1) || path;
}
