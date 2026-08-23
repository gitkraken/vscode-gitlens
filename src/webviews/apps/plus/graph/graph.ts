import './graph.scss';
import { ContextProvider } from '@lit/context';
import { html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { Color } from '@gitlens/utils/color.js';
import type { GraphServices } from '../../../plus/graph/graphService.js';
import type {
	DidFailRevealParams,
	DidRequestOpenCompareModeParams,
	DidRequestOpenTimelineScopeParams,
	DidRequestSearchParams,
	State,
} from '../../../plus/graph/protocol.js';
import type { AgentInfo } from '../../../rpc/services/types.js';
import { sortAgentSessions } from '../../shared/agentUtils.js';
import { GlAppHost } from '../../shared/appHost.js';
import { createOnboardingDismissals, onboardingDismissalsContext } from '../../shared/contexts/onboardingDismissals.js';
import type { HostIpc } from '../../shared/ipc.js';
import { RpcController } from '../../shared/rpc/rpcController.js';
import type { ThemeChangeEvent } from '../../shared/theme.js';
import { coachMarkSeenContext, createCoachMarkSeenStore } from './coachMarkSeen.js';
import { graphServicesContext } from './context.js';
import type { GraphApp } from './graph-app.js';
import { applyGraphThemeVariables } from './graph-wrapper/graph-theme-bridge.js';
import { createSearchActions } from './search/searchActions.js';
import { searchActionsContext } from './search/searchContext.js';
import { sidebarActionsContext } from './sidebar/sidebarContext.js';
import { createSidebarActions } from './sidebar/sidebarState.js';
import { GraphStateProvider } from './stateProvider.js';
import './graph-app.js';

/** Derives the hooks-install capability from the shared agent list — CLI rows only, stripped of the
 *  `cli:` id prefix the settings table dispatch expects but the graph consumers never carried. */
function computeHooksAgents(infos: readonly AgentInfo[]): { id: string; displayName: string; installed: boolean }[] {
	const result: { id: string; displayName: string; installed: boolean }[] = [];
	for (const a of infos) {
		if (a.kind !== 'cli' || a.detected !== true || a.hooks?.supported !== true) continue;

		result.push({ id: a.id.replace(/^cli:/, ''), displayName: a.label, installed: a.hooks.installed });
	}
	return result;
}

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

	private _searchActions = createSearchActions();

	// Same eager-provider pattern as `_sidebarActionsProvider` above.
	private _searchActionsProvider = new ContextProvider(this, {
		context: searchActionsContext,
		initialValue: this._searchActions,
	});

	/** Unsubscribes the current `onDidRequestSearch` listener — reconnect-safe teardown, same pattern as
	 *  `_sidebarActions.initialize()`'s own subscriptions. */
	private _unsubscribeRequestSearch: (() => void) | undefined;
	/** The search remote `_unsubscribeRequestSearch` currently belongs to — lets a superseding
	 *  `_onRpcReady` (reconnect) detect and discard a subscribe that resolves after it's moved on. */
	private _activeSearchRemote: unknown;

	/** Unsubscribes the current `onSessionsChanged`/`onAgentsChanged` listeners — reconnect-safe
	 *  teardown, same pattern as `_unsubscribeRequestSearch`. */
	private _unsubscribeAgentSessions: (() => void) | undefined;
	private _unsubscribeAgentsInfo: (() => void) | undefined;
	/** The `agents` remote the two unsubs above currently belong to — same staleness-guard pattern
	 *  as `_activeSearchRemote`. */
	private _activeAgentsRemote: unknown;

	/** Unsubscribes the current onboarding `onDidChange` listener feeding the agents-banner state. */
	private _unsubscribeAgentsBanner: (() => void) | undefined;
	/** The onboarding remote `_unsubscribeAgentsBanner` currently belongs to. */
	private _activeOnboardingRemote: unknown;

	private readonly _onboardingDismissals = createOnboardingDismissals();

	// Eager provider (like _sidebarActionsProvider): consumers can read during connectedCallback;
	// connect() later wires the RPC remote and signal updates drive their reactivity.
	private _onboardingDismissalsProvider = new ContextProvider(this, {
		context: onboardingDismissalsContext,
		initialValue: this._onboardingDismissals,
	});

	private readonly _coachMarkSeen = createCoachMarkSeenStore();

	// Same eager-provider pattern as the dismissals above; wired to the remote in `_onRpcReady`.
	private _coachMarkSeenProvider = new ContextProvider(this, {
		context: coachMarkSeenContext,
		initialValue: this._coachMarkSeen,
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

		this._onboardingDismissals.connect(services.onboarding);
		this._coachMarkSeen.connect(services.onboarding);

		const sidebar = await services.sidebar;
		this._sidebarActions.initialize(sidebar);

		const search = await services.search;
		this._searchActions.initialize(search, this._stateProvider);

		// Tear down the previous listener first — reconnect-safe, same pattern as `_sidebarActions.initialize()`.
		this._unsubscribeRequestSearch?.();
		this._unsubscribeRequestSearch = undefined;
		this._activeSearchRemote = search;

		const unsub = (await search.onDidRequestSearch(params => {
			this.dispatchEvent(new CustomEvent('gl-graph-request-search', { detail: params, bubbles: true }));
		})) as unknown as (() => void) | undefined;
		if (typeof unsub !== 'function') return;

		if (this._activeSearchRemote !== search) {
			unsub();
			return;
		}

		this._unsubscribeRequestSearch = unsub;

		// Tear down the previous agent-plane listeners first — reconnect-safe, same pattern as above.
		this._unsubscribeAgentSessions?.();
		this._unsubscribeAgentSessions = undefined;
		this._unsubscribeAgentsInfo?.();
		this._unsubscribeAgentsInfo = undefined;

		const agents = await services.agents;
		this._activeAgentsRemote = agents;

		// Subscribe before fetching so no snapshot fired between subscribe and fetch is ever lost.
		const unsubSessions = (await agents.onSessionsChanged(sessions => {
			this._stateProvider.agentSessions = sortAgentSessions(sessions);
		})) as unknown as (() => void) | undefined;
		if (typeof unsubSessions !== 'function') return;

		if (this._activeAgentsRemote !== agents) {
			unsubSessions();
			return;
		}

		this._unsubscribeAgentSessions = unsubSessions;

		const sessions = await agents.getSessions();
		if (this._activeAgentsRemote !== agents) return;

		this._stateProvider.agentSessions = sortAgentSessions(sessions);

		const unsubAgentsInfo = (await agents.onAgentsChanged(infos => {
			this.applyAgentsInfo(infos);
		})) as unknown as (() => void) | undefined;
		if (typeof unsubAgentsInfo !== 'function') return;

		if (this._activeAgentsRemote !== agents) {
			unsubAgentsInfo();
			return;
		}

		this._unsubscribeAgentsInfo = unsubAgentsInfo;

		const infos = await agents.getAgents();
		if (this._activeAgentsRemote !== agents) return;

		this.applyAgentsInfo(infos);

		// Agents-banner: bridge the onboarding RPC service's per-key dismissal event into the
		// stateProvider slot `sidebar-panel.ts` reads. `isWeb` forces collapsed (agents are fully
		// disabled on web hosts) — mirrors the legacy host's `isAgentsBannerEnabled`.
		this._unsubscribeAgentsBanner?.();
		this._unsubscribeAgentsBanner = undefined;

		const onboarding = await services.onboarding;
		this._activeOnboardingRemote = onboarding;

		const unsubBanner = (await onboarding.onDidChange(e => {
			if (e.key !== 'agents:banner') return;

			this._stateProvider.applyAgentsBannerCollapsed(this._stateProvider.isWeb === true || e.dismissed);
		})) as unknown as (() => void) | undefined;
		if (typeof unsubBanner !== 'function') return;

		if (this._activeOnboardingRemote !== onboarding) {
			unsubBanner();
			return;
		}

		this._unsubscribeAgentsBanner = unsubBanner;

		// oxlint-disable-next-line typescript/await-thenable -- Supertalk proxy method calls are thenable at runtime
		const dismissed = await onboarding.isDismissed('agents:banner');
		if (this._activeOnboardingRemote !== onboarding) return;

		this._stateProvider.applyAgentsBannerCollapsed(this._stateProvider.isWeb === true || dismissed);
	}

	private applyAgentsInfo(infos: readonly AgentInfo[]): void {
		const hooksAgents = computeHooksAgents(infos);
		this._stateProvider.applyHooksCapability(
			hooksAgents.some(a => !a.installed),
			hooksAgents,
		);
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

	override connectedCallback(): void {
		super.connectedCallback?.();
		// StateProvider dispatches webview-directed notifications on this element (the apphost).
		// We listen here — descendants can't catch parent-dispatched events — and route to the
		// graph-app, which holds the @query reference to the details panel.
		this.addEventListener(
			'gl-graph-request-open-compare-mode',
			this._handleRequestOpenCompareMode as EventListener,
		);
		this.addEventListener(
			'gl-graph-request-open-timeline-scope',
			this._handleRequestOpenTimelineScope as EventListener,
		);
		this.addEventListener('gl-graph-request-search', this._handleRequestSearch as EventListener);
		this.addEventListener(
			'gl-graph-request-ensure-row-visible',
			this._handleRequestEnsureRowVisible as EventListener,
		);
		this.addEventListener('gl-graph-request-reveal-failed', this._handleRequestRevealFailed as EventListener);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.removeEventListener(
			'gl-graph-request-open-compare-mode',
			this._handleRequestOpenCompareMode as EventListener,
		);
		this.removeEventListener(
			'gl-graph-request-open-timeline-scope',
			this._handleRequestOpenTimelineScope as EventListener,
		);
		this.removeEventListener('gl-graph-request-search', this._handleRequestSearch as EventListener);
		this.removeEventListener(
			'gl-graph-request-ensure-row-visible',
			this._handleRequestEnsureRowVisible as EventListener,
		);
		this.removeEventListener('gl-graph-request-reveal-failed', this._handleRequestRevealFailed as EventListener);
		this._sidebarActions.dispose();
		this._searchActions.dispose();
		this._unsubscribeRequestSearch?.();
		this._unsubscribeRequestSearch = undefined;
		this._unsubscribeAgentSessions?.();
		this._unsubscribeAgentSessions = undefined;
		this._unsubscribeAgentsInfo?.();
		this._unsubscribeAgentsInfo = undefined;
		this._unsubscribeAgentsBanner?.();
		this._unsubscribeAgentsBanner = undefined;
		this._onboardingDismissals.dispose();
		this._coachMarkSeen.dispose();
	}

	private _handleRequestOpenCompareMode = (e: CustomEvent<DidRequestOpenCompareModeParams>): void => {
		this.appElement?.openCompareMode(e.detail);
	};

	private _handleRequestEnsureRowVisible = (e: CustomEvent<string>): void => {
		this.appElement?.ensureRowVisible(e.detail);
	};

	private _handleRequestRevealFailed = (e: CustomEvent<DidFailRevealParams>): void => {
		this.appElement?.handleRevealFailed(e.detail.id);
	};

	private _handleRequestOpenTimelineScope = (e: CustomEvent<DidRequestOpenTimelineScopeParams>): void => {
		this.appElement?.openTimelineScope(e.detail);
	};

	private _handleRequestSearch = (e: CustomEvent<DidRequestSearchParams>): void => {
		this.appElement?.applyExternalSearchRequest(e.detail);
	};

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
		// Refresh the graph engine's HSL token vars so lane colors follow theme switches. Cheap
		// (~7 getComputedStyle reads + Color.from conversions) and idempotent.
		// `onThemeUpdated` is invoked once at startup (before the initial render) AND on every later
		// theme change (see appBase.ts) — so the lane palette is already correct before `gl-lit-graph`
		// ever renders; the event below only matters for a THEME CHANGE while the graph is open, to
		// invalidate its cached (lane-colored) adornments.
		if (applyGraphThemeVariables()) {
			window.dispatchEvent(new CustomEvent('gl-graph-lane-palette-changed'));
		}

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

		// minimap tip colors (dark themes only)
		let c: Color;
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
		// Buffered onboarding change events collapse to the last one while hidden; re-sync on restore.
		// Going hidden clears unacknowledged signals so a stale value can't paint before that re-sync lands.
		if (visible) {
			this._onboardingDismissals.refresh();
		} else {
			this._onboardingDismissals.markStale();
		}
		this.appElement?.onWebviewVisibilityChanged(visible);
	}
}
