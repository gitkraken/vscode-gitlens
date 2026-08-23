import * as assert from 'node:assert';
import { MessageChannel } from 'node:worker_threads';
import type { Endpoint } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { InMemoryStorage } from '../../shared/host/storage.js';
import { setupSubscriptions } from '../events.js';
import { createCommitDetailsState } from '../state.js';

/** Node's MessagePort is an EventTarget, so it satisfies Supertalk's Endpoint directly. */
function asEndpoint(port: import('node:worker_threads').MessagePort): Endpoint {
	return port as unknown as Endpoint;
}

/** Real supertalk `Connection` pair over a `MessageChannel` — the new `setupSubscriptions` takes the
 *  client-side connection; the host exposes the fake services bag. `nestedProxies` makes the nested
 *  sub-services remote proxies instead of attempted structured clones, matching production. */
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

suite('commit details subscriptions', () => {
	test('should clear stale search context when a new commit selection has none', async () => {
		const state = createCommitDetailsState(new InMemoryStorage());

		let onCommitSelected: ((event: any) => void) | undefined;
		const services = {
			inspect: {
				onCommitSelected: (callback: (event: any) => void) => {
					onCommitSelected = callback;
					return () => {};
				},
			},
			repositories: {
				onRepositoryChanged: () => () => {},
			},
			config: {
				onConfigChanged: () => () => {},
			},
			integrations: {
				onIntegrationsChanged: () => () => {},
			},
			ai: {
				onModelChanged: () => () => {},
			},
		};

		const fetches: Array<{ repoPath: string; sha: string }> = [];
		const actions = {
			fetchCommit: async (repoPath: string, sha: string) => {
				fetches.push({ repoPath: repoPath, sha: sha });
			},
			clearReachability: () => {},
		} as any;

		const previousSearchContext: GitCommitSearchContext = {
			query: { query: 'test' },
			queryFilters: { files: false, refs: false },
			matchedFiles: [],
			hiddenFromGraph: true,
		};

		const pair = createConnectionPair();
		try {
			pair.host.expose(services);
			const subscription = setupSubscriptions(pair.client, state, actions);
			void pair.client.waitForReady();
			await subscription.ready;
			await tick();

			state.searchContext.set(previousSearchContext);

			assert.ok(onCommitSelected, 'commit selection callback should be registered');
			onCommitSelected?.({
				repoPath: '/repo',
				sha: 'abc123',
				passive: false,
			});
			await tick();

			assert.strictEqual(state.searchContext.get(), undefined);
			assert.deepStrictEqual(fetches, [{ repoPath: '/repo', sha: 'abc123' }]);

			subscription.unsubscribe();
		} finally {
			pair.close();
		}
	});
});
