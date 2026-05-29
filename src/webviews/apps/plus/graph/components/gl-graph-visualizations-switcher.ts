import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { VisualizationMode } from '../../../../plus/graph/protocol.js';
import type { TreemapMode } from '../../../../plus/treemap/protocol.js';
import { graphStateContext } from '../context.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/tooltip.js';

/** Flat enumeration of the visualizations the switcher offers. Each entry collapses the two-axis
 *  (mode × treemapMode) state into a single key, so the UI is one tablist instead of two nested
 *  toggles. Add a new visualization by extending this map; the rest of the component derives icon,
 *  tooltip, and dispatch from the entry. */
type VisualizationKey = 'timeline' | 'treemap-files' | 'treemap-commits' | 'treemap-activity';

interface VisualizationConfig {
	mode: VisualizationMode;
	treemapMode?: TreemapMode;
	icon: string;
	label: string;
}

const visualizationConfigs: Record<VisualizationKey, VisualizationConfig> = {
	timeline: { mode: 'timeline', icon: 'graph-scatter', label: 'Visual History' },
	'treemap-files': { mode: 'treemap', treemapMode: 'files', icon: 'folder', label: 'Files Treemap' },
	'treemap-commits': { mode: 'treemap', treemapMode: 'commits', icon: 'git-commit', label: 'Commits Treemap' },
	'treemap-activity': { mode: 'treemap', treemapMode: 'activity', icon: 'robot', label: 'Agent Activity Treemap' },
};

const visualizationOrder: readonly VisualizationKey[] = [
	'timeline',
	'treemap-files',
	'treemap-commits',
	'treemap-activity',
];

export interface GraphVisualizationModeChangeDetail {
	mode: VisualizationMode;
}

export interface GraphTreemapModeChangeDetail {
	mode: TreemapMode;
}

/**
 * Compact icon-button group for switching between Visual History (timeline) and the three treemap
 * modes. Embedded directly into each visualization's header — the wrapping `gl-graph-visualizations`
 * routes the active mode; this component is the user-visible control.
 *
 * Clicking an entry dispatches `gl-graph-visualization-mode-change` and (when applicable)
 * `gl-graph-treemap-mode-change` so graph-app's existing per-axis handlers continue to own
 * persistence — the switcher is purely presentational.
 */
@customElement('gl-graph-visualizations-switcher')
export class GlGraphVisualizationsSwitcher extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
			gap: 0.2rem;
			padding: 0.2rem;
			border-radius: 0.4rem;
			background: var(--vscode-editorWidget-background, transparent);
		}

		.visualization-tablist {
			display: contents;
		}

		.visualization-button {
			appearance: none;
			background: none;
			border: 1px solid transparent;
			border-radius: 0.3rem;
			padding: 0.4rem 0.6rem;
			cursor: pointer;
			font: inherit;
			color: var(--vscode-descriptionForeground);
			display: inline-flex;
			align-items: center;
			justify-content: center;
			--code-icon-size: 1.6rem;
		}

		.visualization-button:hover:not(:disabled) {
			color: var(--vscode-foreground);
			background: var(--vscode-toolbar-hoverBackground);
		}

		.visualization-button[aria-pressed='true'] {
			color: var(--vscode-button-foreground, var(--vscode-foreground));
			background: var(--vscode-button-background);
			border-color: var(--vscode-button-background);
		}

		.visualization-button[aria-pressed='true']:hover {
			background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
		}

		.visualization-button:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 1px;
		}

		.visualization-button:disabled {
			opacity: 0.45;
			cursor: not-allowed;
		}
	`;

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	private get mode(): VisualizationMode {
		return this.graphState.visualizationMode ?? 'timeline';
	}

	private get treemapMode(): TreemapMode {
		return this.graphState.treemapMode ?? 'files';
	}

	private get commitsUnavailable(): boolean {
		const repoId = this.graphState.selectedRepository;
		const repos = this.graphState.repositories;
		const repo = repoId != null ? (repos?.find(r => r.id === repoId) ?? repos?.[0]) : repos?.[0];
		return repo?.virtual === true;
	}

	/** Map current `(mode, treemapMode)` state to the active switcher key. Treemap defaults to
	 *  `files` when no mode is set so the switcher always has exactly one pressed button. */
	private get activeKey(): VisualizationKey {
		if (this.mode === 'timeline') return 'timeline';
		return `treemap-${this.treemapMode}`;
	}

	private select(key: VisualizationKey): void {
		const config = visualizationConfigs[key];
		if (this.mode !== config.mode) {
			this.dispatchEvent(
				new CustomEvent<GraphVisualizationModeChangeDetail>('gl-graph-visualization-mode-change', {
					detail: { mode: config.mode },
					bubbles: true,
					composed: true,
				}),
			);
		}
		if (config.treemapMode != null && this.treemapMode !== config.treemapMode) {
			this.dispatchEvent(
				new CustomEvent<GraphTreemapModeChangeDetail>('gl-graph-treemap-mode-change', {
					detail: { mode: config.treemapMode },
					bubbles: true,
					composed: true,
				}),
			);
		}
	}

	private renderButton(
		key: VisualizationKey,
		active: VisualizationKey,
		disabled: boolean,
		disabledMessage: string | undefined,
	) {
		const config = visualizationConfigs[key];
		const selected = key === active;
		const tooltipContent = disabled ? (disabledMessage ?? config.label) : config.label;
		return html`<gl-tooltip placement="bottom" content=${tooltipContent} distance="6">
			<button
				class="visualization-button"
				role="tab"
				aria-pressed=${selected ? 'true' : 'false'}
				aria-label=${config.label}
				?disabled=${disabled}
				tabindex=${selected ? '0' : '-1'}
				@click=${() => this.select(key)}
			>
				<code-icon icon=${config.icon}></code-icon>
			</button>
		</gl-tooltip>`;
	}

	override render(): unknown {
		// Gate the entire switcher behind the experimental Visualizations flag — when disabled,
		// only the Visual History (timeline) is offered to the user, so showing the multi-tab
		// switcher would just dangle dead options.
		if (this.graphState.config?.experimentalVisualizationsEnabled !== true) return nothing;

		const active = this.activeKey;
		const commitsUnavailable = this.commitsUnavailable;

		return html`<div role="tablist" aria-label="Visualization" class="visualization-tablist">
			${visualizationOrder.map(key => {
				const disabled = key === 'treemap-commits' && commitsUnavailable;
				const disabledMessage = disabled ? 'Commit history is unavailable for virtual repositories' : undefined;
				return this.renderButton(key, active, disabled, disabledMessage);
			})}
		</div>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-visualizations-switcher': GlGraphVisualizationsSwitcher;
	}

	interface GlobalEventHandlersEventMap {
		'gl-graph-visualization-mode-change': CustomEvent<GraphVisualizationModeChangeDetail>;
		'gl-graph-treemap-mode-change': CustomEvent<GraphTreemapModeChangeDetail>;
	}
}
