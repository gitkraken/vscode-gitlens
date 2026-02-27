import * as assert from 'assert';
import type { GitCommitSearchContext } from '../../../../git/search.js';
import { InMemoryStorage } from '../../shared/host/storage.js';
import { setupSubscriptions } from '../events.js';
import { createCommitDetailsState } from '../state.js';

suite('commit details subscriptions', () => {
	test('should clear stale search context when a new commit selection has none', async () => {
		const state = createCommitDetailsState(new InMemoryStorage());
		state.mode.set('commit');

		let onCommitSelected: ((event: any) => void) | undefined;
		const services = {
			inspect: {
				onCommitSelected: (callback: (event: any) => void) => {
					onCommitSelected = callback;
					return () => {};
				},
				onShowWip: () => () => {},
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
		} as any;

		const fetches: Array<{ repoPath: string; sha: string }> = [];
		const actions = {
			switchMode: () => {},
			fetchCommit: async (repoPath: string, sha: string) => {
				fetches.push({ repoPath: repoPath, sha: sha });
			},
			fetchWipState: async () => {},
			clearReachability: () => {},
		} as any;

		const previousSearchContext: GitCommitSearchContext = {
			query: { query: 'test' },
			queryFilters: { files: false, refs: false },
			matchedFiles: [],
			hiddenFromGraph: true,
		};

		const unsubscribe = await setupSubscriptions(state, services, actions);
		state.searchContext.set(previousSearchContext);

		assert.ok(onCommitSelected, 'commit selection callback should be registered');
		onCommitSelected?.({
			repoPath: '/repo',
			sha: 'abc123',
			passive: false,
		});

		assert.strictEqual(state.searchContext.get(), undefined);
		assert.deepStrictEqual(fetches, [{ repoPath: '/repo', sha: 'abc123' }]);

		unsubscribe();
	});
});
