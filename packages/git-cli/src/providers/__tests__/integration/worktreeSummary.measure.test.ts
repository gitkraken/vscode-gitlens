import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { GitService } from '@gitlens/git/service.js';
import type { FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import type { WorktreeSummary, WorktreeSummarySubscription } from '@gitlens/git/watching/worktreeSummary.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { fileUri, getRepositoryKey, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import { createCliGitService } from '../../../service.js';
import type { TestRepo } from './helpers.js';
import { addCommit, cloneTestRepo, createTestRepo, createWorktree, noCommitGraphWritesConfig } from './helpers.js';

const fs: FileSystemProvider = {
	readFile: async uri => readFileSync(toFsPath(uri)),
	stat: async uri => {
		try {
			const stats = statSync(toFsPath(uri));
			return { type: stats.isDirectory() ? 2 : 1, ctime: stats.ctimeMs, mtime: stats.mtimeMs, size: stats.size };
		} catch {
			return undefined;
		}
	},
	readDirectory: async () => [],
};

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function nextChange(sub: WorktreeSummarySubscription): Promise<WorktreeSummary> {
	return new Promise(resolve => {
		const listener = sub.onDidChange(e => {
			listener.dispose();
			resolve(e);
		});
	});
}

/**
 * A fetch moving `origin/main` reaches every linked worktree based on it. Each finished git subprocess logs one
 * `[<cwd>] git … • completed` line through `gitOptions.logger`, so the lines carrying a linked worktree's path are the
 * processes its summary refresh ran there; reads shared by the repository's checkouts run in the main checkout.
 *
 * Before the base re-measure, each linked worktree's refresh resolved its base again with 4 processes of its own
 * (`rev-parse main@{u}`, `merge-base --fork-point` against `main` and against `origin/main`, and `rev-list
 * --left-right --count`), and the first of them also read the remotes. Then each ran 1 (`rev-list --count`). Now, with
 * git 2.41 or later, each runs none: the repository's checkouts share one read of the base's reflog, one `rev-parse` of
 * the value before its oldest entry, one `rev-list` of what they reach off the new tip's history and one `for-each-ref`
 * counting every local branch past the new tip, besides the ref list and remote `HEAD` reads every refresh after a
 * fetch shares. Before 2.41 each still runs its own `rev-list --count`.
 */
suite('WorktreeSummaryService base refresh after a fetch (spawn count)', () => {
	const worktreeCount = 4;
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

	let root: string;
	let origin: string;
	let main: TestRepo;
	let peer: TestRepo;
	let linked: { path: string; cleanup: () => void }[];
	let service: GitService;
	let subs: WorktreeSummarySubscription[];

	setup(async () => {
		root = mkdtempSync(join(tmpdir(), 'gitlens-summary-measure-'));
		origin = join(root, 'origin.git');
		git(root, 'init', '--bare', '-b', 'main', origin);

		main = createTestRepo();
		git(main.path, 'remote', 'add', 'origin', origin);
		git(main.path, 'push', '-u', 'origin', 'main');
		git(main.path, 'remote', 'set-head', 'origin', 'main');

		// Task branches taken off `origin/main`, as a host creates them, each with work of its own
		linked = [];
		for (let i = 0; i < worktreeCount; i++) {
			const name = `task-${i}`;
			git(main.path, 'branch', '--no-track', name, 'origin/main');
			const wt = createWorktree(main.path, name);
			linked.push(wt);
			addCommit(wt.path, `${name}.txt`, name, `Work on ${name}`);
		}

		peer = cloneTestRepo(origin);

		// Not the shadow-checked service: its full base reads would add to the process counts measured here
		service = createCliGitService({
			context: { fs: fs, config: noCommitGraphWritesConfig },
			gitOptions: { logger: countingLogger },
			watchingProvider: {
				createWatcher: () => createDisposable(() => {}),
			} satisfies FileWatchingProvider,
		});
		const provider = service.getProvider(main.path)!.provider as CliGitProvider;

		subs = [];
		for (const path of [main.path, ...linked.map(wt => wt.path)]) {
			provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
			subs.push(service.summaries!.subscribe(path, { delayMs: 10, workingTreeDelayMs: 10 }));
			await service.summaries!.getSummary(path);
		}
	});

	teardown(() => {
		for (const sub of subs) {
			sub.dispose();
		}
		service.dispose();
		peer.cleanup();
		for (const wt of linked) {
			wt.cleanup();
		}
		main.cleanup();
		rmSync(root, { recursive: true, force: true });
	});

	test('a fetch moving origin/main costs each linked worktree no git process for its base (was 4)', async () => {
		for (const sub of subs.slice(1)) {
			assert.strictEqual(sub.current?.base?.ref, 'origin/main');
		}

		addCommit(peer.path, 'moved.txt', 'moved', 'Peer moved');
		git(peer.path, 'push', 'origin', 'main');
		const tip = git(peer.path, 'rev-parse', 'HEAD');

		const changed = Promise.all(subs.slice(1).map(sub => nextChange(sub)));
		await service.forRepo(main.path)!.ops!.fetch({ remote: 'origin' });
		const mark = completed.length;
		const summaries = await changed;
		// Lets any trailing read finish, so a late spawn is counted too
		await delay(150);
		await Promise.all(linked.map(wt => service.summaries!.getSummary(wt.path)));

		for (const summary of summaries) {
			assert.strictEqual(summary.base?.sha, tip, 'the base follows the new tip');
			assert.strictEqual(summary.base?.ahead, 1);
		}

		const spawned = completed.slice(mark);
		const perWorktree = linked.map(wt => {
			const key = getRepositoryKey(wt.path);
			return spawned.filter(m => m.includes(`[${key}]`) || m.includes(`[${wt.path}]`));
		});
		const shared = spawned.filter(m => !perWorktree.some(lines => lines.includes(m)));
		console.error(
			`[measure] base refresh after a fetch: ${perWorktree.map(l => l.length).join(', ')} git process(es) per linked worktree, ${shared.length} elsewhere`,
		);
		for (const line of [...perWorktree[0], ...shared]) {
			console.error(`[measure]   ${line.replace(/^.*?\]\s*/, '')}`);
		}

		const provider = service.getProvider(main.path)!.provider as CliGitProvider;
		const own = (await provider.git.supports('git:for-each-ref:ahead-behind')) ? 0 : 1;
		for (const [i, lines] of perWorktree.entries()) {
			assert.strictEqual(lines.length, own, `linked worktree ${i} ran ${lines.join('\n')}`);
		}
		// A fetch moves refs, not config, so no checkout's config-key snapshot is evicted and none is read again
		assert.deepStrictEqual(
			spawned.filter(m => m.includes(' --get-regexp ')),
			[],
			'no config-key read after a fetch',
		);
	});

	test('a fetch moving origin/main, with a branch created during the refreshes, shares one reflog read and one count (was 2 each)', async () => {
		const provider = service.getProvider(main.path)!.provider as CliGitProvider;
		const launched = join(root, 'launched');

		// The first re-measure runs alone; a task launch then adds a worktree and replaces the ref list before the rest
		// start. The summaries reach the provider through each checkout's repository service, whose bound methods are
		// the ones to wrap.
		type Remeasure = CliGitProvider['branches']['getAheadOfBaseAfterBaseMove'] extends (
			first: string,
			...rest: infer Rest
		) => infer Result
			? (...args: Rest) => Result
			: never;
		const wrapped: { branches: { getAheadOfBaseAfterBaseMove: Remeasure }; original: Remeasure }[] = [];
		const first = { started: false };
		let release!: () => void;
		const gate = new Promise<void>(resolve => (release = resolve));
		const mainPath = main.path;
		const wrap =
			(original: Remeasure): Remeasure =>
			async (...args) => {
				if (first.started) {
					await gate;
					return original(...args);
				}

				first.started = true;
				try {
					const result = await original(...args);
					git(mainPath, 'worktree', 'add', '-q', '-b', 'launched', launched, 'origin/main');
					await provider.refs.getRefs(mainPath, undefined, { force: true });
					return result;
				} finally {
					// A failed launch still lets the parked re-measures run, so the test fails on it rather than timing out
					release();
				}
			};
		for (const path of [main.path, ...linked.map(wt => wt.path)]) {
			const branches = service.forRepo(path)!.branches as unknown as {
				getAheadOfBaseAfterBaseMove: Remeasure;
			};
			const original = branches.getAheadOfBaseAfterBaseMove;
			wrapped.push({ branches: branches, original: original });
			branches.getAheadOfBaseAfterBaseMove = wrap(original);
		}

		try {
			addCommit(peer.path, 'moved.txt', 'moved', 'Peer moved');
			git(peer.path, 'push', 'origin', 'main');
			const tip = git(peer.path, 'rev-parse', 'HEAD');

			const changed = Promise.all(subs.slice(1).map(sub => nextChange(sub)));
			await service.forRepo(main.path)!.ops!.fetch({ remote: 'origin' });
			const mark = completed.length;
			const summaries = await changed;
			await delay(150);
			await Promise.all(linked.map(wt => service.summaries!.getSummary(wt.path)));

			assert.ok(first.started, 'the refreshes re-measured the base, and the launch ran between them');
			for (const summary of summaries) {
				assert.strictEqual(summary.base?.sha, tip, 'the base follows the new tip');
				assert.strictEqual(summary.base?.ahead, 1);
			}

			const spawned = completed.slice(mark);
			const perWorktree = linked.map(wt => {
				const key = getRepositoryKey(wt.path);
				return spawned.filter(m => m.includes(`[${key}]`) || m.includes(`[${wt.path}]`));
			});
			const reflogReads = spawned.filter(m => m.includes(' reflog show '));
			const counts = spawned.filter(m => m.includes('%(ahead-behind:'));
			console.error(
				`[measure] base refresh with a branch created during the refreshes: ${reflogReads.length} reflog read(s), ${counts.length} shared count(s), ${perWorktree.map(l => l.length).join(', ')} git process(es) per linked worktree`,
			);

			const aheadBehind = await provider.git.supports('git:for-each-ref:ahead-behind');
			const own = aheadBehind ? 0 : 1;
			for (const [i, lines] of perWorktree.entries()) {
				assert.strictEqual(lines.length, own, `linked worktree ${i} ran ${lines.join('\n')}`);
			}
			assert.strictEqual(reflogReads.length, 1, reflogReads.join('\n'));
			if (aheadBehind) {
				assert.strictEqual(counts.length, 1, counts.join('\n'));
			}
		} finally {
			for (const { branches, original } of wrapped) {
				branches.getAheadOfBaseAfterBaseMove = original;
			}
			release();
			if (existsSync(launched)) {
				git(main.path, 'worktree', 'remove', '--force', launched);
			}
		}
	});
});

/**
 * `.git/config` writes reaching 8 linked worktree summaries (and the main checkout's), counted the same way. Every
 * checkout shares one listing of the config inputs to the base, read in the main checkout, and each summary keys its
 * base on the part of it the base read consulted: the remotes, `init.defaultBranch`, conditional includes, and the
 * tracking of the branches it depends on. Before, each checkout listed its own and keyed on every branch's tracking,
 * so (measured on this fixture) a key-neutral write ran 9 listings (11 processes), a fetch after a write to another
 * branch's section ran 2 or 3 processes in each linked worktree (28 in all), and a key-neutral write after one re-read
 * every base (46 processes, 5 or 6 in each linked worktree).
 */
suite('WorktreeSummaryService base config key after .git/config writes (spawn count)', function () {
	this.timeout(60000);

	const worktreeCount = 8;
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

	let scratch: string;
	let previousGlobalConfig: string | undefined;
	let origin: string;
	let main: TestRepo;
	let peer: TestRepo;
	let linked: { path: string; cleanup: () => void }[];
	let service: GitService;
	let subs: WorktreeSummarySubscription[];
	let watchers: { basePath: string; fire: (e: { path: string; reason: 'change' }) => void }[];

	suiteSetup(() => {
		// A conditional include in the machine's own global config could make the config differ by checkout
		scratch = mkdtempSync(join(tmpdir(), 'gitlens-summary-config-'));
		const globalConfig = join(scratch, 'gitconfig');
		writeFileSync(globalConfig, '');
		previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = globalConfig;
	});

	suiteTeardown(() => {
		if (previousGlobalConfig == null) {
			delete process.env.GIT_CONFIG_GLOBAL;
		} else {
			process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
		}
		rmSync(scratch, { recursive: true, force: true });
	});

	setup(async () => {
		origin = join(scratch, `origin-${Date.now()}.git`);
		git(scratch, 'init', '--bare', '-b', 'main', origin);

		main = createTestRepo();
		git(main.path, 'remote', 'add', 'origin', origin);
		git(main.path, 'push', '-u', 'origin', 'main');
		git(main.path, 'remote', 'set-head', 'origin', 'main');
		git(main.path, 'branch', '--no-track', 'unrelated', 'origin/main');

		linked = [];
		for (let i = 0; i < worktreeCount; i++) {
			const name = `task-${i}`;
			git(main.path, 'branch', '--no-track', name, 'origin/main');
			const wt = createWorktree(main.path, name);
			linked.push(wt);
			addCommit(wt.path, `${name}.txt`, name, `Work on ${name}`);
		}
		peer = cloneTestRepo(origin);

		watchers = [];
		// Not the shadow-checked service: its full base reads would add to the process counts measured here
		service = createCliGitService({
			context: { fs: fs, config: noCommitGraphWritesConfig },
			gitOptions: { logger: countingLogger },
			watchingProvider: {
				createWatcher: (basePath, _pattern, onEvent) => {
					watchers.push({ basePath: basePath, fire: onEvent });
					return createDisposable(() => {});
				},
			} satisfies FileWatchingProvider,
		});
		const provider = service.getProvider(main.path)!.provider as CliGitProvider;
		subs = [];
		for (const path of [main.path, ...linked.map(wt => wt.path)]) {
			provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
			subs.push(service.summaries!.subscribe(path, { delayMs: 10, workingTreeDelayMs: 10 }));
			await service.summaries!.getSummary(path);
		}
		for (const sub of subs.slice(1)) {
			assert.strictEqual(sub.current?.base?.ref, 'origin/main');
		}
		// Lets the watch group's baseline config read and any trailing start-up read finish
		await settle(300);
	});

	teardown(() => {
		for (const sub of subs) {
			sub.dispose();
		}
		service.dispose();
		peer.cleanup();
		for (const wt of linked) {
			wt.cleanup();
		}
		main.cleanup();
		rmSync(origin, { recursive: true, force: true });
	});

	/** Reports a `.git/config` change as the watcher would, written by `args` from the main checkout */
	async function writeConfig(...args: string[]): Promise<string[]> {
		git(main.path, ...args);
		const mark = completed.length;
		const base = join(main.path, '.git');
		const watcher = watchers.find(w => w.basePath === base);
		assert.ok(watcher != null, `no watcher on ${base}`);
		watcher.fire({ path: join(base, 'config'), reason: 'change' });
		await settle();
		return completed.slice(mark);
	}

	/** Waits until no git process completed for `quietMs` */
	async function settle(quietMs: number = 300): Promise<void> {
		let last = completed.length;
		let lastAt = Date.now();
		const start = lastAt;
		while (Date.now() - start < 15000) {
			await delay(25);
			if (completed.length !== last) {
				last = completed.length;
				lastAt = Date.now();
			} else if (Date.now() - lastAt >= quietMs) {
				return;
			}
		}
	}

	function inWorktree(lines: string[], path: string): string[] {
		const key = getRepositoryKey(path);
		return lines.filter(m => m.includes(`[${key}]`) || m.includes(`[${path}]`));
	}

	function configListings(lines: string[]): string[] {
		return lines.filter(m => m.includes(' --get-regexp ^(branch'));
	}

	function report(label: string, lines: string[]): void {
		console.error(
			`[measure] ${label}: ${lines.length} git process(es), ${linked.map(wt => inWorktree(lines, wt.path).length).join(', ')} per linked worktree, ${configListings(lines).length} config listing(s)`,
		);
	}

	function assertOneListingInMain(lines: string[]): void {
		const listings = configListings(lines);
		assert.strictEqual(listings.length, 1, listings.join('\n'));
		assert.deepStrictEqual(inWorktree(listings, main.path), listings, 'the listing runs in the main checkout');
	}

	test('a write that leaves the base inputs alone lists the config once for every checkout (was 9 listings)', async () => {
		const spawned = await writeConfig('config', 'core.scratchkey', 'one');
		report('key-neutral write', spawned);

		assertOneListingInMain(spawned);
		for (const wt of linked) {
			assert.deepStrictEqual(inWorktree(spawned, wt.path), [], 'no linked worktree runs git');
		}
	});

	test("a fetch after a write to another branch's section costs each linked worktree no git process (was 2 or 3)", async () => {
		const confined = await writeConfig('config', 'branch.unrelated.remote', 'origin');
		assert.deepStrictEqual(confined, [], 'a write confined to an unrelated branch wakes no summary');

		addCommit(peer.path, 'moved.txt', 'moved', 'Peer moved');
		git(peer.path, 'push', 'origin', 'main');
		const mark = completed.length;
		await service.forRepo(main.path)!.ops!.fetch({ remote: 'origin' });
		await settle();
		const spawned = completed.slice(mark);
		report('fetch after a confined write', spawned);

		const tip = git(peer.path, 'rev-parse', 'HEAD');
		for (const [i, sub] of subs.slice(1).entries()) {
			assert.strictEqual(sub.current?.base?.sha, tip, `linked worktree ${i} follows the new tip`);
		}
		// One process each before git 2.41 (see the suite above)
		const provider = service.getProvider(main.path)!.provider as CliGitProvider;
		const own = (await provider.git.supports('git:for-each-ref:ahead-behind')) ? 0 : 1;
		for (const [i, wt] of linked.entries()) {
			const lines = inWorktree(spawned, wt.path);
			assert.strictEqual(lines.length, own, `linked worktree ${i} ran ${lines.join('\n')}`);
		}
		assertOneListingInMain(spawned);
	});

	test("a write to another branch's section, then a key-neutral write, re-reads no base (was 46 processes)", async () => {
		const confined = await writeConfig('config', 'branch.unrelated.merge', 'refs/heads/main');
		assert.deepStrictEqual(confined, [], 'a write confined to an unrelated branch wakes no summary');

		const spawned = await writeConfig('config', 'core.scratchkey', 'two');
		report('key-neutral write after a confined one', spawned);

		assertOneListingInMain(spawned);
		for (const wt of linked) {
			assert.deepStrictEqual(inWorktree(spawned, wt.path), [], 'no linked worktree re-reads its base');
		}
	});

	test('a write to the remotes still re-reads every base', async () => {
		const spawned = await writeConfig('config', 'remote.origin.scratch', 'one');
		report('remote write', spawned);

		assertOneListingInMain(spawned);
		for (const [i, wt] of linked.entries()) {
			assert.ok(
				inWorktree(spawned, wt.path).some(m => m.includes(' merge-base ')),
				`linked worktree ${i} re-reads its base`,
			);
		}
	});

	test('a write confined to the section of a branch every base depends on re-reads each base', async () => {
		// Each base is the nearer of `origin/main` and `main`, through `main`'s upstream
		const spawned = await writeConfig('branch', '--unset-upstream', 'main');
		report('upstream unset on the default branch', spawned);

		assertOneListingInMain(spawned);
		for (const [i, wt] of linked.entries()) {
			assert.ok(
				inWorktree(spawned, wt.path).some(m => m.includes(' merge-base ')),
				`linked worktree ${i} re-reads its base`,
			);
			const direct = await service.forRepo(wt.path)!.branches.getAheadOfBase!(`task-${i}`);
			assert.deepStrictEqual(subs[i + 1].current?.base, direct.base, `linked worktree ${i} matches a fresh read`);
		}
	});
});
