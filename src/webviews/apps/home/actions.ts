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
 * - Fire-and-forget with `.then(setter, noop)`: each RPC sets its signal independently
 */
import type { Remote } from '@eamodio/supertalk';
import { Logger } from '@gitlens/utils/logger.js';
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

type OverviewFilterSelectionState = Pick<HomeRootState['home'], 'overviewFilter'>;
type OverviewFilterSelectionService = Pick<ResolvedHome, 'getOverviewFilterState' | 'setOverviewFilter'>;
type OverviewRepositorySelectionState = Pick<HomeRootState['home'], 'overviewRepositoryPath'>;
type OverviewRepositorySelectionService = Pick<ResolvedHome, 'getOverviewRepositoryState' | 'setOverviewRepository'>;

export async function restoreOverviewFilter(
	state: OverviewFilterSelectionState,
	home: OverviewFilterSelectionService,
	setOverviewFilter?: OverviewFilterSetter,
): Promise<void> {
	const applyOverviewFilter = (filter: OverviewFilters): void => {
		state.overviewFilter.set(filter);
		setOverviewFilter?.(filter);
	};

	const persistedOverviewFilter = state.overviewFilter.get();
	applyOverviewFilter(persistedOverviewFilter);

	try {
		await home.setOverviewFilter(persistedOverviewFilter);
		applyOverviewFilter(await home.getOverviewFilterState());
	} catch (ex) {
		Logger.error(ex, 'Home: Failed to restore overview filter');
	}
}

/**
 * Fire all initial data fetches concurrently. Each sets its signal as it
 * resolves so the UI renders progressively.
 *
 * Layout-critical data is fetched first so the main content area
 * renders promptly. The `ready` signal gates rendering.
 *
 * Returns a promise that settles when the `ready` gate resolves (either set
 * to true or `error` set). Callers can await this to race against a timeout.
 */
export function populateInitialState(
	state: HomeRootState,
	home: ResolvedHome,
	_subscription: Awaited<Remote<HomeServices>['subscription']>,
	integrations: Awaited<Remote<HomeServices>['integrations']>,
	_repositories: Awaited<Remote<HomeServices>['repositories']>,
	ai: Awaited<Remote<HomeServices>['ai']>,
	setOverviewFilter?: OverviewFilterSetter,
): Promise<void> {
	// Layout-critical: set ready LAST since it's the render gate for main content.
	// Restore the persisted overview filter onto the host before rendering children,
	// so the first overview fetch uses the user's saved thresholds instead of defaults.
	//
	// Use `Promise.allSettled` (not `Promise.all`) so a rejection from either side
	// doesn't short-circuit the other — and more importantly, we always settle and
	// therefore always either set `ready` or `error`, instead of leaving skeletons
	// rendering forever.
	const gate = Promise.allSettled([
		home.getInitialContext(),
		restoreOverviewFilter(state.home, home, setOverviewFilter),
	]).then(([ctxResult]) => {
		if (ctxResult.status === 'fulfilled') {
			const ctx = ctxResult.value;
			state.home.discovering.set(ctx.discovering);
			state.home.repositories.set(ctx.repositories);
			state.home.walkthroughSupported.set(ctx.walkthroughSupported);
			state.home.newInstall.set(ctx.newInstall);
			state.home.hostAppName.set(ctx.hostAppName);
			state.home.ready.set(true); // render gate — set last
		} else {
			const ex = ctxResult.reason;
			Logger.error(ex, 'Home: Failed to fetch initial context');
			state.home.error.set(ex instanceof Error ? ex.message : 'Failed to load');
		}
	});

	// Header data: integrations chip
	// Note: subscription, avatar, hasAccount, organizationsCount, orgSettings are bridged from host-side signals
	void integrations.getIntegrationStates().then(s => {
		state.integrations.integrations.set(s);
		state.integrations.hasAnyIntegrationConnected.set(s.some(i => i.connected));
	}, noop);
	void ai.getModel().then(m => state.ai.model.set(m), noop);

	// Secondary data: banners, filters, and content
	// Note: repositories already set from getInitialContext() above; event-driven updates keep it fresh
	void home.getWalkthroughProgress().then(w => state.onboarding.walkthroughProgress.set(w), noop);
	void home.getAgentSessions().then(s => state.home.agentSessions.set(s), noop);
	void ai.getState().then(s => state.ai.state.set(s), noop);
	// Launchpad summary is deferred — fetched when GlLaunchpad mounts (connectedCallback)

	return gate;
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
