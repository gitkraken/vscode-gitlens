import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import * as sinon from 'sinon';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import type { TestRepo } from './helpers.js';
import { addCommit, cloneTestRepo, createBranch, createTestRepo } from './helpers.js';

suite('BranchesSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		// Create some branches
		createBranch(repo.path, 'feature/test-1');
		createBranch(repo.path, 'feature/test-2');
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		createBranch(repo.path, 'feature/test-3');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getBranches returns all branches', async () => {
		const result = await repo.provider.branches.getBranches(repo.path);
		assert.ok(result.values.length >= 4, `Expected at least 4 branches, got ${result.values.length}`);

		const names = result.values.map(b => b.name);
		assert.ok(names.includes('main'), 'Should include main');
		assert.ok(names.includes('feature/test-1'), 'Should include feature/test-1');
		assert.ok(names.includes('feature/test-2'), 'Should include feature/test-2');
		assert.ok(names.includes('feature/test-3'), 'Should include feature/test-3');
	});

	test('getBranches identifies current branch', async () => {
		const result = await repo.provider.branches.getBranches(repo.path);
		const current = result.values.find(b => b.current);
		assert.ok(current, 'Should have a current branch');
		assert.strictEqual(current.name, 'main');
	});

	test('getBranch returns a specific branch', async () => {
		const branch = await repo.provider.branches.getBranch(repo.path, 'feature/test-1');
		assert.ok(branch, 'Should find feature/test-1');
		assert.strictEqual(branch.name, 'feature/test-1');
	});

	test('getBranch returns undefined for nonexistent branch', async () => {
		const branch = await repo.provider.branches.getBranch(repo.path, 'nonexistent');
		assert.strictEqual(branch, undefined);
	});

	test('getBranches supports filtering', async () => {
		const result = await repo.provider.branches.getBranches(repo.path, {
			filter: b => b.name.startsWith('feature/'),
		});
		assert.ok(result.values.length >= 3, `Expected at least 3 feature branches, got ${result.values.length}`);
		for (const b of result.values) {
			assert.ok(b.name.startsWith('feature/'), `Branch ${b.name} should start with feature/`);
		}
	});
});

suite('BranchesSubProvider.getBranchMergedStatus caching', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		// `feature` never moves past the initial commit, so it's trivially an ancestor of every
		// later `main` commit — `merge-base --is-ancestor` succeeds on the very first check.
		createBranch(repo.path, 'feature');
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	function countMergeBaseCalls(spy: sinon.SinonSpy): number {
		return spy.getCalls().filter(c => c.args[1] === 'merge-base' && c.args[2] === '--is-ancestor').length;
	}

	test('same tips are served from cache; a tip advance recomputes', async () => {
		const runSpy = sinon.spy(repo.provider.git, 'run');
		try {
			const feature = await repo.provider.branches.getBranch(repo.path, 'feature');
			const main = await repo.provider.branches.getBranch(repo.path, 'main');
			assert.ok(feature && main);

			const first = await repo.provider.branches.getBranchMergedStatus(repo.path, feature, main);
			assert.strictEqual(first.merged, true);
			assert.strictEqual(countMergeBaseCalls(runSpy), 1, 'first call should compute');

			// Same tips (as if an unrelated branch elsewhere had gained a commit) — cache hit.
			const second = await repo.provider.branches.getBranchMergedStatus(repo.path, feature, main);
			assert.strictEqual(second.merged, true);
			assert.strictEqual(countMergeBaseCalls(runSpy), 1, 'repeat call with the same tips should be cached');

			// Advance main's tip — new key, so it recomputes. The test harness bypasses GitLens's
			// change hooks, so force the (unrelated) branches cache to refresh and pick up the move.
			addCommit(repo.path, 'file2.txt', 'more content', 'Third commit');
			repo.provider.cache.clearCaches(repo.path, 'branches');
			const mainAdvanced = await repo.provider.branches.getBranch(repo.path, 'main');
			assert.ok(mainAdvanced && mainAdvanced.sha !== main.sha);

			const third = await repo.provider.branches.getBranchMergedStatus(repo.path, feature, mainAdvanced);
			assert.strictEqual(third.merged, true);
			assert.strictEqual(countMergeBaseCalls(runSpy), 2, 'a tip advance should bust the cache and recompute');
		} finally {
			runSpy.restore();
		}
	});
});

