import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { basename } from '@gitlens/utils/path.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import type { AgentSessionCategory } from '../../../shared/agentUtils.js';
import { agentPhaseToCategory, formatAgentElapsed, getAgentPhaseLabel } from '../../../shared/agentUtils.js';
import '../../../shared/components/agents/gl-agent-prompt-detail.js';
import '../../../shared/components/code-icon.js';
import { graphStateContext } from '../context.js';

/** Soft cap on `lastPrompt` rendering — keeps the hover scannable; the full prompt lives one
 *  click away in Open Session. Sliced at codepoint length, with trailing whitespace trimmed. */
const lastPromptTruncateAt = 240;

function truncatePrompt(prompt: string): string {
	if (prompt.length <= lastPromptTruncateAt) return prompt;
	return `${prompt.slice(0, lastPromptTruncateAt).trimEnd()}…`;
}

/**
 * Hover tooltip for agent leaves in the graph sidebar. Lit-rendered instead of markdown so the
 * layout (right-anchored phase cluster, labeled sections, code-style tool input) can use scoped
 * CSS without fighting the webview's `style-src` CSP — Lit's `static styles` ship as adopted
 * stylesheets, which the CSP doesn't restrict (unlike inline `<style>` or `style="…"` attrs).
 *
 * Reads as a zoomed-in version of the leaf row itself: `$(claude)` + name on the left, phase
 * cluster on the right, then folder + branch identity, then content sections ordered by urgency
 * (current tool / pending permission precede `lastPrompt`).
 *
 * Takes only the session id and looks the session up live from `graphStateContext.agentSessions`
 * (a `@signalState` accessor) — so an open tooltip ticks as the session's phase/elapsed/permission
 * state advances host-side, instead of going stale until the user re-hovers. The tree-view's
 * popover snapshots the tooltip TemplateResult at hover time, so without this self-subscription
 * the captured `<gl-agent-tooltip>` instance would render the at-hover session forever.
 */
