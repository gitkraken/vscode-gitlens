/**
 * Actions for the Home webview.
 *
 * This module contains data-fetching logic separated from the Lit component.
 * The Lit component delegates here after RPC is ready.
 *
 * All functions receive the `HomeRootState` aggregate as a parameter — no
 * module-level singletons. The root component passes the state it owns.
 *
 * Patterns used:
 * - Progressive population: Tier 1 (layout-critical), Tier 2 (header), Tier 3 (secondary)
 * - Fire-and-forget with `.then(setter, noop)`: each RPC sets its signal independently
 */
import type { Remote } from '@eamodio/supertalk';
import { Logger } from '../../../system/logger.js';
import type { HomeServices } from '../../home/homeService.js';
import type { OverviewFilters } from '../../home/protocol.js';
import { noop } from '../shared/actions/rpc.js';
import type { LaunchpadService, LaunchpadState } from '../shared/contexts/launchpad.js';
import type { HomeRootState } from './state.js';

/**
 * Resolved sub-service types (after awaiting the sub-service property from the Remote proxy).
 */
type ResolvedHome = Awaited<Remote<HomeServices>['home']>;
/**
 * Callback for setting the inactive overview filter after it's fetched.
 * Keeps the overview state object ownership in the Lit component.
 */
export type OverviewFilterSetter = (filter: OverviewFilters) => void;

type OverviewRepositorySelectionState = Pick<HomeRootState['home'], 'overviewRepositoryPath'>;
type OverviewRepositorySelectionService = Pick<ResolvedHome, 'getOverviewRepositoryState' | 'setOverviewRepository'>;

/**
 * Fire all initial data fetches concurrently. Each sets its signal as it
 * resolves so the UI renders progressively.
 *
 * Layout-critical data (initialContext + previewState) is grouped so the
 * main content area doesn't flash the wrong layout.
 */
export function populateInitialState(
	state: HomeRootState,
	home: ResolvedHome,
	_subscription: Awaited<Remote<HomeServices>['subscription']>,
	integrations: Awaited<Remote<HomeServices>['integrations']>,
	git: Awaited<Remote<HomeServices>['git']>,
	ai: Awaited<Remote<HomeServices>['ai']>,
	setOverviewFilter?: OverviewFilterSetter,
): void {
	const applyOverviewFilter = (filter: OverviewFilters): void => {
		state.home.overviewFilter.set(filter);
		setOverviewFilter?.(filter);
	};

	// Persisted state (overviewFilter) is restored synchronously by createStateGroup's persisted()
	// on construction — no manual restore needed here. Seed the local overview filter state from
	// the persisted signal until the host sends back the authoritative filter.
	applyOverviewFilter(state.home.overviewFilter.get());

	// Tier 1 — Layout-critical: group these so we don't render main content
	// with the wrong layout (preview vs classic). Set initialContext LAST
	// since it's the render gate for main content.
	// Note: orgSettings removed — bridged from host-side signal
	void Promise.all([home.getInitialContext(), home.getPreviewState()]).then(
		([ctx, preview]) => {
			state.home.discovering.set(ctx.discovering);
			state.home.repositories.set(ctx.repositories);
			state.home.walkthroughSupported.set(ctx.walkthroughSupported);
			state.home.newInstall.set(ctx.newInstall);
			state.home.hostAppName.set(ctx.hostAppName);
			state.onboarding.banners.integrationBanner = !ctx.integrationBannerCollapsed;
			state.onboarding.banners.amaBanner = !ctx.amaBannerCollapsed;
			state.home.previewState.set(preview);
			state.home.initialContext.set(ctx); // render gate — set last
		},
		(ex: unknown) => {
			Logger.error(ex, 'Home: Failed to fetch initial context');
			state.home.error.set(ex instanceof Error ? ex.message : 'Failed to load');
		},
	);

	// Tier 2 — Header data: integrations chip
	// Note: subscription, avatar, hasAccount, organizationsCount, orgSettings are bridged from host-side signals
	void integrations.getIntegrationStates().then(s => state.integrations.integrations.set(s), noop);
	void integrations.hasAnyConnected().then(h => state.integrations.hasAnyIntegrationConnected.set(h), noop);
	void ai.getModel().then(m => state.ai.aiModel.set(m), noop);

	// Tier 3 — Secondary data: banners, filters, and content
	void git.getRepositoriesState().then(s => state.home.repositories.set(s), noop);
	void home.getWalkthroughProgress().then(w => state.onboarding.walkthroughProgress.set(w), noop);
	void home.isAiAllAccessBannerCollapsed().then(c => {
		state.onboarding.banners.aiAllAccessBanner = !c;
	}, noop);
	void ai.getState().then(s => state.ai.aiState.set(s), noop);
	void home.getOverviewFilterState().then(f => {
		applyOverviewFilter(f);
		// Persistence is handled automatically by startAutoPersist()
	}, noop);
	// Launchpad summary is deferred — fetched when GlLaunchpad mounts (connectedCallback)
}

export async function restoreOverviewRepositoryPath(
	state: OverviewRepositorySelectionState,
	home: OverviewRepositorySelectionService,
): Promise<void> {
	try {
		const persistedOverviewRepositoryPath = state.overviewRepositoryPath.get();
		if (persistedOverviewRepositoryPath != null) {
			const restoredOverviewRepositoryPath = await home.setOverviewRepository(persistedOverviewRepositoryPath);
			state.overviewRepositoryPath.set(restoredOverviewRepositoryPath);
			return;
		}

		const currentOverviewRepositoryPath = await home.getOverviewRepositoryState();
		if (currentOverviewRepositoryPath != null) {
			state.overviewRepositoryPath.set(currentOverviewRepositoryPath);
		}
	} catch (ex) {
		Logger.error(ex, 'Home: Failed to restore overview repository path');
	}
}

/**
 * Fetch launchpad summary and update signal.
 */
export async function fetchLaunchpadSummary(state: LaunchpadState, launchpad: LaunchpadService): Promise<void> {
	state.launchpadLoading.set(true);
	try {
		const summary = await launchpad.getSummary();
		state.launchpadSummary.set(summary);
	} catch (ex) {
		Logger.error(ex, 'Home: Failed to fetch launchpad summary');
		state.launchpadSummary.set({ error: ex instanceof Error ? ex : new Error('Failed to load') });
	} finally {
		state.launchpadLoading.set(false);
	}
}
