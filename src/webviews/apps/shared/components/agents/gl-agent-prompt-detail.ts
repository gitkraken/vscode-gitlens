import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { basename } from '@gitlens/utils/path.js';
import type { PendingPermission } from '../../../../../agents/provider.js';
import { createCommandLink } from '../../../../../system/commands.js';
import '../chips/action-chip.js';
import '../code-icon.js';
import '../copy-container.js';
import '../overlays/tooltip.js';

interface PlanActions {
	openHref: string;
	copyContent: string;
}

interface ResolvedContent {
	block: string;
	blockClass: string;
	caption: string | undefined;
	captionTooltip: string | undefined;
	planActions: PlanActions | undefined;
	tooltip: string | undefined;
}

/**
 * Shared "what's the agent waiting on" display for the four discriminated permission kinds
 * (`tool`, `plan`, `question`, `elicitation`). Renders a three-layer composite:
 *
 *  - **block**: the primary content, clamped to two lines — the tool call for `tool`, the plan
 *    summary for `plan`, the leading question text for `question`, the tool name for `elicitation`.
 *    Monospace for `tool` (it's a code invocation); proportional for the others (they're prose).
 *  - **caption row**: a dimmer subtitle anchored beneath the block in the same container, with
 *    optional action chips on the trailing edge — e.g. plan kind gets Open + Copy chips next to
 *    `Plan: <filename>`. Caption text is plain (no link); affordances are the chips.
 *  - **tooltip**: covers the full composite and carries the untruncated body so users can
 *    inspect long Bash calls / multi-sentence plan summaries / full question text on hover.
 *
 * Replaces the bespoke renderings in the graph card, the graph hover popover row, the sidebar
 * agent-tooltip, and the status-pill needs-input hover — so a single fix lands across every
 * surface that asks "what is this agent waiting on?".
 */
@customElement('gl-agent-prompt-detail')
export class GlAgentPromptDetail extends LitElement {
	static override styles = css`
		:host {
			display: block;
			min-width: 0;
		}

		.composite {
			display: flex;
			flex-direction: column;
			gap: 0.2rem;
			padding: 0.4rem 0.5rem;
			border-radius: 0.3rem;
			background-color: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
			min-width: 0;
		}

		.block {
			font-size: 0.85em;
			word-break: break-word;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
			min-width: 0;
		}

		.block--code {
			font-family: var(--vscode-editor-font-family, monospace);
			word-break: break-all;
		}

		.block--prose {
			font-style: italic;
			color: var(--vscode-foreground);
		}

		.caption-row {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			min-width: 0;
		}

		.caption {
			flex: 1 1 auto;
			min-width: 0;
			font-size: 0.8em;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.caption-actions {
			flex: none;
			display: inline-flex;
			align-items: center;
			gap: 0.2rem;
		}

		/* gl-copy-container hosts a bare code-icon — give it the same hover affordance the
		   sibling gl-action-chip has so the two buttons read as a matched pair. */
		.caption-copy {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2rem;
			height: 2rem;
			border-radius: 0.5rem;
			color: inherit;
			cursor: pointer;
		}

		.caption-copy:hover {
			background-color: var(--vscode-toolbar-hoverBackground);
		}
	`;

	@property({ attribute: false })
	permission?: PendingPermission;

	override render(): unknown {
		const permission = this.permission;
		if (permission == null) return nothing;

		const content = this.resolveContent(permission);
		// Tooltip anchors to the block text only — wrapping the whole composite would intercept
		// hovers over the caption-row's action chips/copy-container and conflict with their own
		// tooltips.
		const blockHtml = content.tooltip
			? html`<gl-tooltip content=${content.tooltip} placement="bottom">
					<div class=${content.blockClass}>${content.block}</div>
				</gl-tooltip>`
			: html`<div class=${content.blockClass}>${content.block}</div>`;

		return html` <div class="composite">${blockHtml}${this.renderCaptionRow(content)}</div> `;
	}

	private renderCaptionRow(content: ResolvedContent): unknown {
		if (!content.caption && content.planActions == null) return nothing;

		return html`
			<div class="caption-row">
				${content.caption
					? content.captionTooltip
						? html`<gl-tooltip content=${content.captionTooltip} placement="bottom">
								<span class="caption">${content.caption}</span>
							</gl-tooltip>`
						: html`<span class="caption">${content.caption}</span>`
					: nothing}
				${content.planActions != null
					? html`<span class="caption-actions">
							<gl-action-chip
								icon="tasklist"
								label="View Plan"
								overlay="tooltip"
								href=${content.planActions.openHref}
							></gl-action-chip>
							<gl-copy-container
								class="caption-copy"
								.content=${content.planActions.copyContent}
								copyLabel="Copy Plan Path"
							>
								<code-icon icon="copy"></code-icon>
							</gl-copy-container>
						</span>`
					: nothing}
			</div>
		`;
	}

	private resolveContent(permission: PendingPermission): ResolvedContent {
		switch (permission.kind) {
			case 'plan': {
				const block = permission.planSummary ?? 'Plan ready for review';
				const filename = permission.planFilePath != null ? basename(permission.planFilePath) : undefined;
				// JSON.stringify the path so the command URI's query string is valid JSON; bare
				// strings break VS Code's argument parser. Copy is handled client-side by
				// <gl-copy-container> so it doesn't need a command.
				const planActions: PlanActions | undefined =
					permission.planFilePath != null
						? {
								openHref: createCommandLink(
									'gitlens.agents.openPlanFile',
									JSON.stringify(permission.planFilePath),
								),
								copyContent: permission.planFilePath,
							}
						: undefined;
				return {
					block: block,
					blockClass: 'block block--prose',
					caption: filename != null ? `Plan: ${filename}` : undefined,
					captionTooltip: permission.planFilePath,
					planActions: planActions,
					tooltip: permission.planSummary,
				};
			}
			case 'question': {
				const block = permission.questionText ?? 'Awaiting your answer';
				const count = permission.questionCount ?? 0;
				const caption = count > 1 ? `1 of ${count} questions` : count === 1 ? '1 question' : undefined;
				return {
					block: block,
					blockClass: 'block block--prose',
					caption: caption,
					captionTooltip: undefined,
					planActions: undefined,
					tooltip: permission.questionText,
				};
			}
			case 'elicitation': {
				return {
					block: permission.toolName || 'Input required',
					blockClass: 'block block--prose',
					caption: 'Awaiting input',
					captionTooltip: undefined,
					planActions: undefined,
					tooltip: undefined,
				};
			}
			case 'tool':
			default: {
				const block = permission.toolDescription || permission.toolName;
				return {
					block: block,
					blockClass: 'block block--code',
					caption: permission.toolInputDescription,
					captionTooltip: undefined,
					planActions: undefined,
					tooltip: block,
				};
			}
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-agent-prompt-detail': GlAgentPromptDetail;
	}
}
