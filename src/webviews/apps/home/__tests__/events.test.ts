import * as assert from 'node:assert';
import { MessageChannel } from 'node:worker_threads';
import type { Endpoint } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import type { OverviewFilters } from '../../../home/protocol.js';
import type { RepositoryChange, RepositoryChangeEventData } from '../../../rpc/services/types.js';
import { createAIState } from '../../shared/contexts/ai.js';
import { createIntegrationsState } from '../../shared/contexts/integrations.js';
import { createLaunchpadState } from '../../shared/contexts/launchpad.js';
import { createOnboardingState } from '../../shared/contexts/onboarding.js';
import { InMemoryStorage } from '../../shared/host/storage.js';
import type { SubscriptionActions } from '../events.js';
import { setupSubscriptions } from '../events.js';
import { createHomeState } from '../state.js';

/** Node's MessagePort is an EventTarget, so it satisfies Supertalk's Endpoint directly. */
function asEndpoint(port: import('node:worker_threads').MessagePort): Endpoint {
	return port as unknown as Endpoint;
}

/** Real supertalk `Connection` pair over a `MessageChannel`, mirroring how RpcController connects. */
function createConnectionPair(): { host: Connection; client: Connection; close: () => void } {
	const { port1, port2 } = new MessageChannel();
	const host = new Connection(asEndpoint(port1), { nestedProxies: true });
	const client = new Connection(asEndpoint(port2), { nestedProxies: true });

	return {
		host: host,
		client: client,
		close: () => {
			host.close();
			client.close();
			port1.close();
			port2.close();
		},
	};
}

/** Enough time for a same-process MessageChannel round trip to complete. */
const tick = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface CapturedHandlers {
	onOverviewFilterChanged?: (data: { filter: OverviewFilters }) => void;
	onOverviewRepositoryChanged?: (data: { repoPath: string | undefined }) => void;
	onPausedOperationContinuingChanged?: () => void;
	onRepositoryChanged?: (event: RepositoryChangeEventData) => void;
}

/**
 * Fake Home remote exposing every sub-service `setupSubscriptions` resolves. Registrations for
 * the events exercised by the tests below are captured so the test can fire them manually; the
 * rest are trivial no-ops.
 */
function createFakeHomeRemote(): { remote: object; captured: CapturedHandlers } {
	const captured: CapturedHandlers = {};
	const remote = {
		home: {
			onWalkthroughProgressChanged: () => () => {},
			onPausedOperationContinuingChanged: (callback: () => void) => {
				captured.onPausedOperationContinuingChanged = callback;
				return () => {};
			},
			onOverviewRepositoryChanged: (callback: (data: { repoPath: string | undefined }) => void) => {
				captured.onOverviewRepositoryChanged = callback;
				return () => {};
			},
			onOverviewFilterChanged: (callback: (data: { filter: OverviewFilters }) => void) => {
				captured.onOverviewFilterChanged = callback;
				return () => {};
			},
			onFocusAccount: () => () => {},
		},
		launchpad: {
			onLaunchpadChanged: () => () => {},
		},
		subscription: {
			onSubscriptionChanged: () => () => {},
		},
		integrations: {
			onIntegrationsChanged: () => () => {},
		},
		repositories: {
			onDiscoveryCompleted: () => () => {},
			onRepositoriesChanged: () => () => {},
			onRepositoryChanged: (callback: (event: RepositoryChangeEventData) => void) => {
				captured.onRepositoryChanged = callback;
				return () => {};
			},
			getRepositoriesState: () => Promise.resolve({ count: 0, openCount: 0, hasUnsafe: false, trusted: true }),
		},
		onboarding: {
			onDidChange: () => () => {},
		},
		ai: {
			onModelChanged: () => () => {},
			onStateChanged: () => () => {},
		},
		agents: {
			onSessionsChanged: () => () => {},
		},
	};

	return { remote: remote, captured: captured };
}

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

