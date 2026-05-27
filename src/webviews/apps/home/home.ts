/*global*/
import './home.scss';
import type { Remote } from '@eamodio/supertalk';
import { ContextProvider } from '@lit/context';
import { html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { signalObject } from 'signal-utils/object';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
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
import '../shared/components/hooks-banner.js';
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
		void this._fetchActiveCoalesced();
		void this._fetchInactiveCoalesced();
	}, 500);
	// Active-only refresh: FS events and per-flag dispatches that can't shift the inactive
	// list (e.g. `index`/`pausedOp`) target this debounce instead of `_refreshOverviewDebounced`,
	// so the inactive resource doesn't re-fetch its full skeleton + WIP + enrichment for an
	// edit that only touched the current branch's working tree.
	private readonly _refreshActiveDebounced = debounce(() => {
		void this._fetchActiveCoalesced();
	}, 500);
	// Inactive list is driven by discrete RepositoryChange events (no FS-watcher noise),
	// and the user isn't focused there — afford a longer window so bursts (branch ops,
	// fetch fan-out) coalesce into a single fetch.
	private readonly _refreshInactiveDebounced = debounce(() => {
		void this._fetchInactiveCoalesced();
	}, 500);

	// Per-resource in-flight gates. Concurrent callers receive the in-flight promise instead
	// of triggering a `Resource.fetch()` that would cancel-and-restart the existing one (its
	// default behavior is `cancelPrevious=true`). A trailing-edge re-fire after settle ensures
	// the latest request gets fresh data. Same shape as Graph's `_wipNotifyInFlight` /
	// `_wipNotifyDirty` pattern in graphWebview.ts.
	//
	// `replaceOverview` bypasses these gates — it explicitly cancels and force-fetches; the
	// reset helper below clears in-flight tracking AND bumps the generation counters so any
	// orphaned `.finally()` from a just-canceled promise no-ops instead of clobbering the
	// new in-flight reference.
	private _activeFetchInFlight?: Promise<void>;
	private _activeFetchDirty = false;
	private readonly _activeFetchGen = getScopedCounter();
	private _inactiveFetchInFlight?: Promise<void>;
	private _inactiveFetchDirty = false;
	private readonly _inactiveFetchGen = getScopedCounter();
	private _agentFetchInFlight?: Promise<void>;
	private _agentFetchDirty = false;
	private readonly _agentFetchGen = getScopedCounter();

	private _fetchActiveCoalesced(): Promise<void> {
		const resource = this._activeResource;
		if (resource == null) return Promise.resolve();

		if (this._activeFetchInFlight != null) {
			this._activeFetchDirty = true;
			return this._activeFetchInFlight;
		}

		const gen = this._activeFetchGen.next();
		const run = resource.fetch().finally(() => {
			if (this._activeFetchGen.current !== gen) return;

			this._activeFetchInFlight = undefined;
			if (this._activeFetchDirty) {
				this._activeFetchDirty = false;
				void this._fetchActiveCoalesced();
			}
		});
		this._activeFetchInFlight = run;
		return run;
	}

	private _fetchInactiveCoalesced(): Promise<void> {
		const resource = this._inactiveResource;
		if (resource == null) return Promise.resolve();

		if (this._inactiveFetchInFlight != null) {
			this._inactiveFetchDirty = true;
			return this._inactiveFetchInFlight;
		}

		const gen = this._inactiveFetchGen.next();
		const run = resource.fetch().finally(() => {
			if (this._inactiveFetchGen.current !== gen) return;

			this._inactiveFetchInFlight = undefined;
			if (this._inactiveFetchDirty) {
				this._inactiveFetchDirty = false;
				void this._fetchInactiveCoalesced();
			}
		});
		this._inactiveFetchInFlight = run;
		return run;
	}

	private _fetchAgentCoalesced(): Promise<void> {
		const resource = this._agentResource;
		if (resource == null) return Promise.resolve();

		if (this._agentFetchInFlight != null) {
			this._agentFetchDirty = true;
			return this._agentFetchInFlight;
		}

		const gen = this._agentFetchGen.next();
		const run = resource.fetch().finally(() => {
			if (this._agentFetchGen.current !== gen) return;

			this._agentFetchInFlight = undefined;
			if (this._agentFetchDirty) {
				this._agentFetchDirty = false;
				void this._fetchAgentCoalesced();
			}
		});
		this._agentFetchInFlight = run;
		return run;
	}

	private _resetFetchGates(): void {
		// Bumping the generations invalidates any in-flight `.finally()` callbacks from
		// the canceled promises so they don't clobber the next fetch's tracking reference.
		this._activeFetchGen.next();
		this._activeFetchInFlight = undefined;
		this._activeFetchDirty = false;
		this._inactiveFetchGen.next();
		this._inactiveFetchInFlight = undefined;
		this._inactiveFetchDirty = false;
		this._agentFetchGen.next();
		this._agentFetchInFlight = undefined;
		this._agentFetchDirty = false;
	}

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
		// Abort any in-flight `_onRpcReady` work so phase timeouts don't fire after unmount.
		// Tagged reason so unhandled rejections that escape consumer chains are diagnosable.
		this._readyAbort?.abort(new DOMException('home: disconnected', 'AbortError'));
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
		this._refreshActiveDebounced.cancel();
		this._refreshInactiveDebounced.cancel();
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
		this._readyAbort?.abort(new DOMException('home: re-entering _onRpcReady', 'AbortError'));
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
							abort.abort(
								new DOMException(`home: phase "${phase}" timed out after ${ms}ms`, 'AbortError'),
							);
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
			branches,
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
			services.branches,
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
			// Active branch is always-expanded, so merge-target stays eager here — deferring
			// would only add a loading flash with no win.
			const wipPromise = home.getOverviewWip(activeIds, signal);
			const enrichmentPromise = home.getOverviewEnrichment(activeIds, undefined, signal);

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
			// Defer merge-target — `gl-branch-card` lazy-fetches via `branches.getBranchEnrichment`
			// on first expand, so the initial enrichment skips ~4 git/integration ops per branch.
			const emptyWip = Promise.resolve<GetOverviewWipResponse>({});
			const wipPromise = wipIds.length > 0 ? home.getOverviewWip(wipIds, signal) : emptyWip;
			const enrichmentPromise = home.getOverviewEnrichment(allIds, { skipMergeTarget: true }, signal);

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

			// Same lazy-merge-target rationale as the inactive path.
			const emptyWip = Promise.resolve<GetOverviewWipResponse>({});
			const wipPromise = wipIds.length > 0 ? home.getOverviewWip(wipIds, signal) : emptyWip;
			const enrichmentPromise = home.getOverviewEnrichment(allIds, { skipMergeTarget: true }, signal);

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
		root.home.branchesService = branches;
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

		// Populate initial banner state from onboarding service. The RPC service marshals
		// `isDismissed` as a Promise, so each call must be awaited — synchronous `!` against
		// a Promise is always `false`, which leaves banners stuck "dismissed" until an
		// onDidChange event corrects them (and never corrects fresh, never-dismissed keys).
		/* eslint-disable @typescript-eslint/await-thenable -- Supertalk proxy method calls are thenable at runtime */
		const [integrationDismissed, mcpDismissed, hooksDismissed] = await Promise.all([
			onboarding.isDismissed('home:integrationBanner'),
			onboarding.isDismissed('mcp:banner'),
			onboarding.isDismissed('hooks:banner'),
		]);
		this._onboardingState.banners.integrationBanner = !integrationDismissed;
		this._onboardingState.banners.mcpBanner = !mcpDismissed;
		this._onboardingState.banners.hooksBanner = !hooksDismissed;

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
					// FS events in the selected overview repo can only shift the active branch's
					// WIP — inactive branches root their working trees elsewhere. Targeting the
					// active-only debounce avoids re-running the inactive skeleton + WIP +
					// enrichment pipeline on every file save.
					this._refreshActiveDebounced();
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
			this._refreshActiveDebounced.cancel();
			this._refreshInactiveDebounced.cancel();
			this._activeResource?.cancel();
			this._inactiveResource?.cancel();
			this._agentResource?.cancel();
			// Clear coalesce tracking before re-fetching — otherwise the next coalesced caller
			// would receive the just-canceled in-flight promise.
			this._resetFetchGates();
			void this._fetchActiveCoalesced();
			void this._fetchInactiveCoalesced();
			void this._fetchAgentCoalesced();
			// Re-subscribe FS watcher for the (possibly new) overview repo
			watchWipForRepo(this._homeState.overviewRepositoryPath.get());
		};
		const replaceOverviewDebounced = debounce(replaceOverview, 100);
		this.disposables.push({ dispose: () => replaceOverviewDebounced.cancel() });
		const actions: SubscriptionActions = {
			refreshOverview: () => {
				this._refreshOverviewDebounced();
			},
			refreshActiveOverview: () => {
				this._refreshActiveDebounced();
			},
			refreshInactiveOverview: () => {
				this._refreshInactiveDebounced();
			},
			replaceOverview: () => {
				replaceOverviewDebounced();
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
				void this._fetchAgentCoalesced();
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

		// Cancel pending debounced fetches on hide so they don't fire against a hidden
		// view; intentionally do NOT cancel in-flight resource fetches here. VS Code
		// delivers responses across visibility transitions, and a standalone cancel can
		// strand a resource in idle/no-error state ("skeleton forever") if no follow-up
		// fetch arrives. Re-fetch on visibility restore.
		const onVisibilityChange = (): void => {
			if (document.visibilityState !== 'visible') {
				this._refreshOverviewDebounced.cancel();
				this._refreshActiveDebounced.cancel();
				this._refreshInactiveDebounced.cancel();
				replaceOverviewDebounced.cancel();
				return;
			}

			// Visibility restored — refresh overview and launchpad
			this._refreshOverviewDebounced();
			void this._fetchAgentCoalesced();
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

		const aiState = this._aiState.state.get();
		// Suppress the MCP banner once MCP is actually installed — the "Connect More Agents" CTA
		// still lives in the integrations popover row, so it isn't lost. Hooks takes the slot instead.
		const showMcp = this._onboardingState.banners.mcpBanner && !aiState.mcp.installed;
		if (showMcp) return this.renderMcpBanner();
		return this.renderHooksBanner();
	}

	private renderMcpBanner(): unknown {
		// Hide once the user has dismissed it via the onboarding service
		if (!this._onboardingState.banners.mcpBanner) return nothing;

		const aiState = this._aiState.state.get();
		return html`
			<gl-mcp-banner
				source="home"
				.canAutoRegister=${aiState.mcp.bundled}
				.canInstallClaudeHook=${aiState.hooks.canInstallClaudeHook}
			></gl-mcp-banner>
		`;
	}

	private renderHooksBanner(): unknown {
		if (!this._onboardingState.banners.hooksBanner) return nothing;

		const aiState = this._aiState.state.get();
		if (!aiState.enabled || !aiState.orgEnabled) return nothing;
		if (!aiState.hooks.canInstallClaudeHook) return nothing;

		return html`<gl-hooks-banner source="home"></gl-hooks-banner>`;
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
function swallowCancellation<T>(reason: unknown): T | undefined {
	if (isCancellationError(reason)) return undefined;
	throw reason;
}

function buildBranchProgressive(
	skeleton: OverviewBranch,
	wipPromise: Promise<GetOverviewWipResponse>,
	enrichmentPromise: Promise<GetOverviewEnrichmentResponse>,
): GetOverviewBranch {
	// One `.catch` per shared upstream promise so the seven derived `.then(...)` chains below
	// don't each surface their own unhandled rejection when the resource is cancelled. The
	// skeleton already renders without these fields; treating cancellation as "no enrichment yet"
	// keeps the UI consistent.
	const wip = wipPromise.catch(swallowCancellation<GetOverviewWipResponse>);
	const enrichment = enrichmentPromise.catch(swallowCancellation<GetOverviewEnrichmentResponse>);
	return {
		...skeleton,
		wip: wip.then(w => w?.[skeleton.id]),
		remote: enrichment.then(e => e?.[skeleton.id]?.remote),
		pr: enrichment.then(e => e?.[skeleton.id]?.pr),
		autolinks: enrichment.then(e => e?.[skeleton.id]?.autolinks),
		issues: enrichment.then(e => e?.[skeleton.id]?.issues),
		contributors: enrichment.then(e => e?.[skeleton.id]?.contributors),
		mergeTarget: enrichment.then(e => e?.[skeleton.id]?.mergeTarget),
	};
}
