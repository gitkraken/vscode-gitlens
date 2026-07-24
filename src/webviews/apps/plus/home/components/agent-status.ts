import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
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
				margin-bottom: var(--gl-space-24);
			}

			.workspace-group {
				margin-block-start: var(--gl-space-4);
			}

			.workspace-group__label {
				margin-block: 0 var(--gl-space-2);
				font-size: 0.9em;
				font-weight: 600;
				color: var(--vscode-descriptionForeground);
			}

			.sessions {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-2);
			}

			.session {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				margin-block: 0;
			}

			.session__name {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				color: var(--vscode-foreground);
				white-space: nowrap;
			}

			.session__subagents {
				flex: none;
				color: var(--vscode-descriptionForeground);
			}

			.session__context {
				flex: none;
				overflow: hidden;
				text-overflow: ellipsis;
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
				white-space: nowrap;
			}
		`,
	];

	@consume({ context: homeStateContext })
	@state()
	private _homeState!: HomeState;

	override render(): unknown {
		const sessions = this._homeState.agentSessions.get();
		if (sessions == null || sessions.length === 0) return nothing;

		// Group by `worktreePath`; fall back to `workspacePath` so sessions in a non-repo
		// workspace folder (no git resolution → no worktreePath) still cluster together.
		const groups = new Map<string, AgentSessionState[]>();
		for (const session of sessions) {
			const key = session.worktreePath ?? session.workspacePath ?? 'unknown';
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
		// Branch isn't stored on the session — it's a property of the worktree, resolved live
		// at serialization time. Here in the home overlay we surface the live worktree name
		// (typically the branch name) when present; the branch label appears on the branch card
		// itself so this is just disambiguation.
		const name = session.worktree?.name ?? (session.worktreePath ? basename(session.worktreePath) : undefined);
		if (name == null) return undefined;

		return {
			text: `worktree: ${name}`,
			tooltip: session.cwd,
		};
	}

	private renderSession(session: AgentSessionState): unknown {
		const context = this.getSessionContext(session);

		return html`
			<div class="session">
				<gl-agent-status-pill .session=${session}></gl-agent-status-pill>
				<span class="session__name">${session.displayName}</span>
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
