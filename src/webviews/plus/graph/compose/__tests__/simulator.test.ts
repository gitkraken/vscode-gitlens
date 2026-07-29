import * as assert from 'assert';
import type { GitRepositoryService } from '../../../../../git/gitRepositoryService.js';
import { applyHunks } from '../../../../../virtual/hunkApply.js';
import type { ScopeSelection } from '../../graphService.js';
import { runSimulatedComposeChanges } from '../simulator.js';

const decoder = new TextDecoder();
const utf8 = new TextEncoder();

const wipScope: Extract<ScopeSelection, { type: 'wip' }> = {
	type: 'wip',
	includeStaged: true,
	includeUnstaged: true,
	includeShas: [],
};

function createService(paths: string[]): GitRepositoryService {
	return {
		commits: { getCommit: () => Promise.resolve({ sha: 'a'.repeat(40) }) },
		status: {
			getStatus: () =>
				Promise.resolve({
					files: paths.map(path => ({
						path: path,
						originalPath: undefined,
						status: 'M',
						staged: false,
						workingTreeStatus: 'M',
					})),
				}),
		},
	} as unknown as GitRepositoryService;
}

function runSimulator(paths: string[]) {
	return runSimulatedComposeChanges({ svc: createService(paths), scope: wipScope, onProgress: () => {} });
}

suite('compose simulator Test Suite', () => {
	// The simulator's plan flows through `deriveComposeCommits` into the virtual content provider, so
	// its hunks are applied against real base file content. Invented deleted/context text can never
	// match that, which is why the synthetic hunk has to be addition-only.
	test('produces hunks that apply against unrelated base content', async () => {
		const result = await runSimulator(['src/one.ts', 'src/two.ts']);
		assert.strictEqual(result.sourceHunks.length, 2);

		const base = utf8.encode(['import * as x from "y";', 'const a = 1;', ''].join('\n'));
		for (const hunk of result.sourceHunks) {
			const applied = decoder.decode(applyHunks(base, [hunk]));
			assert.ok(
				applied.includes('(simulated changed line)'),
				`expected the simulated line in the result for ${hunk.fileName}, got ${JSON.stringify(applied)}`,
			);
			assert.ok(applied.includes('const a = 1;'), 'expected the base content to survive');
		}
	});

	test('produces hunks that apply against an empty base', async () => {
		const result = await runSimulator(['src/new.ts']);

		const applied = decoder.decode(applyHunks(undefined, result.sourceHunks));
		assert.strictEqual(applied, '(simulated changed line)\n');
	});

	test('reports no deletions, so nothing is verified against the base', async () => {
		const result = await runSimulator(['src/one.ts']);
		const [hunk] = result.sourceHunks;

		assert.strictEqual(hunk.deletions, 0);
		assert.strictEqual(hunk.additions, 1);
		assert.ok(!hunk.content.split('\n').some(l => l.startsWith('-')), 'expected no deleted lines');
	});
});
