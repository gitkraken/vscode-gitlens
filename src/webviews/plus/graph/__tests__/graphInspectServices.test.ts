import * as assert from 'assert';
import * as sinon from 'sinon';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { Container } from '../../../../container.js';
import { GraphInspectServices } from '../graphInspectServices.js';
import type { ScopeSelection } from '../graphService.js';

// `getDiffForScope` is private and only reaches `this.container.git.getRepositoryService(repoPath)` and
// `this.buildChangesContext(...)`, so we exercise it against a minimal fake `this` rather than constructing
// the full service. Fix under test (#5586): a WIP review must include untracked file contents by staging
// them intent-to-add around the unstaged diff — and that the staging must land in a scratch index, never the
// repository index, so a concurrent user `git add` can't be silently undone (#5604) and the review emits no
// index change that would mark its own result stale (#5605).

type DiffForScopeResult = { diff: string; message: string; context: string } | undefined;
type GetDiffForScope = (repoPath: string, scope: ScopeSelection, signal?: AbortSignal) => Promise<DiffForScopeResult>;

function invoke(fakeThis: unknown, scope: ScopeSelection, signal?: AbortSignal): Promise<DiffForScopeResult> {
	const fn = (GraphInspectServices.prototype as unknown as { getDiffForScope: GetDiffForScope }).getDiffForScope;
	return fn.call(fakeThis, '/repo', scope, signal);
}

function wipScope(o: { includeUnstaged?: boolean; includeStaged?: boolean }): ScopeSelection {
	return {
		type: 'wip',
		includeUnstaged: o.includeUnstaged ?? false,
		includeStaged: o.includeStaged ?? false,
		includeShas: [],
	};
}

function createMocks(opts: {
	untracked?: string[];
	untrackedError?: Error;
	unstagedDiff?: string;
	unstagedError?: Error;
	stagedDiff?: string;
	noStaging?: boolean;
	indexError?: Error;
	stageError?: Error;
	abortOnStage?: AbortController;
}) {
	// Shared, ordered log so tests can assert the exact snapshot → stage → diff → dispose sequence.
	const order: string[] = [];

	const getUntrackedFiles = sinon.stub().callsFake(async () => {
		order.push('getUntracked');
		if (opts.untrackedError != null) throw opts.untrackedError;
		return (opts.untracked ?? []).map(p => ({ path: p }));
	});
	const dispose = sinon.stub().callsFake(async () => {
		order.push('dispose');
	});
	const tempIndex = { path: '/tmp/gl-x/index', env: { GIT_INDEX_FILE: '/tmp/gl-x/index' }, dispose: dispose };
	const createTemporaryIndex = sinon.stub().callsFake(async () => {
		order.push('createIndex');
		if (opts.indexError != null) throw opts.indexError;
		return tempIndex;
	});
	const stageFiles = sinon.stub().callsFake(async () => {
		order.push('stage');
		if (opts.stageError != null) throw opts.stageError;

		opts.abortOnStage?.abort();
	});
	// Retained only so tests can assert it is NEVER called — the repository index must stay untouched.
	const unstageFiles = sinon.stub().callsFake(async () => {
		order.push('unstage');
	});

	const getDiff = sinon.stub();
	getDiff.withArgs(uncommitted).callsFake(async () => {
		order.push('diff:unstaged');
		if (opts.unstagedError != null) throw opts.unstagedError;
		return opts.unstagedDiff != null ? { contents: opts.unstagedDiff } : undefined;
	});
	getDiff.withArgs(uncommittedStaged).callsFake(async () => {
		order.push('diff:staged');
		return opts.stagedDiff != null ? { contents: opts.stagedDiff } : undefined;
	});

	const svc = {
		diff: { getDiff: getDiff },
		status: { getUntrackedFiles: getUntrackedFiles },
		// `staging` is optional on the repo service (e.g. virtual repos lack it).
		staging: opts.noStaging
			? undefined
			: {
					createTemporaryIndex: createTemporaryIndex,
					stageFiles: stageFiles,
					unstageFiles: unstageFiles,
				},
		branches: { getBranch: sinon.stub().resolves(undefined) },
	};

	const container = {
		git: { getRepositoryService: sinon.stub().returns(svc) },
	} as unknown as Container;

	const fakeThis = { container: container, buildChangesContext: async () => '' };

	return {
		fakeThis: fakeThis,
		order: order,
		tempIndex: tempIndex,
		getUntrackedFiles: getUntrackedFiles,
		createTemporaryIndex: createTemporaryIndex,
		stageFiles: stageFiles,
		unstageFiles: unstageFiles,
		dispose: dispose,
		getDiff: getDiff,
	};
}

