import * as assert from 'assert';
import type { Container } from '../../../../container.js';
import { getScopeFiles } from '../graphScopeService.js';

suite('graphScopeService — content ids of the working changes', () => {
	test('a deletion has the deletion as its content, on disk or in the index alike', async () => {
		const hashed: string[][] = [];
		const container = {
			git: {
				getRepositoryService: () => ({
					status: {
						getStatus: () =>
							Promise.resolve({
								files: [
									{ path: 'gone-on-disk.ts', status: 'D', workingTreeStatus: 'D' },
									{ path: 'gone-in-index.ts', status: 'D', indexStatus: 'D' },
									{ path: 'staged.ts', status: 'M', indexStatus: 'M' },
								],
							}),
					},
					revision: {
						getBlobIds: (paths: string[]) => {
							hashed.push(paths);
							return Promise.resolve(new Map(paths.map(p => [p, `blob:${p}`])));
						},
					},
				}),
			},
		} as unknown as Container;

		const files = await getScopeFiles(container, '/r', {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: true,
			includeShas: [],
		});
		assert.deepStrictEqual(
			files.map(f => [f.path, f.contentId]),
			[
				['gone-on-disk.ts', 'deleted'],
				['gone-in-index.ts', 'deleted'],
				['staged.ts', 'blob:staged.ts'],
			],
		);
		assert.ok(!hashed.flat().some(p => p.startsWith('gone')), 'a deletion is never hashed');
	});
});

suite('graphScopeService — content ids of the committed changes', () => {
	/** A range whose tip is `tip`, with `a.ts` modified, `b.ts` deleted and `c.ts` unreadable at the tip. */
	function containerAt(tip: string, blobs: Record<string, string | undefined>): Container {
		return {
			git: {
				getRepositoryService: () => ({
					diff: {
						getDiffStatus: () =>
							Promise.resolve([
								{ path: 'a.ts', status: 'M' },
								{ path: 'b.ts', status: 'D' },
								{ path: 'c.ts', status: 'M' },
							]),
					},
					revision: {
						resolveRevision: (ref: string) => Promise.resolve({ sha: `parent-of-${ref}`, revision: ref }),
						getTreeForRevision: (rev: string, options: { paths: string[] }) => {
							assert.strictEqual(rev, tip, 'the blobs are read at the range tip');
							assert.ok(!options.paths.includes('b.ts'), 'a deletion is never looked up');
							return Promise.resolve(
								options.paths
									.filter(p => p in blobs)
									.map(p => ({ ref: rev, oid: blobs[p] ?? '', path: p, size: 1, type: 'blob' })),
							);
						},
					},
				}),
			},
		} as unknown as Container;
	}

	test('a file keeps its id across a rewrite that left it alone', async () => {
		const scope = (tip: string) => ({
			type: 'wip' as const,
			includeStaged: false,
			includeUnstaged: false,
			includeShas: [tip, 'base'],
		});

		const before = await getScopeFiles(containerAt('tip1', { 'a.ts': 'blob-a' }), '/r', scope('tip1'));
		const after = await getScopeFiles(containerAt('tip2', { 'a.ts': 'blob-a' }), '/r', scope('tip2'));

		assert.deepStrictEqual(
			before.map(f => [f.path, f.contentId]),
			[
				['a.ts', 'blob-a'],
				['b.ts', 'deleted'],
				['c.ts', 'tip1'],
			],
		);
		assert.strictEqual(after[0].contentId, before[0].contentId, 'the unchanged file is still viewed');
		assert.notStrictEqual(after[2].contentId, before[2].contentId, 'an unreadable blob falls back to the tip');
	});

	test('a blob listed without its id falls back to the tip', async () => {
		const scope = {
			type: 'wip' as const,
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ['tip1', 'base'],
		};
		// Listed, but with an empty id — as the GitHub provider lists every entry
		const files = await getScopeFiles(containerAt('tip1', { 'a.ts': undefined }), '/r', scope);

		assert.strictEqual(files[0].contentId, 'tip1');
	});
});
