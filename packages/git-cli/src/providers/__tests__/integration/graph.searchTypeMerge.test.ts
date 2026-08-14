import * as assert from 'assert';
import type { GitGraphSearch, GitGraphSearchProgress } from '@gitlens/git/models/graphSearch.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { TestRepo } from './helpers.js';
import { addCommit, checkout, createBranch, createStash, createTestRepo, getHeadSha, mergeBranch } from './helpers.js';

async function drainSearch(gen: AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>): Promise<GitGraphSearch> {
	let result = await gen.next();
	while (!result.done) {
		result = await gen.next();
	}
	return result.value;
}

// Stash commits have 2-3 parents (HEAD, index, and optionally untracked files), so `git --merges`
// matches them just like a real merge commit -- both because the provider used to feed their shas
// through `--stdin` and because `--all` surfaces refs/stash's tip on its own. `type:merge` must only
// ever return real merge commits.
suite('GraphSubProvider.searchGraph type:merge excludes stashes', () => {
	let repo: TestRepo;
	let mergeSha: string;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'a.txt', 'a', 'A');
		createBranch(repo.path, 'feature', { checkout: true });
		addCommit(repo.path, 'f1.txt', 'f1', 'F1');
		checkout(repo.path, 'main');
		mergeBranch(repo.path, 'feature', 'Merge feature into main');
		mergeSha = getHeadSha(repo.path);

		createStash(repo.path, 'first stash');
		createStash(repo.path, 'second stash');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('returns the merge commit but not stashes', async () => {
		const search: SearchQuery = { query: 'type:merge', matchRegex: true };
		const result = await drainSearch(repo.provider.graph.searchGraph(repo.path, search));

		assert.ok(result.results.has(mergeSha), 'the real merge commit must be in the results');

		const stashList = await repo.provider.stash?.getStash(repo.path, { includeFiles: false });
		for (const stashSha of stashList?.stashes.keys() ?? []) {
			assert.ok(!result.results.has(stashSha), `stash ${stashSha} must be excluded from type:merge results`);
		}
	});

	// A multi-value `type:` query leaves `--merges` in the git args regardless of which value the parser's
	// last-value-wins `filters.type` ends up with -- `mergesOnly` must track the args, not `filters.type`,
	// or the stash-exclusion guard disengages while `--merges` still runs.
	test('type:merge type:tip still excludes stashes', async () => {
		const search: SearchQuery = { query: 'type:merge type:tip', matchRegex: true };
		const result = await drainSearch(repo.provider.graph.searchGraph(repo.path, search));

		assert.ok(result.results.has(mergeSha), 'the real merge commit must be in the results');

		const stashList = await repo.provider.stash?.getStash(repo.path, { includeFiles: false });
		for (const stashSha of stashList?.stashes.keys() ?? []) {
			assert.ok(
				!result.results.has(stashSha),
				`stash ${stashSha} must be excluded from type:merge type:tip results`,
			);
		}
	});
});
