import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import type { AgentInfo } from '../../../../../rpc/services/types.js';
import type { AgentsState } from '../../../../shared/contexts/agents.js';
import { agentsContext } from '../../../../shared/contexts/agents.js';
import type { AIContextState } from '../../../../shared/contexts/ai.js';
import { aiContext } from '../../../../shared/contexts/ai.js';
import '@gitlens/components/components/codeIcon.js';

/** The two state columns. Named rather than positional so the shared cell renderer can be read at its call site. */
type StateColumn = 'mcp' | 'hooks';

/** The four cell treatments, one per row of `renderStateCell`'s table — a union rather than a `string` so a
 *  typo can't silently produce an unstyled cell that renders at the inherited colour. */
type CellTreatment = 'absent' | 'uninstalled' | 'installed' | 'warning';

/** One glyph per column, never varying down it — that identity is what lets the column headings go, so the
 *  treatment (see `renderStateCell`) is the only thing allowed to change per row. */
const columnIcons: Record<StateColumn, string> = {
	mcp: 'mcp',
	hooks: 'search-sparkle',
};

/** Column names for the per-cell accessible names — the visual columns are unheaded, so each cell has to
 *  say which column it belongs to on its own. */
const columnLabels: Record<StateColumn, string> = {
	mcp: 'GitKraken MCP',
	hooks: 'Hooks',
};

/** Mirrors the Agents settings table's `kindIcons`. Typed against `AgentInfo['kind']` so a new kind can't be
 *  added upstream without this map failing to compile. Deliberately NOT the provider mark: provider marks
 *  collide across rows (Copilot Chat vs. GitHub Copilot CLI, Claude Code vs. its extension) and Gemini has
 *  none — identity here is carried by the text label, and the glyph only hints at the host. */
const kindIcons: Record<AgentInfo['kind'], string> = {
	'ide-chat': 'comment-discussion',
	'claude-extension': 'claude',
	cli: 'terminal',
	editor: 'robot',
};

declare global {
	interface HTMLElementTagNameMap {
		'gl-agents-chip': GlAgentsChip;
	}
}

/**
 * Agents roster for the graph account rollup — a compact, read-only mirror of the Agents settings table
 * (`apps/settings/components/settings-agents.ts`): one row per detected agent, named in text, with MCP and
 * hooks state columns. Nothing inside is interactive; the wrapping anchor owned by
 * `gl-graph-account-indicator` is the single target for the whole region.
 */
@customElement('gl-agents-chip')
export class GlAgentsChip extends SignalWatcher(LitElement) {
	// No `subscribe: true` on either context, matching `gl-integrations-chip`: the provider objects are stable
	// references whose internal signals mutate in place, and `SignalWatcher` already re-renders on those.
	@consume({ context: agentsContext })
	private _agents!: AgentsState;

	@consume({ context: aiContext })
	private _ai!: AIContextState;

