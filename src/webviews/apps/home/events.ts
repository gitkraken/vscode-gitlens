/**
 * Subscriptions for the Home webview.
 *
 * This module sets up event subscriptions from the backend via RPC.
 * The webview subscribes to events and decides how to react.
 *
 * All functions receive the `HomeRootState` aggregate as a parameter — no
 * module-level singletons. The root component passes the state it owns.
 *
 * Event Flow:
 * 1. Backend fires event (e.g., subscription changed)
 * 2. RPC delivers event to subscribed callback
 * 3. Callback updates local state via signals
 * 4. UI reacts to signal changes
 *
 * Events are split between:
 * - Generic events (subscription, integrations, repositories, discovery) from domain services
 * - Home-specific events (overview, walkthrough, preview, banners, focus) from HomeViewService
 * - Launchpad events from standalone LaunchpadService
 */
import type { Remote } from '@eamodio/supertalk';
import { Logger } from '../../../system/logger.js';
import type { HomeServices, PreviewState, WalkthroughProgressState } from '../../home/homeService.js';
import type { OverviewFilters } from '../../home/protocol.js';
import type { AiModelInfo, AIState, IntegrationChangeEventData, RepositoriesState } from '../../rpc/services/types.js';
import type { Unsubscribe } from '../shared/events/subscriptions.js';
import { subscribeAll } from '../shared/events/subscriptions.js';
import type { HomeRootState } from './state.js';

/**
 * Resolved sub-services (after awaiting the sub-service properties from the Remote proxy).
 */
interface ResolvedServices {
	home: Awaited<Remote<HomeServices>['home']>;
	launchpad: Awaited<Remote<HomeServices>['launchpad']>;
	config: Awaited<Remote<HomeServices>['config']>;
	subscription: Awaited<Remote<HomeServices>['subscription']>;
	integrations: Awaited<Remote<HomeServices>['integrations']>;
	git: Awaited<Remote<HomeServices>['git']>;
	ai: Awaited<Remote<HomeServices>['ai']>;
}

/**
 * Callback interface for actions that the entry point needs to handle
 * (e.g., triggering overview refreshes, showing the header).
 */
export interface SubscriptionActions {
	/** Called when the overview data should be refreshed. */
	refreshOverview(): void;
	/** Called when only the inactive overview data should be refreshed. */
	refreshInactiveOverview(): void;
	/** Called when the current overview should be replaced immediately. */
	replaceOverview(): void;
	/** Called when the overview filter changes so the root can sync all local filter state. */
	updateOverviewFilter(filter: OverviewFilters): void;
	/** Called when the extension requests account focus (show header). */
	onFocusAccount(): void;
	/** Called when subscription changes (refresh promos). */
	onSubscriptionChanged(): void;
	/** Called when launchpad data should be refreshed. */
	refreshLaunchpad(): void;
}

/**
 * Set up all event subscriptions from the backend.
 * Accepts the root state aggregate, resolved sub-services, and action callbacks.
 * Returns a cleanup function that unsubscribes from all events.
 */
export function setupSubscriptions(
	state: HomeRootState,
	services: ResolvedServices,
	actions: SubscriptionActions,
): Promise<Unsubscribe> {
	return subscribeAll([
		// ============================================================
		// Generic events — from WebviewEventsService
		// ============================================================

		// Subscription changed — state handled by signal bridges, keep side effects only
		() =>
			services.subscription.onSubscriptionChanged(() => {
				actions.onSubscriptionChanged();
			}),

		// Integrations changed (includes full state data)
		() =>
			services.integrations.onIntegrationsChanged((data: IntegrationChangeEventData) => {
				state.integrations.hasAnyIntegrationConnected.set(data.hasAnyConnected);
				state.integrations.integrations.set(data.integrations);
				actions.refreshOverview();
			}),

		// Note: onOrgSettingsChanged removed — orgSettings signal bridged from host

		// Repository discovery completed
		() =>
			services.git.onDiscoveryCompleted((repos: RepositoriesState) => {
				state.home.repositories.set(repos);
				state.home.discovering.set(false);
				actions.refreshOverview();
			}),

		// Repositories changed (add/remove)
		() =>
			services.git.onRepositoriesChanged(() => {
				void services.git.getRepositoriesState().then(
					repos => {
						state.home.repositories.set(repos);
					},
					(ex: unknown) => Logger.error(ex, 'Home: Failed to refetch repositories state'),
				);
				actions.refreshOverview();
			}),

		// ============================================================
		// Home-specific events — from HomeViewService
		// ============================================================

		() =>
			services.home.onWalkthroughProgressChanged((progress: WalkthroughProgressState) => {
				state.onboarding.walkthroughProgress.set(progress);
			}),

		() =>
			services.home.onPreviewChanged((preview: PreviewState) => {
				state.home.previewState.set(preview);
			}),

		() =>
			services.home.onAiAllAccessBannerChanged((collapsed: boolean) => {
				state.onboarding.banners.aiAllAccessBanner = !collapsed;
			}),

		// ============================================================
		// Generic AI events — from WebviewAIService
		// ============================================================

		() =>
			services.ai.onModelChanged((model: AiModelInfo | undefined) => {
				state.ai.aiModel.set(model);
			}),

		() =>
			services.ai.onStateChanged((ai: AIState) => {
				state.ai.aiState.set(ai);
			}),

		// ============================================================
		// Home-specific events (continued) — from HomeViewService
		// ============================================================

		() =>
			services.home.onOverviewRepositoryChanged((data: { repoPath: string | undefined }) => {
				state.home.overviewRepositoryPath.set(data.repoPath);
				actions.replaceOverview();
			}),

		() =>
			services.home.onOverviewFilterChanged((data: { filter: OverviewFilters }) => {
				// Persistence is handled automatically by startAutoPersist()
				actions.updateOverviewFilter(data.filter);
				actions.refreshInactiveOverview();
			}),

		() =>
			services.home.onFocusAccount(() => {
				actions.onFocusAccount();
			}),

		// ============================================================
		// Launchpad events — from standalone LaunchpadService
		// ============================================================

		() =>
			services.launchpad.onLaunchpadChanged(() => {
				actions.refreshLaunchpad();
			}),
	]);
}
