import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import * as sinon from 'sinon';
import type { GitResult, GitRunOptions } from '@gitlens/git/run.types.js';
import type { TestRepo } from './helpers.js';
import { addCommit, checkout, cloneTestRepo, createBranch, createTestRepo, getHeadSha } from './helpers.js';

suite('CommitsSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		// Add several commits with known content
		addCommit(repo.path, 'file1.txt', 'hello', 'Add file1', { date: '2024-02-01T00:00:00Z' });
		addCommit(repo.path, 'file2.txt', 'world', 'Add file2', { date: '2024-03-01T00:00:00Z' });
		addCommit(repo.path, 'file1.txt', 'hello updated', 'Update file1', { date: '2024-04-01T00:00:00Z' });
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getLog returns commits', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 10 });
		assert.ok(log, 'Log should not be undefined');
		assert.ok(log.count >= 4, `Expected at least 4 commits, got ${log.count}`);
	});

	test('getLog respects limit', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 2 });
		assert.ok(log, 'Log should not be undefined');
		assert.strictEqual(log.count, 2);
		assert.strictEqual(log.hasMore, true);
	});

	test('getCommit returns a specific commit', async () => {
		const sha = getHeadSha(repo.path);
		const commit = await repo.provider.commits.getCommit(repo.path, sha);
		assert.ok(commit, 'Should find HEAD commit');
		assert.strictEqual(commit.sha, sha);
		assert.ok(commit.message?.includes('Update file1'), `Expected message about file1, got: ${commit.message}`);
	});

	test('getCommit resolves HEAD', async () => {
		const commit = await repo.provider.commits.getCommit(repo.path, 'HEAD');
		assert.ok(commit, 'Should resolve HEAD');
		const sha = getHeadSha(repo.path);
		assert.strictEqual(commit.sha, sha);
	});

	test('commits have author information', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 1 });
		assert.ok(log, 'Log should not be undefined');
		const commit = [...log.commits.values()][0];
		assert.ok(commit, 'Should have at least one commit');
		assert.ok(commit.author.name, 'Author should have a name');
		assert.ok(commit.author.email, 'Author should have an email');
		assert.ok(commit.author.date instanceof Date, 'Author date should be a Date');
	});

	test('commits have parent information', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 2 });
		assert.ok(log, 'Log should not be undefined');
		const commits = [...log.commits.values()];
		// Most recent commit should have a parent
		assert.ok(commits[0].parents.length > 0, 'HEAD commit should have parents');
	});

	test('getCommitCount returns correct count', async () => {
		const count = await repo.provider.commits.getCommitCount(repo.path, 'HEAD');
		assert.ok(count != null, 'Count should not be undefined');
		assert.ok(count >= 4, `Expected at least 4 commits, got ${count}`);
	});

	test('isAncestorOf works correctly', async () => {
		const isAncestor = await repo.provider.commits.isAncestorOf(repo.path, 'HEAD~1', 'HEAD');
		assert.strictEqual(isAncestor, true, 'HEAD~1 should be ancestor of HEAD');

		const notAncestor = await repo.provider.commits.isAncestorOf(repo.path, 'HEAD', 'HEAD~1');
		assert.strictEqual(notAncestor, false, 'HEAD should not be ancestor of HEAD~1');
	});
	test('a cancelled caller must not reject a concurrent caller sharing the in-flight spawn', async () => {
		// Deliberately a rev no earlier test has touched: on a cache HIT both callers would just share a
		// settled promise, which exercises per-caller cancellation but NOT the case that actually
		// regressed — two callers riding one live `rev-list`. Missing the cache is what puts them on the
		// same spawn, so the first caller's abort has a shared command it could wrongly kill.
		const rev = 'HEAD~2..HEAD';
		const first = new AbortController();
		const second = new AbortController();

		const p1 = repo.provider.commits.getCommitCount(repo.path, rev, undefined, first.signal);
		const p2 = repo.provider.commits.getCommitCount(repo.path, rev, undefined, second.signal);
		first.abort();

		const [r1, r2] = await Promise.allSettled([p1, p2]);
		assert.strictEqual(r1.status, 'rejected', 'the caller that aborted should see its own cancellation');
		assert.strictEqual(r2.status, 'fulfilled', 'a caller that never cancelled must still get its result');
		assert.ok(r2.status === 'fulfilled' && typeof r2.value === 'number', 'and it must be a real count');
	});
	test('a failed rev-list is not cached as a real "unknown" count', async () => {
		// `errors: 'ignore'` makes a bad rev resolve with empty stdout, which looks exactly like a
		// legitimate `undefined`. Caching that would pin a transient failure for the entry's sliding
		// hour-long TTL, so the factory must invalidate and let the next call retry.
		const bogus = 'no-such-rev-abcdef';
		assert.strictEqual(await repo.provider.commits.getCommitCount(repo.path, bogus), undefined);

		// Count spawns rather than timing: if the failure were cached, the second call would be served
		// from it and never reach git.
		const spy = sinon.spy(repo.provider.git, 'run');
		try {
			assert.strictEqual(await repo.provider.commits.getCommitCount(repo.path, bogus), undefined);
			assert.ok(spy.callCount > 0, 'a failed lookup must be retried, not served from cache');
		} finally {
			spy.restore();
		}
	});
});

