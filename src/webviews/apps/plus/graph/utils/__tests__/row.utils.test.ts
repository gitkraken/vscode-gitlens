import * as assert from 'assert';
import { keepRowUnderRefVisibility, pickRowUndoTarget } from '@gitkraken/commit-graph-ui/rows.js';
import type { GitGraphRow, GitGraphRowHead } from '@gitlens/git/models/graph.js';

function head(name: string, isCurrentHead = false, worktree?: GitGraphRowHead['worktree']): GitGraphRowHead {
	return { name: name, id: `/mock/repo|heads/${name}`, isCurrentHead: isCurrentHead, worktree: worktree };
}

function row(
	sha: string,
	kind: GitGraphRow['kind'],
	parents: string[],
	heads?: GitGraphRowHead[],
): Pick<GitGraphRow, 'kind' | 'sha' | 'parents' | 'heads'> {
	return { sha: sha, kind: kind, parents: parents, heads: heads };
}

suite('keepRowUnderRefVisibility', () => {
	test('a stash whose base commit is filtered out is dropped', () => {
		const reachable = new Set(['included-tip']);
		const stashRow = row('stash-sha', 'stash', ['excluded-base']);
		assert.strictEqual(keepRowUnderRefVisibility(stashRow, reachable), false);
	});

	test('a stash whose base commit survives is kept', () => {
		const reachable = new Set(['included-base']);
		const stashRow = row('stash-sha', 'stash', ['included-base']);
		assert.strictEqual(keepRowUnderRefVisibility(stashRow, reachable), true);
	});

	test('a WIP (workdir) row is kept regardless of reachability', () => {
		const reachable = new Set<string>();
		const wipRow = row('workdir-sha', 'workdir', []);
		assert.strictEqual(keepRowUnderRefVisibility(wipRow, reachable), true);
	});

	test('the current-HEAD row is kept even when HEAD is not in the include set', () => {
		const reachable = new Set(['included-tip']);
		const headRow = row('head-sha', 'commit', ['parent-sha'], [head('main', true)]);
		assert.strictEqual(keepRowUnderRefVisibility(headRow, reachable), true);
	});

	test('a commit reachable only from HEAD (and not from any included ref) is dropped', () => {
		const reachable = new Set(['included-tip']);
		const onlyFromHead = row('only-from-head-sha', 'commit', ['head-sha']);
		assert.strictEqual(keepRowUnderRefVisibility(onlyFromHead, reachable), false);
	});
});

const wtA = { id: '/mock/repo|worktrees/feature-a', path: '/mock/repo.worktrees/feature-a', isDefault: false };
const wtB = { id: '/mock/repo|worktrees/feature-b', path: '/mock/repo.worktrees/feature-b', isDefault: false };

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
