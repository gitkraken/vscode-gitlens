import './graph.scss';
import { ContextProvider } from '@lit/context';
import { html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { Color } from '@gitlens/utils/color.js';
import type { GraphServices } from '../../../plus/graph/graphService.js';
import type { State } from '../../../plus/graph/protocol.js';
import { GlAppHost } from '../../shared/appHost.js';
import type { HostIpc } from '../../shared/ipc.js';
import { RpcController } from '../../shared/rpc/rpcController.js';
import type { ThemeChangeEvent } from '../../shared/theme.js';
import { graphServicesContext } from './context.js';
import type { GraphApp } from './graph-app.js';
import { sidebarActionsContext } from './sidebar/sidebarContext.js';
import { createSidebarActions } from './sidebar/sidebarState.js';
import { GraphStateProvider } from './stateProvider.js';
import './graph-app.js';

@customElement('gl-graph-apphost')
export class GraphAppHost extends GlAppHost<State, GraphStateProvider> {
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	private _sidebarActions = createSidebarActions();

	// Create the context provider eagerly so child components can consume it
	// during their connectedCallback. The actions object exists immediately;
	// initialize() later populates it with the RPC service, and signal
	// updates inside the actions drive reactivity in consumers.
	private _sidebarActionsProvider = new ContextProvider(this, {
		context: sidebarActionsContext,
		initialValue: this._sidebarActions,
	});

	private _servicesProvider = new ContextProvider(this, {
		context: graphServicesContext,
		initialValue: undefined,
	});

	private _rpc = new RpcController<GraphServices>(this, {
		onReady: services => this._onRpcReady(services),
	});

	private async _onRpcReady(services: import('@eamodio/supertalk').Remote<GraphServices>): Promise<void> {
		this._servicesProvider.setValue(services);

		const sidebar = await services.sidebar;
		this._sidebarActions.initialize(sidebar);
	}

	@query('gl-graph-app')
	private appElement!: GraphApp;

	private _initialRowsLoaded = false;

	@state()
	searching: string = '';

	get hasFilters() {
		if (this.state.config?.onlyFollowFirstParent) return true;
		if (this.state.excludeTypes == null) return false;

		return Object.values(this.state.excludeTypes).includes(true);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._sidebarActions.dispose();
	}

	override render() {
		return html`<gl-graph-app></gl-graph-app>`;
	}

	protected override createStateProvider(bootstrap: string, ipc: HostIpc): GraphStateProvider {
		return new GraphStateProvider(this, bootstrap, ipc, this._logger, {
			onStateUpdate: partial => {
				if ('rows' in partial) {
					this.appElement.resetHover();

					// Focus the graph after initial rows are loaded
					if (!this._initialRowsLoaded && partial.rows?.length) {
						this._initialRowsLoaded = true;
						requestAnimationFrame(() => this.appElement?.graph?.focus());
					}
				}
			},
		});
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
	}

	protected override onWebviewVisibilityChanged(visible: boolean): void {
		this.appElement?.onWebviewVisibilityChanged(visible);
	}
}
