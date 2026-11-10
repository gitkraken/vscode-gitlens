import assert from 'node:assert';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
	createWorkingTreeNoiseFilter,
	dotGitGlobCombined,
	dotGitGlobCommon,
	dotGitGlobRoot,
	shouldIgnoreRepoPath,
	shouldIgnoreWorkingTreePath,
} from '../watcherPatterns.js';

describe('shouldIgnoreRepoPath', () => {
	it('rejects fsmonitor-daemon paths', () => {
		assert.strictEqual(shouldIgnoreRepoPath('/fsmonitor--daemon/'), true);
		assert.strictEqual(shouldIgnoreRepoPath('something/fsmonitor--daemon/cookie'), true);
	});

	it('rejects index.lock', () => {
		assert.strictEqual(shouldIgnoreRepoPath('index.lock'), true);
		assert.strictEqual(shouldIgnoreRepoPath('something/index.lock'), true);
	});

	it('accepts normal git paths', () => {
		assert.strictEqual(shouldIgnoreRepoPath('HEAD'), false);
		assert.strictEqual(shouldIgnoreRepoPath('refs/heads/main'), false);
		assert.strictEqual(shouldIgnoreRepoPath('index'), false);
	});
});

describe('shouldIgnoreWorkingTreePath', () => {
	it('rejects node_modules at any depth', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('node_modules'), true);
		assert.strictEqual(shouldIgnoreWorkingTreePath('node_modules/foo'), true);
		assert.strictEqual(shouldIgnoreWorkingTreePath('packages/a/node_modules/foo'), true);
	});

	it('rejects .git paths, including nested repositories', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('.git'), true);
		assert.strictEqual(shouldIgnoreWorkingTreePath('.git/HEAD'), true);
		assert.strictEqual(shouldIgnoreWorkingTreePath('.git/index.lock'), true);
		assert.strictEqual(shouldIgnoreWorkingTreePath('vendor/lib/.git/HEAD'), true);
	});

	it('rejects .watchman-cookie paths', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('.watchman-cookie-abc'), true);
		assert.strictEqual(shouldIgnoreWorkingTreePath('src/.watchman-cookie-abc-1'), true);
	});

	it('rejects the same paths spelled with Windows separators', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('packages\\a\\node_modules\\foo'), true);
		assert.strictEqual(shouldIgnoreWorkingTreePath('vendor\\lib\\.git\\HEAD'), true);
		assert.strictEqual(shouldIgnoreWorkingTreePath('src\\.watchman-cookie-abc'), true);
	});

	it('accepts normal working tree paths', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('src/index.ts'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath('package.json'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath(''), false);
	});

	it('accepts a segment that only contains or ends in the noisy name', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('fixtures/repo.git/HEAD'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath('my.github.io/x'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath('foo.git'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath('.github/workflows/ci.yml'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath('.gitignore'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath('src/my_node_modules/x'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath('src/node_modules_backup/x'), false);
	});
});

describe('createWorkingTreeNoiseFilter', () => {
	it('judges only the part of the path inside the repository root', () => {
		const ignored = createWorkingTreeNoiseFilter('/repo');
		assert.strictEqual(ignored('/repo/node_modules/foo'), true);
		assert.strictEqual(ignored('/repo/.git/HEAD'), true);
		assert.strictEqual(ignored('/repo/.git/index.lock'), true);
		assert.strictEqual(ignored('/repo/.watchman-cookie-abc'), true);
		assert.strictEqual(ignored('/repo/src/index.ts'), false);
		assert.strictEqual(ignored('/repo/fixtures/repo.git/HEAD'), false);
	});

	it('ignores segments above the root', () => {
		const underBareLayout = createWorkingTreeNoiseFilter('/home/u/src/app.git/feature');
		assert.strictEqual(underBareLayout('/home/u/src/app.git/feature/src/a.ts'), false);
		assert.strictEqual(underBareLayout('/home/u/src/app.git/feature/node_modules/x'), true);
		assert.strictEqual(underBareLayout('/home/u/src/app.git/feature/.git/HEAD'), true);

		const underNodeModules = createWorkingTreeNoiseFilter('/x/node_modules/pkg/repo');
		assert.strictEqual(underNodeModules('/x/node_modules/pkg/repo/src/a.ts'), false);
		assert.strictEqual(underNodeModules('/x/node_modules/pkg/repo/node_modules/y'), true);

		const underDotGit = createWorkingTreeNoiseFilter('/x/.git/worktrees-live/repo');
		assert.strictEqual(underDotGit('/x/.git/worktrees-live/repo/src/a.ts'), false);
	});

	it('does not match a sibling that merely shares the root as a prefix', () => {
		const ignored = createWorkingTreeNoiseFilter('/repo');
		// Not under the root, so the whole path is judged
		assert.strictEqual(ignored('/repo2/src/a.ts'), false);
		assert.strictEqual(ignored('/repo2/node_modules/a'), true);
	});

	it('keeps an event on the root itself', () => {
		assert.strictEqual(createWorkingTreeNoiseFilter('/x/node_modules/pkg/repo')('/x/node_modules/pkg/repo'), false);
	});

	it('judges the whole path when it is not under the root', () => {
		const ignored = createWorkingTreeNoiseFilter('/repo');
		assert.strictEqual(ignored('/elsewhere/node_modules/a'), true);
		assert.strictEqual(ignored('/elsewhere/a.ts'), false);
	});

	it('handles Windows separators in the event path and the root', () => {
		const ignored = createWorkingTreeNoiseFilter('/repo');
		assert.strictEqual(ignored('\\repo\\node_modules\\foo'), true);
		assert.strictEqual(ignored('\\repo\\src\\a.ts'), false);

		const windowsRoot = createWorkingTreeNoiseFilter('c:\\x\\app.git\\feature');
		assert.strictEqual(windowsRoot('c:\\x\\app.git\\feature\\src\\a.ts'), false);
		assert.strictEqual(windowsRoot('c:\\x\\app.git\\feature\\.git\\HEAD'), true);
	});

	it('is reusable across calls with the same answers', () => {
		const ignored = createWorkingTreeNoiseFilter('/repo');
		for (let i = 0; i < 3; i++) {
			assert.strictEqual(ignored('/repo/src/a.ts'), false);
			assert.strictEqual(ignored('/repo/node_modules/a'), true);
		}
	});
});

describe('shallow boundary glob contract', () => {
	// Check the literal glob contract with Node's matcher; this does not exercise VS Code's
	// watcher backend. Live unshallow/deepen checks cover actual event delivery.
	// Node 24 provides matchesGlob; the workspace's Node 20 types do not declare it yet.
	const { matchesGlob } = path as typeof path & { matchesGlob(path: string, pattern: string): boolean };

	it('watches shallow in the standard and shared git directories, excluding the transient lock', () => {
		for (const pattern of [dotGitGlobCombined, dotGitGlobCommon]) {
			assert.strictEqual(matchesGlob('shallow', pattern), true);
			assert.strictEqual(matchesGlob('shallow.lock', pattern), false);
		}

		assert.strictEqual(matchesGlob('shallow', dotGitGlobRoot), false);
	});
});

describe('worktrees glob contract', () => {
	const { matchesGlob } = path as typeof path & { matchesGlob(path: string, pattern: string): boolean };

	it('watches only the worktree list and per-worktree HEAD/locked/gitdir in the common glob', () => {
		for (const pattern of [dotGitGlobCombined, dotGitGlobCommon]) {
			for (const p of [
				'worktrees',
				'worktrees/A',
				'worktrees/A/HEAD',
				'worktrees/A/locked',
				'worktrees/A/gitdir',
			]) {
				assert.strictEqual(matchesGlob(p, pattern), true, p);
			}

			for (const p of [
				'worktrees/A/index',
				'worktrees/A/MERGE_HEAD',
				'worktrees/A/rebase-merge/onto',
				'worktrees/A/sequencer/todo',
			]) {
				assert.strictEqual(matchesGlob(p, pattern), false, p);
			}
		}

		assert.ok(!dotGitGlobCommon.includes('worktrees/**'));
	});
});
