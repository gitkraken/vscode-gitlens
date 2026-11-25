import * as assert from 'assert';
import { Cache } from '@gitlens/git/cache.js';
import type { GitService } from '@gitlens/git/service.js';
import type { ProcessSpawner } from '@gitlens/utils/env/node/exec.js';
import { spawnProcess } from '@gitlens/utils/env/node/exec.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { createCliGitService } from '../../../service.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo, createWorktree, noCommitGraphWritesConfig } from './helpers.js';

/**
 * A linked worktree first read through the service before the host registered it shares its repository's ref listing
 * when a registrar is set, rather than reading a copy of its own that its registration then throws away.
 */
suite('Registering a checkout before its first read (real git)', () => {
	let repo: TestRepo;
	let worktree: ReturnType<typeof createWorktree>;
	let service: GitService | undefined;
	let cache: Cache | undefined;
	/** The argv of each git process launched */
	let launches: string[];

	setup(() => {
		launches = [];
		repo = createTestRepo();
		createBranch(repo.path, 'task-0');
		worktree = createWorktree(repo.path, 'task-0');
	});

	teardown(() => {
		service?.dispose();
		service = undefined;
		cache?.dispose();
		cache = undefined;
		worktree.cleanup();
		repo.cleanup();
	});

	function open(options: { registrar: boolean }): { git: GitService; cache: Cache } {
		const opened = new Cache();
		cache = opened;
		const spawn: ProcessSpawner = (command, args, spawnOptions) => {
			launches.push(args.join(' '));
			return spawnProcess(command, args, spawnOptions);
		};
		const git = createCliGitService({
			context: { fs: repo.provider.context.fs, config: noCommitGraphWritesConfig },
			gitOptions: { spawn: spawn },
			cache: opened,
		});
		service = git;
		if (options.registrar) {
			opened.setRepoPathRegistrar(path =>
				git.forRepo(path)!.config.getGitDir!().then(gitDir => {
					if (gitDir != null) {
						opened.registerRepoPath(fileUri(path), gitDir);
					}
				}),
			);
		}
		return { git: git, cache: opened };
	}

	function refListings(): number {
		return launches.filter(argv => argv.includes('for-each-ref')).length;
	}

	/** Registers the main checkout and reads its branch list, which seeds the listing its checkouts share */
	async function readMain(git: GitService, opened: Cache): Promise<void> {
		const gitDir = await git.forRepo(repo.path)!.config.getGitDir!();
		assert.ok(gitDir != null);
		opened.registerRepoPath(fileUri(repo.path), gitDir);
		await git.forRepo(repo.path)!.branches.getBranches({ sort: false });
	}

	/** What a host's registration pass does for the worktree, unaware of whether it was registered already */
	async function registerInBackground(git: GitService, opened: Cache): Promise<void> {
		const gitDir = await git.forRepo(worktree.path)!.config.getGitDir!();
		assert.ok(gitDir != null);
		opened.registerRepoPath(fileUri(worktree.path), gitDir);
	}

	test("an unregistered worktree's first read shares the main checkout's listing, and keeps it", async () => {
		const { git, cache: opened } = open({ registrar: true });
		await readMain(git, opened);
		const seeded = refListings();
		assert.ok(seeded > 0, 'the main checkout lists the refs');

		const branches = await git.forRepo(worktree.path)!.branches.getBranches({ sort: false });
		assert.ok(branches.values.some(b => b.name === 'task-0'));
		const worktreePath = normalizePath(worktree.path);
		assert.strictEqual(opened.isRegistered(worktreePath), true, 'registered before it was read');
		assert.strictEqual(opened.getCommonPath(worktreePath), normalizePath(repo.path));
		assert.strictEqual(refListings(), seeded, 'no listing of its own');

		// The host's own background registration arriving after, and reads after it, throw nothing away
		await registerInBackground(git, opened);
		await git.forRepo(worktree.path)!.branches.getBranches({ sort: false });
		await git.forRepo(repo.path)!.branches.getBranches({ sort: false });
		assert.strictEqual(refListings(), seeded);
	});

	test("without a registrar, the worktree's first read lists the refs a second time, for itself alone", async () => {
		const { git, cache: opened } = open({ registrar: false });
		await readMain(git, opened);
		const seeded = refListings();

		await git.forRepo(worktree.path)!.branches.getBranches({ sort: false });
		assert.strictEqual(opened.isRegistered(normalizePath(worktree.path)), false);
		const ownListing = refListings();
		assert.ok(ownListing > seeded, 'read as a repository of its own');

		await registerInBackground(git, opened);
		await git.forRepo(worktree.path)!.branches.getBranches({ sort: false });
		await git.forRepo(repo.path)!.branches.getBranches({ sort: false });
		assert.strictEqual(refListings(), ownListing, 'the shared listing the main checkout read is still there');
	});
});
