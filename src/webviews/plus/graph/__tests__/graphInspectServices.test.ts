import * as assert from 'assert';
import * as sinon from 'sinon';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import type { Container } from '../../../../container.js';
import { GraphInspectServices } from '../graphInspectServices.js';
import type { GraphInspectService, ScopeSelection } from '../graphService.js';

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
	disposeError?: Error;
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
		if (opts.disposeError != null) throw opts.disposeError;
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

	test('a failing scratch-index teardown neither sinks the review nor masks a cancellation', async () => {
		const m = createMocks({
			untracked: ['new.txt'],
			unstagedDiff: 'diff --git a/new.txt b/new.txt\n',
			disposeError: new Error('EBUSY: temp dir locked'),
		});

		// Teardown runs in a `finally`, where a rejection would replace whatever the body was throwing.
		const result = await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));
		assert.ok(result?.diff.includes('new.txt'), 'the completed review must survive a cleanup failure');

		// Same teardown on the cancelled path: the abort must still be what surfaces.
		const ac = new AbortController();
		const c = createMocks({
			untracked: ['new.txt'],
			unstagedDiff: 'x',
			abortOnStage: ac,
			disposeError: new Error('EBUSY: temp dir locked'),
		});
		await assert.rejects(
			invoke(c.fakeThis, wipScope({ includeUnstaged: true }), ac.signal),
			(ex: Error) => !/EBUSY/.test(ex.message),
			'the cancellation must surface, not the cleanup error',
		);
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

// Fix under test (#5603): git reports an untracked directory that is itself a repository with a
// trailing slash (`nested-repo/`), which is what the Files Changed rows — and so the exclusion set —
// carry, but the intent-to-add staging above lands it in the diff as a gitlink named without one
// (`nested-repo`). Exclusion has to match across that difference. These drive the real RPC handlers
// (and the real diff parser) so the assertions are on the payload that would actually reach the AI.

/** An unstaged diff shaped like the one the bug reproduces against: an ordinary modification, a
 *  plain untracked file, and the gitlink entry an untracked embedded repository stages down to. */
const diffWithNestedRepoGitlink = [
	'diff --git a/changed.txt b/changed.txt',
	'index 1111111..2222222 100644',
	'--- a/changed.txt',
	'+++ b/changed.txt',
	'@@ -1 +1 @@',
	'-before',
	'+after',
	'diff --git a/new.txt b/new.txt',
	'new file mode 100644',
	'index 0000000..4444444',
	'--- /dev/null',
	'+++ b/new.txt',
	'@@ -0,0 +1 @@',
	'+brand new',
	'diff --git a/nested-repo b/nested-repo',
	'new file mode 160000',
	'index 0000000..3333333',
	'--- /dev/null',
	'+++ b/nested-repo',
	'@@ -0,0 +1 @@',
	'+Subproject commit 3333333333333333333333333333333333333333',
	'',
].join('\n');

type CreateServices = () => { graphInspect: GraphInspectService };

