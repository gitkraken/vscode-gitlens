/*global document window*/
import type { CssVariables } from '@gitkraken/gitkraken-components';
import { provide } from '@lit/context';
import { html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { Color, getCssVariable, mix, opacity } from '../../../../system/color';
import type { State } from '../../../plus/graph/protocol';
import type { StateProvider } from '../../shared/app';
import { GlApp } from '../../shared/app';
import type { HostIpc } from '../../shared/ipc';
import type { ThemeChangeEvent } from '../../shared/theme';
import type { GraphAppWC } from './graph-app';
import { GraphAppState, graphStateContext, GraphStateProvider } from './stateProvider';
import './graph-app';
import './graph.scss';

const graphLaneThemeColors = new Map([
	['--vscode-gitlens-graphLane1Color', '#15a0bf'],
	['--vscode-gitlens-graphLane2Color', '#0669f7'],
	['--vscode-gitlens-graphLane3Color', '#8e00c2'],
	['--vscode-gitlens-graphLane4Color', '#c517b6'],
	['--vscode-gitlens-graphLane5Color', '#d90171'],
	['--vscode-gitlens-graphLane6Color', '#cd0101'],
	['--vscode-gitlens-graphLane7Color', '#f25d2e'],
	['--vscode-gitlens-graphLane8Color', '#f2ca33'],
	['--vscode-gitlens-graphLane9Color', '#7bd938'],
	['--vscode-gitlens-graphLane10Color', '#2ece9d'],
]);

@customElement('gl-graph-app')
export class GraphApp extends GlApp<State> {
	@state()
	searching: string = '';
	searchResultsHidden: unknown;
	get hasFilters() {
		if (this.state.config?.onlyFollowFirstParent) return true;
		if (this.state.excludeTypes == null) return false;

		return Object.values(this.state.excludeTypes).includes(true);
	}
	private applyTheme(theme: { cssVariables: CssVariables; themeOpacityFactor: number }) {
		this._graphState.theming = theme;
	}

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@provide({ context: graphStateContext })
	private readonly _graphState: typeof graphStateContext.__context__ = new GraphAppState();

	protected override createStateProvider(state: State, ipc: HostIpc): StateProvider<State> {
		return new GraphStateProvider(this, state, ipc, this._logger, {
			onStateUpdate: partial => {
				if ('loading' in partial) {
					this._graphState.loading = partial.loading ?? false;
				}
				if ('rows' in partial) {
					this.appElement.resetHover();
				}
				if ('selectedRows' in partial) {
					this._graphState.selectedRows = partial.selectedRows;
				}
				if ('searchResults' in partial) {
					this._graphState.searchResultsResponse = partial.searchResults;
				}
			},
		});
	}

	private getGraphTheming(): { cssVariables: CssVariables; themeOpacityFactor: number } {
		// this will be called on theme updated as well as on config updated since it is dependent on the column colors from config changes and the background color from the theme
		const computedStyle = window.getComputedStyle(document.documentElement);
		const bgColor = getCssVariable('--color-background', computedStyle);

		const mixedGraphColors: CssVariables = {};

		let i = 0;
		let color;
		for (const [colorVar, colorDefault] of graphLaneThemeColors) {
			color = getCssVariable(colorVar, computedStyle) || colorDefault;

			mixedGraphColors[`--column-${i}-color`] = color;

			mixedGraphColors[`--graph-color-${i}`] = color;
			for (const mixInt of [15, 25, 45, 50]) {
				mixedGraphColors[`--graph-color-${i}-bg${mixInt}`] = mix(bgColor, color, mixInt);
			}
			for (const mixInt of [10, 50]) {
				mixedGraphColors[`--graph-color-${i}-f${mixInt}`] = opacity(color, mixInt);
			}

			i++;
		}

		const isHighContrastTheme =
			document.body.classList.contains('vscode-high-contrast') ||
			document.body.classList.contains('vscode-high-contrast-light');

		return {
			cssVariables: {
				'--app__bg0': bgColor,
				'--panel__bg0': getCssVariable('--color-graph-background', computedStyle),
				'--panel__bg1': getCssVariable('--color-graph-background2', computedStyle),
				'--section-border': getCssVariable('--color-graph-background2', computedStyle),

				'--selected-row': getCssVariable('--color-graph-selected-row', computedStyle),
				'--selected-row-border': isHighContrastTheme
					? `1px solid ${getCssVariable('--color-graph-contrast-border', computedStyle)}`
					: 'none',
				'--hover-row': getCssVariable('--color-graph-hover-row', computedStyle),
				'--hover-row-border': isHighContrastTheme
					? `1px dashed ${getCssVariable('--color-graph-contrast-border', computedStyle)}`
					: 'none',

				'--scrollable-scrollbar-thickness': getCssVariable('--graph-column-scrollbar-thickness', computedStyle),
				'--scroll-thumb-bg': getCssVariable('--vscode-scrollbarSlider-background', computedStyle),

				'--scroll-marker-head-color': getCssVariable('--color-graph-scroll-marker-head', computedStyle),
				'--scroll-marker-upstream-color': getCssVariable('--color-graph-scroll-marker-upstream', computedStyle),
				'--scroll-marker-highlights-color': getCssVariable(
					'--color-graph-scroll-marker-highlights',
					computedStyle,
				),
				'--scroll-marker-local-branches-color': getCssVariable(
					'--color-graph-scroll-marker-local-branches',
					computedStyle,
				),
				'--scroll-marker-remote-branches-color': getCssVariable(
					'--color-graph-scroll-marker-remote-branches',
					computedStyle,
				),
				'--scroll-marker-stashes-color': getCssVariable('--color-graph-scroll-marker-stashes', computedStyle),
				'--scroll-marker-tags-color': getCssVariable('--color-graph-scroll-marker-tags', computedStyle),
				'--scroll-marker-selection-color': getCssVariable(
					'--color-graph-scroll-marker-selection',
					computedStyle,
				),
				'--scroll-marker-pull-requests-color': getCssVariable(
					'--color-graph-scroll-marker-pull-requests',
					computedStyle,
				),

				'--stats-added-color': getCssVariable('--color-graph-stats-added', computedStyle),
				'--stats-deleted-color': getCssVariable('--color-graph-stats-deleted', computedStyle),
				'--stats-files-color': getCssVariable('--color-graph-stats-files', computedStyle),
				'--stats-bar-border-radius': getCssVariable('--graph-stats-bar-border-radius', computedStyle),
				'--stats-bar-height': getCssVariable('--graph-stats-bar-height', computedStyle),

				'--text-selected': getCssVariable('--color-graph-text-selected', computedStyle),
				'--text-selected-row': getCssVariable('--color-graph-text-selected-row', computedStyle),
				'--text-hovered': getCssVariable('--color-graph-text-hovered', computedStyle),
				'--text-dimmed-selected': getCssVariable('--color-graph-text-dimmed-selected', computedStyle),
				'--text-dimmed': getCssVariable('--color-graph-text-dimmed', computedStyle),
				'--text-normal': getCssVariable('--color-graph-text-normal', computedStyle),
				'--text-secondary': getCssVariable('--color-graph-text-secondary', computedStyle),
				'--text-disabled': getCssVariable('--color-graph-text-disabled', computedStyle),

				'--text-accent': getCssVariable('--color-link-foreground', computedStyle),
				'--text-inverse': getCssVariable('--vscode-input-background', computedStyle),
				'--text-bright': getCssVariable('--vscode-input-background', computedStyle),
				...mixedGraphColors,
			},
			themeOpacityFactor: parseInt(getCssVariable('--graph-theme-opacity-factor', computedStyle)) || 1,
		};
	}

	protected override onThemeUpdated(e: ThemeChangeEvent) {
		const rootStyle = document.documentElement.style;

		const backgroundColor = Color.from(e.colors.background);
		const foregroundColor = Color.from(e.colors.foreground);

		const backgroundLuminance = backgroundColor.getRelativeLuminance();
		const foregroundLuminance = foregroundColor.getRelativeLuminance();

		const themeLuminance = (luminance: number) => {
			let min;
			let max;
			if (foregroundLuminance > backgroundLuminance) {
				max = foregroundLuminance;
				min = backgroundLuminance;
			} else {
				min = foregroundLuminance;
				max = backgroundLuminance;
			}
			const percent = luminance / 1;
			return percent * (max - min) + min;
		};

		// minimap and scroll markers

		let c = Color.fromCssVariable('--vscode-scrollbarSlider-background', e.computedStyle);
		rootStyle.setProperty(
			'--color-graph-minimap-visibleAreaBackground',
			c.luminance(themeLuminance(e.isLightTheme ? 0.6 : 0.1)).toString(),
		);

		if (!e.isLightTheme) {
			c = Color.fromCssVariable('--color-graph-scroll-marker-local-branches', e.computedStyle);
			rootStyle.setProperty(
				'--color-graph-minimap-tip-branchBackground',
				c.luminance(themeLuminance(0.55)).toString(),
			);

			c = Color.fromCssVariable('--color-graph-scroll-marker-local-branches', e.computedStyle);
			rootStyle.setProperty(
				'--color-graph-minimap-tip-branchBorder',
				c.luminance(themeLuminance(0.55)).toString(),
			);

			c = Color.fromCssVariable('--vscode-editor-foreground', e.computedStyle);
			const tipForeground = c.isLighter() ? c.luminance(0.01).toString() : c.luminance(0.99).toString();
			rootStyle.setProperty('--color-graph-minimap-tip-headForeground', tipForeground);
			rootStyle.setProperty('--color-graph-minimap-tip-upstreamForeground', tipForeground);
			rootStyle.setProperty('--color-graph-minimap-tip-highlightForeground', tipForeground);
			rootStyle.setProperty('--color-graph-minimap-tip-branchForeground', tipForeground);
		}

		const branchStatusLuminance = themeLuminance(e.isLightTheme ? 0.72 : 0.064);
		const branchStatusHoverLuminance = themeLuminance(e.isLightTheme ? 0.64 : 0.076);
		const branchStatusPillLuminance = themeLuminance(e.isLightTheme ? 0.92 : 0.02);
		// branch status ahead
		c = Color.fromCssVariable('--branch-status-ahead-foreground', e.computedStyle);
		rootStyle.setProperty('--branch-status-ahead-background', c.luminance(branchStatusLuminance).toString());
		rootStyle.setProperty(
			'--branch-status-ahead-hover-background',
			c.luminance(branchStatusHoverLuminance).toString(),
		);
		rootStyle.setProperty(
			'--branch-status-ahead-pill-background',
			c.luminance(branchStatusPillLuminance).toString(),
		);

		// branch status behind
		c = Color.fromCssVariable('--branch-status-behind-foreground', e.computedStyle);
		rootStyle.setProperty('--branch-status-behind-background', c.luminance(branchStatusLuminance).toString());
		rootStyle.setProperty(
			'--branch-status-behind-hover-background',
			c.luminance(branchStatusHoverLuminance).toString(),
		);
		rootStyle.setProperty(
			'--branch-status-behind-pill-background',
			c.luminance(branchStatusPillLuminance).toString(),
		);

		// branch status both
		c = Color.fromCssVariable('--branch-status-both-foreground', e.computedStyle);
		rootStyle.setProperty('--branch-status-both-background', c.luminance(branchStatusLuminance).toString());
		rootStyle.setProperty(
			'--branch-status-both-hover-background',
			c.luminance(branchStatusHoverLuminance).toString(),
		);
		rootStyle.setProperty(
			'--branch-status-both-pill-background',
			c.luminance(branchStatusPillLuminance).toString(),
		);

		const th = this.getGraphTheming();
		Object.entries(th.cssVariables).forEach(([property, value]) => {
			rootStyle.setProperty(property, value.toString());
		});
		this.applyTheme(th);
	}

	@query('gl-graph-app-wc')
	private appElement!: GraphAppWC;

	override render() {
		return html`<gl-graph-app-wc></gl-graph-app-wc>`;
	}
}