	static override styles = [
		boxSizingBase,
		css`
			:host {
				display: block;
			}

			.roster {
				display: grid;
				/* Name takes the slack; the two state columns are fixed-width cells (see .cell) so the
	   glyphs line up into readable columns across rows. */
				grid-template-columns: 1fr auto auto;
				row-gap: var(--gl-space-2);
				align-items: center;
			}

			.agent {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				/* Also the thing that makes the label's ellipsis possible: a 1fr track's automatic minimum
	   is min-content, which would push the row wider than the popover rather than clipping —
	   overflow: hidden here drops that minimum to zero. */
				overflow: hidden;
			}

			/* Recessed: the glyph is a hint at the agent's host, not its identity, so it must not compete
	  with the label beside it. */
			.agent__kind {
				flex: none;
				color: var(--color-foreground--50);
			}

			.agent__label {
				overflow: hidden;
				text-overflow: ellipsis;
				color: var(--color-foreground);
				white-space: nowrap;
			}

			/* Built on gl-badge's experimental recipe (tinted fill, hairline border at a higher alpha,
	  small caps) with the AI hue substituted. Kept local rather than added as a gl-badge appearance —
	  a new shared appearance is a wider change than one pill in one popover warrants.

	  flex: 0 0 auto so the label, not the pill, absorbs the squeeze: an elided "Defa…" would be a
	  worse loss than an elided agent name, which at least still ranks in the roster.

	  Asymmetric padding for the same reason the account chip's tier badge carries it: the text is
	  small caps with no descenders, so it sits on the box's floor and reads low against the agent
	  name beside it. The bottom padding buys back the room those descenders would have taken. */
			.agent__default {
				flex: 0 0 auto;
				padding: 0 var(--gl-space-6) var(--gl-space-2);
				font-size: var(--gl-font-micro);
				font-weight: 600;
				font-variant: all-small-caps;
				line-height: 1;
				/* Mixing toward the surface foreground rather than pinning a colour: one declaration then
	   stays legible against both a light and a dark editor background. */
				color: color-mix(in srgb, var(--gl-ai-accent-1) 58%, var(--color-foreground));
				letter-spacing: 0.06em;
				background-color: color-mix(in srgb, var(--gl-ai-accent-1) 16%, transparent);
				border: var(--gl-border-width) solid color-mix(in srgb, var(--gl-ai-accent-1) 45%, transparent);
				border-radius: var(--gl-radius-sm);
			}

			/* align-items is explicit rather than left to the grid sizing the cell to its glyph: the
	  default stretch would top-align the icon the moment anything gives the cell height, and the
	  settings table's equivalent status cell centres for the same reason. */
			.cell {
				display: flex;
				flex: none;
				align-items: center;
				justify-content: center;
				/* Wide enough to centre a 1.4rem glyph with real margin either side, so the columns read as
	   columns; also gives the cell a body rather than a glyph-shaped sliver. */
				width: 2.5rem;
			}

			.cell--installed {
				color: var(--color-foreground);
			}

			/* Installed but inert until the user does one more thing in the agent's own host — the same
	  editor-warning tone the settings table uses for this state. */
			.cell--warning {
				color: var(--vscode-editorWarning-foreground);
			}

			/* "Supported, not installed" — dim enough to read as an unlit affordance you could turn on. */
			.cell--uninstalled {
				color: var(--color-foreground--25);
			}

			/* Same tier as .cell--uninstalled, NOT weaker: the dash carries the "doesn't apply here"
	  distinction by SHAPE — a 1px rule against a 14px glyph — so it doesn't need a fainter colour too.
	  It first shipped at 15% of the foreground and measured invisible against the popover ground; a
	  1px-tall mark needs more contrast than a solid glyph to read at the same weight, not less. */
			.cell--absent {
				color: var(--color-foreground--25);
			}

			/* Measured correction, not a nudge-to-taste: in the codicon font search-sparkle's ink centre
	  sits 0.99px above its em-box centre (ink spans the box top but stops 1.97px short of the
	  baseline), while mcp's is dead centre. Both cells are box-centred to within 0.01px, so the two
	  columns still read a pixel out of step with each other — which is exactly what the headless grid
	  cannot afford, since "the columns line up" is what replaces the missing headings. Corrects the
	  glyph rather than the cell so the cell geometry stays honest. */
			.cell code-icon[icon='search-sparkle'] {
				transform: translateY(0.1rem);
			}

			/* HC themes flatten exactly the mid-tones this grid encodes state in. Measured live:
	  --color-foreground--25 lands at 2.0:1 on hc-dark and 1.7:1 on hc-light, under the 3:1 floor
	  WCAG 1.4.11 sets for a meaningful non-text mark. --vscode-disabledForeground is the
	  theme-supplied "unavailable" tone and measures 8.5:1 / 4.0:1 in those same two themes.
	  Both HC themes carry .vscode-high-contrast, so one selector covers them.

	  This is NOT a duplicate of the forced-colors block below: a VS Code HC *theme* does not
	  trigger forced-colors: active, so the two cases need separate handling. */
			:host-context(.vscode-high-contrast) .cell--uninstalled,
			:host-context(.vscode-high-contrast) .cell--absent {
				color: var(--vscode-disabledForeground);
			}

			/* The pill's tinted border measures 2.1:1 on hc-light. Keying on --vscode-contrastBorder is safe
	  here where it would be wrong for a state glyph: the word "Default" carries the meaning, so a
	  theme that sets the token to its own background hides an outline, not information. */
			:host-context(.vscode-high-contrast) .agent__default {
				border-color: var(--vscode-contrastBorder, currentColor);
			}

			.notes {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-2);
				margin-top: var(--gl-space-4);
				font-size: var(--gl-font-sm);
				color: var(--color-foreground--50);
			}

			/* Forced colours flattens every foreground to CanvasText, which would collapse three of the four
	  cell treatments into one another — "installed" and "not installed" are separated ONLY by dimness.
	  GrayText is the one system colour reserved for de-emphasised content, so it is what keeps the
	  distinction alive. .cell--absent also lands there, but keeps its dash glyph to stay distinct
	  from a dimmed column glyph. The warning tone has no system equivalent; that state carries a note
	  line in words, so it degrades to text rather than to an invisible tint.

	  The brand hue drops out here too, which would leave the default agent unmarked in the theme least
	  able to afford an unlabelled signal — repaint the pill with system colours. */
			@media (forced-colors: active) {
				.agent__default {
					color: CanvasText;
					background-color: transparent;
					border-color: CanvasText;
				}

				.cell--uninstalled,
				.cell--absent {
					color: GrayText;
				}

				.cell--installed,
				.cell--warning {
					color: CanvasText;
				}
			}
		`,
	];

