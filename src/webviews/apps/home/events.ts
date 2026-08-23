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
 * - Home-specific events (overview, walkthrough, banners, focus) from HomeViewService
 * - Launchpad events from standalone LaunchpadService
 */
import type { Connection, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import { Logger } from '@gitlens/utils/logger.js';
import type { WalkthroughProgress } from '../../../constants.walkthroughs.js';
import type { HomeServices } from '../../home/homeService.js';
import type { AgentSessionState, OverviewFilters } from '../../home/protocol.js';
import type {
	AiModelInfo,
	AIState,
	IntegrationChangeEventData,
	RepositoriesState,
	RepositoryChange,
	RepositoryChangeEventData,
} from '../../rpc/services/types.js';
import { isConnectionClosedError } from '../shared/actions/rpc.js';
import { sortAgentSessions } from '../shared/agentUtils.js';
import { subscribeAll } from '../shared/events/subscriptions.js';
import type { HomeRootState } from './state.js';

/**
 * Per-change overview-refresh scope.
 *
 * - `'active'` — only the active branch's slice can shift (WIP, paused-op progress); skip inactive.
 * - `'both'` — could affect inactive list ordering, presence, or enrichment; refresh both.
 * - `'none'` — irrelevant to overview surfaces; skip refresh entirely.
 *
 * Defined as an exhaustive `Record<RepositoryChange, …>` so adding a new `RepositoryChange`
 * value forces a classification decision at compile time (no silent fallthrough).
 */
type OverviewChangeScope = 'none' | 'active' | 'both';
const overviewChangeScope: Record<RepositoryChange, OverviewChangeScope> = {
	// Active-only — WIP / paused-op state on the current branch
	index: 'active',
	pausedOp: 'active',
	cherryPick: 'active',
	merge: 'active',
	rebase: 'active',
	revert: 'active',

	// Both — topology, HEAD movement, or enrichment-affecting (PR/tracking)
	head: 'both',
	heads: 'both',
	worktrees: 'both',
	remotes: 'both',

	// Conservative — system-level events that could shift anything
	unknown: 'both',
	closed: 'both',
	opened: 'both',

	// Irrelevant — overview surfaces don't render these
	tags: 'none',
	stash: 'none',
	config: 'none',
	starred: 'none',
	ignores: 'none',
	remoteProviders: 'none',
	gkConfig: 'none',
	lastFetched: 'none',
};

/**
 * Callback interface for actions that the entry point needs to handle
 * (e.g., triggering overview refreshes, showing the header).
 */
export interface SubscriptionActions {
	/** Called when the overview data should be refreshed. */
	refreshOverview(): void;
	/** Called when only the active overview data should be refreshed (FS edits, index changes — anything that can't shift the inactive list). */
	refreshActiveOverview(): void;
	/** Called when the active overview must refresh NOW, without the usual debounce — the busy state of a
	 *  paused-operation continue/skip is only correct for as long as it matches the host's in-flight set. */
	refreshActiveOverviewNow(): void;
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
	/** Called when agent overview branches should be refreshed. */
	refreshAgentOverview(): void;
}

/**
 * Set up all event subscriptions from the backend.
 * Accepts the RPC connection, the root state aggregate, and action callbacks.
 * The library re-runs the subscriber on every successful handshake (including reconnects),
 * so it re-resolves sub-services and re-subscribes each time.
 */
export function setupSubscriptions(
	connection: Connection,
	state: HomeRootState,
	actions: SubscriptionActions,
): Subscription {
	return subscribe<HomeServices>(connection, async services => {
		const [home, launchpad, subscription, integrations, repositories, onboarding, ai, agents] = await Promise.all([
			services.home,
			services.launchpad,
			services.subscription,
			services.integrations,
			services.repositories,
			services.onboarding,
			services.ai,
			services.agents,
		]);

		return subscribeAll([
			// ============================================================
			// Generic events — from WebviewEventsService
			// ============================================================

			// Subscription changed — state flows via the bridged signals, whose freshness is
			// guaranteed by SubscriptionService's eager listeners (#5513); this subscription
			// exists solely for its side effects and is safe to remove if they go away
			() =>
				subscription.onSubscriptionChanged(() => {
					actions.onSubscriptionChanged();
				}),

			// Integrations changed (includes full state data)
			() =>
				integrations.onIntegrationsChanged((data: IntegrationChangeEventData) => {
					state.integrations.hasAnyIntegrationConnected.set(data.hasAnyConnected);
					state.integrations.integrations.set(data.integrations);
					actions.refreshOverview();
				}),

			// Note: onOrgSettingsChanged removed — the bridged orgSettings signal is kept fresh
			// by SubscriptionService's eager listeners (#5513)

			// Repository discovery completed
			() =>
				repositories.onDiscoveryCompleted((repos: RepositoriesState) => {
					state.home.repositories.set(repos);
					state.home.discovering.set(false);
					actions.refreshOverview();
				}),

			// Repositories changed (add/remove)
			() =>
				repositories.onRepositoriesChanged(() => {
					void repositories.getRepositoriesState().then(
						repos => {
							state.home.repositories.set(repos);
						},
						(ex: unknown) => {
							if (isConnectionClosedError(ex)) {
								Logger.debug('Home: repositories refetch dropped by deliberate connection teardown');
								return;
							}

							Logger.error(ex, 'Home: Failed to refetch repositories state');
						},
					);
					actions.refreshOverview();
				}),

			// Per-repository git-level changes (index, head, etc.)
			// Uses the all-repos event because the overview shows WIP across worktrees
			// which may be in different repo paths.
			// Dispatch by `event.changes` via the `overviewChangeScope` map below so that flags
			// which can only shift the active branch's data (e.g. `index`/`pausedOp`) don't
			// re-fetch the inactive list's skeleton + WIP + enrichment for every commit.
			() =>
				repositories.onRepositoryChanged((event: RepositoryChangeEventData) => {
					const overviewRepo = state.home.overviewRepositoryPath.get();
					if (overviewRepo == null || event.repoPath !== overviewRepo) return;

					let needsActive = false;
					let needsInactive = false;
					for (const c of event.changes) {
						const scope = overviewChangeScope[c];
						if (scope === 'active') {
							needsActive = true;
						} else if (scope === 'both') {
							needsActive = true;
							needsInactive = true;
						}
					}

					if (needsActive) {
						actions.refreshActiveOverview();
					}
					if (needsInactive) {
						actions.refreshInactiveOverview();
					}
				}),

			// ============================================================
			// Home-specific events — from HomeViewService
			// ============================================================

			() =>
				home.onWalkthroughProgressChanged((progress: WalkthroughProgress) => {
					state.onboarding.walkthroughProgress.set(progress);
				}),

			// Both edges of a continue/skip need a fetch: the start so the bar goes busy even when the click
			// came from another surface, and the settle because the repo change the command produces carries
			// the paused op's OWN path — which the handler above drops when that's a worktree rather than the
			// selected overview repo, leaving the bar stranded on its host-reported busy state.
			() =>
				home.onPausedOperationContinuingChanged(() => {
					actions.refreshActiveOverviewNow();
				}),

			// ============================================================
			// Onboarding events — from shared OnboardingRpcService
			// ============================================================

			() =>
				onboarding.onDidChange((e: { key: string; dismissed: boolean }) => {
					if (e.key === 'home:integrationBanner') {
						state.onboarding.banners.integrationBanner = !e.dismissed;
					} else if (e.key === 'agents:banner') {
						state.onboarding.banners.agentsBanner = !e.dismissed;
					}
				}),

			// ============================================================
			// Generic AI events — from AIService
			// ============================================================

			() =>
				ai.onModelChanged((model: AiModelInfo | undefined) => {
					state.ai.model.set(model);
				}),

			() =>
				ai.onStateChanged((aiState: AIState) => {
					state.ai.state.set(aiState);
				}),

			// ============================================================
			// Home-specific events (continued) — from HomeViewService
			// ============================================================

			() =>
				home.onOverviewRepositoryChanged((data: { repoPath: string | undefined }) => {
					state.home.overviewRepositoryPath.set(data.repoPath);
					actions.replaceOverview();
				}),

			() =>
				home.onOverviewFilterChanged((data: { filter: OverviewFilters }) => {
					// Persistence is handled automatically by startAutoPersist()
					actions.updateOverviewFilter(data.filter);
					actions.refreshInactiveOverview();
				}),

			() =>
				home.onFocusAccount(() => {
					actions.onFocusAccount();
				}),

			// ============================================================
			// Launchpad events — from standalone LaunchpadService
			// ============================================================

			() =>
				launchpad.onLaunchpadChanged(() => {
					actions.refreshLaunchpad();
				}),

			// ============================================================
			// Agent sessions — from AgentsService
			// ============================================================

			// The agent status service emits bursts of `onSessionsChanged` as it scans state
			// from disk (phase/status/timestamp churn on the same set of sessions). Refetching the
			// agent overview on every event cascades through `createResource`'s cancelPrevious=true
			// and starves the in-flight RPC. The branch list rendered by the agent overview is
			// keyed on `worktreePath` (see `findOverviewBranchForSession`), so the overview only
			// needs to refetch when that set changes — session churn is covered by the
			// `agentSessions` signal write above.
			() => {
				let lastAgentBranchKey: string | undefined;
				return agents.onSessionsChanged((sessions: AgentSessionState[]) => {
					state.home.agentSessions.set(sortAgentSessions(sessions));
					const key = [...new Set(sessions.map(s => s.worktreePath ?? ''))].sort().join('\n');
					if (key !== lastAgentBranchKey) {
						lastAgentBranchKey = key;
						actions.refreshAgentOverview();
					}
				});
			},
		]);
	});
}
