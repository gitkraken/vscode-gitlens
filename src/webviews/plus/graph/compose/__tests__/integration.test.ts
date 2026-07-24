import * as assert from 'assert';
import type { Container } from '../../../../../container.js';
import type { CachedPlan } from '../../../../../plus/coretools/compose/integration.js';
import type { ComposeHunk, ComposePlan } from '../../../../../plus/coretools/compose/types.js';
import { GraphComposeIntegration } from '../integration.js';

type TestCommit = ComposePlan['allOrderedCommits'][number];

function makeCommit(id: string): TestCommit {
	return { id: id, message: `msg-${id}`, explanation: '', hunkIndices: [] };
}

function makeHunk(index: number, fileName: string, originalFileName?: string): ComposeHunk {
	return {
		index: index,
		fileName: fileName,
		originalFileName: originalFileName,
		diffHeader: '',
		hunkHeader: '',
		content: '',
		additions: 0,
		deletions: 0,
	};
}

/** Build a plan whose branches share commit-object references the way the library does:
 *  `grouping.branches[i]` IS `branches[i].branchGroup`, and every branch's `commits` array holds the
 *  same objects as `allOrderedCommits`. */
function makePlan(branches: { id: string; commitIds: string[] }[]): {
	plan: ComposePlan;
	byId: Map<string, TestCommit>;
} {
	const allCommits: TestCommit[] = [];
	const byId = new Map<string, TestCommit>();
	const branchPlans = branches.map(b => {
		const commits = b.commitIds.map(id => {
			const commit = makeCommit(id);
			allCommits.push(commit);
			byId.set(id, commit);
			return commit;
		});
		const branchGroup = { id: b.id, name: b.id, title: b.id, description: '', commits: [...commits] };
		return { branchGroup: branchGroup, orderedCommitIds: b.commitIds.slice() };
	});

	const plan: ComposePlan = {
		grouping: { branches: branchPlans.map(bp => bp.branchGroup) },
		ordering: {
			branches: branchPlans.map(bp => ({
				branchId: bp.branchGroup.id,
				orderedCommitIds: bp.orderedCommitIds.slice(),
			})),
			rationale: '',
		},
		branches: branchPlans,
		allOrderedCommits: allCommits,
	};

	return { plan: plan, byId: byId };
}

function seed(sut: GraphComposeIntegration, cacheKey: string, plan: ComposePlan): void {
	(sut as unknown as { _cache: Map<string, CachedPlan> })._cache.set(cacheKey, { plan: plan } as CachedPlan);
}

/** Single-branch plan whose commits carry explicit `hunkIndices`, plus the source-hunk pool a file
 *  move matches against. */
function makePlanWithHunks(
	commits: { id: string; hunkIndices: number[] }[],
	sourceHunks: ComposeHunk[],
): { plan: ComposePlan; sourceHunks: ComposeHunk[] } {
	const { plan } = makePlan([{ id: 'branch', commitIds: commits.map(c => c.id) }]);
	for (const c of commits) {
		// Shared references (makePlan) mean this also updates the branchGroup.commits entry.
		plan.allOrderedCommits.find(x => x.id === c.id)!.hunkIndices = c.hunkIndices.slice();
	}
	return { plan: plan, sourceHunks: sourceHunks };
}

function seedFull(sut: GraphComposeIntegration, cacheKey: string, plan: ComposePlan, sourceHunks: ComposeHunk[]): void {
	(sut as unknown as { _cache: Map<string, CachedPlan> })._cache.set(cacheKey, {
		plan: plan,
		sourceHunks: sourceHunks,
	} as CachedPlan);
}

const sortedIndices = (hunkIndices: readonly number[]) => [...hunkIndices].sort((a, b) => a - b);

const ids = (commits: readonly TestCommit[]) => commits.map(c => c.id);

suite('graph/compose/integration reorderCachedPlan', () => {
	const cacheKey = 'test-key';

	test('reorders allOrderedCommits and the single branch id lists', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const { plan } = makePlan([{ id: 'b', commitIds: ['c1', 'c2', 'c3'] }]);
		seed(sut, cacheKey, plan);

		const ok = sut.reorderCachedPlan(cacheKey, ['c3', 'c1', 'c2']);

		assert.strictEqual(ok, true);
		assert.deepStrictEqual(ids(plan.allOrderedCommits), ['c3', 'c1', 'c2']);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['c3', 'c1', 'c2']);
		assert.deepStrictEqual(plan.ordering.branches[0].orderedCommitIds, ['c3', 'c1', 'c2']);
		assert.deepStrictEqual(ids(plan.branches[0].branchGroup.commits), ['c3', 'c1', 'c2']);
		// grouping.branches[0] shares the branchGroup reference, so it reorders with it.
		assert.deepStrictEqual(ids(plan.grouping.branches[0].commits), ['c3', 'c1', 'c2']);
	});

	test('reuses the existing commit objects (never clones)', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const { plan, byId } = makePlan([{ id: 'b', commitIds: ['c1', 'c2', 'c3'] }]);
		seed(sut, cacheKey, plan);

		sut.reorderCachedPlan(cacheKey, ['c2', 'c3', 'c1']);

		assert.strictEqual(plan.allOrderedCommits[0], byId.get('c2'));
		assert.strictEqual(plan.allOrderedCommits[1], byId.get('c3'));
		assert.strictEqual(plan.allOrderedCommits[2], byId.get('c1'));
	});

	test('preserves branch membership while reordering within the global order', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const { plan } = makePlan([
			{ id: 'a', commitIds: ['a1', 'a2'] },
			{ id: 'b', commitIds: ['b1', 'b2'] },
		]);
		seed(sut, cacheKey, plan);

		const ok = sut.reorderCachedPlan(cacheKey, ['a2', 'a1', 'b2', 'b1']);

		assert.strictEqual(ok, true);
		assert.deepStrictEqual(ids(plan.allOrderedCommits), ['a2', 'a1', 'b2', 'b1']);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['a2', 'a1']);
		assert.deepStrictEqual(plan.branches[1].orderedCommitIds, ['b2', 'b1']);
		assert.deepStrictEqual(plan.ordering.branches[0].orderedCommitIds, ['a2', 'a1']);
		assert.deepStrictEqual(plan.ordering.branches[1].orderedCommitIds, ['b2', 'b1']);
	});

	test('rejects a non-permutation and leaves the plan untouched', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const { plan } = makePlan([{ id: 'b', commitIds: ['c1', 'c2', 'c3'] }]);
		seed(sut, cacheKey, plan);

		// Wrong id, missing id, duplicate, and wrong length all reject.
		assert.strictEqual(sut.reorderCachedPlan(cacheKey, ['c1', 'c2', 'nope']), false);
		assert.strictEqual(sut.reorderCachedPlan(cacheKey, ['c1', 'c2']), false);
		assert.strictEqual(sut.reorderCachedPlan(cacheKey, ['c1', 'c2', 'c2']), false);

		assert.deepStrictEqual(ids(plan.allOrderedCommits), ['c1', 'c2', 'c3']);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['c1', 'c2', 'c3']);
	});

	test('returns false on a cache miss', () => {
		const sut = new GraphComposeIntegration({} as Container);
		assert.strictEqual(sut.reorderCachedPlan('unknown-key', ['c1']), false);
	});
});

