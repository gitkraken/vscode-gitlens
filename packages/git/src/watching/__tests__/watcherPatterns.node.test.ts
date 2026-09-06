import assert from 'node:assert';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
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
	it('rejects node_modules paths', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('/repo/node_modules/foo'), true);
	});

	it('rejects .git paths', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('/repo/.git/HEAD'), true);
	});

	it('rejects .git/index.lock', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('/repo/.git/index.lock'), true);
	});

	it('rejects .watchman-cookie paths', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('/repo/.watchman-cookie-abc'), true);
	});

	it('accepts normal working tree paths', () => {
		assert.strictEqual(shouldIgnoreWorkingTreePath('/repo/src/index.ts'), false);
		assert.strictEqual(shouldIgnoreWorkingTreePath('/repo/package.json'), false);
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
