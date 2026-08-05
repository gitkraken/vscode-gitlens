import * as assert from 'node:assert';
import { getPullBlockedFileCount } from '../branches.js';

function unstaged(...paths: string[]) {
	return paths.map(p => ({ path: p, staged: false }));
}

function staged(...paths: string[]) {
	return paths.map(p => ({ path: p, staged: true }));
}

/** `ahead` defaults to a fast-forward pull — the common behind-only case. */
function opts(options: { rebase: boolean; autoStash: boolean; ahead?: boolean }) {
	return { rebase: options.rebase, autoStash: options.autoStash, ahead: options.ahead ?? false };
}

suite('getPullBlockedFileCount', () => {
	test('clean tree blocks nothing, in every mode', () => {
		for (const rebase of [false, true]) {
			for (const autoStash of [false, true]) {
				for (const ahead of [false, true]) {
					assert.strictEqual(
						getPullBlockedFileCount(
							[],
							[],
							new Set(['a.ts']),
							opts({ rebase: rebase, autoStash: autoStash, ahead: ahead }),
						),
						0,
					);
				}
			}
		}
	});

	test('autostash on: an overlapping tracked file does not block', () => {
		const count = getPullBlockedFileCount(
			unstaged('a.ts'),
			[],
			new Set(['a.ts']),
			opts({ rebase: false, autoStash: true }),
		);
		assert.strictEqual(count, 0);
	});

	test('autostash on: a staged file does not block, even building a merge commit', () => {
		const count = getPullBlockedFileCount(
			staged('a.ts'),
			[],
			new Set(['b.ts']),
			opts({ rebase: false, autoStash: true, ahead: true }),
		);
		assert.strictEqual(count, 0);
	});

	test('autostash on: a non-overlapping tracked file does not block', () => {
		const count = getPullBlockedFileCount(
			unstaged('a.ts'),
			[],
			new Set(['b.ts']),
			opts({ rebase: true, autoStash: true }),
		);
		assert.strictEqual(count, 0);
	});

	test('autostash on: an overlapping untracked file blocks', () => {
		const count = getPullBlockedFileCount(
			[],
			['a.ts'],
			new Set(['a.ts']),
			opts({ rebase: false, autoStash: true }),
		);
		assert.strictEqual(count, 1);
	});

	test('autostash on: a non-overlapping untracked file does not block', () => {
		const count = getPullBlockedFileCount([], ['a.ts'], new Set(['b.ts']), opts({ rebase: true, autoStash: true }));
		assert.strictEqual(count, 0);
	});

	test('autostash off + rebase: a non-overlapping tracked file still blocks', () => {
		const count = getPullBlockedFileCount(
			unstaged('a.ts'),
			[],
			new Set(['b.ts']),
			opts({ rebase: true, autoStash: false }),
		);
		assert.strictEqual(count, 1);
	});

	test('autostash off + rebase: an overlapping tracked file blocks', () => {
		const count = getPullBlockedFileCount(
			unstaged('a.ts'),
			[],
			new Set(['a.ts']),
			opts({ rebase: true, autoStash: false }),
		);
		assert.strictEqual(count, 1);
	});

	test('autostash off + rebase: an overlapping untracked file also blocks', () => {
		const count = getPullBlockedFileCount(
			[],
			['a.ts'],
			new Set(['a.ts']),
			opts({ rebase: true, autoStash: false }),
		);
		assert.strictEqual(count, 1);
	});

	test('autostash off + merge: a non-overlapping unstaged file does not block', () => {
		const count = getPullBlockedFileCount(
			unstaged('a.ts'),
			[],
			new Set(['b.ts']),
			opts({ rebase: false, autoStash: false }),
		);
		assert.strictEqual(count, 0);
	});

	test('autostash off + merge: a non-overlapping unstaged file does not block building a merge commit either', () => {
		const count = getPullBlockedFileCount(
			unstaged('a.ts'),
			[],
			new Set(['b.ts']),
			opts({ rebase: false, autoStash: false, ahead: true }),
		);
		assert.strictEqual(count, 0);
	});

	test('autostash off + merge: a non-overlapping STAGED file does NOT block a fast-forward', () => {
		const count = getPullBlockedFileCount(
			staged('a.ts'),
			[],
			new Set(['b.ts']),
			opts({ rebase: false, autoStash: false }),
		);
		assert.strictEqual(count, 0);
	});

	test('autostash off + merge: a non-overlapping STAGED file blocks a merge commit — it needs a clean index', () => {
		const count = getPullBlockedFileCount(
			staged('a.ts'),
			[],
			new Set(['b.ts']),
			opts({ rebase: false, autoStash: false, ahead: true }),
		);
		assert.strictEqual(count, 1);
	});

	test('autostash off + merge: an overlapping tracked file blocks', () => {
		const count = getPullBlockedFileCount(
			unstaged('a.ts'),
			[],
			new Set(['a.ts']),
			opts({ rebase: false, autoStash: false }),
		);
		assert.strictEqual(count, 1);
	});

	test('autostash off + merge: an overlapping untracked file blocks', () => {
		const count = getPullBlockedFileCount(
			[],
			['a.ts'],
			new Set(['a.ts']),
			opts({ rebase: false, autoStash: false }),
		);
		assert.strictEqual(count, 1);
	});

	test('autostash off + merge: a staged file the incoming commits also touch counts once', () => {
		const count = getPullBlockedFileCount(
			staged('a.ts'),
			[],
			new Set(['a.ts']),
			opts({ rebase: false, autoStash: false, ahead: true }),
		);
		assert.strictEqual(count, 1);
	});

	test('mixed tracked and untracked overlap counts both', () => {
		const count = getPullBlockedFileCount(
			unstaged('a.ts'),
			['b.ts'],
			new Set(['a.ts', 'b.ts']),
			opts({ rebase: false, autoStash: false }),
		);
		assert.strictEqual(count, 2);
	});
});
