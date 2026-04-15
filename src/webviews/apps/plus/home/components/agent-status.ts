import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { basename } from '@gitlens/utils/path.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import type { HomeState } from '../../../home/state.js';
import { homeStateContext } from '../../../home/state.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/pills/agent-status-pill.js';
import './branch-section.js';

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

			.session {
				display: flex;
				align-items: center;
				gap: 0.6rem;
				margin-block: 0;
			}

			.session__name {
				flex: 1;
				min-width: 0;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				color: var(--vscode-foreground);
			}

			.session__subagents {
				flex: none;
				color: var(--vscode-descriptionForeground);
			}

			.session__context {
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

		// Group sessions by full workspace path to avoid collisions between
		// identically-named folders; display only the basename as the label.
		const groups = new Map<string, AgentSessionState[]>();
		for (const session of sessions) {
			const key = session.workspacePath ?? 'unknown';
			let group = groups.get(key);
			if (group == null) {
				group = [];
				groups.set(key, group);
			}
			group.push(session);
		}

		return html`
			<gl-section>
				<span slot="heading">AI Agents</span>
				${Array.from(
					groups,
					([key, sessions]) => html`
						<div class="workspace-group">
							<p class="workspace-group__label" title=${key !== 'unknown' ? key : ''}>
								${key !== 'unknown' ? basename(key) : 'Unknown workspace'}
							</p>
							<div class="sessions">${sessions.map(s => this.renderSession(s))}</div>
						</div>
					`,
				)}
			</gl-section>
		`;
	}

	private getSessionContext(session: AgentSessionState): { text: string; tooltip?: string } | undefined {
		const parts: string[] = [];
		if (session.branch != null) {
			parts.push(session.branch);
		}
		if (session.worktreeName != null) {
			parts.push(`worktree: ${session.worktreeName}`);
		}
		if (parts.length === 0) return undefined;

		return {
			text: parts.join(' · '),
			tooltip: session.worktreeName != null ? session.cwd : undefined,
		};
	}

	private renderSession(session: AgentSessionState): unknown {
		const context = this.getSessionContext(session);

		return html`
			<div class="session">
				<gl-agent-status-pill .session=${session}></gl-agent-status-pill>
				<span class="session__name">${session.name}</span>
				${context != null
					? html`<span class="session__context" title=${context.tooltip ?? context.text}
							>${context.text}</span
						>`
					: nothing}
				${session.subagentCount > 0
					? html`<span class="session__subagents">
							<code-icon icon="organization"></code-icon>
							${session.subagentCount}
						</span>`
					: nothing}
			</div>
		`;
	}
}
