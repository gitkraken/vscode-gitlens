import * as assert from 'assert';
import type { GitGraphRowHead } from '@gitlens/git/models/graph.js';
import { pickRowUndoTarget } from '../row.utils.js';

function head(name: string, isCurrentHead = false, worktree?: { id: string; path: string }): GitGraphRowHead {
	return { name: name, id: `/mock/repo|heads/${name}`, isCurrentHead: isCurrentHead, worktree: worktree };
}

const wtA = { id: '/mock/repo|worktrees/feature-a', path: '/mock/repo.worktrees/feature-a' };
const wtB = { id: '/mock/repo|worktrees/feature-b', path: '/mock/repo.worktrees/feature-b' };

suite('pickRowUndoTarget', () => {
	test('active-worktree HEAD (leaf) → currentHead, no worktreeHead', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget([head('main', true)], false);
		assert.strictEqual(currentHead?.name, 'main');
		assert.strictEqual(worktreeHead, undefined);
	});

	test('single secondary-worktree HEAD (leaf) → worktreeHead with its path, no currentHead', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget([head('feature-a', false, wtA)], false);
		assert.strictEqual(currentHead, undefined);
		assert.strictEqual(worktreeHead?.name, 'feature-a');
		assert.strictEqual(worktreeHead?.worktree?.path, wtA.path);
	});

	test('current head + secondary-worktree head → active wins (no worktreeHead)', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget(
			[head('main', true), head('feature-a', false, wtA)],
			false,
		);
		assert.strictEqual(currentHead?.name, 'main');
		assert.strictEqual(worktreeHead, undefined);
	});

	test('non-HEAD row → neither', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget([head('feature-a')], false);
		assert.strictEqual(currentHead, undefined);
		assert.strictEqual(worktreeHead, undefined);
	});

	test('two secondary-worktree heads on the same sha → ambiguous, no worktreeHead', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget(
			[head('feature-a', false, wtA), head('feature-b', false, wtB)],
			false,
		);
		assert.strictEqual(currentHead, undefined);
		assert.strictEqual(worktreeHead, undefined);
	});

	test('current head + multiple worktree heads → active wins', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget(
			[head('main', true), head('feature-a', false, wtA), head('feature-b', false, wtB)],
			false,
		);
		assert.strictEqual(currentHead?.name, 'main');
		assert.strictEqual(worktreeHead, undefined);
	});

	test('undefined heads → neither', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget(undefined, false);
		assert.strictEqual(currentHead, undefined);
		assert.strictEqual(worktreeHead, undefined);
	});

	test('hasChildren=true suppresses an active HEAD (non-leaf is not undoable)', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget([head('main', true)], true);
		assert.strictEqual(currentHead, undefined);
		assert.strictEqual(worktreeHead, undefined);
	});

	test('hasChildren=true suppresses a secondary-worktree HEAD (stacked/ancestor commit)', () => {
		const { currentHead, worktreeHead } = pickRowUndoTarget([head('feature-a', false, wtA)], true);
		assert.strictEqual(currentHead, undefined);
		assert.strictEqual(worktreeHead, undefined);
	});
});