suite('graph/compose/integration moveFilesBetweenCommits', () => {
	const cacheKey = 'test-key';

	test("moves a file's hunks between commits, leaving both in place", () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'a.ts'), makeHunk(2, 'b.ts'), makeHunk(3, 'c.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1, 2] },
				{ id: 'c2', hunkIndices: [3] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['a.ts']);

		assert.strictEqual(ok, true);
		const c1 = plan.allOrderedCommits.find(c => c.id === 'c1')!;
		const c2 = plan.allOrderedCommits.find(c => c.id === 'c2')!;
		assert.deepStrictEqual(c1.hunkIndices, [2]);
		assert.deepStrictEqual(sortedIndices(c2.hunkIndices), [0, 1, 3]);
		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c1', 'c2'],
		);
	});

	test('moves every hunk of multiple files in a single mutation', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'b.ts'), makeHunk(2, 'b.ts'), makeHunk(3, 'c.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1, 2, 3] },
				{ id: 'c2', hunkIndices: [] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['a.ts', 'b.ts']);

		assert.strictEqual(ok, true);
		const c1 = plan.allOrderedCommits.find(c => c.id === 'c1')!;
		const c2 = plan.allOrderedCommits.find(c => c.id === 'c2')!;
		assert.deepStrictEqual(c1.hunkIndices, [3]);
		assert.deepStrictEqual(sortedIndices(c2.hunkIndices), [0, 1, 2]);
		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c1', 'c2'],
		);
	});

	test('prunes the source once after moving every file out of it', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'b.ts'), makeHunk(2, 'z.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1] },
				{ id: 'c2', hunkIndices: [2] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['a.ts', 'b.ts']);

		assert.strictEqual(ok, true);
		// c1 emptied by the batch → pruned; c2 holds all three files' hunks.
		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c2'],
		);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['c2']);
		assert.deepStrictEqual(sortedIndices(plan.allOrderedCommits[0].hunkIndices), [0, 1, 2]);
	});

	test('prunes the source commit when its last file is moved out', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'c.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0] },
				{ id: 'c2', hunkIndices: [1] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c2', 'c1', ['c.ts']);

		assert.strictEqual(ok, true);
		// c2 emptied → pruned from allOrderedCommits and every shared branch read site.
		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c1'],
		);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['c1']);
		assert.deepStrictEqual(
			plan.branches[0].branchGroup.commits.map(c => c.id),
			['c1'],
		);
		assert.deepStrictEqual(plan.ordering.branches[0].orderedCommitIds, ['c1']);
		assert.deepStrictEqual(sortedIndices(plan.allOrderedCommits[0].hunkIndices), [0, 1]);
	});

	test('matches renamed files on originalFileName', () => {
		const sut = new GraphComposeIntegration({} as Container);
		// old.ts → new.ts rename: the hunk carries the current name plus the original.
		const sourceHunks = [makeHunk(0, 'new.ts', 'old.ts'), makeHunk(1, 'b.ts'), makeHunk(2, 'd.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1] },
				{ id: 'c2', hunkIndices: [2] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['old.ts']);

		assert.strictEqual(ok, true);
		assert.deepStrictEqual(plan.allOrderedCommits.find(c => c.id === 'c1')!.hunkIndices, [1]);
		assert.deepStrictEqual(sortedIndices(plan.allOrderedCommits.find(c => c.id === 'c2')!.hunkIndices), [0, 2]);
	});

	test('rejects invalid moves and leaves the plan untouched', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'b.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0] },
				{ id: 'c2', hunkIndices: [1] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		assert.strictEqual(sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c1', ['a.ts']), false); // same commit
		assert.strictEqual(sut.moveFilesBetweenCommits(cacheKey, 'c1', 'nope', ['a.ts']), false); // unknown target
		assert.strictEqual(sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['zzz.ts']), false); // file not in source
		assert.strictEqual(sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', []), false); // no files
		assert.strictEqual(sut.moveFilesBetweenCommits('bad-key', 'c1', 'c2', ['a.ts']), false); // cache miss

		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c1', 'c2'],
		);
		assert.deepStrictEqual(plan.allOrderedCommits.find(c => c.id === 'c1')!.hunkIndices, [0]);
	});
});
