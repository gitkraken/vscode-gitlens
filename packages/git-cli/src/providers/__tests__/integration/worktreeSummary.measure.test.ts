import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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
import { addCommit, cloneTestRepo, createTestRepo, createWorktree } from './helpers.js';

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
 * --left-right --count`), and the first of them also read the remotes. Now each runs 1 (`rev-list --count`), and the
 * repository's checkouts share one read of the base's reflog, one `rev-parse` of the value before its oldest entry and
 * one `rev-list` of what they reach off the new tip's history, besides the ref list and remote `HEAD` reads every
 * refresh after a fetch shares.
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

		service = createCliGitService({
			context: { fs: fs },
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

	test('a fetch moving origin/main costs each linked worktree 1 git process for its base (was 4)', async () => {
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

		for (const [i, lines] of perWorktree.entries()) {
			assert.strictEqual(lines.length, 1, `linked worktree ${i} ran ${lines.join('\n')}`);
		}
		// A fetch moves refs, not config, so no checkout's config-key snapshot is evicted and none is read again
		assert.deepStrictEqual(
			spawned.filter(m => m.includes(' --get-regexp ')),
			[],
			'no config-key read after a fetch',
		);
	});
});
