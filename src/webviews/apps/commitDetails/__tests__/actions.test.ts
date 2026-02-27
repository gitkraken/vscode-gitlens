import * as assert from 'assert';
import type { GitCommitSearchContext } from '../../../../git/search.js';
import { InMemoryStorage } from '../../shared/host/storage.js';
import { CommitDetailsActions } from '../actions.js';
import { createCommitDetailsState } from '../state.js';

suite('CommitDetailsActions', () => {
	test('should explicitly fetch the navigated commit and clear stale search context', async () => {
		const state = createCommitDetailsState(new InMemoryStorage());
		state.navigationStack.set({ count: 2, position: 1, hint: 'prev' });
		state.searchContext.set({
			query: { query: 'test' },
			queryFilters: { files: false, refs: false },
			matchedFiles: [],
			hiddenFromGraph: true,
		} satisfies GitCommitSearchContext);

		const actions = new CommitDetailsActions(
			state,
			{
				inspect: {
					navigate: async () => ({
						navigationStack: { count: 2, position: 0, hint: 'abc1234' },
						selectedCommit: { repoPath: '/repo', sha: 'abc123' },
					}),
				},
			} as any,
			{} as any,
		);

		const fetches: Array<{ repoPath: string; sha: string; force: boolean | undefined }> = [];
		(actions as any).fetchCommit = async (repoPath: string, sha: string, options?: { force?: boolean }) => {
			fetches.push({ repoPath: repoPath, sha: sha, force: options?.force });
		};

		await actions.navigateBack();

		assert.deepStrictEqual(state.navigationStack.get(), { count: 2, position: 0, hint: 'abc1234' });
		assert.strictEqual(state.searchContext.get(), undefined);
		assert.deepStrictEqual(fetches, [{ repoPath: '/repo', sha: 'abc123', force: true }]);
	});

	test('should force a refetch when reloading the current commit after visibility restore', async () => {
		const state = createCommitDetailsState(new InMemoryStorage());
		state.currentCommit.set({ repoPath: '/repo', sha: 'abc123' } as any);

		const actions = new CommitDetailsActions(state, {} as any, {} as any);
		const fetches: Array<{ repoPath: string; sha: string; force: boolean | undefined }> = [];
		(actions as any).fetchCommit = async (repoPath: string, sha: string, options?: { force?: boolean }) => {
			fetches.push({ repoPath: repoPath, sha: sha, force: options?.force });
		};

		await actions.refetchCurrentCommit();

		assert.deepStrictEqual(fetches, [{ repoPath: '/repo', sha: 'abc123', force: true }]);
	});
});