suite('BranchesSubProvider — default branch caching', () => {
	let origin: TestRepo;
	let clone: TestRepo;

	suiteSetup(() => {
		origin = createTestRepo();
		addCommit(origin.path, 'f.txt', 'x', 'seed');
		clone = cloneTestRepo(origin.path);
		// A fresh clone has `refs/remotes/origin/HEAD`; drop it so the local-only lookup starts as a miss,
		// which is the state that used to get cached forever.
		execFileSync('git', ['remote', 'set-head', 'origin', '--delete'], { cwd: clone.path, stdio: 'pipe' });
	});

	suiteTeardown(() => {
		clone.cleanup();
		origin.cleanup();
	});

	test('a local miss is cached, so repeated lookups spawn once', async () => {
		// `symbolic-ref` on an absent `refs/remotes/<remote>/HEAD` exits FATAL, not empty, and matches no
		// `GitWarnings` entry — so it reaches the factory's catch. That is still an answer, and the common
		// one; invalidating it there meant every caller re-probed and the cache bought nothing. The sibling
		// test can't catch that: it only asserts a later networked lookup sees a newly created symref.
		const spy = sinon.spy(clone.provider.git, 'run');
		try {
			const first = await clone.provider.branches.getDefaultBranchName(clone.path, 'origin', { local: true });
			const second = await clone.provider.branches.getDefaultBranchName(clone.path, 'origin', { local: true });

			assert.strictEqual(first, undefined);
			assert.strictEqual(second, undefined);

			const spawns = spy
				.getCalls()
				.filter(c => c.args.includes('symbolic-ref') && c.args.includes(`refs/remotes/origin/HEAD`)).length;
			assert.strictEqual(spawns, 1, 'the cached miss must not re-spawn `symbolic-ref`');
		} finally {
			spy.restore();
		}
	});

	test('a cached local miss does not survive the networked path creating the symref', async () => {
		const local = await clone.provider.branches.getDefaultBranchName(clone.path, 'origin', { local: true });
		assert.strictEqual(local, undefined, 'no local symref yet, so the local-only lookup must miss');

		// The networked lookup runs `git remote set-head -a`, which creates the symref the local variant
		// was told didn't exist. Without an explicit eviction that miss stays cached — and a consumer of
		// this package that never wires up a file watcher has nothing else to repair it.
		const networked = await clone.provider.branches.getDefaultBranchName(clone.path, 'origin');
		assert.ok(networked, 'the networked lookup should resolve a default branch');

		const after = await clone.provider.branches.getDefaultBranchName(clone.path, 'origin', { local: true });
		assert.strictEqual(after, networked, 'the local lookup must now see the symref the networked path created');
	});
});

