import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type { GitService } from '@gitlens/git/service.js';
import type { WatcherRepoChangeEvent } from '@gitlens/git/watching/changeEvent.js';
import type { FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import type { WatchHandle } from '@gitlens/git/watching/watchService.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import type { TestRepo } from './helpers.js';
import { createShadowCheckedGitService, createTestRepo } from './helpers.js';

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

/** Long enough that an event raised while the commit runs is still pending when the commit announces itself */
const debounceMs = 250;

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A typed write announces itself to the host at once, and its announcement is the watch service's one event for it,
 * marked `announced`; the `.git` file events it causes don't fire again, while an outside write right after the
 * announcement fired does.
 */
suite('Self-write announcements through createCliGitService', () => {
	let repo: TestRepo;
	let service: GitService;
	let handle: WatchHandle;
	let watchers: { basePath: string; fire: (event: FileWatchEvent) => void }[];
	let announced: { repoPath: string; changes: RepositoryChange[] }[];
	let repoEvents: WatcherRepoChangeEvent[];

	function fireGitDir(...relativePaths: string[]): void {
		const watcher = watchers.find(w => w.basePath.endsWith('.git'));
		assert.ok(watcher != null, 'no .git watcher');
		for (const relativePath of relativePaths) {
			watcher.fire({ path: join(watcher.basePath, relativePath), reason: 'change' });
		}
	}

	setup(async () => {
		repo = createTestRepo();
		watchers = [];
		announced = [];
		repoEvents = [];
		const watchingProvider: FileWatchingProvider = {
			createWatcher: function (basePath, _pattern, onEvent) {
				watchers.push({ basePath: basePath, fire: onEvent });
				return createDisposable(() => {});
			},
		};
		service = createShadowCheckedGitService({
			context: {
				fs: fs,
				hooks: {
					repository: {
						onChanged: (repoPath, changes) => announced.push({ repoPath: repoPath, changes: changes }),
					},
				},
			},
			watchingProvider: watchingProvider,
		});

		const gitDir = await repo.provider.config.getGitDir(repo.path);
		assert.ok(gitDir != null);
		const watched = service.watchService!.watch(repo.path, gitDir);
		assert.ok(watched != null);
		handle = watched;
		handle.session.subscribe({ delayMs: debounceMs });
		service.watchService!.onDidChangeRepository(e => repoEvents.push(e));
	});

	teardown(() => {
		handle.dispose();
		service.dispose();
		repo.cleanup();
	});

	test("a typed commit is announced once and fires one announced event, and its own .git events don't fire again", async () => {
		writeFileSync(join(repo.path, 'file.txt'), 'content\n');
		execFileSync('git', ['add', 'file.txt'], { cwd: repo.path, stdio: 'pipe' });

		const committed = service.forRepo(repo.path)!.ops!.commit('Typed commit');
		// Events the write raises while it runs land before its announcement
		fireGitDir('index');
		await committed;
		// ...and the rest just after it
		fireGitDir('index', 'refs/heads/main', 'HEAD');
		await delay(debounceMs + 50);

		const self = normalizePath(repo.path);
		assert.deepStrictEqual(
			announced.filter(a => normalizePath(a.repoPath) === self).map(a => a.changes),
			[['head', 'heads', 'index']],
		);
		assert.strictEqual(repoEvents.length, 1, 'the announcement fires once, in place of its .git echo');
		assert.deepStrictEqual([...repoEvents[0].changes].sort(), ['head', 'heads', 'index']);
		assert.deepStrictEqual([...repoEvents[0].announced].sort(), ['head', 'heads', 'index']);
		assert.ok(repoEvents[0].mayHaveChangedRef('refs/heads/main'));

		// An outside commit right after the announcement fired is reported as usual
		writeFileSync(join(repo.path, 'file.txt'), 'changed\n');
		execFileSync('git', ['commit', '-q', '-am', 'Outside commit'], { cwd: repo.path, stdio: 'pipe' });
		fireGitDir('index', 'refs/heads/main');
		await delay(debounceMs + 50);

		assert.strictEqual(repoEvents.length, 2);
		assert.ok(repoEvents[1].changes.has('index'));
		assert.ok(repoEvents[1].changes.has('heads'));
		assert.ok(repoEvents[1].mayHaveChangedRef('refs/heads/main'));
		assert.deepStrictEqual([...repoEvents[1].announced], []);
	});

	test('an outside change of a kind the write did not announce fires with the announcement', async () => {
		await service.forRepo(repo.path)!.ops!.commit('Empty commit', { allowEmpty: true });
		execFileSync('git', ['tag', 'v1'], { cwd: repo.path, stdio: 'pipe' });
		fireGitDir('refs/heads/main', 'refs/tags/v1');
		await delay(debounceMs + 50);

		const self = normalizePath(repo.path);
		const committed = announced.filter(a => normalizePath(a.repoPath) === self).flatMap(a => a.changes);
		assert.strictEqual(repoEvents.length, 1);
		assert.ok(repoEvents[0].changes.has('tags'));
		assert.deepStrictEqual([...repoEvents[0].announced].sort(), [...new Set(committed)].sort());
	});
});
