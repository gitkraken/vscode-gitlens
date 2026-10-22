import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { GitPushTarget, GitPushTargetRef } from '@gitlens/git/providers/branches.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import type { TestRepo } from './helpers.js';
import { addCommit, cloneTestRepo, createTestRepo, createWorktree } from './helpers.js';

function git(repoPath: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

/** stdout of a git command that exits 0, else `undefined` */
function tryGit(repoPath: string, ...args: string[]): string | undefined {
	try {
		return execFileSync('git', args, { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' }).trim();
	} catch {
		return undefined;
	}
}

function unsetConfig(repoPath: string, key: string): void {
	tryGit(repoPath, 'config', '--unset-all', key);
}

/**
 * Asserts `target` names what git itself resolves for `branch`: `<branch>@{push}` and `<branch>@{upstream}` (which git
 * only resolves when the ref exists), `%(push)` and `%(upstream)` (which name it either way), and the tip a push
 * detector reads, the push destination's else the upstream's.
 */
function assertMatchesGit(repoPath: string, branch: string, target: GitPushTarget): void {
	if (!target.known) {
		assert.fail(`${branch}: the ref list was read`);
	}

	for (const [kind, atom, at] of [
		['push', '%(push)', '@{push}'],
		['upstream', '%(upstream)', '@{upstream}'],
	] as const) {
		const actual: GitPushTargetRef | undefined = target[kind];
		const named = tryGit(repoPath, 'for-each-ref', `--format=${atom}`, `refs/heads/${branch}`) || undefined;
		assert.strictEqual(actual?.ref, named, `${branch}: ${kind} is named as ${atom} names it`);

		const resolved = tryGit(repoPath, 'rev-parse', '--symbolic-full-name', `${branch}${at}`);
		const sha = tryGit(repoPath, 'rev-parse', '--verify', '--quiet', `${branch}${at}^{commit}`);
		if (resolved != null) {
			assert.strictEqual(actual?.ref, resolved, `${branch}: ${kind} is git's ${at}`);
		}
		assert.strictEqual(actual?.sha, sha, `${branch}: ${kind} tip is git's ${at}^{commit}`);
	}

	const gitTip =
		tryGit(repoPath, 'rev-parse', '--verify', '--quiet', `${branch}@{push}^{commit}`) ??
		tryGit(repoPath, 'rev-parse', '--verify', '--quiet', `${branch}@{upstream}^{commit}`);
	assert.strictEqual(target.push?.sha ?? target.upstream?.sha, gitTip, `${branch}: push tip, else upstream tip`);
}

suite('BranchesGitSubProvider.getPushTarget', () => {
	let origin: TestRepo;
	let repo: TestRepo;
	let scratch: string;
	let previousGlobalConfig: string | undefined;
	const completed: string[] = [];

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

	suiteSetup(() => {
		// The machine's own `push.default` or `remote.pushDefault` would otherwise decide these cases
		scratch = mkdtempSync(join(tmpdir(), 'gitlens-push-target-'));
		const globalConfig = join(scratch, 'gitconfig');
		writeFileSync(globalConfig, '');
		previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = globalConfig;

		origin = createTestRepo();
		repo = cloneTestRepo(origin.path, { gitOptions: { logger: countingLogger } });

		const fork = join(scratch, 'fork.git');
		execFileSync('git', ['clone', '-q', '--bare', origin.path, fork], { stdio: 'pipe' });
		git(repo.path, 'remote', 'add', 'fork', fork);
		git(repo.path, 'fetch', '-q', 'fork');

		// `main` moves past the remotes, so its own tip, origin's and the fork's all differ
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
		// Every case rewrites config or refs from outside the provider, and no watcher runs here
		repo.provider.cache.evictCaches(repo.path);
	});

	const cases: {
		name: string;
		arrange: (path: string) => void;
		restore: (path: string) => void;
		/** The push destination git names, per branch; omitted where only git equivalence is asserted */
		expected?: { main: string | undefined; task: string | undefined };
	}[] = [
		{
			name: 'simple, task has no upstream',
			arrange: p => git(p, 'config', 'push.default', 'simple'),
			restore: p => unsetConfig(p, 'push.default'),
			expected: { main: 'refs/remotes/origin/main', task: undefined },
		},
		{
			name: 'current, task not pushed yet',
			arrange: p => git(p, 'config', 'push.default', 'current'),
			restore: p => unsetConfig(p, 'push.default'),
			expected: { main: 'refs/remotes/origin/main', task: 'refs/remotes/origin/task' },
		},
		{
			name: 'current, task pushed',
			arrange: p => {
				git(p, 'config', 'push.default', 'current');
				git(p, 'push', '-q', 'origin', 'task');
			},
			restore: p => {
				git(p, 'push', '-q', 'origin', '--delete', 'task');
				unsetConfig(p, 'push.default');
			},
			expected: { main: 'refs/remotes/origin/main', task: 'refs/remotes/origin/task' },
		},
		{
			name: 'matching',
			arrange: p => git(p, 'config', 'push.default', 'matching'),
			restore: p => unsetConfig(p, 'push.default'),
			expected: { main: 'refs/remotes/origin/main', task: 'refs/remotes/origin/task' },
		},
		{
			name: 'upstream',
			arrange: p => git(p, 'config', 'push.default', 'upstream'),
			restore: p => unsetConfig(p, 'push.default'),
			expected: { main: 'refs/remotes/origin/main', task: undefined },
		},
		{
			name: 'nothing',
			arrange: p => git(p, 'config', 'push.default', 'nothing'),
			restore: p => unsetConfig(p, 'push.default'),
			expected: { main: undefined, task: undefined },
		},
		{
			name: 'a push refspec',
			arrange: p => git(p, 'config', 'remote.origin.push', 'refs/heads/*:refs/heads/pushed/*'),
			restore: p => unsetConfig(p, 'remote.origin.push'),
			expected: { main: 'refs/remotes/origin/pushed/main', task: 'refs/remotes/origin/pushed/task' },
		},
		{
			name: 'a mirror remote',
			arrange: p => git(p, 'config', 'remote.origin.mirror', 'true'),
			restore: p => unsetConfig(p, 'remote.origin.mirror'),
			expected: { main: 'refs/remotes/origin/main', task: 'refs/remotes/origin/task' },
		},
		{
			name: 'a valueless mirror line',
			arrange: p => appendFileSync(join(p, '.git', 'config'), '[remote "origin"]\n\tmirror\n'),
			restore: p => unsetConfig(p, 'remote.origin.mirror'),
			expected: { main: 'refs/remotes/origin/main', task: 'refs/remotes/origin/task' },
		},
		{
			name: 'remote.pushDefault under simple (triangular)',
			arrange: p => git(p, 'config', 'remote.pushDefault', 'fork'),
			restore: p => unsetConfig(p, 'remote.pushDefault'),
			expected: { main: undefined, task: undefined },
		},
		{
			name: 'remote.pushDefault under current',
			arrange: p => {
				git(p, 'config', 'remote.pushDefault', 'fork');
				git(p, 'config', 'push.default', 'current');
			},
			restore: p => {
				unsetConfig(p, 'remote.pushDefault');
				unsetConfig(p, 'push.default');
			},
			expected: { main: 'refs/remotes/fork/main', task: 'refs/remotes/fork/task' },
		},
		{
			name: 'branch pushRemote under simple (triangular)',
			arrange: p => {
				git(p, 'config', 'branch.main.pushRemote', 'fork');
				git(p, 'config', 'branch.task.pushRemote', 'fork');
			},
			restore: p => {
				unsetConfig(p, 'branch.main.pushRemote');
				unsetConfig(p, 'branch.task.pushRemote');
			},
			expected: { main: undefined, task: undefined },
		},
		{
			name: 'branch pushRemote under current',
			arrange: p => {
				git(p, 'config', 'branch.main.pushRemote', 'fork');
				git(p, 'config', 'branch.task.pushRemote', 'fork');
				git(p, 'config', 'push.default', 'current');
			},
			restore: p => {
				unsetConfig(p, 'branch.main.pushRemote');
				unsetConfig(p, 'branch.task.pushRemote');
				unsetConfig(p, 'push.default');
			},
			expected: { main: 'refs/remotes/fork/main', task: 'refs/remotes/fork/task' },
		},
		{
			name: 'an upstream named differently than the branch, under simple',
			arrange: p => git(p, 'branch', '-q', '--set-upstream-to=origin/main', 'task'),
			restore: p => git(p, 'branch', '-q', '--unset-upstream', 'task'),
			expected: { main: 'refs/remotes/origin/main', task: undefined },
		},
		{
			name: 'an upstream named differently than the branch, under upstream',
			arrange: p => {
				git(p, 'branch', '-q', '--set-upstream-to=origin/main', 'task');
				git(p, 'config', 'push.default', 'upstream');
			},
			restore: p => {
				git(p, 'branch', '-q', '--unset-upstream', 'task');
				unsetConfig(p, 'push.default');
			},
			expected: { main: 'refs/remotes/origin/main', task: 'refs/remotes/origin/main' },
		},
		{
			// The upstream is `refs/heads/main`, a local branch
			name: 'an upstream that is a local branch',
			arrange: p => git(p, 'branch', '-q', '--set-upstream-to=main', 'task'),
			restore: p => git(p, 'branch', '-q', '--unset-upstream', 'task'),
		},
		{
			name: 'a gone tracking ref',
			arrange: p => git(p, 'update-ref', '-d', 'refs/remotes/origin/main'),
			restore: p => git(p, 'fetch', '-q', 'origin'),
			expected: { main: 'refs/remotes/origin/main', task: undefined },
		},
		{
			// git warns this layout is "nominated for removal", so only equivalence with git is asserted
			name: 'a legacy .git/remotes file with Push: and Pull: lines',
			arrange: p => {
				mkdirSync(join(p, '.git', 'remotes'), { recursive: true });
				writeFileSync(
					join(p, '.git', 'remotes', 'legacy'),
					`URL: ${origin.path}\nPush: refs/heads/main:refs/heads/legacy\nPull: refs/heads/*:refs/remotes/legacy/*\n`,
				);
				git(p, 'config', 'branch.main.pushRemote', 'legacy');
			},
			restore: p => {
				unsetConfig(p, 'branch.main.pushRemote');
				rmSync(join(p, '.git', 'remotes'), { recursive: true, force: true });
			},
		},
	];

	cases.forEach(c => {
		test(`matches git: ${c.name}`, async () => {
			c.arrange(repo.path);
			try {
				for (const branch of ['main', 'task'] as const) {
					const target = await repo.provider.branches.getPushTarget(repo.path, branch);
					assertMatchesGit(repo.path, branch, target);
					if (c.expected != null) {
						assert.ok(target.known);
						assert.strictEqual(target.push?.ref, c.expected[branch], `${branch}: push destination`);
					}
				}
			} finally {
				c.restore(repo.path);
			}
		});
	});

	test('names a gone upstream with no tip', async () => {
		git(repo.path, 'update-ref', '-d', 'refs/remotes/origin/main');
		try {
			const target = await repo.provider.branches.getPushTarget(repo.path, 'main');
			assert.deepStrictEqual(target, {
				known: true,
				push: { ref: 'refs/remotes/origin/main', sha: undefined },
				upstream: { ref: 'refs/remotes/origin/main', sha: undefined },
			});
		} finally {
			git(repo.path, 'fetch', '-q', 'origin');
		}
	});

	test("defaults to the checkout's own branch, also in a linked worktree", async () => {
		git(repo.path, 'config', 'push.default', 'current');
		const worktree = createWorktree(repo.path, 'task');
		try {
			assert.deepStrictEqual(
				await repo.provider.branches.getPushTarget(repo.path),
				await repo.provider.branches.getPushTarget(repo.path, 'main'),
			);
			// The ref list is read at the common directory, where `%(HEAD)` is the main checkout's branch
			const linked = await repo.provider.branches.getPushTarget(worktree.path);
			assert.deepStrictEqual(linked, {
				known: true,
				push: { ref: 'refs/remotes/origin/task', sha: undefined },
				upstream: undefined,
			});
		} finally {
			git(repo.path, 'worktree', 'remove', '--force', worktree.path);
			worktree.cleanup();
			unsetConfig(repo.path, 'push.default');
		}
	});

	test('a detached HEAD has no destination', async () => {
		git(repo.path, 'checkout', '-q', '--detach');
		try {
			assert.deepStrictEqual(await repo.provider.branches.getPushTarget(repo.path), {
				known: true,
				push: undefined,
				upstream: undefined,
			});
		} finally {
			git(repo.path, 'checkout', '-q', 'main');
		}
	});

	test('a remote-tracking ref or a missing branch has no destination', async () => {
		for (const branch of ['origin/main', 'refs/remotes/origin/main', 'no-such-branch']) {
			assert.deepStrictEqual(await repo.provider.branches.getPushTarget(repo.path, branch), {
				known: true,
				push: undefined,
				upstream: undefined,
			});
		}
	});

	test('accepts a full branch name', async () => {
		assert.deepStrictEqual(
			await repo.provider.branches.getPushTarget(repo.path, 'refs/heads/main'),
			await repo.provider.branches.getPushTarget(repo.path, 'main'),
		);
	});

	test('is unknown when the ref list could not be read', async () => {
		const getRefs = sinon.stub(repo.provider.refs, 'getRefs').resolves([]);
		try {
			assert.deepStrictEqual(await repo.provider.branches.getPushTarget(repo.path, 'main'), { known: false });
			assert.deepStrictEqual(await repo.provider.branches.getPushTarget(repo.path), { known: false });
		} finally {
			getRefs.restore();
		}
	});

	test('a warm read spawns nothing', async () => {
		git(repo.path, 'config', 'push.default', 'current');
		try {
			repo.provider.cache.evictCaches(repo.path);
			let mark = completed.length;
			const cold = await repo.provider.branches.getPushTarget(repo.path);
			const coldSpawns = completed.length - mark;
			assert.ok(coldSpawns > 0, 'a cold read lists the refs');

			mark = completed.length;
			assert.deepStrictEqual(await repo.provider.branches.getPushTarget(repo.path), cold);
			assert.deepStrictEqual(
				await repo.provider.branches.getPushTarget(repo.path, 'task'),
				await repo.provider.branches.getPushTarget(repo.path, 'task'),
			);
			assert.deepStrictEqual(completed.slice(mark), [], 'warm reads are served from the cached ref list');
		} finally {
			unsetConfig(repo.path, 'push.default');
		}
	});
});
