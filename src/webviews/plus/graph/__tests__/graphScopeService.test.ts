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
