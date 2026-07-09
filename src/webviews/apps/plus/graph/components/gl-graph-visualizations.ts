import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { VisualizationMode } from '../../../../plus/graph/protocol.js';
import { graphStateContext } from '../context.js';
import { getEffectiveVisualizationKey } from './visualizations.utils.js';
import './gl-graph-timeline.js';
import './gl-graph-treemap.js';

// Re-exported so existing graph-app event-detail imports keep working without a new import path.
export type { GraphVisualizationModeChangeDetail } from './gl-graph-visualizations-switcher.js';

/**
 * Visualizations container for the Graph webview. Pure passthrough router that mounts either
 * `<gl-graph-timeline>` or `<gl-graph-treemap>` based on `graphState.visualizationMode`. The
 * visualization-switcher control is embedded inside each child's own header — see
 * `<gl-graph-visualizations-switcher>` — so this wrapper carries no chrome of its own.
 */
@customElement('gl-graph-visualizations')
export class GlGraphVisualizations extends SignalWatcher(LitElement) {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			width: 100%;
			height: 100%;
			min-height: 0;
		}

		:host > * {
			flex: 1 1 auto;
			min-height: 0;
		}
	`;

	@property({ type: String, reflect: true })
	placement: 'editor' | 'view' = 'editor';

	/** Externally-pushed file/folder scope, forwarded to `<gl-graph-timeline>`. Only meaningful in
	 *  timeline mode — the treemap doesn't consume scope. The timeline emits
	 *  `gl-graph-timeline-scope-applied` (composed) which bubbles up to graph-app for one-shot reset. */
	@property({ attribute: false })
	scope?: { type: 'file' | 'folder'; relativePath: string };

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	private get mode(): VisualizationMode {
		// Route through the shared resolver so this render decision, the switcher's active tab, and
		// the `graph/visualizations/closed` telemetry all gate identically: when the experimental
		// flag is off it force-routes to the timeline regardless of persisted `visualizationMode`
		// (the stored value is left untouched so re-enabling restores the user's prior choice).
		return getEffectiveVisualizationKey(
			this.graphState.visualizationMode,
			this.graphState.treemapMode,
			this.graphState.config?.experimentalVisualizationsEnabled === true,
		) === 'timeline'
			? 'timeline'
			: 'treemap';
	}

	override render(): unknown {
		return this.mode === 'treemap'
			? html`<gl-graph-treemap></gl-graph-treemap>`
			: html`<gl-graph-timeline placement=${this.placement} .scope=${this.scope}></gl-graph-timeline>`;
	}
}