// `filterUnpublishedShas` decides whether the graph's WIP bar shows an unpushed indicator for a
// worktree, and it answers for a whole batch at once — so a wrong answer here is wrong for every
// worktree in the batch, not one.
suite('CommitsSubProvider.filterUnpublishedShas', () => {
	let origin: TestRepo;
	let clone: TestRepo;

	setup(() => {
		origin = createTestRepo();
		addCommit(origin.path, 'a.txt', 'a', 'Published commit');
		clone = cloneTestRepo(origin.path);
	});

	teardown(() => {
		clone.cleanup();
		origin.cleanup();
	});

	test('separates unpublished tips from published ones', async () => {
		const published = getHeadSha(clone.path);
		addCommit(clone.path, 'b.txt', 'b', 'Local only');
		const unpublished = getHeadSha(clone.path);

		const result = await clone.provider.commits.filterUnpublishedShas(clone.path, [published, unpublished]);

		assert.strictEqual(result.has(unpublished), true, 'a local-only tip is unpublished');
		assert.strictEqual(result.has(published), false, 'a tip on the remote is published');
		assert.strictEqual(result.size, 1, 'only the tips asked about are reported, not their ancestors');
	});

	test('a duplicate tip across worktrees is reported once', async () => {
		addCommit(clone.path, 'b.txt', 'b', 'Local only');
		const sha = getHeadSha(clone.path);

		// Sibling worktrees checked out at the same commit pass the same sha; the walk must not care.
		const result = await clone.provider.commits.filterUnpublishedShas(clone.path, [sha, sha, sha]);

		assert.deepStrictEqual([...result], [sha]);
	});

	test('an empty set makes no call at all', async () => {
		const spy = sinon.spy(clone.provider.git, 'run');
		try {
			const result = await clone.provider.commits.filterUnpublishedShas(clone.path, []);

			assert.strictEqual(result.size, 0);
			assert.strictEqual(
				spy.getCalls().filter(c => c.args.includes('rev-list')).length,
				0,
				'no shas means no walk',
			);
		} finally {
			spy.restore();
		}
	});

	test('a failed walk throws rather than reporting everything as published', async () => {
		addCommit(clone.path, 'b.txt', 'b', 'Local only');
		const sha = getHeadSha(clone.path);

		// The shape that matters: `errors: 'ignore'` would resolve this empty, which is indistinguishable
		// from "nothing is unpublished" — a confident wrong `hasUnpushed: false` for the whole batch.
		const real = clone.provider.git.run.bind(clone.provider.git);
		const stub = sinon
			.stub(clone.provider.git, 'run')
			.callsFake(async (options: GitRunOptions, ...args: readonly (string | undefined)[]) => {
				if (!args.includes('rev-list')) return real(options, ...args);

				const failed: GitResult = {
					stdout: '',
					stderr: undefined,
					completion: { status: 'failed', reason: 'unstarted', error: new Error('walk never ran') },
				};
				return failed;
			});
		try {
			await assert.rejects(clone.provider.commits.filterUnpublishedShas(clone.path, [sha]));
		} finally {
			stub.restore();
		}
	});
});

suite('CommitsSubProvider.getCommitCount — excluding', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo(); // main has one commit
		createBranch(repo.path, 'feat', { checkout: true });
		addCommit(repo.path, 'a.txt', 'a', 'feat commit 1');
		addCommit(repo.path, 'b.txt', 'b', 'feat commit 2');
		checkout(repo.path, 'main');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('excluding every OTHER branch counts only feat’s own two commits', async () => {
		const count = await repo.provider.commits.getCommitCount(repo.path, 'feat', {
			excluding: { branches: true, except: ['refs/heads/feat'] },
		});
		assert.strictEqual(count, 2);
	});

	test('a remote-tracking ref at the same tip, also excluded, drops the count to 0', async () => {
		execFileSync('git', ['update-ref', 'refs/remotes/o/feat', 'feat'], { cwd: repo.path, stdio: 'pipe' });

		const count = await repo.provider.commits.getCommitCount(repo.path, 'feat', {
			excluding: { branches: true, remotes: true, except: ['refs/heads/feat'] },
		});
		assert.strictEqual(count, 0, 'the remote-tracking ref reaches the same 2 commits, so they are excluded too');
	});

	test('excepting the remote-tracking ref too restores the count to 2', async () => {
		const count = await repo.provider.commits.getCommitCount(repo.path, 'feat', {
			excluding: { branches: true, remotes: true, except: ['refs/heads/feat', 'refs/remotes/o/feat'] },
		});
		assert.strictEqual(count, 2);
	});
});

suite('CommitsSubProvider.getLogShas — excluding', () => {
	let repo: TestRepo;
	const shas: string[] = [];

	suiteSetup(() => {
		repo = createTestRepo(); // main has one commit
		createBranch(repo.path, 'feat', { checkout: true });
		for (const name of ['a', 'b', 'c']) {
			addCommit(repo.path, `${name}.txt`, name, `feat commit ${name}`);
			shas.push(getHeadSha(repo.path));
		}
		execFileSync('git', ['update-ref', 'refs/heads/up', shas[0]], { cwd: repo.path, stdio: 'pipe' });
		checkout(repo.path, 'main');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('lists what rev has beyond the upstream and the target, and agrees with getCommitCount', async () => {
		const excluding = { refs: ['up', 'main'] };

		const list = [...(await repo.provider.commits.getLogShas(repo.path, 'feat', { excluding: excluding }))];
		const count = await repo.provider.commits.getCommitCount(repo.path, 'feat', { excluding: excluding });

		assert.deepStrictEqual(new Set(list), new Set([shas[1], shas[2]]));
		assert.strictEqual(list.length, 2);
		assert.strictEqual(count, 2);
	});
});
