import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import '../../../shared/components/card/card.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/pills/agent-status-pill.js';

export const agentSessionCardTagName = 'gl-agent-session-card';

@customElement(agentSessionCardTagName)
export class GlAgentSessionCard extends LitElement {
	static override styles = [
		css`
			:host {
				display: block;
			}

			.content {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
				padding: 0.4rem 0;
			}

			.header {
				display: inline-flex;
				align-items: center;
				gap: 0.6rem;
				max-width: 100%;
				margin-block: 0;
			}

			.header__icon {
				color: var(--vscode-descriptionForeground);
				flex: none;
			}

			.header__name {
				flex: 1;
				min-width: 0;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: bold;
			}

			.details {
				display: flex;
				flex-direction: column;
				gap: 0.2rem;
				font-size: 0.9em;
				color: var(--vscode-descriptionForeground);
			}

			.detail {
				display: inline-flex;
				align-items: center;
				gap: 0.4rem;
			}

			.sessions {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}

			.session {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 0.4rem;
				flex-wrap: wrap;
			}

			.session code-icon {
				color: var(--vscode-descriptionForeground);
			}

			.session__name {
				color: var(--vscode-descriptionForeground);
				font-size: 0.9em;
			}

			.session__subagents {
				color: var(--vscode-descriptionForeground);
			}
		`,
	];

	@property()
	label!: string;

	@property()
	labelTitle = '';

	@property()
	labelType: 'workspace' | 'cwd' = 'workspace';

	@property({ type: Array })
	sessions!: AgentSessionState[];

	override render(): unknown {
		if (this.sessions.length === 0) return nothing;

		return html`
			<gl-card>
				<div class="content">
					<p class="header">
						<span class="header__icon"
							><code-icon
								icon=${this.labelType === 'workspace' ? 'folder-library' : 'folder'}
								title=${this.labelType === 'workspace' ? 'Workspace' : 'Working Directory'}
							></code-icon
						></span>
						<span class="header__name" title=${this.labelTitle}>${this.label}</span>
					</p>
					${this.renderDetails()}
					<div class="sessions">${this.sessions.map(s => this.renderSession(s))}</div>
				</div>
			</gl-card>
		`;
	}

	private renderDetails(): unknown {
		const branches = new Set<string>();
		const worktrees = new Map<string, string | undefined>();
		for (const s of this.sessions) {
			if (s.branch != null) {
				branches.add(s.branch);
			}
			if (s.worktreeName != null && !worktrees.has(s.worktreeName)) {
				worktrees.set(s.worktreeName, s.cwd);
			}
		}

		if (branches.size === 0 && worktrees.size === 0) return nothing;

		return html`
			<div class="details">
				${Array.from(
					branches,
					b => html`<span class="detail"><code-icon icon="git-branch" title="Branch"></code-icon>${b}</span>`,
				)}
				${Array.from(
					worktrees,
					([w, cwd]) =>
						html`<span class="detail" title=${cwd ?? w}
							><code-icon icon="folder-opened" title="Worktree"></code-icon>${w}</span
						>`,
				)}
			</div>
		`;
	}

	private renderSession(session: AgentSessionState): unknown {
		return html`
			<div class="session">
				<code-icon icon="hubot" title="Agent"></code-icon>
				<gl-agent-status-pill .session=${session}></gl-agent-status-pill>
				<span class="session__name">${session.name}</span>
				${session.subagentCount > 0
					? html`<span class="session__subagents">
							<code-icon icon="organization" title="Subagents"></code-icon>
							${session.subagentCount}
						</span>`
					: nothing}
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[agentSessionCardTagName]: GlAgentSessionCard;
	}
}
