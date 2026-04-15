import * as assert from 'assert';
import type { OverviewFilters } from '../../../home/protocol.js';
import { createAIState } from '../../shared/contexts/ai.js';
import { createIntegrationsState } from '../../shared/contexts/integrations.js';
import { createLaunchpadState } from '../../shared/contexts/launchpad.js';
import { createOnboardingState } from '../../shared/contexts/onboarding.js';
import { InMemoryStorage } from '../../shared/host/storage.js';
import { populateInitialState, restoreOverviewFilter } from '../actions.js';
import { createHomeState } from '../state.js';

function createRootState() {
	return {
		home: createHomeState(new InMemoryStorage()),
		integrations: createIntegrationsState(),
		ai: createAIState(),
		onboarding: createOnboardingState(),
		launchpad: createLaunchpadState(),
		commands: { service: undefined },
	};
}

async function flushPromises(): Promise<void> {
	// Enough microtask ticks to settle the async chain through:
	// restoreOverviewFilter (2 awaits + async wrapper unwrap) > Promise.all > .then callback
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
}

suite('home actions', () => {
	test('restoreOverviewFilter should sync the persisted filter to the host before reading it back', async () => {
		const state = createRootState();
		const persisted: OverviewFilters = {
			recent: { threshold: 'OneMonth' },
			stale: { threshold: 'OneYear', show: true, limit: 5 },
		};

		const syncedToHost: OverviewFilters[] = [];
		const appliedLocally: OverviewFilters[] = [];
		state.home.overviewFilter.set(persisted);

		await restoreOverviewFilter(
			state.home,
			{
				setOverviewFilter: async filter => {
					syncedToHost.push(filter);
				},
				getOverviewFilterState: async () => persisted,
			},
			filter => {
				appliedLocally.push(filter);
			},
		);

		assert.deepStrictEqual(syncedToHost, [persisted]);
		assert.deepStrictEqual(appliedLocally, [persisted, persisted]);
		assert.deepStrictEqual(state.home.overviewFilter.get(), persisted);
	});

	test('populateInitialState should wait for the host filter restore before marking the view ready', async () => {
		const state = createRootState();
		const persisted: OverviewFilters = {
			recent: { threshold: 'OneMonth' },
			stale: { threshold: 'OneYear', show: true, limit: 5 },
		};
		state.home.overviewFilter.set(persisted);

		let resolveFilterRestore!: () => void;
		const filterRestore = new Promise<void>(resolve => {
			resolveFilterRestore = resolve;
		});

		populateInitialState(
			state,
			{
				getInitialContext: async () => ({
					discovering: false,
					repositories: { count: 1, openCount: 1, hasUnsafe: false, trusted: true },
					walkthroughSupported: true,
					newInstall: false,
					hostAppName: 'VS Code',
					orgSettings: { ai: true, drafts: true },
				}),
				getWalkthroughProgress: async () => undefined,
				getOverviewFilterState: async () => persisted,
				setOverviewFilter: async () => filterRestore,
				getAgentSessions: async () => [],
			} as any,
			{} as any,
			{ getIntegrationStates: async () => [] } as any,
			{} as any,
			{ getModel: async () => undefined, getState: async () => undefined } as any,
		);

		await flushPromises();
		assert.strictEqual(state.home.ready.get(), false);

		resolveFilterRestore();
		await flushPromises();

		assert.strictEqual(state.home.ready.get(), true);
		assert.deepStrictEqual(state.home.overviewFilter.get(), persisted);
	});
});
