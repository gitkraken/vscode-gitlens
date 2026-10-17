import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { addCommit, checkout, createBranch, createTestRepo, getHeadSha } from './helpers.js';

function git(repoPath: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

suite('BranchesSubProvider.getAheadBehindCounts', () => {
	let repo: TestRepo;
	let mainName: string;

	suiteSetup(() => {
		repo = createTestRepo();
		mainName = execFileSync('git', ['branch', '--show-current'], { cwd: repo.path, encoding: 'utf-8' }).trim();

		// feat: 2 ahead; main then moves 1 past the fork, so feat is also 1 behind
		createBranch(repo.path, 'feat', { checkout: true });
		addCommit(repo.path, 'a.txt', 'a', 'feat 1');
		addCommit(repo.path, 'b.txt', 'b', 'feat 2');
		const featSha = getHeadSha(repo.path);
		checkout(repo.path, mainName);
		addCommit(repo.path, 'm.txt', 'm', 'main 1');
		createBranch(repo.path, 'same');

		git(repo.path, 'update-ref', 'refs/remotes/origin/feat', featSha);
		git(repo.path, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/feat');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	function run(options?: { remotes?: boolean; refs?: readonly string[] }, base?: string) {
		return repo.provider.branches.getAheadBehindCounts(repo.path, base ?? mainName, options);
	}

	function assertLocal(counts: Map<string, { ahead: number; behind: number }>): void {
		assert.deepStrictEqual(counts.get('refs/heads/feat'), { ahead: 2, behind: 1 });
		assert.deepStrictEqual(counts.get('refs/heads/same'), { ahead: 0, behind: 0 });
		assert.deepStrictEqual(counts.get(`refs/heads/${mainName}`), { ahead: 0, behind: 0 });
	}

	function suiteFor(name: string, setup?: () => () => void): void {
		suite(name, () => {
			let restore: (() => void) | undefined;
			suiteSetup(() => {
				restore = setup?.();
			});
			suiteTeardown(() => {
				restore?.();
			});

			test('counts local branches only by default', async () => {
				const counts = await run();
				assert.strictEqual(counts.size, 3);
				assertLocal(counts);
			});

			test('includes remote branches, never symbolic refs', async () => {
				const counts = await run({ remotes: true });
				assertLocal(counts);
				assert.deepStrictEqual(counts.get('refs/remotes/origin/feat'), { ahead: 2, behind: 1 });
				assert.ok(!counts.has('refs/remotes/origin/HEAD'));
				assert.strictEqual(counts.size, 4);
			});

			test('counts only the named refs, matched exactly', async () => {
				const counts = await run({ refs: ['refs/heads/feat', 'refs/remotes/origin/feat', 'refs/heads/gone'] });
				assert.deepStrictEqual([...counts.keys()].sort(), ['refs/heads/feat', 'refs/remotes/origin/feat']);
				assert.deepStrictEqual(counts.get('refs/heads/feat'), { ahead: 2, behind: 1 });

				// A namespace given as a ref name would match every ref below it in for-each-ref
				assert.strictEqual((await run({ refs: ['refs/heads'] })).size, 0);
				assert.strictEqual((await run({ refs: [] })).size, 0);
			});

			test('rejects on a bad base', async () => {
				await assert.rejects(run(undefined, 'no-such-base'));
				await assert.rejects(run({ remotes: true }, '--no-such-flag'));
			});

			test('counts against a base whose name holds a parenthesis', async () => {
				git(repo.path, 'branch', 'base(x)', mainName);
				try {
					const counts = await run(undefined, 'base(x)');
					assert.deepStrictEqual(counts.get('refs/heads/feat'), { ahead: 2, behind: 1 });
				} finally {
					git(repo.path, 'branch', '-D', 'base(x)');
				}
			});
		});
	}

	suiteFor('single for-each-ref (git 2.41+)');

	suiteFor('per-branch fallback (git < 2.41)', () => {
		const target = repo.provider.git;
		const original = target.supports;
		target.supports = feature =>
			feature === 'git:for-each-ref:ahead-behind' ? false : original.call(target, feature);
		return () => {
			target.supports = original;
		};
	});
});

suite('BranchesSubProvider.getAheadBehindCounts — per-tip fallback spawns', () => {
	let repo: TestRepo;
	let revLists: number;

	setup(() => {
		repo = createTestRepo();
		revLists = 0;

		const target = repo.provider.git;
		const supports = target.supports;
		target.supports = feature =>
			feature === 'git:for-each-ref:ahead-behind' ? false : supports.call(target, feature);
		const run = target.run;
		target.run = function (this: typeof target, ...args: Parameters<typeof run>) {
			if (args[1] === 'rev-list') {
				revLists++;
			}
			return run.apply(this, args);
		};
	});

	teardown(() => {
		repo.cleanup();
	});

	test('counts refs sharing a tip once', async () => {
		createBranch(repo.path, 'feat', { checkout: true });
		addCommit(repo.path, 'a.txt', 'a', 'feat 1');
		git(repo.path, 'update-ref', 'refs/remotes/origin/feat', getHeadSha(repo.path));
		checkout(repo.path, 'main');

		const counts = await repo.provider.branches.getAheadBehindCounts(repo.path, 'main', { remotes: true });

		assert.deepStrictEqual(counts.get('refs/heads/feat'), { ahead: 1, behind: 0 });
		assert.deepStrictEqual(counts.get('refs/remotes/origin/feat'), { ahead: 1, behind: 0 });
		assert.strictEqual(revLists, 1);
	});

	test('counts nothing for a tip at the base', async () => {
		createBranch(repo.path, 'same');

		const counts = await repo.provider.branches.getAheadBehindCounts(repo.path, 'main');

		assert.deepStrictEqual(counts.get('refs/heads/main'), { ahead: 0, behind: 0 });
		assert.deepStrictEqual(counts.get('refs/heads/same'), { ahead: 0, behind: 0 });
		assert.strictEqual(revLists, 0);
	});

	test('a repeat call recounts only the tips that moved', async () => {
		createBranch(repo.path, 'feat', { checkout: true });
		addCommit(repo.path, 'a.txt', 'a', 'feat 1');
		createBranch(repo.path, 'other', { checkout: true });
		addCommit(repo.path, 'b.txt', 'b', 'other 1');
		checkout(repo.path, 'main');

		await repo.provider.branches.getAheadBehindCounts(repo.path, 'main');
		assert.strictEqual(revLists, 2);

		const again = await repo.provider.branches.getAheadBehindCounts(repo.path, 'main');
		assert.deepStrictEqual(again.get('refs/heads/feat'), { ahead: 1, behind: 0 });
		assert.strictEqual(revLists, 2, 'no ref moved, so nothing is recounted');

		checkout(repo.path, 'feat');
		addCommit(repo.path, 'c.txt', 'c', 'feat 2');
		checkout(repo.path, 'main');

		const moved = await repo.provider.branches.getAheadBehindCounts(repo.path, 'main');
		assert.deepStrictEqual(moved.get('refs/heads/feat'), { ahead: 2, behind: 0 });
		assert.deepStrictEqual(moved.get('refs/heads/other'), { ahead: 2, behind: 0 });
		assert.strictEqual(revLists, 3);
	});
});
