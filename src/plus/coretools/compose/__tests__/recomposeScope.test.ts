import * as assert from 'assert';
import type { Container } from '../../../../container.js';
import type { GitRepositoryService } from '../../../../git/gitRepositoryService.js';
import { resolveRecomposeScope } from '../recomposeScope.js';

// A fake GitRepositoryService for the wrapper's svc-only paths (range / commitShas / rejections).
// The branch-only merge-target path calls module-imported helpers and is left to live coverage.
function makeSvc(opts: {
	branch?: { name: string; detached?: boolean; remote?: boolean } | null;
	head?: string;
	commits?: Record<string, string[]>;
	log?: Record<string, string[]>;
}): GitRepositoryService {
	const commits = opts.commits ?? {};
	return {
		branches: { getBranch: async () => opts.branch ?? undefined },
		commits: {
			getCommit: async (ref: string) => {
				const sha = ref === 'HEAD' ? opts.head : ref;
				if (sha == null || !(sha in commits)) return undefined;
				return { sha: sha, parents: commits[sha] };
			},
			getLog: async (rangeStr: string) => {
				const shas = opts.log?.[rangeStr];
				if (shas == null) return undefined;
				// Real log entries are GitCommits — the resolver reads `sha` and `parents` off them.
				return { commits: new Map(shas.map(s => [s, { sha: s, parents: commits[s] ?? [] }])) };
			},
		},
		getRepository: () => undefined,
	} as unknown as GitRepositoryService;
}

// Linear first-parent chain h→a→b→c (c is root); 'side' is off the first-parent line.
const linear: Record<string, string[]> = { h: ['a'], a: ['b'], b: ['c'], c: [], side: ['b'] };
const container = {} as unknown as Container;

suite('compose/recomposeScope resolveRecomposeScope', () => {
	test('detached branch → detached', async () => {
		const svc = makeSvc({ branch: { name: 'main', detached: true }, head: 'h', commits: linear });
		const result = await resolveRecomposeScope(container, svc, { range: { base: 'c', head: 'h' } });
		assert.strictEqual(result.ok, false);
		assert.strictEqual((result as { reason: string }).reason, 'detached');
	});

	test('remote branch → detached', async () => {
		const svc = makeSvc({ branch: { name: 'main', remote: true }, head: 'h', commits: linear });
		const result = await resolveRecomposeScope(container, svc, { range: { base: 'c', head: 'h' } });
		assert.strictEqual((result as { reason: string }).reason, 'detached');
	});

	test('no checked-out branch → detached', async () => {
		const svc = makeSvc({ branch: null, head: 'h', commits: linear });
		const result = await resolveRecomposeScope(container, svc, { range: { base: 'c', head: 'h' } });
		assert.strictEqual((result as { reason: string }).reason, 'detached');
	});

	test('HEAD unresolvable → not-found', async () => {
		const svc = makeSvc({ branch: { name: 'main' }, head: 'missing', commits: linear });
		const result = await resolveRecomposeScope(container, svc, { range: { base: 'c', head: 'h' } });
		assert.strictEqual((result as { reason: string }).reason, 'not-found');
	});

	test('branchName mismatch with checked-out branch → not-checked-out', async () => {
		const svc = makeSvc({ branch: { name: 'main' }, head: 'h', commits: linear });
		const result = await resolveRecomposeScope(container, svc, {
			branchName: 'feature',
			range: { base: 'c', head: 'h' },
		});
		assert.strictEqual((result as { reason: string }).reason, 'not-checked-out');
	});

	test('range not ending at HEAD → not-checked-out', async () => {
		const svc = makeSvc({ branch: { name: 'main' }, head: 'h', commits: linear });
		const result = await resolveRecomposeScope(container, svc, { range: { base: 'c', head: 'a' } });
		assert.strictEqual((result as { reason: string }).reason, 'not-checked-out');
	});

	test('valid range → ok, covering prefix from HEAD, expandedFromSelection:false, includeWip passthrough', async () => {
		const svc = makeSvc({ branch: { name: 'main' }, head: 'h', commits: linear, log: { 'c..h': ['h', 'a', 'b'] } });
		const result = await resolveRecomposeScope(container, svc, {
			range: { base: 'c', head: 'h' },
			includeWip: true,
		});
		assert.deepStrictEqual(result, {
			ok: true,
			branchName: 'main',
			headSha: 'h',
			tipSha: 'h',
			shas: ['h', 'a', 'b'],
			includeWip: true,
			expandedFromSelection: false,
		});
	});

	test('commitShas interior sub-selection → ok, range ends at the selection tip, not widened to HEAD', async () => {
		// 'a' is the selection's single tip (no selected commit has it as a parent), so the covering
		// resolver logs from the base candidate's parent ('b' is the only base — 'a' has an
		// in-selection parent) through 'a', leaving the tip commit 'h' out of the rewrite.
		const svc = makeSvc({ branch: { name: 'main' }, head: 'h', commits: linear, log: { 'c..a': ['a', 'b'] } });
		const result = await resolveRecomposeScope(container, svc, { commitShas: ['a', 'b'] });
		assert.deepStrictEqual(result, {
			ok: true,
			branchName: 'main',
			headSha: 'h',
			tipSha: 'a',
			shas: ['a', 'b'],
			includeWip: false,
			expandedFromSelection: false,
		});
	});

	test('commitShas with an unknown sha → not-found', async () => {
		const svc = makeSvc({ branch: { name: 'main' }, head: 'h', commits: linear });
		const result = await resolveRecomposeScope(container, svc, { commitShas: ['a', 'zzz'] });
		assert.strictEqual((result as { reason: string }).reason, 'not-found');
	});

	test('commitShas off the first-parent line (merge side-branch) → not-contiguous', async () => {
		const svc = makeSvc({ branch: { name: 'main' }, head: 'h', commits: linear });
		const result = await resolveRecomposeScope(container, svc, { commitShas: ['side'] });
		assert.strictEqual((result as { reason: string }).reason, 'not-contiguous');
	});
});
