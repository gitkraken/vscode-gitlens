import * as assert from 'assert';
import { GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';
import type { GraphCommitContextValue } from '../../../../../plus/graph/protocol.js';
import type { RowContextSource } from '../rowContext.utils.js';
import { buildRowCommitContext } from '../rowContext.utils.js';

const primary = '/mock/repo';
const wtA = { id: '/mock/repo|worktrees/feature-a', path: '/mock/repo.worktrees/feature-a' };
const wtB = { id: '/mock/repo|worktrees/feature-b', path: '/mock/repo.worktrees/feature-b' };

function row(overrides?: Partial<RowContextSource>): RowContextSource {
	return { sha: 'abc1234', ...overrides };
}

/** Narrow the built context to the commit value (`buildRowCommitContext` always builds `type: 'commit'`). */
function build(source: RowContextSource): { webviewItem: string; value: GraphCommitContextValue } {
	const ctx = buildRowCommitContext(source, primary);
	return { webviewItem: ctx.webviewItem, value: ctx.webviewItemValue as GraphCommitContextValue };
}

suite('buildRowCommitContext', () => {
	test('active-worktree HEAD → +HEAD, primary repoPath, no worktreePath', () => {
		const { webviewItem, value } = build(row({ heads: [{ isCurrentHead: true }] }));
		assert.ok(/\+HEAD\b/.test(webviewItem), `expected +HEAD in "${webviewItem}"`);
		assert.ok(!/\+worktreeHEAD\b/.test(webviewItem), `unexpected +worktreeHEAD in "${webviewItem}"`);
		assert.strictEqual(value.ref.repoPath, primary);
		assert.strictEqual(value.worktreePath, undefined);
	});

	test('secondary-worktree HEAD → +worktreeHEAD, primary refPath, worktreePath side-channel', () => {
		const { webviewItem, value } = build(row({ heads: [{ isCurrentHead: false, worktree: wtA }] }));
		assert.ok(!/\+HEAD\b/.test(webviewItem), `unexpected lone +HEAD in "${webviewItem}"`);
		assert.ok(/\+worktreeHEAD\b/.test(webviewItem), `expected +worktreeHEAD in "${webviewItem}"`);
		// ref stays primary so other right-click commands don't retarget; undo reads worktreePath
		assert.strictEqual(value.ref.repoPath, primary);
		assert.strictEqual(value.worktreePath, wtA.path);
	});

	test('active wins over a secondary worktree head on the same row', () => {
		const { webviewItem, value } = build(
			row({ heads: [{ isCurrentHead: true }, { isCurrentHead: false, worktree: wtA }] }),
		);
		assert.ok(/\+HEAD\b/.test(webviewItem), `expected +HEAD in "${webviewItem}"`);
		assert.ok(!/\+worktreeHEAD\b/.test(webviewItem), `unexpected +worktreeHEAD in "${webviewItem}"`);
		assert.strictEqual(value.worktreePath, undefined);
	});

	test('two secondary-worktree heads on the same sha → ambiguous, no token, no worktreePath', () => {
		const { webviewItem, value } = build(row({ heads: [{ worktree: wtA }, { worktree: wtB }] }));
		assert.ok(!/\+worktreeHEAD\b/.test(webviewItem), `unexpected +worktreeHEAD in "${webviewItem}"`);
		assert.strictEqual(value.worktreePath, undefined);
	});

	test('non-HEAD row → neither token, no worktreePath', () => {
		const { webviewItem, value } = build(row({ heads: [] }));
		assert.ok(!/\+HEAD\b/.test(webviewItem), `unexpected +HEAD in "${webviewItem}"`);
		assert.ok(!/\+worktreeHEAD\b/.test(webviewItem), `unexpected +worktreeHEAD in "${webviewItem}"`);
		assert.strictEqual(value.worktreePath, undefined);
	});

	test('flags map to +current (ReachableFromHead) and +unique (UniqueToBranch)', () => {
		const { webviewItem } = build(
			row({
				contexts: {
					flags: GitGraphRowContextFlags.ReachableFromHead | GitGraphRowContextFlags.UniqueToBranch,
				},
			}),
		);
		assert.ok(/\+current\b/.test(webviewItem), `expected +current in "${webviewItem}"`);
		assert.ok(/\+unique\b/.test(webviewItem), `expected +unique in "${webviewItem}"`);
	});

	test('Unpublished flag maps to +unpublished', () => {
		const { webviewItem } = build(row({ contexts: { flags: GitGraphRowContextFlags.Unpublished } }));
		assert.ok(/\+unpublished\b/.test(webviewItem), `expected +unpublished in "${webviewItem}"`);
	});

	test('no Unpublished flag → no +unpublished', () => {
		const { webviewItem } = build(row({ contexts: { flags: GitGraphRowContextFlags.ReachableFromHead } }));
		assert.ok(!/\+unpublished\b/.test(webviewItem), `unexpected +unpublished in "${webviewItem}"`);
	});

	test('HasChildren suppresses +HEAD (leaf-only — a commit other work is built on is not undoable)', () => {
		const { webviewItem, value } = build(
			row({ heads: [{ isCurrentHead: true }], contexts: { flags: GitGraphRowContextFlags.HasChildren } }),
		);
		assert.ok(!/\+HEAD\b/.test(webviewItem), `unexpected +HEAD on a non-leaf in "${webviewItem}"`);
		assert.strictEqual(value.worktreePath, undefined);
	});

	test('HasChildren suppresses +worktreeHEAD (stacked/ancestor worktree commit is not undoable)', () => {
		const { webviewItem, value } = build(
			row({
				heads: [{ isCurrentHead: false, worktree: wtA }],
				contexts: { flags: GitGraphRowContextFlags.HasChildren },
			}),
		);
		assert.ok(!/\+worktreeHEAD\b/.test(webviewItem), `unexpected +worktreeHEAD on a non-leaf in "${webviewItem}"`);
		assert.strictEqual(value.worktreePath, undefined);
	});
});
