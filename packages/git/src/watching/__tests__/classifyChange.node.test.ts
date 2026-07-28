import assert from 'node:assert';
import { describe, it } from 'node:test';
import { classifyGitDirChange } from '../classifyChange.js';

describe('classifyGitDirChange', () => {
	it('maps config to config + remotes', () => {
		assert.deepStrictEqual(classifyGitDirChange('config'), ['config', 'remotes']);
	});

	it('maps gk/config to gkConfig', () => {
		assert.deepStrictEqual(classifyGitDirChange('gk/config'), ['gkConfig']);
	});

	it('maps info/exclude to ignores', () => {
		assert.deepStrictEqual(classifyGitDirChange('info/exclude'), ['ignores']);
	});

	it('maps index to index', () => {
		assert.deepStrictEqual(classifyGitDirChange('index'), ['index']);
	});

	it('returns undefined for FETCH_HEAD (no change type)', () => {
		assert.strictEqual(classifyGitDirChange('FETCH_HEAD'), undefined);
	});

	it('maps HEAD to head + heads', () => {
		assert.deepStrictEqual(classifyGitDirChange('HEAD'), ['head', 'heads']);
	});

	it('maps ORIG_HEAD to heads', () => {
		assert.deepStrictEqual(classifyGitDirChange('ORIG_HEAD'), ['heads']);
	});

	it('maps CHERRY_PICK_HEAD to cherryPick + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('CHERRY_PICK_HEAD'), ['cherryPick', 'pausedOp']);
	});

	it('maps MERGE_HEAD to merge + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('MERGE_HEAD'), ['merge', 'pausedOp']);
	});

	it('maps REBASE_HEAD to rebase + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('REBASE_HEAD'), ['rebase', 'pausedOp']);
	});

	it('maps rebase-merge to rebase + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('rebase-merge'), ['rebase', 'pausedOp']);
	});

	it('maps rebase-apply to rebase + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('rebase-apply'), ['rebase', 'pausedOp']);
	});

	it('maps rebase-apply/head-name to rebase + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('rebase-apply/head-name'), ['rebase', 'pausedOp']);
	});

	it('maps rebase-merge/head-name to rebase + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('rebase-merge/head-name'), ['rebase', 'pausedOp']);
	});

	it('maps rebase-merge/onto to rebase + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('rebase-merge/onto'), ['rebase', 'pausedOp']);
	});

	it('maps rebase-merge/done to rebase + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('rebase-merge/done'), ['rebase', 'pausedOp']);
	});

	it('returns undefined for rebase-merge/git-rebase-todo (handled by VS Code TextDocument events)', () => {
		assert.strictEqual(classifyGitDirChange('rebase-merge/git-rebase-todo'), undefined);
	});

	it('returns undefined for rebase-merge/git-rebase-todo.backup', () => {
		assert.strictEqual(classifyGitDirChange('rebase-merge/git-rebase-todo.backup'), undefined);
	});

	it('returns undefined for worktrees/foo/rebase-merge/git-rebase-todo (todo special-case wins over worktrees regex)', () => {
		assert.strictEqual(classifyGitDirChange('worktrees/foo/rebase-merge/git-rebase-todo'), undefined);
	});

	it('maps REVERT_HEAD to revert + pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('REVERT_HEAD'), ['revert', 'pausedOp']);
	});

	it('maps sequencer to pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('sequencer'), ['pausedOp']);
	});

	it('maps sequencer/todo to pausedOp', () => {
		assert.deepStrictEqual(classifyGitDirChange('sequencer/todo'), ['pausedOp']);
	});

	it('maps refs/heads/main to heads', () => {
		assert.deepStrictEqual(classifyGitDirChange('refs/heads/main'), ['heads']);
	});

	it('maps refs/heads/feature/foo to heads', () => {
		assert.deepStrictEqual(classifyGitDirChange('refs/heads/feature/foo'), ['heads']);
	});

	it('maps refs/remotes/origin/main to remotes', () => {
		assert.deepStrictEqual(classifyGitDirChange('refs/remotes/origin/main'), ['remotes']);
	});

	it('maps refs/stash to stash', () => {
		assert.deepStrictEqual(classifyGitDirChange('refs/stash'), ['stash']);
	});

	it('maps refs/tags/v1.0 to tags', () => {
		assert.deepStrictEqual(classifyGitDirChange('refs/tags/v1.0'), ['tags']);
	});

	it('maps worktrees to worktrees', () => {
		assert.deepStrictEqual(classifyGitDirChange('worktrees'), ['worktrees']);
	});

	it('maps worktrees/foo/HEAD to worktrees (worktrees match first)', () => {
		// The regex matches "worktrees" before HEAD
		assert.deepStrictEqual(classifyGitDirChange('worktrees/foo/HEAD'), ['worktrees']);
	});

	it('returns undefined for unrecognized paths', () => {
		assert.strictEqual(classifyGitDirChange('objects/pack/something'), undefined);
	});

	it('returns undefined for empty path', () => {
		assert.strictEqual(classifyGitDirChange(''), undefined);
	});
});
