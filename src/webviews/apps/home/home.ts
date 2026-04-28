/*global*/
import './home.scss';
import type { Remote } from '@eamodio/supertalk';
import { ContextProvider } from '@lit/context';
import { html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { signalObject } from 'signal-utils/object';
import { debounce } from '@gitlens/utils/debounce.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { OnboardingKeys } from '../../../constants.onboarding.js';
import type { HomeServices } from '../../home/homeService.js';
import type {
	GetActiveOverviewResponse,
	GetInactiveOverviewResponse,
	GetOverviewBranch,
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewBranch,
	OverviewFilters,
} from '../../home/protocol.js';
import {
	activeOverviewStateContext,
	agentOverviewStateContext,
	inactiveOverviewStateContext,
} from '../plus/home/components/overviewState.js';
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
import type { SubscriptionActions } from './events.js';
import { setupSubscriptions } from './events.js';
import { homeBaseStyles, homeStyles } from './home.css.js';
import type { HomeRootState } from './state.js';
import { createHomeState, homeStateContext } from './state.js';
import '../plus/shared/components/home-header.js';
import '../plus/home/components/active-work.js';
import '../plus/home/components/launchpad.js';
import '../plus/home/components/overview.js';
import '../shared/components/skeleton-loader.js';
import './components/repo-alerts.js';
import '../shared/components/banner/banner.js';
import '../shared/components/gl-error-banner.js';
import '../shared/components/mcp-banner.js';

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
		rpcOptions: {
			webviewId: () => this._webview?.webviewId,
			webviewInstanceId: () => this._webview?.webviewInstanceId,
			endpoint: () => this._host.createEndpoint(),
		},
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
	private _agentOverviewCtxProvider?: ContextProvider<typeof agentOverviewStateContext>;

	/**
	 * Resource-backed overview states (created in _onRpcReady).
	 */
	private _activeResource?: Resource<GetActiveOverviewResponse>;
	private _inactiveResource?: Resource<GetInactiveOverviewResponse>;
	private _agentResource?: Resource<GetInactiveOverviewResponse>;
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
	 * Dynamic FS-level WIP watcher — re-subscribed when the overview repo changes.
	 */
	private _wipWatchUnsubscribe?: () => void;

	/**
	 * Stop function for auto-persistence (created in _onRpcReady).
	 */
	private _stopAutoPersist?: () => void;

	/**
	 * AbortController for the `_onRpcReady` pipeline. Aborted on component disconnect,
	 * or internally if a phase timeout fires, so downstream code can bail out of
	 * hanging work. Skeleton-loader-forever used to be possible when a single RPC
	 * response was never delivered; with this guard, any hang inside `_onRpcReady`
	 * becomes a visible error banner within the phase timeout.
	 */
	private _readyAbort?: AbortController;

	@query('gl-home-header')
	private _header!: GlHomeHeader;

	@state()
	private isLightTheme = false;

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
		this._agentOverviewCtxProvider = new ContextProvider(this, {
			context: agentOverviewStateContext,
		});
	}

	override disconnectedCallback(): void {
		// Abort any in-flight `_onRpcReady` work so phase timeouts don't fire after unmount
		this._readyAbort?.abort();
		this._readyAbort = undefined;

		// Unsubscribe RPC event callbacks (before RPC connection is disposed)
		this._unsubscribeEvents?.();
		this._unsubscribeEvents = undefined;
		this._wipWatchUnsubscribe?.();
		this._wipWatchUnsubscribe = undefined;

		// Stop auto-persistence before resetting state
		this._stopAutoPersist?.();
		this._stopAutoPersist = undefined;

		// Dispose and clear resource references
		this._refreshOverviewDebounced.cancel();
		this._activeResource?.dispose();
		this._inactiveResource?.dispose();
		this._agentResource?.dispose();
		this._activeResource = undefined;
		this._inactiveResource = undefined;
		this._agentResource = undefined;
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
		this._readyAbort?.abort();
		this._readyAbort = new AbortController();
		const abort = this._readyAbort;

		/**
		 * Bound an RPC-driven phase with a hard timeout. If the phase's underlying
		 * RPC response is never delivered (skeleton-forever case from the log
		 * investigation), this surfaces as an error banner instead of perpetual
		 * skeletons. Cancels itself on unmount via the outer abort signal.
		 */
		const phaseTimeout = async <T>(phase: string, ms: number, promise: Promise<T>): Promise<T> => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				return await Promise.race([
					promise,
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(() => {
							if (abort.signal.aborted) return;
							Logger.warn(`Home: _onRpcReady phase "${phase}" timed out after ${ms}ms`);
							abort.abort();
							reject(new Error(`Home initialization timed out in phase: ${phase}`));
						}, ms);
					}),
					new Promise<never>((_resolve, reject) => {
						if (abort.signal.aborted) {
							reject(new Error(`Home initialization aborted during phase: ${phase}`));
							return;
						}
						abort.signal.addEventListener(
							'abort',
							() => reject(new Error(`Home initialization aborted during phase: ${phase}`)),
							{ once: true },
						);
					}),
				]);
			} finally {
				if (timer != null) {
					clearTimeout(timer);
				}
			}
		};

		const root = this._rootState;

		// Resolve all sub-services in parallel.
		// Supertalk proxy properties are thenables (have .then but not .catch/.finally);
		// Promise.all handles thenables natively so no wrapping is needed.
		const [
			home,
			launchpad,
			config,
			subscription,
			integrations,
			repositories,
			repository,
			ai,
			commands,
			onboarding,
		] = await Promise.all([
			services.home,
			services.launchpad,
			services.config,
			services.subscription,
			services.integrations,
			services.repositories,
			services.repository,
			services.ai,
			services.commands,
			services.onboarding,
		]);

		// Supertalk remote proxy properties are thenable at runtime (ProxyProperty with .then()),
		// but Remote<T> types them as synchronous values. The lint rule correctly detects the
		// thenable; the disable is required — this is how Supertalk property access works.

		/* eslint-disable @typescript-eslint/await-thenable -- Supertalk proxy properties are thenable at runtime */
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

		await phaseTimeout(
			'restoreOverviewRepositoryPath',
			30_000,
			restoreOverviewRepositoryPath(this._homeState, home),
		);

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
			const branches = await home.getOverviewBranches('active', signal);
			if (branches == null) return undefined;
			syncOverviewRepositoryPath(branches.repository.path);

			const activeIds = branches.active.map(b => b.id);
			// Fire WIP + enrichment without awaiting — branch cards fill in progressively
			// as each Promise resolves. Resource exits loading state after just the skeleton.
			const wipPromise = home.getOverviewWip(activeIds, signal);
			const enrichmentPromise = home.getOverviewEnrichment(activeIds, signal);

			return {
				repository: branches.repository,
				active: branches.active.map(s => buildBranchProgressive(s, wipPromise, enrichmentPromise)),
			};
		});
		const inactiveResource = createResource<GetInactiveOverviewResponse>(async signal => {
			const branches = await home.getOverviewBranches('inactive', signal);
			if (branches == null) return undefined;
			syncOverviewRepositoryPath(branches.repository.path);

			const allInactive = [...branches.recent, ...(branches.stale ?? [])];
			const allIds = allInactive.map(b => b.id);
			const wipIds = allInactive.filter(b => b.worktree != null).map(b => b.id);

			// Fire WIP + enrichment without awaiting — same progressive pattern as active.
			const emptyWip = Promise.resolve<GetOverviewWipResponse>({});
			const wipPromise = wipIds.length > 0 ? home.getOverviewWip(wipIds, signal) : emptyWip;
			const enrichmentPromise = home.getOverviewEnrichment(allIds, signal);

			return {
				repository: branches.repository,
				recent: branches.recent.map(s => buildBranchProgressive(s, wipPromise, enrichmentPromise)),
				stale: branches.stale?.map(s => buildBranchProgressive(s, wipPromise, enrichmentPromise)),
			};
		});
		const inactiveFilter = signalObject<Partial<OverviewFilters>>({});

		const agentResource = createResource<GetInactiveOverviewResponse>(async signal => {
			const branches = await home.getOverviewBranches('agents', signal);
			if (branches == null) return undefined;
			syncOverviewRepositoryPath(branches.repository.path);

			const allIds = branches.recent.map(b => b.id);
			const wipIds = branches.recent.filter(b => b.worktree != null).map(b => b.id);

			const emptyWip = Promise.resolve<GetOverviewWipResponse>({});
			const wipPromise = wipIds.length > 0 ? home.getOverviewWip(wipIds, signal) : emptyWip;
			const enrichmentPromise = home.getOverviewEnrichment(allIds, signal);

			return {
				repository: branches.repository,
				recent: branches.recent.map(s => buildBranchProgressive(s, wipPromise, enrichmentPromise)),
			};
		});

		this._activeResource = activeResource;
		this._inactiveResource = inactiveResource;
		this._agentResource = agentResource;
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
		this._agentOverviewCtxProvider?.setValue(
			{
				value: agentResource.value,
				loading: agentResource.loading,
				error: agentResource.error,
				fetch: () => void agentResource.fetch(),
			},
			true,
		);

		// Wire service handles to domain states
		root.home.homeService = home;
		root.commands.service = commands;
		root.launchpad.service = launchpad;

		// Wire onboarding dismiss/state to RPC onboarding service
		const onboardingKeyMap: Record<OnboardingKey, OnboardingKeys> = {
			integrationBanner: 'home:integrationBanner',
		};
		this._onboardingState.dismiss = (key: OnboardingKey) => {
			const onboardingKey = onboardingKeyMap[key];
			if (onboardingKey != null) {
				this._onboardingState.banners[key] = false;
				void onboarding.dismiss(onboardingKey);
			}
		};
		this._onboardingState.dismissWalkthrough = () => void home.dismissWalkthrough();

		// Populate initial banner state from onboarding service
		this._onboardingState.banners.integrationBanner = !onboarding.isDismissed('home:integrationBanner');
		this._onboardingState.banners.mcpBanner = !onboarding.isDismissed('mcp:banner');

		// Set up event subscriptions FIRST (so we don't miss events during fetch)
		// Supertalk RPC marshals subscription methods as `Promise<Unsubscribe>`, so the
		// call must be awaited — a synchronous assignment captures the Promise (not callable).
		let watchWipRepoPath: string | undefined;
		const watchWipForRepo = (repoPath: string | undefined): void => {
			this._wipWatchUnsubscribe?.();
			this._wipWatchUnsubscribe = undefined;
			watchWipRepoPath = repoPath;
			if (repoPath == null) return;

			void (async () => {
				const unsubscribe = (await repository.onRepositoryWorkingChanged(repoPath, () => {
					this._refreshOverviewDebounced();
				})) as unknown as (() => void) | undefined;
				if (typeof unsubscribe !== 'function') return;
				if (watchWipRepoPath !== repoPath) {
					unsubscribe();
					return;
				}
				this._wipWatchUnsubscribe = unsubscribe;
			})();
		};
		const replaceOverview = (): void => {
			this._refreshOverviewDebounced.cancel();
			this._activeResource?.cancel();
			this._inactiveResource?.cancel();
			this._agentResource?.cancel();
			void this._activeResource?.fetch();
			void this._inactiveResource?.fetch();
			void this._agentResource?.fetch();
			// Re-subscribe FS watcher for the (possibly new) overview repo
			watchWipForRepo(this._homeState.overviewRepositoryPath.get());
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
			},
			refreshLaunchpad: () => {
				if (launchpad != null) {
					void fetchLaunchpadSummary(root.launchpad, launchpad);
				}
			},
			refreshAgentOverview: () => {
				void this._agentResource?.fetch();
			},
		};
		this._unsubscribeEvents = await phaseTimeout(
			'setupSubscriptions',
			30_000,
			setupSubscriptions(
				root,
				{
					home: home,
					launchpad: launchpad,
					config: config,
					subscription: subscription,
					integrations: integrations,
					repositories: repositories,
					onboarding: onboarding,
					ai: ai,
				},
				actions,
			),
		);

		// Start FS-level WIP watcher for the initial overview repo
		watchWipForRepo(this._homeState.overviewRepositoryPath.get());

		// Cancel pending overview fetches on hide (responses would be silently
		// dropped by VS Code); re-fetch on visibility restore
		const onVisibilityChange = (): void => {
			if (document.visibilityState !== 'visible') {
				this._refreshOverviewDebounced.cancel();
				this._activeResource?.cancel();
				this._inactiveResource?.cancel();
				this._agentResource?.cancel();
				return;
			}

			// Visibility restored — refresh overview and launchpad
			this._refreshOverviewDebounced();
			void this._agentResource?.fetch();
			if (launchpad != null) {
				void fetchLaunchpadSummary(root.launchpad, launchpad);
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		this.disposables.push({ dispose: () => document.removeEventListener('visibilitychange', onVisibilityChange) });

		// Populate signals progressively — each RPC sets its signal as it resolves,
		// so the UI updates incrementally instead of waiting for everything. Wrapped
		// in a phase timeout so the gating `getInitialContext()` RPC can't leave the
		// UI stuck on skeleton loaders if its response is never delivered.
		await phaseTimeout(
			'populateInitialState',
			30_000,
			populateInitialState(root, home, subscription, integrations, repositories, ai, syncInactiveOverviewFilter),
		);
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
		// Banners outside <main> only render once we know the layout
		if (!this._homeState.ready.get()) return nothing;

		return this.renderMcpBanner();
	}

	private renderMcpBanner(): unknown {
		// Hide once the user has dismissed it via the onboarding service
		if (!this._onboardingState.banners.mcpBanner) return nothing;

		const aiState = this._aiState.state.get();
		return html` <gl-mcp-banner source="home" .canAutoRegister=${aiState.mcp.bundled}></gl-mcp-banner> `;
	}

	private renderMain(): unknown {
		// Until initial data arrives, show a single lightweight skeleton so the view feels responsive.
		if (!this._homeState.ready.get()) {
			return html`<skeleton-loader lines="1"></skeleton-loader>`;
		}

		return html`
			<gl-active-work></gl-active-work>
			<gl-launchpad></gl-launchpad>
			<gl-overview></gl-overview>
		`;
	}
}

/**
 * Builds a `GetOverviewBranch` from a skeleton and *pending* batch Promises.
 *
 * Each enrichment field is a `.then()` chain off the batch Promise, so the
 * branch card's Promise-to-State setters fire naturally as the RPC call
 * resolves — no micro-task render storms from `Promise.resolve()` wrapping.
 */
function buildBranchProgressive(
	skeleton: OverviewBranch,
	wipPromise: Promise<GetOverviewWipResponse>,
	enrichmentPromise: Promise<GetOverviewEnrichmentResponse>,
): GetOverviewBranch {
	return {
		...skeleton,
		wip: wipPromise.then(wip => wip[skeleton.id]),
		remote: enrichmentPromise.then(e => e[skeleton.id]?.remote),
		pr: enrichmentPromise.then(e => e[skeleton.id]?.pr),
		autolinks: enrichmentPromise.then(e => e[skeleton.id]?.autolinks),
		issues: enrichmentPromise.then(e => e[skeleton.id]?.issues),
		contributors: enrichmentPromise.then(e => e[skeleton.id]?.contributors),
		mergeTarget: enrichmentPromise.then(e => e[skeleton.id]?.mergeTarget),
	};
}