@customElement('gl-agent-tooltip')
export class GlAgentTooltip extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			display: block;
			max-width: 48rem;
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			line-height: 1.4;
		}

		.header {
			display: flex;
			align-items: baseline;
			gap: 1.6rem;
			justify-content: space-between;
		}

		.header__identity {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			min-width: 0;
			flex: 1 1 auto;
		}

		.header__name {
			font-weight: 600;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.header__phase {
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			flex: 0 0 auto;
			white-space: nowrap;
			color: var(--vscode-descriptionForeground);
		}

		/* Phase colors pull from the shared --gl-agent-* palette so the tooltip header and the
		 * leaf row's icon agree on what each state looks like. */
		.header__phase--working {
			color: var(--gl-agent-working-color);
		}

		.header__phase--needs-input {
			color: var(--gl-agent-waiting-color);
		}

		.identity-line {
			margin-top: 0.4rem;
			display: flex;
			align-items: center;
			gap: 0.4rem;
			color: var(--vscode-descriptionForeground);
			min-width: 0;
		}

		.identity-line__value {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			min-width: 0;
		}

		.identity-line code {
			font-family: var(--vscode-editor-font-family);
			background: transparent;
			color: var(--vscode-foreground);
		}

		.upstream {
			color: var(--vscode-descriptionForeground);
			font-family: var(--vscode-editor-font-family);
		}

		hr {
			margin: 0.8rem 0;
			border: none;
			border-top: 1px solid var(--vscode-widget-border, var(--vscode-foreground));
			opacity: 0.4;
		}

		/* Header-less section rows — leading icon doubles as the section's label. The icon stays
		 * pinned to the first line via align-items: flex-start; the content column flexes to fill
		 * the rest and is allowed to break long tokens (paths, branch names) at any point. */
		.section {
			display: flex;
			align-items: flex-start;
			gap: 0.6rem;
			color: var(--vscode-foreground);
		}

		.section > code-icon {
			flex: 0 0 auto;
			color: var(--vscode-descriptionForeground);
			/* Nudge to align the icon's optical center with the first line of body text. */
			margin-top: 0.2rem;
		}

		.section__content {
			flex: 1 1 auto;
			min-width: 0;
			overflow-wrap: anywhere;
		}

		.section--prompt .section__content {
			white-space: pre-wrap;
		}

		.section--needs-input > code-icon {
			color: var(--gl-agent-waiting-color);
		}
	`;

	@consume({ context: graphStateContext, subscribe: true })
	private readonly _state!: typeof graphStateContext.__context__;

	@property({ attribute: false })
	sessionId!: string;

	override render(): unknown {
		const session = this._state.agentSessions?.find(s => s.id === this.sessionId);
		if (session == null) return nothing;

		const category = agentPhaseToCategory[session.phase];
		const phaseLabel = getAgentPhaseLabel(category, session.pendingPermission);
		const elapsed = formatAgentElapsed(session.phaseSince);
		const phaseIcon = category === 'needs-input' ? 'warning' : category === 'working' ? 'sync' : 'circle-filled';

		const wt = session.worktree;
		const folderPath = wt?.path ?? session.workspacePath;

		return html`
			<div class="header">
				<span class="header__identity">
					<code-icon icon="claude"></code-icon>
					<span class="header__name">${session.displayName}</span>
				</span>
				<span class="header__phase header__phase--${category}">
					<code-icon icon=${phaseIcon}></code-icon>
					${phaseLabel}${elapsed != null ? ` · ${elapsed}` : ''}
				</span>
			</div>

			${folderPath != null
				? html`<div class="identity-line">
						<code-icon icon="folder"></code-icon>
						<span class="identity-line__value"><code>${folderPath}</code></span>
					</div>`
				: nothing}
			${this.renderBranchLine(wt)} ${this.renderSections(session, category)}
		`;
	}

	/** Branch / detached / bare line. `type === undefined` is the transient pre-refresh window;
	 *  fall through to the branch path so we still surface whatever name we have. */
	private renderBranchLine(wt: AgentSessionState['worktree']) {
		if (wt == null) return nothing;

		if (wt.type === 'bare') {
			return html`<div class="identity-line">
				<code-icon icon="circle-slash"></code-icon>
				<span class="identity-line__value">Bare worktree</span>
			</div>`;
		}

		if (wt.type === 'detached') {
			const label = wt.name ?? basename(wt.path);
			return html`<div class="identity-line">
				<code-icon icon="git-commit"></code-icon>
				<span class="identity-line__value"><code>${label}</code></span>
			</div>`;
		}

		const label = wt.branch?.name ?? wt.name ?? basename(wt.path);
		return html`<div class="identity-line">
			<code-icon icon="git-branch"></code-icon>
			<span class="identity-line__value">
				<code>${label}</code>${wt.branch?.upstreamName
					? html` <span class="upstream">⇆ ${wt.branch.upstreamName}</span>`
					: nothing}
			</span>
		</div>`;
	}

	/** Content sections ordered by urgency: tool / permission detail precede `lastPrompt` so a
	 *  user hovering a stuck or active session sees the actionable signal first. Each section is
	 *  iconified, never headered — the leading icon (`tools` / `warning` / `comment-discussion`)
	 *  is the only label, with the colored variant on `--needs-input` carrying the urgency cue. */
	private renderSections(session: AgentSessionState, category: AgentSessionCategory) {
		const blocks: unknown[] = [];

		if (category === 'working' && session.status === 'tool_use' && session.statusDetail) {
			blocks.push(html`
				<hr />
				<div class="section">
					<code-icon icon="tools"></code-icon>
					<div class="section__content">${session.statusDetail}</div>
				</div>
			`);
		}

		const permission = session.pendingPermission;
		if (category === 'needs-input' && permission != null) {
			blocks.push(html`
				<hr />
				<div class="section section--needs-input">
					<code-icon icon="warning"></code-icon>
					<div class="section__content">
						<gl-agent-prompt-detail .permission=${permission}></gl-agent-prompt-detail>
					</div>
				</div>
			`);
		}

		if (session.lastPrompt) {
			blocks.push(html`
				<hr />
				<div class="section section--prompt">
					<code-icon icon="comment-discussion"></code-icon>
					<div class="section__content">${truncatePrompt(session.lastPrompt)}</div>
				</div>
			`);
		}

		return blocks;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-agent-tooltip': GlAgentTooltip;
	}
}
