import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { basename } from '@gitlens/utils/path.js';
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
		// This card represents unrepresented sessions (those not on any rendered branch card),
		// so the worktree's live display name carries the useful disambiguation. Branch labels
		// appear on the proper branch card when one exists.
		// Keyed by `worktree.path` so two sessions in the same worktree show one chip.
		const worktrees = new Map<string, { label: string; cwd: string | undefined }>();
		for (const s of this.sessions) {
			const path = s.worktree?.path;
			if (path == null || worktrees.has(path)) continue;
			worktrees.set(path, { label: s.worktree?.name ?? basename(path), cwd: s.cwd });
		}

		if (worktrees.size === 0) return nothing;

		return html`
			<div class="details">
				${Array.from(
					worktrees.values(),
					({ label, cwd }) =>
						html`<span class="detail" title=${cwd ?? label}
							><code-icon icon="folder-opened" title="Worktree"></code-icon>${label}</span
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
