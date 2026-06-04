import * as assert from 'assert';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { InMemoryStorage } from '../../shared/host/storage.js';
import { CommitDetailsActions } from '../actions.js';
import { createCommitDetailsState } from '../state.js';

suite('CommitDetailsActions', () => {
	test('should explicitly fetch the navigated commit and clear stale search context', async () => {
		const state = createCommitDetailsState(new InMemoryStorage());

		const actions = new CommitDetailsActions(state, {} as any, {} as any);

		// Seed the shared history with two viewed commits (the second is current). Recording flows
		// through the controller's onChange into the navigationStack signal, mirroring real fetches.
		(actions as any)._nav.record({ sha: 'abc1234', repoPath: '/repo' });
		(actions as any)._nav.record({ sha: 'def5678', repoPath: '/repo' });

		state.searchContext.set({
			query: { query: 'test' },
			queryFilters: { files: false, refs: false },
			matchedFiles: [],
			hiddenFromGraph: true,
		} satisfies GitCommitSearchContext);

		const fetches: Array<{ repoPath: string; sha: string; force: boolean | undefined }> = [];
		(actions as any).fetchCommit = async (repoPath: string, sha: string, options?: { force?: boolean }) => {
			fetches.push({ repoPath: repoPath, sha: sha, force: options?.force });
		};

		await actions.navigateBack();

		// Back moves to the older entry and force-fetches it; forward becomes available.
		assert.deepStrictEqual(fetches, [{ repoPath: '/repo', sha: 'abc1234', force: true }]);
		assert.strictEqual(state.searchContext.get(), undefined);
		assert.strictEqual(state.navigationStack.get().position, 1);
		assert.strictEqual(state.navigationStack.get().canForward, true);
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
