import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitService } from '@gitlens/git/service.js';
import type { WatcherRepoChangeEvent } from '@gitlens/git/watching/changeEvent.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { ProcessSpawner } from '@gitlens/utils/env/node/exec.js';
import { spawnProcess } from '@gitlens/utils/env/node/exec.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, getRepositoryKey } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import { createCliGitService } from '../../../service.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo, createWorktree, noCommitGraphWritesConfig } from './helpers.js';

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/**
 * A main checkout and two linked worktrees, each registered and watched (only the file watchers are fakes) by a host
 * that re-reads its branches on every repository change. Each session flushes on a debounce of its own, far enough
 * apart that each re-read finishes before the next session's event lands.
 */
suite('A change every checkout of a repository reports, read again by each (real git)', () => {
	/** Each checkout's session debounce, in the order they flush */
	const delays = [10, 400, 800];

	let repo: TestRepo;
	let linked: ReturnType<typeof createWorktree>[];
	let service: GitService;
	let provider: CliGitProvider;
	let watchers: { basePath: string; fire: (event: FileWatchEvent) => void }[];
	let disposables: { dispose(): void }[];
	/** The argv of each git process launched */
	let launches: string[];

	setup(() => {
		repo = createTestRepo();
		linked = [];
		for (const name of ['feature-a', 'feature-b']) {
			createBranch(repo.path, name);
			linked.push(createWorktree(repo.path, name));
		}

		launches = [];
		watchers = [];
		disposables = [];
		const spawn: ProcessSpawner = (command, args, options) => {
			launches.push(args.join(' '));
			return spawnProcess(command, args, options);
		};
		service = createCliGitService({
			context: { fs: repo.provider.context.fs, config: noCommitGraphWritesConfig },
			gitOptions: { spawn: spawn },
			watchingProvider: {
				createWatcher: function (basePath, _pattern, onEvent) {
					watchers.push({ basePath: basePath, fire: onEvent });
					return createDisposable(() => {});
				},
			} satisfies FileWatchingProvider,
		});
		provider = service.getProvider(repo.path)!.provider as CliGitProvider;
	});

	teardown(() => {
		for (const d of disposables) {
			d.dispose();
		}
		service.dispose();
		for (const wt of linked) {
			wt.cleanup();
		}
		repo.cleanup();
	});

	/** Registers and watches `path` as a host does, re-reading its branches on every event it hears */
	async function track(
		path: string,
		delayMs: number,
	): Promise<{ events: WatcherRepoChangeEvent[]; reads: Promise<unknown>[] }> {
		provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
		const handle = service.watchService!.watch(getRepositoryKey(path), await provider.config.getGitDir(path));
		assert.ok(handle != null);
		const sub = handle.session.subscribe({ delayMs: delayMs });
		const events: WatcherRepoChangeEvent[] = [];
		const reads: Promise<unknown>[] = [];
		disposables.push(
			sub.onDidChange(e => {
				events.push(e);
				reads.push(service.forRepo(path)!.branches.getBranches({ sort: false }));
			}),
			sub,
			handle,
		);
		await service.forRepo(path)!.branches.getBranches({ sort: false });
		return { events: events, reads: reads };
	}

	/** Reports a ref's file in the common git dir changing, the way the `.git` watchers over it do */
	function fireRefChanged(ref: string): void {
		const dotGit = normalizePath(join(repo.path, '.git'));
		for (const w of watchers.filter(w => normalizePath(w.basePath) === dotGit)) {
			w.fire({ path: join(w.basePath, ref), reason: 'change' });
		}
	}

	function refListings(): string[] {
		return launches.filter(argv => argv.includes('for-each-ref') && argv.includes('refs/heads/'));
	}

	test('a commit outside core in a linked worktree lists the refs once for every checkout that re-reads its branches', async () => {
		const paths = [repo.path, ...linked.map(wt => wt.path)];
		const tracked = [];
		for (const [i, path] of paths.entries()) {
			tracked.push(await track(path, delays[i]));
		}
		launches.length = 0;

		writeFileSync(join(linked[0].path, 'work.txt'), 'work\n');
		git(linked[0].path, 'add', 'work.txt');
		git(linked[0].path, 'commit', '-q', '-m', 'Work');
		const tip = git(linked[0].path, 'rev-parse', 'HEAD');
		fireRefChanged('refs/heads/feature-a');
		await delay(delays.at(-1)! + 150);
		for (const { reads } of tracked) {
			await Promise.allSettled(reads);
		}

		for (const [i, { events }] of tracked.entries()) {
			assert.strictEqual(events.length, 1, `${paths[i]} heard the change once`);
			assert.deepStrictEqual([...events[0].changes], ['heads'], `${paths[i]} heard only the ref move`);
		}
		for (const path of paths) {
			const { values } = await service.forRepo(path)!.branches.getBranches({ sort: false });
			assert.strictEqual(values.find(b => b.name === 'feature-a')?.sha, tip, `${path} lists the new tip`);
		}
		assert.strictEqual(refListings().length, 1, `the refs are listed once:\n${launches.join('\n')}`);
	});
});