suite('setupSubscriptions Test Suite', () => {
	test('should refresh only the inactive overview when the overview filter changes', async () => {
		const state = createRootState();
		const { remote, captured } = createFakeHomeRemote();
		const { host, client, close } = createConnectionPair();
		host.expose(remote);

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
			refreshActiveOverview: () => {},
			refreshActiveOverviewNow: () => {},
		} satisfies SubscriptionActions;

		const subscription = setupSubscriptions(client, state, actions);
		void client.waitForReady();
		await tick();

		const filter: OverviewFilters = {
			recent: { threshold: 'OneMonth' },
			stale: { threshold: 'OneYear', show: true, limit: 5 },
		};

		assert.ok(captured.onOverviewFilterChanged, 'overview filter callback should be registered');
		captured.onOverviewFilterChanged?.({ filter: filter });
		await tick();

		assert.deepStrictEqual(syncedFilter, filter);
		assert.deepStrictEqual(state.home.overviewFilter.get(), filter);
		assert.strictEqual(refreshInactiveOverviewCalls, 1);
		assert.strictEqual(refreshOverviewCalls, 0);

		subscription.unsubscribe();
		close();
	});

	test('should replace the overview immediately when the selected repository changes', async () => {
		const state = createRootState();
		const { remote, captured } = createFakeHomeRemote();
		const { host, client, close } = createConnectionPair();
		host.expose(remote);

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
			refreshActiveOverview: () => {},
			refreshActiveOverviewNow: () => {},
		} satisfies SubscriptionActions;

		const subscription = setupSubscriptions(client, state, actions);
		void client.waitForReady();
		await tick();

		assert.ok(captured.onOverviewRepositoryChanged, 'overview repository callback should be registered');
		captured.onOverviewRepositoryChanged?.({ repoPath: '/repo/selected' });
		await tick();

		assert.strictEqual(state.home.overviewRepositoryPath.get(), '/repo/selected');
		assert.strictEqual(replaceOverviewCalls, 1);

		subscription.unsubscribe();
		close();
	});

	test('should refresh the active overview immediately when a paused operation continue starts or settles', async () => {
		const state = createRootState();
		const { remote, captured } = createFakeHomeRemote();
		const { host, client, close } = createConnectionPair();
		host.expose(remote);

		let nowCalls = 0;
		let activeCalls = 0;
		let inactiveCalls = 0;
		let overviewCalls = 0;

		const actions = {
			refreshOverview: () => {
				overviewCalls++;
			},
			refreshActiveOverview: () => {
				activeCalls++;
			},
			refreshActiveOverviewNow: () => {
				nowCalls++;
			},
			refreshInactiveOverview: () => {
				inactiveCalls++;
			},
			replaceOverview: () => {},
			updateOverviewFilter: () => {},
			onFocusAccount: () => {},
			onSubscriptionChanged: () => {},
			refreshLaunchpad: () => {},
			refreshAgentOverview: () => {},
		} satisfies SubscriptionActions;

		const subscription = setupSubscriptions(client, state, actions);
		void client.waitForReady();
		await tick();

		assert.ok(
			captured.onPausedOperationContinuingChanged,
			'paused operation continuing callback should be registered',
		);

		// The start edge and the settle edge are the same event — both must land, and neither may go
		// through a debounce that could outlive the state it reports.
		captured.onPausedOperationContinuingChanged?.();
		captured.onPausedOperationContinuingChanged?.();
		await tick();

		assert.strictEqual(nowCalls, 2);
		assert.strictEqual(activeCalls, 0);
		assert.strictEqual(inactiveCalls, 0);
		assert.strictEqual(overviewCalls, 0);

		subscription.unsubscribe();
		close();
	});

	suite('onRepositoryChanged dispatch', () => {
		async function run(
			changes: RepositoryChange[],
			repoPath?: string,
			...overviewRepoPathArg: [overviewRepoPath?: string | undefined]
		): Promise<{ activeCalls: number; inactiveCalls: number; overviewCalls: number }> {
			// Defaults are applied manually so an explicit `undefined` for `overviewRepoPath`
			// is preserved (a `param = default` declaration replaces explicit `undefined` with
			// the default, masking the "no overview repo selected" test case).
			repoPath ??= '/repo/selected';
			const overviewRepoPath = overviewRepoPathArg.length > 0 ? overviewRepoPathArg[0] : '/repo/selected';

			const state = createRootState();
			state.home.overviewRepositoryPath.set(overviewRepoPath);

			const { remote, captured } = createFakeHomeRemote();
			const { host, client, close } = createConnectionPair();
			host.expose(remote);

			let activeCalls = 0;
			let inactiveCalls = 0;
			let overviewCalls = 0;

			const actions = {
				refreshOverview: () => {
					overviewCalls++;
				},
				refreshActiveOverview: () => {
					activeCalls++;
				},
				refreshActiveOverviewNow: () => {
					activeCalls++;
				},
				refreshInactiveOverview: () => {
					inactiveCalls++;
				},
				replaceOverview: () => {},
				updateOverviewFilter: () => {},
				onFocusAccount: () => {},
				onSubscriptionChanged: () => {},
				refreshLaunchpad: () => {},
				refreshAgentOverview: () => {},
			} satisfies SubscriptionActions;

			const subscription = setupSubscriptions(client, state, actions);
			void client.waitForReady();
			await tick();

			assert.ok(captured.onRepositoryChanged, 'repository changed callback should be registered');
			captured.onRepositoryChanged?.({ repoPath: repoPath, repoUri: `file://${repoPath}`, changes: changes });
			await tick();

			subscription.unsubscribe();
			close();
			return { activeCalls: activeCalls, inactiveCalls: inactiveCalls, overviewCalls: overviewCalls };
		}

		test('index → active only', async () => {
			const r = await run(['index']);
			assert.strictEqual(r.activeCalls, 1);
			assert.strictEqual(r.inactiveCalls, 0);
			assert.strictEqual(r.overviewCalls, 0);
		});

		test('pausedOp → active only', async () => {
			const r = await run(['pausedOp']);
			assert.strictEqual(r.activeCalls, 1);
			assert.strictEqual(r.inactiveCalls, 0);
		});

		test('heads → both', async () => {
			const r = await run(['heads']);
			assert.strictEqual(r.activeCalls, 1);
			assert.strictEqual(r.inactiveCalls, 1);
			assert.strictEqual(r.overviewCalls, 0);
		});

		test('worktrees → both', async () => {
			const r = await run(['worktrees']);
			assert.strictEqual(r.activeCalls, 1);
			assert.strictEqual(r.inactiveCalls, 1);
		});

		test('head → both', async () => {
			const r = await run(['head']);
			assert.strictEqual(r.activeCalls, 1);
			assert.strictEqual(r.inactiveCalls, 1);
		});

		test('remotes → both (PR/tracking enrichment may shift)', async () => {
			const r = await run(['remotes']);
			assert.strictEqual(r.activeCalls, 1);
			assert.strictEqual(r.inactiveCalls, 1);
		});

		test('stash → none', async () => {
			const r = await run(['stash']);
			assert.strictEqual(r.activeCalls, 0);
			assert.strictEqual(r.inactiveCalls, 0);
			assert.strictEqual(r.overviewCalls, 0);
		});

		test('config → none', async () => {
			const r = await run(['config']);
			assert.strictEqual(r.activeCalls, 0);
			assert.strictEqual(r.inactiveCalls, 0);
		});

		test('lastFetched → none', async () => {
			const r = await run(['lastFetched']);
			assert.strictEqual(r.activeCalls, 0);
			assert.strictEqual(r.inactiveCalls, 0);
		});

		test('multi-flag [index, head] → both (head escalates)', async () => {
			const r = await run(['index', 'head']);
			assert.strictEqual(r.activeCalls, 1);
			assert.strictEqual(r.inactiveCalls, 1);
		});

		test('multi-flag all-irrelevant → none', async () => {
			const r = await run(['tags', 'config', 'stash']);
			assert.strictEqual(r.activeCalls, 0);
			assert.strictEqual(r.inactiveCalls, 0);
		});

		test('multi-flag [index, config] → active only (config is none)', async () => {
			const r = await run(['index', 'config']);
			assert.strictEqual(r.activeCalls, 1);
			assert.strictEqual(r.inactiveCalls, 0);
		});

		test('event for non-overview repo → no refresh', async () => {
			const r = await run(['heads'], '/repo/other', '/repo/selected');
			assert.strictEqual(r.activeCalls, 0);
			assert.strictEqual(r.inactiveCalls, 0);
		});

		test('no overview repo selected → no refresh', async () => {
			const r = await run(['heads'], '/repo/selected', undefined);
			assert.strictEqual(r.activeCalls, 0);
			assert.strictEqual(r.inactiveCalls, 0);
		});

		test('empty changes array → no refresh', async () => {
			const r = await run([]);
			assert.strictEqual(r.activeCalls, 0);
			assert.strictEqual(r.inactiveCalls, 0);
		});
	});
});
