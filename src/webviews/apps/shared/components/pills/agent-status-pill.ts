import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AgentSessionStatus } from '../../../../../agents/provider.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { AgentSessionState } from '../../../../home/protocol.js';
import { elementBase, linkBase } from '../styles/lit/base.css.js';
import '../button.js';
import '../code-icon.js';
import '../overlays/popover.js';

type AgentPillCategory = 'working' | 'needs-input' | 'idle';

function getCategory(status: AgentSessionStatus): AgentPillCategory {
	switch (status) {
		case 'thinking':
		case 'tool_use':
		case 'responding':
		case 'compacting':
			return 'working';
		case 'permission_requested':
		case 'waiting':
			return 'needs-input';
		case 'idle':
			return 'idle';
	}
}

const categoryLabels: Record<AgentPillCategory, string> = {
	working: 'Working',
	'needs-input': 'Needs Input',
	idle: 'Idle',
};

const statusVerbs: Record<AgentSessionStatus, string> = {
	thinking: 'is thinking\u2026',
	tool_use: 'is running a tool',
	responding: 'is responding\u2026',
	compacting: 'is compacting context\u2026',
	permission_requested: 'is awaiting approval',
	waiting: 'is waiting for input',
	idle: 'is idle',
};

function formatElapsed(timestamp: number | undefined): string | undefined {
	if (timestamp == null) return undefined;

	const seconds = Math.floor((Date.now() - timestamp) / 1000);
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-agent-status-pill': GlAgentStatusPill;
	}
}

@customElement('gl-agent-status-pill')
export class GlAgentStatusPill extends LitElement {
	static override styles = [
		elementBase,
		linkBase,
		css`
			:host {
				display: inline-block;
				--max-width: 30rem;
			}

			/* Pill badge */
			.pill {
				display: inline-flex;
				align-items: center;
				gap: 0.4rem;
				padding: 0.1rem 0.6rem;
				border-radius: 50px;
				border: 1px solid transparent;
				font-size: 0.85em;
				font-weight: 500;
				line-height: normal;
				white-space: nowrap;
				cursor: default;
			}

			.pill__dot {
				width: 5px;
				height: 5px;
				border-radius: 50%;
				flex: none;
			}

			/* Working (blue) */
			.pill--working {
				background-color: rgba(59, 126, 246, 0.1);
				border-color: rgba(59, 126, 246, 0.5);
				color: #7aabff;
			}
			.pill--working .pill__dot {
				background-color: #3b7ef6;
			}

			/* Needs Input (amber) */
			.pill--needs-input {
				background-color: rgba(232, 160, 48, 0.1);
				border-color: rgba(232, 160, 48, 0.5);
				color: #f0bf6e;
			}
			.pill--needs-input .pill__dot {
				background-color: #e8a030;
			}

			/* Idle (gray) */
			.pill--idle {
				background-color: rgba(136, 136, 160, 0.1);
				border-color: rgba(136, 136, 160, 0.35);
				color: #8888a0;
			}
			.pill--idle .pill__dot {
				background-color: #8888a0;
			}

			/* Light theme overrides */
			:host-context(.vscode-light) .pill--working,
			:host-context(.vscode-high-contrast-light) .pill--working {
				background-color: rgba(30, 90, 200, 0.08);
				border-color: rgba(30, 90, 200, 0.4);
				color: #1a5cc8;
			}
			:host-context(.vscode-light) .pill--working .pill__dot,
			:host-context(.vscode-high-contrast-light) .pill--working .pill__dot {
				background-color: #1a5cc8;
			}

			:host-context(.vscode-light) .pill--needs-input,
			:host-context(.vscode-high-contrast-light) .pill--needs-input {
				background-color: rgba(180, 120, 20, 0.08);
				border-color: rgba(180, 120, 20, 0.4);
				color: #a07010;
			}
			:host-context(.vscode-light) .pill--needs-input .pill__dot,
			:host-context(.vscode-high-contrast-light) .pill--needs-input .pill__dot {
				background-color: #a07010;
			}

			:host-context(.vscode-light) .pill--idle,
			:host-context(.vscode-high-contrast-light) .pill--idle {
				background-color: rgba(100, 100, 120, 0.08);
				border-color: rgba(100, 100, 120, 0.3);
				color: #606070;
			}
			:host-context(.vscode-light) .pill--idle .pill__dot,
			:host-context(.vscode-high-contrast-light) .pill--idle .pill__dot {
				background-color: #606070;
			}

			/* Popover content */
			.hover-card {
				display: flex;
				flex-direction: column;
				gap: 0.6rem;
				white-space: normal;
				min-width: 16rem;
			}

			.hover-header {
				display: flex;
				align-items: center;
				gap: 0.5rem;
			}

			.hover-header__dot {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				flex: none;
			}

			.hover-header__dot--working {
				background-color: #7aabff;
			}
			.hover-header__dot--needs-input {
				background-color: #f0bf6e;
			}
			.hover-header__dot--idle {
				background-color: #8888a0;
			}

			.hover-header__text {
				flex: 1;
				min-width: 0;
				font-weight: 500;
			}

			.hover-header__elapsed {
				flex: none;
				color: var(--vscode-descriptionForeground);
				font-size: 0.9em;
			}

			.hover-section {
				display: flex;
				flex-direction: column;
				gap: 0.2rem;
			}

			.hover-section__label {
				text-transform: uppercase;
				font-size: 0.8em;
				color: var(--vscode-descriptionForeground);
				opacity: 0.7;
			}

			.hover-section__value {
			}

			.hover-code {
				background-color: rgba(0, 0, 0, 0.3);
				border-radius: 2px;
				padding: 0.3rem 0.5rem;
				font-family: var(--vscode-editor-font-family, monospace);
				font-size: 0.9em;
				word-break: break-all;
			}

			:host-context(.vscode-light) .hover-code,
			:host-context(.vscode-high-contrast-light) .hover-code {
				background-color: rgba(0, 0, 0, 0.06);
			}

			.hover-actions {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
				margin-top: 0.2rem;
			}
		`,
	];

