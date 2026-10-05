import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { GitService } from '@gitlens/git/service.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import type { WorktreeSummary, WorktreeSummarySubscription } from '@gitlens/git/watching/worktreeSummary.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import { createCliGitService } from '../../../service.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

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

function nextChange(sub: WorktreeSummarySubscription): Promise<WorktreeSummary> {
	return new Promise(resolve => {
		const listener = sub.onDidChange(e => {
			listener.dispose();
			resolve(e);
		});
	});
}

suite('WorktreeSummaryService against real git', () => {
	let repo: TestRepo;
	let service: GitService;
	let watchers: { basePath: string; fire: (event: FileWatchEvent) => void }[];

	function git(...args: string[]): void {
		execFileSync('git', args, { cwd: repo.path, stdio: 'pipe' });
	}

	function fire(basePath: string, relativePath: string): void {
		const watcher = watchers.find(w => w.basePath === basePath);
		assert.ok(watcher != null, `no watcher on ${basePath}`);
		watcher.fire({ path: join(basePath, relativePath), reason: 'change' });
	}

	setup(() => {
		repo = createTestRepo();
		watchers = [];
		const watchingProvider: FileWatchingProvider = {
			createWatcher: function (basePath, _pattern, onEvent) {
				watchers.push({ basePath: basePath, fire: onEvent });
				return createDisposable(() => {});
			},
		};
		service = createCliGitService({ context: { fs: fs }, watchingProvider: watchingProvider });
	});

	teardown(() => {
		service.dispose();
		repo.cleanup();
	});

	test('reads the worktree and follows edits and a branch switch through the cache', async () => {
		const summaries = service.summaries;
		assert.ok(summaries != null);

		const sub = summaries.subscribe(repo.path, { delayMs: 10, workingTreeDelayMs: 10 });
		const initial = await summaries.getSummary(repo.path);
		assert.strictEqual(initial.branch, 'main');
		assert.strictEqual(initial.detached, false);
		assert.strictEqual(initial.dirty, false);
		assert.strictEqual(initial.upstream, undefined);
		// `main` is its own default branch, so there's no base to measure against
		assert.strictEqual(initial.base, undefined);

		// An edit, seen by the working-tree watcher
		const edited = nextChange(sub);
		writeFileSync(join(repo.path, 'README.md'), '# Edited\n');
		fire(repo.path, 'README.md');
		assert.strictEqual((await edited).dirty, true);

		// A commit on a new branch, seen as a HEAD change: the branch read must not be served from a stale cache
		const switched = nextChange(sub);
		git('checkout', '-q', '-b', 'feature');
		git('commit', '-q', '-am', 'Edit');
		const gitDir = watchers.find(w => w.basePath.endsWith('.git'))?.basePath;
		assert.ok(gitDir != null);
		fire(gitDir, 'HEAD');
		const after = await switched;
		assert.strictEqual(after.branch, 'feature');
		assert.strictEqual(after.dirty, false);
		assert.deepStrictEqual(after.base, { ref: 'main', ahead: 1 });

		sub.dispose();
	});
});