	override render(): unknown {
		const agents = this._agents.agents.get();
		// Defensive only — the indicator gates both the unloaded and the empty roster before it renders us.
		if (agents == null) return nothing;

		const detected = agents.filter(a => a.detected !== false);
		if (!detected.length) return nothing;

		const defaultAgentId = this._ai.state.get().defaultAgent?.id;
		// Rendered in delivery order: `getAgents()` already sorts by kind (chat → extension → CLI → editor),
		// which is the same grouping the settings table shows. Floating the default to the top would make the
		// roster's shape change as the user picks one.
		return html`<div class="roster">${detected.map(a => this.renderAgentRow(a, defaultAgentId))}</div>
			${this.renderNotes(detected, defaultAgentId)}`;
	}

	private renderAgentRow(agent: AgentInfo, defaultAgentId: string | undefined): unknown {
		return html`<span class="agent"
				><code-icon class="agent__kind" icon=${kindIcons[agent.kind]} aria-hidden="true"></code-icon
				><span class="agent__label">${agent.label}</span
				>${agent.id === defaultAgentId ? html`<span class="agent__default">Default</span>` : nothing}</span
			>${this.renderStateCell(agent, 'mcp')}${this.renderStateCell(agent, 'hooks')}`;
	}

	private renderStateCell(agent: AgentInfo, column: StateColumn): unknown {
		const state = column === 'mcp' ? agent.mcp : agent.hooks;
		const label = columnLabels[column];
		// Read off `agent.hooks` rather than the narrowed `state` — only the hooks shape carries the field,
		// and this keeps "activation is a hooks-only concern" stated once instead of inferred from a cast.
		const manualActivation = column === 'hooks' ? agent.hooks?.manualActivation : undefined;

		if (state == null || !state.supported) {
			return this.renderCell('absent', 'dash', `${label} not available for ${agent.label}`);
		}

		if (state.installed) {
			return manualActivation != null
				? this.renderCell(
						'warning',
						columnIcons[column],
						`${label} installed for ${agent.label} — activation required`,
					)
				: this.renderCell('installed', columnIcons[column], `${label} installed for ${agent.label}`);
		}

		return this.renderCell('uninstalled', columnIcons[column], `${label} not installed for ${agent.label}`);
	}

	/** `role="img"` is load-bearing: `aria-label` only names elements whose role supports naming, so a bare
	 *  span carrying it would be announced as nothing at all. */
	private renderCell(treatment: CellTreatment, icon: string, label: string): unknown {
		return html`<span class="cell cell--${treatment}" role="img" aria-label=${label}
			><code-icon icon=${icon} aria-hidden="true"></code-icon
		></span>`;
	}

	/** Plain text, never links — the whole region is one target, so a nested anchor would fragment it. */
	private renderNotes(detected: AgentInfo[], defaultAgentId: string | undefined): unknown {
		const pending = detected.filter(a => a.hooks?.installed && a.hooks.manualActivation != null);
		if (defaultAgentId == null && !pending.length) return nothing;

		return html`<div class="notes">
			${defaultAgentId == null ? html`<span>No default agent chosen</span>` : nothing}
			${
				pending.length
					? html`<span
							>${
								pending.length === 1
									? `${pending[0].label} needs one more step to activate hooks`
									: `${pending.length} agents need one more step to activate hooks`
							}</span
						>`
					: nothing
			}
		</div>`;
	}
}
