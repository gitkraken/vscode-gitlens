import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { Cache } from '@gitlens/git/cache.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitService } from '@gitlens/git/service.js';
import type { ProcessSpawner } from '@gitlens/utils/env/node/exec.js';
import { spawnProcess } from '@gitlens/utils/env/node/exec.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { createCliGitService } from '../../../service.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo, createWorktree, noCommitGraphWritesConfig } from './helpers.js';

/** Past the window within which a validated repository is served as is */
const afterValidationWindowMs = 300;

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** Where `branches` places the branch `name`: the path of the worktree it is checked out in, or `false` */
function placementOf(branches: readonly GitBranch[], name: string): string | false | undefined {
	const branch = branches.find(b => b.name === name);
	assert.ok(branch != null, `branch ${name}`);
	return branch.worktree === false ? false : branch.worktree?.path;
}

/**
 * With nothing watched, the caches of every checkout of a repository are kept fresh by validating its git dirs before
 * reads: a linked worktree's checkout from outside reaches the branch list every checkout shares, and a worktree
 * registered after its repository was first read costs only reads of its own.
 */
suite('Unwatched cache validation across linked worktrees (real git)', () => {
	let repo: TestRepo;
	let worktrees: ReturnType<typeof createWorktree>[];
	let service: GitService | undefined;
	let cache: Cache | undefined;
	/** The argv of each git process launched */
	let launches: string[];

	setup(() => {
		launches = [];
		repo = createTestRepo();
		for (const name of ['task-0', 'task-1', 'spare']) {
			createBranch(repo.path, name);
		}
		worktrees = ['task-0', 'task-1'].map(name => createWorktree(repo.path, name));
	});

	teardown(() => {
		service?.dispose();
		service = undefined;
		cache?.dispose();
		cache = undefined;
		for (const worktree of worktrees) {
			worktree.cleanup();
		}
		repo.cleanup();
	});

	function open(): GitService {
		cache = new Cache();
		const spawn: ProcessSpawner = (command, args, options) => {
			launches.push(args.join(' '));
			return spawnProcess(command, args, options);
		};
		service = createCliGitService({
			context: { fs: repo.provider.context.fs, config: noCommitGraphWritesConfig },
			gitOptions: { spawn: spawn },
			cache: cache,
			validateUnwatchedCaches: true,
		});
		return service;
	}

	async function register(path: string): Promise<void> {
		const gitDir = await repo.provider.config.getGitDir(path);
		assert.ok(gitDir != null, path);
		cache!.registerRepoPath(fileUri(path), gitDir);
	}

	async function readBranches(path: string): Promise<GitBranch[]> {
		return (await service!.forRepo(path)!.branches.getBranches({ sort: false })).values;
	}

	function checkoutFromOutside(path: string, branch: string): void {
		execFileSync('git', ['checkout', '-q', branch], { cwd: path, stdio: 'pipe' });
	}

	/** Warms every checkout, then checks a linked worktree out from outside and reads the branch list from `reader` */
	async function readAfterCheckoutFromOutside(reader: 'main' | 'sibling'): Promise<void> {
		const git = open();
		const [moved, sibling] = worktrees.map(w => w.path);
		for (const path of [repo.path, moved, sibling]) {
			await register(path);
		}
		await readBranches(repo.path);
		for (const path of [moved, sibling]) {
			await git.forRepo(path)!.branches.getBranch();
			await readBranches(path);
		}
		const readerPath = reader === 'main' ? repo.path : sibling;
		assert.strictEqual(placementOf(await readBranches(readerPath), 'task-0'), normalizePath(moved));

		await sleep(afterValidationWindowMs);
		checkoutFromOutside(moved, 'spare');
		await sleep(afterValidationWindowMs);

		const branches = await readBranches(readerPath);
		assert.strictEqual(placementOf(branches, 'spare'), normalizePath(moved));
		assert.strictEqual(placementOf(branches, 'task-0'), false);
	}

	test("shows a linked worktree's checkout from outside in the branch list read from the main checkout, without reading that worktree first", () =>
		readAfterCheckoutFromOutside('main'));

	test("shows a linked worktree's checkout from outside in the branch list read from a sibling worktree, without reading that worktree first", () =>
		readAfterCheckoutFromOutside('sibling'));

	test("reads a linked worktree registered after its repository's first read without listing its refs, and sees its later checkout", async () => {
		const git = open();
		const [early, late] = worktrees.map(w => w.path);
		await register(repo.path);
		await register(early);
		await readBranches(repo.path);
		await git.forRepo(early)!.branches.getBranch();

		await register(late);
		launches.length = 0;
		const branch = await git.forRepo(late)!.branches.getBranch();
		assert.strictEqual(branch?.name, 'task-1');
		assert.deepStrictEqual(
			launches.filter(argv => argv.includes('for-each-ref')),
			[],
			`its own reads only: ${launches.join('\n')}`,
		);

		await sleep(afterValidationWindowMs);
		checkoutFromOutside(late, 'spare');
		await sleep(afterValidationWindowMs);

		const branches = await readBranches(repo.path);
		assert.strictEqual(placementOf(branches, 'spare'), normalizePath(late));
		assert.strictEqual(placementOf(branches, 'task-1'), false);
	});
});
