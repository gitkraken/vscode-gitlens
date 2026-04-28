import * as assert from 'assert';
import type { OverviewFilters } from '../../../home/protocol.js';
import { createAIState } from '../../shared/contexts/ai.js';
import { createIntegrationsState } from '../../shared/contexts/integrations.js';
import { createLaunchpadState } from '../../shared/contexts/launchpad.js';
import { createOnboardingState } from '../../shared/contexts/onboarding.js';
import { InMemoryStorage } from '../../shared/host/storage.js';
import type { SubscriptionActions } from '../events.js';
import { setupSubscriptions } from '../events.js';
import { createHomeState } from '../state.js';

suite('setupSubscriptions Test Suite', () => {
	test('should refresh only the inactive overview when the overview filter changes', async () => {
		const state = {
			home: createHomeState(new InMemoryStorage()),
			integrations: createIntegrationsState(),
			ai: createAIState(),
			onboarding: createOnboardingState(),
			launchpad: createLaunchpadState(),
			commands: { service: undefined },
		};

		let onOverviewFilterChanged: ((data: { filter: OverviewFilters }) => void) | undefined;

		const services = {
			home: {
				onWalkthroughProgressChanged: () => () => {},
				onPreviewChanged: () => () => {},
				onAiAllAccessBannerChanged: () => () => {},
				onOverviewRepositoryChanged: () => () => {},
				onOverviewFilterChanged: (callback: (data: { filter: OverviewFilters }) => void) => {
					onOverviewFilterChanged = callback;
					return () => {};
				},
				onFocusAccount: () => () => {},
				onAgentSessionsChanged: () => () => {},
			},
			launchpad: {
				onLaunchpadChanged: () => () => {},
			},
			config: {},
			subscription: {
				onSubscriptionChanged: () => () => {},
			},
			integrations: {
				onIntegrationsChanged: () => () => {},
			},
			repositories: {
				onDiscoveryCompleted: () => () => {},
				onRepositoriesChanged: () => () => {},
				onRepositoryChanged: () => () => {},
				getRepositoriesState: () =>
					Promise.resolve({ count: 0, openCount: 0, hasUnsafe: false, trusted: true }),
			},
			onboarding: {
				onDidChange: () => () => {},
			},
			ai: {
				onModelChanged: () => () => {},
				onStateChanged: () => () => {},
			},
		} as unknown as Parameters<typeof setupSubscriptions>[1];

		let refreshOverviewCalls = 0;
		let refreshInactiveOverviewCalls = 0;
		let syncedFilter: OverviewFilters | undefined;

		const actions = {
			refreshOverview: () => {
				refreshOverviewCalls++;
			},
			refreshInactiveOverview: () => {
				refreshInactiveOverviewCalls++;
			},
			replaceOverview: () => {},
			updateOverviewFilter: (filter: OverviewFilters) => {
				syncedFilter = filter;
				state.home.overviewFilter.set(filter);
			},
			onFocusAccount: () => {},
			onSubscriptionChanged: () => {},
			refreshLaunchpad: () => {},
			refreshAgentOverview: () => {},
		} satisfies SubscriptionActions;

		const unsubscribe = await setupSubscriptions(state, services, actions);
		const filter: OverviewFilters = {
			recent: { threshold: 'OneMonth' },
			stale: { threshold: 'OneYear', show: true, limit: 5 },
		};

		assert.ok(onOverviewFilterChanged, 'overview filter callback should be registered');
		onOverviewFilterChanged?.({ filter: filter });

		assert.deepStrictEqual(syncedFilter, filter);
		assert.deepStrictEqual(state.home.overviewFilter.get(), filter);
		assert.strictEqual(refreshInactiveOverviewCalls, 1);
		assert.strictEqual(refreshOverviewCalls, 0);

		unsubscribe();
	});

	test('should replace the overview immediately when the selected repository changes', async () => {
		const state = {
			home: createHomeState(new InMemoryStorage()),
			integrations: createIntegrationsState(),
			ai: createAIState(),
			onboarding: createOnboardingState(),
			launchpad: createLaunchpadState(),
			commands: { service: undefined },
		};

		let onOverviewRepositoryChanged: ((data: { repoPath: string | undefined }) => void) | undefined;

		const services = {
			home: {
				onWalkthroughProgressChanged: () => () => {},
				onPreviewChanged: () => () => {},
				onAiAllAccessBannerChanged: () => () => {},
				onOverviewRepositoryChanged: (callback: (data: { repoPath: string | undefined }) => void) => {
					onOverviewRepositoryChanged = callback;
					return () => {};
				},
				onOverviewFilterChanged: () => () => {},
				onFocusAccount: () => () => {},
				onAgentSessionsChanged: () => () => {},
			},
			launchpad: {
				onLaunchpadChanged: () => () => {},
			},
			config: {},
			subscription: {
				onSubscriptionChanged: () => () => {},
			},
			integrations: {
				onIntegrationsChanged: () => () => {},
			},
			repositories: {
				onDiscoveryCompleted: () => () => {},
				onRepositoriesChanged: () => () => {},
				onRepositoryChanged: () => () => {},
				getRepositoriesState: () =>
					Promise.resolve({ count: 0, openCount: 0, hasUnsafe: false, trusted: true }),
			},
			onboarding: {
				onDidChange: () => () => {},
			},
			ai: {
				onModelChanged: () => () => {},
				onStateChanged: () => () => {},
			},
		} as unknown as Parameters<typeof setupSubscriptions>[1];

		let replaceOverviewCalls = 0;
		const actions = {
			refreshOverview: () => {},
			refreshInactiveOverview: () => {},
			replaceOverview: () => {
				replaceOverviewCalls++;
			},
			updateOverviewFilter: () => {},
			onFocusAccount: () => {},
			onSubscriptionChanged: () => {},
			refreshLaunchpad: () => {},
			refreshAgentOverview: () => {},
		} satisfies SubscriptionActions;

		const unsubscribe = await setupSubscriptions(state, services, actions);

		assert.ok(onOverviewRepositoryChanged, 'overview repository callback should be registered');
		onOverviewRepositoryChanged?.({ repoPath: '/repo/selected' });

		assert.strictEqual(state.home.overviewRepositoryPath.get(), '/repo/selected');
		assert.strictEqual(replaceOverviewCalls, 1);

		unsubscribe();
	});
});