suite('graphInspectServices — getDiffForScope untracked handling (#5586, #5604, #5605)', () => {
	test('stages untracked files intent-to-add into a scratch index and diffs against it', async () => {
		const m = createMocks({
			untracked: ['new.txt'],
			unstagedDiff:
				'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+brand new\n',
		});

		const result = await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		sinon.assert.calledOnceWithExactly(m.createTemporaryIndex, 'current');
		sinon.assert.calledOnceWithExactly(m.stageFiles, ['new.txt'], { index: m.tempIndex, intentToAdd: true });
		sinon.assert.calledWithExactly(m.getDiff, uncommitted, undefined, { index: m.tempIndex });
		// The repository index is never mutated, so there is nothing to unstage.
		sinon.assert.notCalled(m.unstageFiles);
		sinon.assert.calledOnce(m.dispose);
		assert.deepStrictEqual(m.order, ['getUntracked', 'createIndex', 'stage', 'diff:unstaged', 'dispose']);
		assert.ok(result?.diff.includes('new.txt'), 'reviewed diff should include the untracked file');
	});

	test('disposes the scratch index even when the unstaged diff throws', async () => {
		const m = createMocks({ untracked: ['new.txt'], unstagedError: new Error('diff failed') });

		await assert.rejects(invoke(m.fakeThis, wipScope({ includeUnstaged: true })), /diff failed/);

		sinon.assert.calledOnceWithExactly(m.stageFiles, ['new.txt'], { index: m.tempIndex, intentToAdd: true });
		sinon.assert.notCalled(m.unstageFiles);
		sinon.assert.calledOnce(m.dispose);
		assert.deepStrictEqual(m.order, ['getUntracked', 'createIndex', 'stage', 'diff:unstaged', 'dispose']);
	});

	test('never mutates the repository index, so the staged diff is unaffected', async () => {
		const m = createMocks({
			untracked: ['new.txt'],
			unstagedDiff: 'diff --git a/new.txt b/new.txt\n',
			stagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n',
		});

		await invoke(m.fakeThis, wipScope({ includeUnstaged: true, includeStaged: true }));

		sinon.assert.notCalled(m.unstageFiles);
		// The staged diff reads the real index, which the scratch-index staging never touched — no `index`
		// option, and no ordering constraint needed to keep intent-to-add entries out of it.
		sinon.assert.calledWithExactly(m.getDiff, uncommittedStaged);
		assert.deepStrictEqual(m.order, [
			'getUntracked',
			'createIndex',
			'stage',
			'diff:unstaged',
			'dispose',
			'diff:staged',
		]);
	});

	test('does not create a scratch index when there are no untracked files', async () => {
		const m = createMocks({ untracked: [], unstagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n' });

		await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		sinon.assert.notCalled(m.createTemporaryIndex);
		sinon.assert.notCalled(m.stageFiles);
		sinon.assert.calledWithExactly(m.getDiff, uncommitted, undefined, undefined);
		assert.deepStrictEqual(m.order, ['getUntracked', 'diff:unstaged']);
	});

	test('does not touch untracked files for a staged-only scope', async () => {
		const m = createMocks({ untracked: ['new.txt'], stagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n' });

		await invoke(m.fakeThis, wipScope({ includeStaged: true }));

		sinon.assert.notCalled(m.getUntrackedFiles);
		sinon.assert.notCalled(m.createTemporaryIndex);
		sinon.assert.notCalled(m.stageFiles);
		assert.deepStrictEqual(m.order, ['diff:staged']);
	});

	test('skips the untracked query entirely when there is no staging provider', async () => {
		const m = createMocks({
			noStaging: true,
			untracked: ['new.txt'],
			unstagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n',
		});

		const result = await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		sinon.assert.notCalled(m.getUntrackedFiles);
		sinon.assert.notCalled(m.createTemporaryIndex);
		sinon.assert.notCalled(m.stageFiles);
		assert.deepStrictEqual(m.order, ['diff:unstaged']);
		assert.ok(result?.diff.includes('tracked.txt'), 'the unstaged diff is still produced');
	});

	test('degrades to the plain unstaged diff when untracked enumeration fails', async () => {
		const m = createMocks({
			untrackedError: new Error('git status failed'),
			unstagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n',
		});

		const result = await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		sinon.assert.notCalled(m.createTemporaryIndex);
		sinon.assert.notCalled(m.stageFiles);
		assert.deepStrictEqual(m.order, ['getUntracked', 'diff:unstaged']);
		assert.ok(result?.diff.includes('tracked.txt'), 'the review still covers the tracked change');
	});

	test('degrades to the plain unstaged diff when the scratch index cannot be created', async () => {
		const m = createMocks({
			untracked: ['new.txt'],
			indexError: new Error('cannot copy index'),
			unstagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n',
		});

		const result = await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		// No scratch index means nothing was staged anywhere — the review loses untracked content rather
		// than falling back to mutating the real index.
		sinon.assert.notCalled(m.stageFiles);
		sinon.assert.notCalled(m.unstageFiles);
		sinon.assert.calledWithExactly(m.getDiff, uncommitted, undefined, undefined);
		assert.deepStrictEqual(m.order, ['getUntracked', 'createIndex', 'diff:unstaged']);
		assert.ok(result?.diff.includes('tracked.txt'), 'the review still covers the tracked change');
	});

	test('discards a partially staged scratch index rather than reviewing an arbitrary subset', async () => {
		const m = createMocks({
			untracked: ['new.txt'],
			stageError: new Error('add -N failed'),
			unstagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n',
		});

		const result = await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		// `stageFiles` batches, so the scratch index could hold any subset — degrade to the plain unstaged
		// diff instead of reviewing a silently partial set of untracked files.
		sinon.assert.calledWithExactly(m.getDiff, uncommitted, undefined, undefined);
		// Disposed eagerly on the failure, and not a second time from the `finally`.
		sinon.assert.calledOnce(m.dispose);
		assert.deepStrictEqual(m.order, ['getUntracked', 'createIndex', 'stage', 'dispose', 'diff:unstaged']);
		assert.ok(result?.diff.includes('tracked.txt'), 'the review still covers the tracked change');
	});

	test('honors cancellation after staging without running the unstaged diff', async () => {
		const ac = new AbortController();
		const m = createMocks({ untracked: ['new.txt'], unstagedDiff: 'x', abortOnStage: ac });

		await assert.rejects(invoke(m.fakeThis, wipScope({ includeUnstaged: true }), ac.signal));

		// Staging into the scratch index ran and the scratch index was disposed, but the abort was honored
		// before the diff was requested.
		assert.deepStrictEqual(m.order, ['getUntracked', 'createIndex', 'stage', 'dispose']);
	});
});
