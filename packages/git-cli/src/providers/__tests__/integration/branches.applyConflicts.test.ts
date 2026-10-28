import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { addCommit, checkout, createBranchAt, createTestRepo, getHeadSha, revParse } from './helpers.js';

suite('BranchesSubProvider getPotentialApplyConflicts (real git)', () => {
	let repo: TestRepo;
	let shas: string[];
	let conflictingSha: string;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'base.txt', 'base\n', 'Add base');
		createBranchAt(repo.path, 'feature', 'main');
		addCommit(repo.path, 'base.txt', 'main change\n', 'Change base on main');

		checkout(repo.path, 'feature');
		addCommit(repo.path, 'a.txt', 'a\n', 'Add a');
		addCommit(repo.path, 'base.txt', 'feature change\n', 'Change base on feature');
		conflictingSha = getHeadSha(repo.path);
		addCommit(repo.path, 'b.txt', 'b\n', 'Add b');
		checkout(repo.path, 'main');

		shas = [revParse(repo.path, 'feature~2'), conflictingSha, revParse(repo.path, 'feature')];
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	// The chained simulation feeds trees to `merge-tree`, which git only accepts from 2.45 — on older git the
	// detection must say it is unavailable, never that the rebase is clean
	test('reports the conflicting commit, or unsupported, but never clean', async () => {
		const result = await repo.provider.branches.getPotentialApplyConflicts(repo.path, 'main', shas);

		if (await repo.provider.git.supports('git:merge-tree:trees')) {
			assert.strictEqual(result.status, 'conflicts');
			if (result.status === 'conflicts') {
				assert.deepStrictEqual(result.conflict.shas, [conflictingSha]);
				assert.deepStrictEqual(
					result.conflict.files.map(f => f.path),
					['base.txt'],
				);
			}
		} else {
			assert.strictEqual(result.status, 'error');
			if (result.status === 'error') {
				assert.strictEqual(result.reason, 'unsupported');
			}
		}
	});
});