suite('BranchesSubProvider — partial batch delete', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'f.txt', 'x', 'seed');
	});

	teardown(() => {
		repo.cleanup();
	});

	test('a branch sharing a name with a tag is not mistaken for deleted', async () => {
		// `shared-name` is UNMERGED, so `git branch -d` refuses it while deleting `doomed` — that partial
		// failure is what runs the survivor probe, and `shared-name` must be in the probed set for the
		// collision to matter. `%(refname:short)` disambiguates it as `heads/shared-name`, which wouldn't
		// match the requested name and would read a live branch as deleted.
		createBranch(repo.path, 'doomed');
		createBranch(repo.path, 'shared-name', { checkout: true });
		addCommit(repo.path, 'u.txt', 'y', 'unmerged');
		execFileSync('git', ['checkout', 'main'], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['tag', 'shared-name'], { cwd: repo.path, stdio: 'pipe' });

		await repo.provider.config.setGkConfig(repo.path, 'branch.shared-name.gk-merge-base', 'origin/keep-me');
		await repo.provider.config.setGkConfig(repo.path, 'branch.shared-name.gk-disposition', 'starred');

		await assert.rejects(repo.provider.branches.deleteLocalBranch(repo.path, ['doomed', 'shared-name']));

		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, 'branch.shared-name.gk-merge-base'),
			'origin/keep-me',
			'a live branch colliding with a tag must keep its metadata',
		);
		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, 'branch.shared-name.gk-disposition'),
			'starred',
			'and its user-owned values',
		);
	});

	test('a failed survivor probe deletes nothing', async () => {
		createBranch(repo.path, 'survivor', { checkout: true });
		addCommit(repo.path, 'u2.txt', 'y', 'unmerged');
		execFileSync('git', ['checkout', 'main'], { cwd: repo.path, stdio: 'pipe' });
		await repo.provider.config.setGkConfig(repo.path, 'branch.survivor.gk-merge-base', 'origin/keep-me');

		// The probe must RESOLVE a failure (what `errors: 'ignore'` actually does) rather than reject —
		// a rejection is already caught. An empty stdout is indistinguishable from "nothing survived",
		// which would wipe every probed name.
		//
		// Stub the failure with NO exit code, which is what a spawn failure or queue rejection actually
		// produces — an `exitCode: 1` stub would exercise a git-ran-and-said-no result instead, which the
		// exit-code half of the guard already covers on its own.
		const real = repo.provider.git.run.bind(repo.provider.git);
		const stub = sinon
			.stub(repo.provider.git, 'run')
			.callsFake(async (options: GitRunOptions, ...args: readonly (string | undefined)[]) => {
				if (!args.includes('for-each-ref')) return real(options, ...args);

				const failed: GitResult = {
					stdout: '',
					stderr: undefined,
					completion: { status: 'failed', reason: 'unstarted', error: new Error('probe never ran') },
				};
				return failed;
			});
		try {
			await assert.rejects(repo.provider.branches.deleteLocalBranch(repo.path, ['survivor']));
		} finally {
			stub.restore();
		}

		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, 'branch.survivor.gk-merge-base'),
			'origin/keep-me',
			'a failed probe must not be read as "everything was deleted"',
		);
	});

	test('cleans persisted metadata for the branches a partial delete did remove', async () => {
		createBranch(repo.path, 'gone-1');
		createBranch(repo.path, 'gone-2');
		// An unmerged branch makes `git branch -d` refuse that one while still deleting the others.
		createBranch(repo.path, 'kept', { checkout: true });
		addCommit(repo.path, 'g.txt', 'y', 'unmerged');
		execFileSync('git', ['checkout', 'main'], { cwd: repo.path, stdio: 'pipe' });

		for (const b of ['gone-1', 'gone-2', 'kept']) {
			await repo.provider.config.setGkConfig(repo.path, `branch.${b}.gk-merge-base`, `origin/${b}-base`);
		}

		await assert.rejects(repo.provider.branches.deleteLocalBranch(repo.path, ['gone-1', 'kept', 'gone-2']));

		const read = (b: string) => repo.provider.config.getGkConfig(repo.path, `branch.${b}.gk-merge-base`);
		assert.strictEqual(await read('gone-1'), undefined, 'a branch that was deleted must not keep metadata');
		assert.strictEqual(await read('gone-2'), undefined, 'a branch that was deleted must not keep metadata');
		assert.strictEqual(await read('kept'), 'origin/kept-base', 'a branch that survived must keep its metadata');
	});
});

suite('BranchesSubProvider — branch identity bookkeeping (end to end)', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'f.txt', 'x', 'seed');
	});

	teardown(() => {
		repo.cleanup();
	});

	const setBase = (ref: string, v: string) =>
		repo.provider.config.setGkConfig(repo.path, `branch.${ref}.gk-merge-base`, v);
	const readBase = (ref: string) => repo.provider.config.getGkConfig(repo.path, `branch.${ref}.gk-merge-base`);

	test('renameBranch carries the stored base across to the new name', async () => {
		createBranch(repo.path, 'old-name');
		await setBase('old-name', 'origin/its-base');

		await repo.provider.branches.renameBranch(repo.path, 'old-name', 'new-name');

		assert.strictEqual(await readBase('new-name'), 'origin/its-base', 'the base must follow the branch');
		assert.strictEqual(await readBase('old-name'), undefined, 'the old name must not retain it');
	});

	test('createBranch leaves a predecessor’s metadata alone', async () => {
		// Simulates a branch deleted outside GitLens: its persisted base is still on disk under that name.
		// Metadata is dropped when GitLens DELETES a branch, never on creation — creation would have to guess
		// that a reused name means a different branch, and the only signal for that guess (a `refs/heads/*`
		// create event) also fires on ordinary commits, since git rewrites a loose ref via `<name>.lock` +
		// rename. Guessing there destroyed a live branch's base on every commit. The accepted cost is this:
		// a branch reusing a name deleted outside GitLens inherits the orphaned section.
		await setBase('reborn', 'origin/DEAD-PREDECESSOR');

		await repo.provider.branches.createBranch(repo.path, 'reborn', 'main');

		assert.strictEqual(
			await readBase('reborn'),
			'origin/DEAD-PREDECESSOR',
			'creation must not touch persisted metadata',
		);
	});

	test('deleteLocalBranch drops the deleted branch’s stored base', async () => {
		createBranch(repo.path, 'doomed');
		await setBase('doomed', 'origin/doomed-base');

		await repo.provider.branches.deleteLocalBranch(repo.path, 'doomed');

		assert.strictEqual(await readBase('doomed'), undefined);
	});
});
