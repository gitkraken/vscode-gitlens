import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import '@shoelace-style/shoelace/dist/components/option/option.component.js';
import '@shoelace-style/shoelace/dist/components/select/select.component.js';
import { html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { GlCommand } from '../../../../constants.commands';
import { createWebviewCommandLink } from '../../../../system/webview';
import '../../shared/components/branch-icon';
import '../../shared/components/button';
import '../../shared/components/code-icon';
import type { CustomEventType } from '../../shared/components/element';
import '../../shared/components/feature-badge';
import '../../shared/components/feature-gate';
import '../../shared/components/menu';
import '../../shared/components/overlays/popover';
import '../../shared/components/overlays/tooltip';
import '../../shared/components/rich/issue-pull-request';
import { emitTelemetrySentEvent } from '../../shared/telemetry';
import '../shared/components/merge-rebase-status';
import './actions/gitActionsButtons.wc';
import { stateContext } from './context';
import './graph-header';
import type { GLGraphWrapper } from './graph-wrapper/graph-wrapper';
import './graph.scss';
import type { GlGraphHover } from './hover/graphHover';
import type { GraphMinimapDaySelectedEventDetail } from './minimap/minimap';
import type { GlGraphMinimapContainer } from './minimap/minimap-container';
import './sidebar/sidebar';
import { graphStateContext } from './stateProvider';

@customElement('gl-graph-app-wc')
export class GraphAppWC extends SignalWatcher(LitElement) {
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: stateContext, subscribe: true })
	state!: typeof stateContext.__context__;

	@consume({ context: graphStateContext, subscribe: true })
	graphApp!: typeof graphStateContext.__context__;

	@query('gl-graph-minimap-container')
	minimapEl!: GlGraphMinimapContainer;

	@query('gl-graph-wrapper')
	graphEl!: GLGraphWrapper;

	@query('gl-graph-wrapper')
	graphWrapper!: GLGraphWrapper;

	private handleHeaderSearchNavigation(e: CustomEventType<'gl-select-commits'>) {
		this.graphWrapper.selectCommits([e.detail], false, true);
	}

	private handleMinimapDaySelected(e: CustomEvent<GraphMinimapDaySelectedEventDetail>) {
		if (!this.state.rows) {
			return;
		}
		let { sha } = e.detail;
		if (sha == null) {
			const date = e.detail.date?.getTime();
			if (date == null) return;

			// Find closest row to the date
			const closest = this.state.rows.reduce((prev, curr) =>
				Math.abs(curr.date - date) < Math.abs(prev.date - date) ? curr : prev,
			);
			sha = closest.sha;
		}

		this.graphEl.selectCommits([sha], false, true);

		queueMicrotask(
			() =>
				e.target &&
				emitTelemetrySentEvent<'graph/minimap/day/selected'>(e.target, {
					name: 'graph/minimap/day/selected',
					data: {},
				}),
		);
	}

	private handleGraphVisibleDaysChanged(e: CustomEventType<'gl-graph-change-visible-days'>) {
		this.graphApp.visibleDays = e.detail;
	}

	private handleGraphRowHovered(e: CustomEventType<'gl-graph-hovered-row'>) {
		this.minimapEl.select(e.detail.graphRow.date, true);
	}

	private handleGraphMouseLeaved() {
		this.minimapEl.unselect(undefined, true);
	}

	resetHover() {
		this.hoverElement.reset();
	}

	@query('gl-graph-hover')
	private readonly hoverElement!: GlGraphHover;

	override render() {
		return html`<gl-graph-header @gl-select-commits=${this.handleHeaderSearchNavigation}></gl-graph-header
			><gl-graph-minimap-container
				.activeDay=${this.graphApp.activeDay}
				.disabled=${!this.state.config?.minimap}
				.rows=${this.state.rows ?? []}
				.rowsStats=${this.state.rowsStats}
				.dataType=${this.state.config?.minimapDataType ?? 'commits'}
				.markerTypes=${this.state.config?.minimapMarkerTypes ?? []}
				.refMetadata=${this.state.refsMetadata}
				.searchResults=${this.graphApp.searchResults}
				@gl-graph-minimap-selected=${this.handleMinimapDaySelected}
				.visibleDays=${this.graphApp.visibleDays && {
					top: this.graphApp.visibleDays.top,
					bottom: this.graphApp.visibleDays.bottom,
				}}
			></gl-graph-minimap-container>
			<gl-graph-hover id="commit-hover" distance=${0} skidding=${15}></gl-graph-hover>
			<gl-feature-gate
				class="graph-app__gate"
				.featurePreview=${this.state.featurePreview}
				featurePreviewCommandLink=${ifDefined(
					this.state.featurePreview
						? createWebviewCommandLink(
								GlCommand.PlusContinueFeaturePreview,
								this.state.webviewId,
								this.state.webviewInstanceId,
								{ feature: this.state.featurePreview.feature },
						  )
						: undefined,
				)}
				appearance="alert"
				featureWithArticleIfNeeded="the Commit Graph"
				.source=${{ source: 'graph', detail: 'gate' } as const}
				.state=${this.state.subscription?.state}
				.webroot=${this.state.webroot}
				?visible=${!this.state.allowed}
			>
				<p slot="feature">
					<a href="https://help.gitkraken.com/gitlens/gitlens-features/#commit-graph-pro">Commit Graph</a>
					<gl-feature-badge
						.source=${{ source: 'graph', detail: 'badge' } as const}
						subscription="{subscription}"
					></gl-feature-badge>
					&mdash; easily visualize your repository and keep track of all work in progress. Use the rich commit
					search to find a specific commit, message, author, a changed file or files, or even a specific code
					change.
				</p>
			</gl-feature-gate>
			<main id="main" class="graph-app__main">
				<gl-graph-sidebar></gl-graph-sidebar
				><gl-graph-wrapper
					@gl-graph-change-visible-days=${this.handleGraphVisibleDaysChanged}
					@gl-graph-hovered-row=${this.handleGraphRowHovered}
					@gl-graph-mouse-leave=${this.handleGraphMouseLeaved}
				></gl-graph-wrapper>
			</main>`;
	}
}

new GraphAppWC();