function createReviewFake() {
	const getDiff = sinon.stub();
	getDiff.withArgs(uncommitted).resolves({ contents: diffWithNestedRepoGitlink });
	getDiff.withArgs(uncommittedStaged).resolves(undefined);

	// Mirrors the scratch-index staging the review performs (#5604/#5605) so these tests run the same
	// path production does; without `createTemporaryIndex` the staging step fails and is skipped, which
	// would still let the assertions below pass while quietly testing nothing.
	const tempIndex = { path: '/tmp/gl-x/index', env: { GIT_INDEX_FILE: '/tmp/gl-x/index' }, dispose: async () => {} };

	const svc = {
		diff: { getDiff: getDiff },
		// The paths the curation list carries — the embedded repo keeps its trailing slash.
		status: { getUntrackedFiles: async () => [{ path: 'new.txt' }, { path: 'nested-repo/' }] },
		staging: {
			createTemporaryIndex: async () => tempIndex,
			stageFiles: async () => {},
			unstageFiles: async () => {},
		},
		branches: { getBranch: async () => undefined },
	};

	const reviewChanges = sinon.stub().returns({ promise: Promise.resolve({ result: { mode: 'single-pass' } }) });
	const reviewFocusArea = sinon.stub().returns({ promise: Promise.resolve({ result: {} }) });

	const container = {
		git: { getRepositoryService: () => svc },
		ai: {
			// No model → the conservative single-pass threshold, which this small diff clears, so the
			// assertions can read the diff straight off the single-pass request.
			getModel: async () => undefined,
			actions: { reviewChanges: reviewChanges, reviewFocusArea: reviewFocusArea },
		},
	} as unknown as Container;

	// Prototype-backed fake so the private helpers the handlers lean on (`getReviewTypeForScope`,
	// `getDiffCacheKey`, `getDiffForScope`) run for real; only instance state is supplied. `container`
	// is a getter over the injected context, so it's fed through `context`.
	// `buildChangesContext` is shadowed to keep the AI-context gather out of the test.
	const noopEvent = { subscribe: () => () => {} };
	const fakeThis = Object.assign(Object.create(GraphInspectServices.prototype) as object, {
		context: { container: container },
		buildChangesContext: async () => '',
		_aiCancellations: new Set(),
		_graphDetailsDiffCache: new LruMap(4),
		_reviewHistoryCache: new LruMap(4),
		_composeProgressEvent: noopEvent,
		_resolveProgressEvent: noopEvent,
	});

	const { graphInspect } = (GraphInspectServices.prototype.createServices as unknown as CreateServices).call(
		fakeThis,
	);

	return { graphInspect: graphInspect, reviewChanges: reviewChanges, reviewFocusArea: reviewFocusArea };
}

function reviewedDiff(stub: sinon.SinonStub): string {
	assert.ok(stub.called, 'the AI review action should have been invoked');
	return (stub.firstCall.args[0] as { diff: string }).diff;
}

suite('graphInspectServices — review exclusions across path shapes (#5603)', () => {
	test('excluding an untracked nested repository drops its gitlink entry from the reviewed diff', async () => {
		const m = createReviewFake();

		const result = await m.graphInspect.reviewChanges('/repo', wipScope({ includeUnstaged: true }), undefined, [
			'nested-repo/',
		]);

		assert.ok(!('error' in result), `review should not have errored: ${JSON.stringify(result)}`);

		const diff = reviewedDiff(m.reviewChanges);
		assert.ok(!diff.includes('nested-repo'), 'the excluded nested repository must not reach the AI');
		assert.ok(diff.includes('changed.txt'), 'the still-included change must survive the filter');
		assert.ok(diff.includes('new.txt'), 'the still-included untracked file must survive the filter');
	});

	test('excluding a plain untracked file still works', async () => {
		const m = createReviewFake();

		await m.graphInspect.reviewChanges('/repo', wipScope({ includeUnstaged: true }), undefined, ['new.txt']);

		const diff = reviewedDiff(m.reviewChanges);
		assert.ok(!diff.includes('new.txt'), 'the excluded untracked file must not reach the AI');
		assert.ok(diff.includes('nested-repo'), 'an unexcluded nested repository is left alone');
	});

	test('leaves the nested repository in the diff when it is not excluded', async () => {
		const m = createReviewFake();

		await m.graphInspect.reviewChanges('/repo', wipScope({ includeUnstaged: true }), undefined, undefined);

		const diff = reviewedDiff(m.reviewChanges);
		assert.ok(diff.includes('nested-repo'), 'normalizing must not drop an entry the user left checked');
		assert.ok(diff.includes('changed.txt'));
	});

	test('excluding an untracked nested repository also holds on the two-pass focus-area request', async () => {
		const m = createReviewFake();

		// The focus-area file list comes back from the AI naming diff paths, so it has no trailing
		// slash — the exclusion set does. Both sides have to normalize for the row to be dropped.
		const result = await m.graphInspect.reviewFocusArea(
			'/repo',
			wipScope({ includeUnstaged: true }),
			'focus-1',
			['changed.txt', 'nested-repo'],
			'overview',
			undefined,
			['nested-repo/'],
		);

		assert.ok(!('error' in result), `focus-area review should not have errored: ${JSON.stringify(result)}`);

		const diff = reviewedDiff(m.reviewFocusArea);
		assert.ok(!diff.includes('nested-repo'), 'the excluded nested repository must not reach the AI');
		assert.ok(diff.includes('changed.txt'), 'the focus area still covers its included file');
	});
});
