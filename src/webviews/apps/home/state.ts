/**
 * Signal-based state management for the Home webview.
 *
 * State is instance-owned: the root component creates domain states,
 * provides them to children via Lit context, and passes them to
 * actions/events as a `HomeRootState` aggregate.
 *
 * Domain-scoped contexts (shared across webviews):
 * - integrationsContext — integration connection state
 * - aiContext — AI model and MCP state
 * - onboardingContext — banner visibility and walkthrough progress
 * - commandsContext — command dispatch service
 * - launchpadContext — launchpad summary and service
 * - subscriptionContext — host-pushed subscription signals
 *
 * Home-specific context:
 * - homeStateContext — repositories, overview filter, services
 */

import type { Remote } from '@eamodio/supertalk';
import { createContext } from '@lit/context';
import type { HomeServices } from '../../home/homeService.js';
import type { AgentSessionState, OverviewFilters } from '../../home/protocol.js';
import type { RepositoriesState } from '../../rpc/services/types.js';
import type { AIContextState } from '../shared/contexts/ai.js';
import type { CommandsState } from '../shared/contexts/commands.js';
import type { IntegrationsState } from '../shared/contexts/integrations.js';
import type { LaunchpadState } from '../shared/contexts/launchpad.js';
import type { OnboardingState } from '../shared/contexts/onboarding.js';
import type { HostStorage } from '../shared/host/storage.js';
import { createStateGroup } from '../shared/state/signals.js';

type ResolvedHome = Awaited<Remote<HomeServices>['home']>;
type ResolvedBranches = Awaited<Remote<HomeServices>['branches']>;

const defaultOverviewFilter: OverviewFilters = {
	recent: { threshold: 'OneWeek' },
	stale: { threshold: 'OneYear', show: false, limit: 9 },
};

/**
 * Creates a new Home state instance with Home-specific signals.
 * Domain-specific signals live in their own contexts (integrations, AI, onboarding, etc.).
 *
 * @param storage - Optional host storage for persisting UI state.
 */
export function createHomeState(storage?: HostStorage) {
	const { signal, persisted, resetAll, startAutoPersist, dispose } = createStateGroup({
		storage: storage,
		version: 1,
	});

	return {
		// ── Infrastructure ──

		/** Whether the webview is currently loading data. */
		loading: signal(false),
		/** Current error message, if any. */
		error: signal<string | undefined>(undefined),

		// ── Child-read state (distributed via homeStateContext) ──

		/** Aggregate repository state. */
		repositories: signal<RepositoriesState>({ count: 0, openCount: 0, hasUnsafe: false, trusted: true }),
		/** Whether repository discovery is in progress. */
		discovering: signal(false),
		/** Whether initial data has loaded (render gate for main content). */
		ready: signal(false),

		// ── Root/actions-only state (NOT needed by most children) ──

		/** Selected overview repository path — persisted across sessions. */
		overviewRepositoryPath: persisted<string | undefined>('overviewRepositoryPath', undefined),
		/** Current overview filter state — persisted across sessions. */
		overviewFilter: persisted<OverviewFilters>('overviewFilter', defaultOverviewFilter),
		/** Whether walkthrough is supported. */
		walkthroughSupported: signal(false),
		/** Whether this is a new install. */
		newInstall: signal(false),
		/** Host application name. */
		hostAppName: signal(''),
		/** Active agent sessions. */
		agentSessions: signal<AgentSessionState[]>([]),

		/** Resolved `home` sub-service from RPC. Available after RPC connection. Set once, not reactive. */
		homeService: undefined as ResolvedHome | undefined,

		/** Resolved `branches` sub-service from RPC. Used by `gl-branch-card` to lazy-fetch
		 * merge-target-status on first expand. Available after RPC connection. Set once, not reactive. */
		branchesService: undefined as ResolvedBranches | undefined,

		/** Reset all Home state to initial values. */
		resetAll: resetAll,
		/** Start auto-persistence for persisted signals. Returns cleanup function. */
		startAutoPersist: startAutoPersist,
		/** Dispose state group (stop watcher, clear registrations). */
		dispose: dispose,
	};
}

/** Home state type — the return value of `createHomeState()`. */
export type HomeState = ReturnType<typeof createHomeState>;

/** Lit context key for distributing Home state to child components. */
export const homeStateContext = createContext<HomeState>('homeState');

/**
 * Internal aggregate of all domain states — used by home.ts, actions.ts,
 * events.ts only. Never exposed via context.
 */
export interface HomeRootState {
	home: HomeState;
	integrations: IntegrationsState;
	ai: AIContextState;
	onboarding: OnboardingState;
	launchpad: LaunchpadState;
	commands: CommandsState;
}
