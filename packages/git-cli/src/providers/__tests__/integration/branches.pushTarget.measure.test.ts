import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitPushTarget } from '@gitlens/git/providers/branches.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import type { TestRepo } from './helpers.js';
import { addCommit, cloneTestRepo, createTestRepo, createWorktree } from './helpers.js';

function git(repoPath: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/**
 * `getPushTarget` without a branch needs only the checked-out branch's name, which it reads from the worktree's own
 * `HEAD` file: no git process, and never older than the file. A fetch moves `origin/main` for every worktree of the
 * repository, so each followed worktree used to re-run `rev-parse --symbolic-full-name @ @{u}` after it, one process
 * per worktree on top of the single ref list read. Each finished git subprocess logs one `… • completed` line through
 * `gitOptions.logger`, so a counting channel gives an exact spawn count.
 */
suite('BranchesGitSubProvider.getPushTarget (checked-out branch from HEAD, spawn count)', () => {
	let origin: TestRepo;
	let repo: TestRepo;
	let scratch: string;
	let previousGlobalConfig: string | undefined;
	let completed: string[] = [];

	const countingLogger: LogChannel = {
		name: 'spawn-counter',
		logLevel: 0,
		dispose: () => {},
		trace: () => {},
		debug: () => {},
		info: (msg: string) => {
			if (msg.includes('• completed')) {
				completed.push(msg);
			}
		},
		warn: () => {},
		error: () => {},
	};

	const countSince = (mark: number, needle: string) =>
		completed.slice(mark).filter(m => m.includes(` ${needle} `)).length;

	const countOthersSince = (mark: number, needle: string) =>
		completed.slice(mark).filter(m => !m.includes(` ${needle} `)).length;

	const upstreamOf = (target: GitPushTarget) => (target.known ? target.upstream : undefined);

	suiteSetup(() => {
		// The machine's own `push.default` or `remote.pushDefault` would otherwise decide these cases
		scratch = mkdtempSync(join(tmpdir(), 'gitlens-push-target-measure-'));
		const globalConfig = join(scratch, 'gitconfig');
		writeFileSync(globalConfig, '');
		previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = globalConfig;

		origin = createTestRepo();
		repo = cloneTestRepo(origin.path, { gitOptions: { logger: countingLogger } });

		// `main` is ahead of `origin/main`, and `task` has no upstream
		addCommit(repo.path, 'a.txt', 'a', 'Local commit');
		git(repo.path, 'branch', '--no-track', 'task', 'main');
	});

	suiteTeardown(() => {
		repo?.cleanup();
		origin?.cleanup();
		if (previousGlobalConfig == null) {
			delete process.env.GIT_CONFIG_GLOBAL;
		} else {
			process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
		}
		rmSync(scratch, { recursive: true, force: true });
	});

	setup(() => {
		// No watcher runs here; every case reports its own changes
		repo.provider.cache.evictCaches(repo.path);
		completed = [];
	});

	test('a remote-tracking tip move reads no HEAD again, only the ref list', async () => {
		const first = await repo.provider.branches.getPushTarget(repo.path);
		assert.ok(first.known);
		assert.strictEqual(upstreamOf(first)?.ref, 'refs/remotes/origin/main');
		assert.notStrictEqual(upstreamOf(first)?.sha, git(repo.path, 'rev-parse', 'HEAD'));

		// What a fetch does to `origin/main`, reported the way the watcher does
		const moved = git(repo.path, 'rev-parse', 'HEAD');
		git(repo.path, 'update-ref', 'refs/remotes/origin/main', moved);
		repo.provider.cache.onRepositoryChanged(repo.path, ['remotes']);

		const mark = completed.length;
		const second = await repo.provider.branches.getPushTarget(repo.path);
		const revParses = countSince(mark, 'rev-parse');
		const symbolicRefs = countSince(mark, 'symbolic-ref');
		const forEachRefs = countSince(mark, 'for-each-ref');
		console.error(
			`[measure] getPushTarget after a remote-tracking tip move → ${revParses} rev-parse, ${symbolicRefs} symbolic-ref, ${forEachRefs} for-each-ref (was 1 rev-parse)`,
		);

		assert.strictEqual(upstreamOf(second)?.ref, 'refs/remotes/origin/main');
		assert.strictEqual(upstreamOf(second)?.sha, moved, 'the moved tip is read');
		assert.strictEqual(revParses, 0);
		assert.strictEqual(symbolicRefs, 0);
		assert.strictEqual(forEachRefs, 1, 'only the ref list is read again');
	});

	test('a switch made outside, with nothing reported, still reads the new branch', async () => {
		const main = await repo.provider.branches.getPushTarget(repo.path);
		assert.ok(main.known);
		assert.strictEqual(main.push?.ref, 'refs/remotes/origin/main');

		git(repo.path, 'checkout', '-q', 'task');
		try {
			const task = await repo.provider.branches.getPushTarget(repo.path);
			assert.deepStrictEqual(task, await repo.provider.branches.getPushTarget(repo.path, 'task'));
			assert.notDeepStrictEqual(task, main);
			assert.ok(task.known);
			assert.strictEqual(task.push, undefined, 'task has no destination under push.default simple');
		} finally {
			git(repo.path, 'checkout', '-q', 'main');
		}

		assert.deepStrictEqual(await repo.provider.branches.getPushTarget(repo.path), main);
	});

	test('a rename made with raw git, with no HEAD change reported, reads the renamed branch', async () => {
		git(repo.path, 'config', 'push.default', 'current');
		git(repo.path, 'checkout', '-q', '-b', 'to-rename', 'task');
		try {
			const before = await repo.provider.branches.getPushTarget(repo.path);
			assert.ok(before.known);
			assert.strictEqual(before.push?.ref, 'refs/remotes/origin/to-rename');

			git(repo.path, 'branch', '-m', 'to-rename', 'renamed');
			// The ref list is cached on its own, and a real rename reports the refs; only HEAD goes unreported
			repo.provider.cache.evictCaches(repo.path, 'branches');

			const target = await repo.provider.branches.getPushTarget(repo.path);
			assert.deepStrictEqual(target, await repo.provider.branches.getPushTarget(repo.path, 'renamed'));
			assert.ok(target.known);
			assert.strictEqual(target.push?.ref, 'refs/remotes/origin/renamed', 'the new name, not the old one');
		} finally {
			// A failure before the rename leaves `to-rename`; `push.default` goes first so it can't outlive this case
			git(repo.path, 'config', '--unset-all', 'push.default');
			git(repo.path, 'checkout', '-q', 'main');
			for (const name of ['to-rename', 'renamed']) {
				try {
					git(repo.path, 'branch', '-q', '-D', name);
				} catch {}
			}
		}
	});

	test('a branch that is a symbolic ref to another reads its target, as git does', async () => {
		// A `master` kept pointing at `main` after a rename: HEAD names `master`, whose own config is empty
		git(repo.path, 'symbolic-ref', 'refs/heads/master', 'refs/heads/main');
		git(repo.path, 'checkout', '-q', 'master');
		try {
			const target = await repo.provider.branches.getPushTarget(repo.path);
			assert.ok(target.known);
			assert.strictEqual(target.upstream?.ref, 'refs/remotes/origin/main');
			assert.deepStrictEqual(target, await repo.provider.branches.getPushTarget(repo.path, 'main'));
		} finally {
			git(repo.path, 'checkout', '-q', 'main');
			git(repo.path, 'symbolic-ref', '--delete', 'refs/heads/master');
		}
	});

	test('a detached HEAD has no destination, and its HEAD read spawns nothing', async () => {
		git(repo.path, 'checkout', '-q', '--detach');
		try {
			// The git directory is resolved once per worktree and kept, so it isn't part of reading HEAD
			await repo.provider.config.getGitDir(repo.path);
			const mark = completed.length;
			assert.deepStrictEqual(await repo.provider.branches.getPushTarget(repo.path), {
				known: true,
				push: undefined,
				upstream: undefined,
			});
			assert.strictEqual(countOthersSince(mark, 'for-each-ref'), 0, 'only the ref list is read');
		} finally {
			git(repo.path, 'checkout', '-q', 'main');
		}
	});

	test('a HEAD kept as a symlink to its branch reads that branch, as git does', async function () {
		// Creating a symlink on Windows needs a privilege test machines may not have
		if (process.platform === 'win32') {
			this.skip();
		}

		// `core.preferSymlinkRefs` writes HEAD this way; reading the file follows the link to the branch's object id
		const head = join(git(repo.path, 'rev-parse', '--absolute-git-dir'), 'HEAD');
		try {
			rmSync(head);
			symlinkSync('refs/heads/main', head);
			// A link to a packed branch dangles, and the case would pass through the fallback without reading the link
			assert.match(readFileSync(head, 'utf-8'), /^[0-9a-f]{40,64}\s*$/, 'sanity: the link reads as an object id');

			const target = await repo.provider.branches.getPushTarget(repo.path);
			assert.ok(target.known);
			assert.strictEqual(target.upstream?.ref, 'refs/remotes/origin/main');
			assert.deepStrictEqual(target, await repo.provider.branches.getPushTarget(repo.path, 'main'));
		} finally {
			rmSync(head, { force: true });
			writeFileSync(head, 'ref: refs/heads/main\n');
		}
	});

	test("a linked worktree reads its own branch, not the main checkout's", async () => {
		const worktree = createWorktree(repo.path, 'task');
		try {
			const main = await repo.provider.branches.getPushTarget(repo.path);
			await repo.provider.config.getGitDir(worktree.path);
			const mark = completed.length;
			const linked = await repo.provider.branches.getPushTarget(worktree.path);

			assert.ok(main.known && linked.known);
			assert.strictEqual(main.push?.ref, 'refs/remotes/origin/main');
			assert.strictEqual(linked.push, undefined);
			assert.deepStrictEqual(linked, await repo.provider.branches.getPushTarget(worktree.path, 'task'));
			assert.strictEqual(countSince(mark, 'rev-parse'), 0);
			assert.strictEqual(countSince(mark, 'symbolic-ref'), 0);
		} finally {
			git(repo.path, 'worktree', 'remove', '--force', worktree.path);
			worktree.cleanup();
		}
	});

	test('a reftable repository, whose HEAD file is a placeholder, falls back to resolving the branch', async function () {
		const dir = mkdtempSync(join(tmpdir(), 'gitlens-test-reftable-'));
		try {
			try {
				execFileSync('git', ['init', '-q', '-b', 'main', '--ref-format=reftable', dir], { stdio: 'pipe' });
			} catch {
				// The installed git predates reftable (2.45) and refused to create the repository
				this.skip();
			}

			git(dir, 'config', 'user.email', 'test@gitlens.test');
			git(dir, 'config', 'user.name', 'Test User');
			git(dir, 'config', 'commit.gpgsign', 'false');
			writeFileSync(join(dir, 'a.txt'), 'a');
			git(dir, 'add', 'a.txt');
			git(dir, 'commit', '-q', '-m', 'Initial commit');
			git(dir, 'branch', 'other');
			git(dir, 'branch', '-q', '--set-upstream-to=other', 'main');

			// Resolving the git directory runs `rev-parse` too, so it is kept out of the count
			await repo.provider.config.getGitDir(dir);
			const mark = completed.length;
			const target = await repo.provider.branches.getPushTarget(dir);
			assert.ok(target.known);
			assert.strictEqual(target.upstream?.ref, 'refs/heads/other');
			assert.strictEqual(target.upstream?.sha, git(dir, 'rev-parse', 'other'));
			assert.ok(countSince(mark, 'rev-parse') > 0, 'the fallback resolves the reference');

			git(dir, 'checkout', '-q', 'other');
			// Resolving the reference is cached as it always was; nothing reports this switch
			repo.provider.cache.evictCaches(dir);
			const other = await repo.provider.branches.getPushTarget(dir);
			assert.deepStrictEqual(other, await repo.provider.branches.getPushTarget(dir, 'other'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
