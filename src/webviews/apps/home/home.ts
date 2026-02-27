/*global*/
import './home.scss';
import type { Remote } from '@eamodio/supertalk';
import { ContextProvider } from '@lit/context';
import { html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { signalObject } from 'signal-utils/object';
import { debounce } from '../../../system/function/debounce.js';
import type { HomeServices } from '../../home/homeService.js';
import type { GetActiveOverviewResponse, GetInactiveOverviewResponse, OverviewFilters } from '../../home/protocol.js';
import { activeOverviewStateContext, inactiveOverviewStateContext } from '../plus/home/components/overviewState.js';
import type { GlHomeHeader } from '../plus/shared/components/home-header.js';
import { SignalWatcherWebviewApp } from '../shared/appBase.js';
import { scrollableBase } from '../shared/components/styles/lit/base.css.js';
import { aiContext, createAIState } from '../shared/contexts/ai.js';
import type { CommandsState } from '../shared/contexts/commands.js';
import { commandsContext } from '../shared/contexts/commands.js';
import { createIntegrationsState, integrationsContext } from '../shared/contexts/integrations.js';
import { createLaunchpadState, launchpadContext } from '../shared/contexts/launchpad.js';
import type { OnboardingKey } from '../shared/contexts/onboarding.js';
import { createOnboardingState, onboardingContext } from '../shared/contexts/onboarding.js';
import { createDefaultSubscriptionContextState, subscriptionContext } from '../shared/contexts/subscription.js';
import { getHost } from '../shared/host/context.js';
import { RpcController } from '../shared/rpc/rpcController.js';
import type { Resource } from '../shared/state/resource.js';
import { createResource } from '../shared/state/resource.js';
import type { ThemeChangeEvent } from '../shared/theme.js';
import { fetchLaunchpadSummary, populateInitialState, restoreOverviewRepositoryPath } from './actions.js';
import type { GlAiAllAccessBanner } from './components/ai-all-access-banner.js';
import type { SubscriptionActions } from './events.js';
import { setupSubscriptions } from './events.js';
import { homeBaseStyles, homeStyles } from './home.css.js';
import type { HomeRootState } from './state.js';
import { createHomeState, homeStateContext } from './state.js';
import '../plus/shared/components/home-header.js';
import '../plus/home/components/active-work.js';
import '../plus/home/components/launchpad.js';
import '../plus/home/components/overview.js';
import './components/feature-nav.js';
import './components/ai-all-access-banner.js';
import './components/ama-banner.js';
import './components/preview-banner.js';
import '../shared/components/skeleton-loader.js';
import './components/repo-alerts.js';
import '../shared/components/banner/banner.js';
import '../shared/components/gl-error-banner.js';

/**
 * Home App - signal-based state management with RPC.
 *
 * This component uses:
 * - SignalWatcher to automatically re-render when signals change
 * - RpcController for RPC lifecycle management
 * - Instance-owned state created via createHomeState()
 * - Overview state contexts for active-work and overview child components
 */
@customElement('gl-home-app')
export class GlHomeApp extends SignalWatcherWebviewApp {
	static override styles = [homeBaseStyles, scrollableBase, homeStyles];

	@property({ type: String, noAccessor: true })
	private context!: string;

	@property({ type: String }) webroot?: string;

	// ── Domain states ──
	private _host = getHost();
	private _homeState = createHomeState(this._host.storage);
	private _integrationsState = createIntegrationsState();
	private _aiState = createAIState();
	private _onboardingState = createOnboardingState();
	private _launchpadState = createLaunchpadState();
	private _commandsState: CommandsState = { service: undefined };

	/** Internal aggregate for actions/events — never exposed via context. */
	private get _rootState(): HomeRootState {
		return {
			home: this._homeState,
			integrations: this._integrationsState,
			ai: this._aiState,
			onboarding: this._onboardingState,
			launchpad: this._launchpadState,
			commands: this._commandsState,
		};
	}

	/**
	 * RPC controller — manages connection lifecycle via Lit's ReactiveController pattern.
	 */
	private _rpc = new RpcController<HomeServices>(this, {
		rpcOptions: { endpoint: () => this._host.createEndpoint() },
		onReady: services => this._onRpcReady(services),
		onError: error => this._homeState.error.set(error.message),
	});

	/**
	 * Context providers for state consumed by child components.
	 */
	private _subscriptionCtx?: ContextProvider<typeof subscriptionContext>;
	private _homeStateCtx?: ContextProvider<typeof homeStateContext>;
	private _activeOverviewCtxProvider?: ContextProvider<typeof activeOverviewStateContext>;
	private _inactiveOverviewCtxProvider?: ContextProvider<typeof inactiveOverviewStateContext>;

	/**
	 * Resource-backed overview states (created in _onRpcReady).
	 */
	private _activeResource?: Resource<GetActiveOverviewResponse>;
	private _inactiveResource?: Resource<GetInactiveOverviewResponse>;
	private _inactiveFilter?: Partial<OverviewFilters>;
	private readonly _refreshOverviewDebounced = debounce(() => {
		void this._activeResource?.fetch();
		void this._inactiveResource?.fetch();
	}, 500);

	/**
	 * Unsubscribe function for RPC event subscriptions.
	 */
	private _unsubscribeEvents?: () => void;

	/**
	 * Stop function for auto-persistence (created in _onRpcReady).
	 */
	private _stopAutoPersist?: () => void;

	@query('gl-home-header')
	private _header!: GlHomeHeader;

	@query('gl-ai-all-access-banner')
	private allAccessPromoBanner!: GlAiAllAccessBanner;

	@state()
	private isLightTheme = false;

	private badgeSource = { source: 'home', detail: 'badge' };

	override connectedCallback(): void {
		super.connectedCallback?.();

		const context = this.context;
		this.context = undefined!;
		this.initWebviewContext(context);

		// Create context providers for child components
		this._subscriptionCtx = new ContextProvider(this, {
			context: subscriptionContext,
			initialValue: createDefaultSubscriptionContextState(),
		});
		this._homeStateCtx = new ContextProvider(this, {
			context: homeStateContext,
			initialValue: this._homeState,
		});
		new ContextProvider(this, { context: integrationsContext, initialValue: this._integrationsState });
		new ContextProvider(this, { context: aiContext, initialValue: this._aiState });
		new ContextProvider(this, { context: onboardingContext, initialValue: this._onboardingState });
		new ContextProvider(this, { context: commandsContext, initialValue: this._commandsState });
		new ContextProvider(this, { context: launchpadContext, initialValue: this._launchpadState });
		this._activeOverviewCtxProvider = new ContextProvider(this, {
			context: activeOverviewStateContext,
		});
		this._inactiveOverviewCtxProvider = new ContextProvider(this, {
			context: inactiveOverviewStateContext,
		});
	}

	override disconnectedCallback(): void {
		// Unsubscribe RPC event callbacks (before RPC connection is disposed)
		this._unsubscribeEvents?.();
		this._unsubscribeEvents = undefined;

		// Stop auto-persistence before resetting state
		this._stopAutoPersist?.();
		this._stopAutoPersist = undefined;

		// Dispose and clear resource references
		this._refreshOverviewDebounced.cancel();
		this._activeResource?.dispose();
		this._inactiveResource?.dispose();
		this._activeResource = undefined;
		this._inactiveResource = undefined;
		this._inactiveFilter = undefined;

		// Reset all domain states
		this._homeState.resetAll();
		this._integrationsState.resetAll();
		this._aiState.resetAll();
		this._onboardingState.resetAll();
		this._launchpadState.resetAll();
		this._commandsState.service = undefined;

		// GlWebviewApp: cleans up focus tracker, disposes ipc/promos/telemetry/DOM listeners
		// Lit framework: calls RpcController.hostDisconnected() → disposes RPC connection
		super.disconnectedCallback?.();
	}

	protected override onThemeUpdated(e: ThemeChangeEvent): void {
		this.isLightTheme = e.isLightTheme;
	}

	// ============================================================
	// RPC lifecycle
	// ============================================================

	/**
	 * Called by RpcController when RPC connection is established.
	 * Resolves all sub-services once (resolve-once pattern), then sets up
	 * subscriptions and fetches initial state.
	 */
	private async _onRpcReady(services: Remote<HomeServices>): Promise<void> {
		const root = this._rootState;

		// Resolve all sub-services in parallel.
		// Supertalk proxy properties are thenables (have .then but not .catch/.finally);
		// Promise.all handles thenables natively so no wrapping is needed.
		const [home, launchpad, config, subscription, integrations, git, ai, commands] = await Promise.all([
			services.home,
			services.launchpad,
			services.config,
			services.subscription,
			services.integrations,
			services.git,
			services.ai,
			services.commands,
		]);

		// Supertalk remote proxy properties are thenable at runtime (ProxyProperty with .then()),
		// but Remote<T> types them as synchronous values. The lint rule correctly detects the
		// thenable; the disable is required — this is how Supertalk property access works.
		/* eslint-disable @typescript-eslint/await-thenable */
		const [subscriptionSignal, orgSettingsSignal, avatarSignal, hasAccountSignal, orgCountSignal] =
			await Promise.all([
				subscription.subscriptionState,
				subscription.orgSettingsState,
				subscription.avatarState,
				subscription.hasAccountState,
				subscription.organizationsCountState,
			]);
		/* eslint-enable @typescript-eslint/await-thenable */

		// Swap remote subscription context to use RemoteSignals directly (no bridge/copy)
		this._subscriptionCtx?.setValue(
			{
				subscription: subscriptionSignal,
				orgSettings: orgSettingsSignal,
				avatar: avatarSignal,
				hasAccount: hasAccountSignal,
				organizationsCount: orgCountSignal,
			},
			true,
		);

		// Start auto-persistence before seeding any host-restored persisted values.
		this._stopAutoPersist = this._homeState.startAutoPersist();

		await restoreOverviewRepositoryPath(this._homeState, home);

		// Create resource-backed overview states and provide to children
		const syncOverviewRepositoryPath = (repoPath: string | undefined): void => {
			if (repoPath != null) {
				this._homeState.overviewRepositoryPath.set(repoPath);
			}
		};
		const syncInactiveOverviewFilter = (filter: OverviewFilters): void => {
			if (this._inactiveFilter == null) return;

			this._inactiveFilter.recent = filter.recent;
			this._inactiveFilter.stale = filter.stale;
		};
		const activeResource = createResource<GetActiveOverviewResponse>(async signal => {
			const overview = await home.getActiveOverview(signal);
			syncOverviewRepositoryPath(overview?.repository.path);
			return overview;
		});
		const inactiveResource = createResource<GetInactiveOverviewResponse>(async signal => {
			const overview = await home.getInactiveOverview(signal);
			syncOverviewRepositoryPath(overview?.repository.path);
			return overview;
		});
		const inactiveFilter = signalObject<Partial<OverviewFilters>>({});

		this._activeResource = activeResource;
		this._inactiveResource = inactiveResource;
		this._inactiveFilter = inactiveFilter;

		this._activeOverviewCtxProvider?.setValue(
			{
				value: activeResource.value,
				loading: activeResource.loading,
				error: activeResource.error,
				fetch: () => void activeResource.fetch(),
				changeRepository: () => void home.changeOverviewRepository(),
			},
			true,
		);
		this._inactiveOverviewCtxProvider?.setValue(
			{
				value: inactiveResource.value,
				loading: inactiveResource.loading,
				error: inactiveResource.error,
				filter: inactiveFilter,
				fetch: () => void inactiveResource.fetch(),
			},
			true,
		);

		// Wire service handles to domain states
		root.home.homeService = home;
		root.commands.service = commands;
		root.launchpad.service = launchpad;

		// Wire onboarding dismiss callbacks to current homeService methods
		const dismissMap: Record<OnboardingKey, () => void> = {
			integrationBanner: () => home.collapseSection('integrationBanner', true),
			amaBanner: () => home.collapseSection('feb2025AmaBanner', true),
			aiAllAccessBanner: () => void home.dismissAiAllAccessBanner(),
		};
		this._onboardingState.dismiss = (key: OnboardingKey) => dismissMap[key]?.();
		this._onboardingState.dismissWalkthrough = () => void home.dismissWalkthrough();

		// Set up event subscriptions FIRST (so we don't miss events during fetch)
		const replaceOverview = (): void => {
			this._refreshOverviewDebounced.cancel();
			this._activeResource?.cancel();
			this._inactiveResource?.cancel();
			void this._activeResource?.fetch();
			void this._inactiveResource?.fetch();
		};
		const actions: SubscriptionActions = {
			refreshOverview: () => {
				this._refreshOverviewDebounced();
			},
			refreshInactiveOverview: () => {
				void this._inactiveResource?.fetch();
			},
			replaceOverview: () => {
				replaceOverview();
			},
			updateOverviewFilter: (filter: OverviewFilters) => {
				this._homeState.overviewFilter.set(filter);
				syncInactiveOverviewFilter(filter);
			},
			onFocusAccount: () => this._header?.show(),
			onSubscriptionChanged: () => {
				this._header?.refreshPromo();
				this.allAccessPromoBanner?.requestUpdate();
			},
			refreshLaunchpad: () => {
				if (launchpad != null) {
					void fetchLaunchpadSummary(root.launchpad, launchpad);
				}
			},
		};
		this._unsubscribeEvents = await setupSubscriptions(
			root,
			{
				home: home,
				launchpad: launchpad,
				config: config,
				subscription: subscription,
				integrations: integrations,
				git: git,
				ai: ai,
			},
			actions,
		);

		// Cancel pending overview fetches on hide (responses would be silently
		// dropped by VS Code); re-fetch on visibility restore
		const onVisibilityChange = (): void => {
			if (document.visibilityState !== 'visible') {
				this._refreshOverviewDebounced.cancel();
				this._activeResource?.cancel();
				this._inactiveResource?.cancel();
				return;
			}

			// Visibility restored — refresh overview and launchpad
			this._refreshOverviewDebounced();
			if (launchpad != null) {
				void fetchLaunchpadSummary(root.launchpad, launchpad);
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		this.disposables.push({ dispose: () => document.removeEventListener('visibilitychange', onVisibilityChange) });

		// Populate signals progressively — each RPC sets its signal as it resolves,
		// so the UI updates incrementally instead of waiting for everything.
		populateInitialState(root, home, subscription, integrations, git, ai, syncInactiveOverviewFilter);
	}

	// ============================================================
	// Render
	// ============================================================

	override render(): unknown {
		return html`
			<div class="home scrollable">
				<gl-error-banner .error=${this._homeState.error}></gl-error-banner>
				<gl-home-header class="home__header"></gl-home-header>
				${this.renderBanners()}
				<gl-repo-alerts class="home__alerts"></gl-repo-alerts>
				<main class="home__main scrollable" id="main">${this.renderMain()}</main>
			</div>
		`;
	}

	private renderBanners(): unknown {
		const s = this._homeState;
		// Banners outside <main> only render once we know the layout
		if (s.initialContext.get() == null) return nothing;

		const preview = s.previewState.get();
		return html`
			${when(!preview.previewEnabled, () => html`<gl-preview-banner></gl-preview-banner>`)}
			${when(this._onboardingState.banners.amaBanner, () => html`<gl-ama-banner></gl-ama-banner>`)}
		`;
	}

	private renderMain(): unknown {
		const s = this._homeState;
		// We need initialContext (+ previewState) to know which layout to render.
		// Until they arrive, show a single lightweight skeleton so the view feels responsive.
		if (s.initialContext.get() == null) {
			return html`<skeleton-loader lines="1"></skeleton-loader>`;
		}

		const preview = s.previewState.get();
		if (preview.previewEnabled) {
			return html`
				<gl-preview-banner></gl-preview-banner>
				${when(
					this._onboardingState.banners.aiAllAccessBanner,
					() => html`<gl-ai-all-access-banner></gl-ai-all-access-banner>`,
				)}
				<gl-active-work></gl-active-work>
				<gl-launchpad></gl-launchpad>
				<gl-overview></gl-overview>
			`;
		}

		return html`
			${when(
				this._onboardingState.banners.aiAllAccessBanner,
				() => html`<gl-ai-all-access-banner></gl-ai-all-access-banner>`,
			)}
			<gl-feature-nav .badgeSource=${this.badgeSource}></gl-feature-nav>
		`;
	}
}