	@property({ type: Object })
	session!: AgentSessionState;

	override render(): unknown {
		const category = getCategory(this.session.status);
		const label = categoryLabels[category];

		return html`
			<gl-popover placement="bottom" hoist>
				<span slot="anchor" class="pill pill--${category}" tabindex="0">
					<span class="pill__dot"></span>
					${label}
				</span>
				<div slot="content" class="hover-card" tabindex="-1">${this.renderHoverContent(category)}</div>
			</gl-popover>
		`;
	}

	private renderHoverContent(category: AgentPillCategory): unknown {
		switch (category) {
			case 'working':
				return this.renderWorkingHover();
			case 'needs-input':
				return this.renderNeedsInputHover();
			case 'idle':
				return this.renderIdleHover();
		}
	}

	private renderWorkingHover(): unknown {
		const elapsed = formatElapsed(this.session.lastActivityTimestamp);
		const verb = statusVerbs[this.session.status];
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(this.session.id));

		return html`
			<div class="hover-header">
				<span class="hover-header__dot hover-header__dot--working"></span>
				<span class="hover-header__text">${this.session.name} ${verb}</span>
				${elapsed != null ? html`<span class="hover-header__elapsed">${elapsed}</span>` : nothing}
			</div>
			${this.session.status === 'tool_use' && this.session.statusDetail
				? html`
						<div class="hover-section">
							<span class="hover-section__label">Current Tool</span>
							<span class="hover-section__value">${this.session.statusDetail}</span>
						</div>
					`
				: nothing}
			<div class="hover-actions">
				<gl-button appearance="secondary" full density="compact" href=${openHref}>
					<code-icon icon="link-external" slot="prefix"></code-icon>
					Open Session
				</gl-button>
			</div>
		`;
	}

	private renderNeedsInputHover(): unknown {
		const elapsed = formatElapsed(this.session.lastActivityTimestamp);
		const detail = this.session.pendingPermissionDetail;
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(this.session.id));

		return html`
			<div class="hover-header">
				<span class="hover-header__dot hover-header__dot--needs-input"></span>
				<span class="hover-header__text">${this.session.name} ${statusVerbs[this.session.status]}</span>
				${elapsed != null ? html`<span class="hover-header__elapsed">${elapsed}</span>` : nothing}
			</div>
			${detail != null
				? html`
						<div class="hover-section">
							<span class="hover-section__label">Request</span>
							<div class="hover-code">
								${detail.toolName}${detail.toolDescription
									? html` &mdash; ${detail.toolDescription}`
									: nothing}
							</div>
						</div>
						${detail.toolInputDescription
							? html`
									<div class="hover-section">
										<span class="hover-section__label">Context</span>
										<span class="hover-section__value">${detail.toolInputDescription}</span>
									</div>
								`
							: nothing}
					`
				: nothing}
			<div class="hover-actions">
				<gl-button appearance="secondary" full density="compact" href=${openHref}>
					<code-icon icon="link-external" slot="prefix"></code-icon>
					Open Session
				</gl-button>
			</div>
		`;
	}

	private renderIdleHover(): unknown {
		const openHref = createCommandLink('gitlens.agents.openSession', JSON.stringify(this.session.id));

		return html`
			<div class="hover-header">
				<span class="hover-header__dot hover-header__dot--idle"></span>
				<span class="hover-header__text">${this.session.name} is idle</span>
			</div>
			<div class="hover-actions">
				<gl-button appearance="secondary" full density="compact" href=${openHref}>
					<code-icon icon="link-external" slot="prefix"></code-icon>
					Open Session
				</gl-button>
			</div>
		`;
	}
}
