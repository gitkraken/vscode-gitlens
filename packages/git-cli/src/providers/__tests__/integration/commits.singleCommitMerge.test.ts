import * as assert from 'assert';
import * as sinon from 'sinon';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	checkout,
	createBranch,
	createStash,
	createTestRepo,
	getHeadSha,
	mergeBranch,
	revParse,
} from './helpers.js';

suite('CommitsSubProvider single-commit read of a merge commit', () => {
	let repo: TestRepo;
	let mergeSha: string;
	let stashSha: string;

	suiteSetup(() => {
		repo = createTestRepo();
		createBranch(repo.path, 'feature', { checkout: true });
		addCommit(repo.path, 'f.txt', 'feature', 'Add f');
		checkout(repo.path, 'main');
		addCommit(repo.path, 'm1.txt', 'one', 'Add m1');
		addCommit(repo.path, 'm2.txt', 'two', 'Add m2');
		checkout(repo.path, 'feature');
		mergeBranch(repo.path, 'main', 'Merge main into feature');
		mergeSha = getHeadSha(repo.path);

		createStash(repo.path, 'a stash');
		stashSha = revParse(repo.path, 'stash@{0}');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	/** The args of every `git log` the provider ran while `fn` ran */
	async function captureLogArgs(fn: () => Promise<unknown>): Promise<string[][]> {
		const spy = sinon.spy(repo.provider.git, 'run');
		try {
			await fn();
			return spy
				.getCalls()
				.map(c => c.args.slice(1) as string[])
				.filter(a => a[0] === 'log');
		} finally {
			spy.restore();
		}
	}

	test('getCommit of a merge commit returns the first-parent file list', async () => {
		const commit = await repo.provider.commits.getCommit(repo.path, mergeSha);
		assert.ok(commit);
		assert.strictEqual(commit.sha, mergeSha);
		assert.strictEqual(commit.parents.length, 2);

		const files = (commit.fileset?.files ?? []).map(f => f.path).sort();
		assert.deepStrictEqual(files, ['m1.txt', 'm2.txt']);
	});

	test('getCommit of a merge commit asks git for a single diff, not one per parent', async () => {
		const logs = await captureLogArgs(() => repo.provider.commits.getCommit(repo.path, mergeSha));
		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes('--diff-merges=first-parent'), `args: ${logs[0].join(' ')}`);
		assert.ok(!logs[0].includes('-m'), `args: ${logs[0].join(' ')}`);
	});

	test('getCommit of a stash returns its working-tree file list', async () => {
		const commit = await repo.provider.commits.getCommit(repo.path, stashSha);
		assert.ok(commit);
		assert.strictEqual(commit.sha, stashSha);

		const files = (commit.fileset?.files ?? []).map(f => f.path);
		assert.deepStrictEqual(files, ['stash-file.txt']);
	});

	test('getCommit of a stash asks git for a single diff, not one per parent', async () => {
		const logs = await captureLogArgs(() => repo.provider.commits.getCommit(repo.path, stashSha));
		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes('--diff-merges=first-parent'), `args: ${logs[0].join(' ')}`);
		assert.ok(!logs[0].includes('-m'), `args: ${logs[0].join(' ')}`);
	});

	test('getCommit of a merge commit on a git without --diff-merges keeps -m and the same files', async () => {
		const supports = sinon
			.stub(repo.provider.git, 'supports')
			.callsFake(feature => (feature === 'git:log:diff-merges' ? false : supports.wrappedMethod(feature)));
		try {
			const logs = await captureLogArgs(() => repo.provider.commits.getCommit(repo.path, mergeSha));
			assert.strictEqual(logs.length, 1);
			assert.ok(logs[0].includes('-m'), `args: ${logs[0].join(' ')}`);
			assert.ok(!logs[0].includes('--diff-merges=first-parent'), `args: ${logs[0].join(' ')}`);

			const commit = await repo.provider.commits.getCommit(repo.path, mergeSha);
			const files = (commit?.fileset?.files ?? []).map(f => f.path).sort();
			assert.deepStrictEqual(files, ['m1.txt', 'm2.txt']);
		} finally {
			supports.restore();
		}
	});
});
