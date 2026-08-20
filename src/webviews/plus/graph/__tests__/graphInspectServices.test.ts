import * as assert from 'assert';
import * as sinon from 'sinon';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import type { Container } from '../../../../container.js';
import type { ConflictProgressEvent } from '../../../../plus/coretools/conflict/types.js';
import { GraphInspectServices } from '../graphInspectServices.js';
import type { ComposeSessionKey, GraphInspectService, ResolveProgressUpdate, ScopeSelection } from '../graphService.js';

// `getDiffForScope` is private and only reaches `this.container.git.getRepositoryService(repoPath)` and
// `this.buildChangesContext(...)`, so we exercise it against a minimal fake `this` rather than constructing
// the full service. Fix under test (#5586): a WIP review must include untracked file contents by staging
// them intent-to-add around the unstaged diff — and that the staging must land in a scratch index, never the
// repository index, so a concurrent user `git add` can't be silently undone (#5604) and the review emits no
// index change that would mark its own result stale (#5605).

type DiffForScopeResult = { diff: string; message: string; context: string } | undefined;
type GetDiffForScope = (
	repoPath: string,
	scope: ScopeSelection,
	excluded: Set<string> | undefined,
	signal?: AbortSignal,
) => Promise<DiffForScopeResult>;

/** Argument order mirrors `getDiffForScope` itself, so a call here reads the same as the real one. */
function invoke(
	fakeThis: unknown,
	scope: ScopeSelection,
	excluded?: Set<string>,
	signal?: AbortSignal,
): Promise<DiffForScopeResult> {
	const fn = (GraphInspectServices.prototype as unknown as { getDiffForScope: GetDiffForScope }).getDiffForScope;
	return fn.call(fakeThis, '/repo', scope, excluded, signal);
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

	// Fix under test (#5630): the exclusion set is consulted while collecting, so an excluded untracked
	// path is never staged and its contents are never read into the diff — instead of being staged,
	// diffed, and then dropped from the assembled text.
	test('does not stage an excluded untracked path', async () => {
		const m = createMocks({
			untracked: ['new.txt', 'nested-repo/'],
			unstagedDiff: 'diff --git a/new.txt b/new.txt\n',
		});

		// `nested-repo` without the trailing slash git reports — the shapes have to match normalized.
		await invoke(m.fakeThis, wipScope({ includeUnstaged: true }), new Set(['nested-repo']));

		sinon.assert.calledOnceWithExactly(m.stageFiles, ['new.txt'], { index: m.tempIndex, intentToAdd: true });
		// The unexcluded file still needs the scratch index, so the rest of the sequence is unchanged.
		sinon.assert.calledWithExactly(m.getDiff, uncommitted, undefined, { index: m.tempIndex });
		assert.deepStrictEqual(m.order, ['getUntracked', 'createIndex', 'stage', 'diff:unstaged', 'dispose']);
	});

	test('does not create a scratch index when every untracked path is excluded', async () => {
		const m = createMocks({
			untracked: ['new.txt', 'nested-repo/'],
			unstagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n',
		});

		// Already-normalized, as `getNormalizedExclusions` hands it over.
		await invoke(m.fakeThis, wipScope({ includeUnstaged: true }), new Set(['new.txt', 'nested-repo']));

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
			invoke(c.fakeThis, wipScope({ includeUnstaged: true }), undefined, ac.signal),
			(ex: Error) => !ex.message.includes('EBUSY'),
			'the cancellation must surface, not the cleanup error',
		);
	});

	test('honors cancellation after staging without running the unstaged diff', async () => {
		const ac = new AbortController();
		const m = createMocks({ untracked: ['new.txt'], unstagedDiff: 'x', abortOnStage: ac });

		await assert.rejects(invoke(m.fakeThis, wipScope({ includeUnstaged: true }), undefined, ac.signal));

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

function createReviewFake(diff: string = diffWithNestedRepoGitlink) {
	const getDiff = sinon.stub();
	getDiff.withArgs(uncommitted).resolves({ contents: diff });
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
	const reviewOverview = sinon
		.stub()
		.returns({ promise: Promise.resolve({ result: { mode: 'two-pass', focusAreas: [] } }) });

	const container = {
		git: { getRepositoryService: () => svc },
		ai: {
			// No model → the conservative single-pass (8000-token) threshold. `diffWithNestedRepoGitlink`
			// clears it, so the existing single-pass assertions can read the diff straight off that
			// request; the two-pass manifest tests below pass a diff sized to exceed it instead.
			getModel: async () => undefined,
			actions: { reviewChanges: reviewChanges, reviewFocusArea: reviewFocusArea, reviewOverview: reviewOverview },
		},
	} as unknown as Container;

	// Prototype-backed fake so the private helpers the handlers lean on (`getReviewTypeForScope`,
	// `getDiffCacheKey`, `getDiffForScope`) run for real; only instance state is supplied. `container`
	// is a getter over the injected context, so it's fed through `context`.
	// `buildChangesContext` is shadowed to keep the AI-context gather out of the test.
	const noopEvent = { subscribe: () => () => {} };
	const diffCache = new LruMap<string, { diff: string; message: string; context: string }>(4);
	const fakeThis = Object.assign(Object.create(GraphInspectServices.prototype) as object, {
		context: { container: container },
		buildChangesContext: async () => '',
		_aiCancellations: new Set(),
		_graphDetailsDiffCache: diffCache,
		_reviewHistoryCache: new LruMap(4),
		_composeProgressEvent: noopEvent,
		_resolveProgressEvent: noopEvent,
	});

	const { graphInspect } = (GraphInspectServices.prototype.createServices as unknown as CreateServices).call(
		fakeThis,
	);

	return {
		graphInspect: graphInspect,
		reviewChanges: reviewChanges,
		reviewFocusArea: reviewFocusArea,
		reviewOverview: reviewOverview,
		diffCache: diffCache,
	};
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

	// Fix under test (#5630): the diff-cache key is built from the same normalized set the filters
	// compare, so two spellings of one logical exclusion don't each take a slot in an LRU sized for
	// only a couple of `excludedFiles` variants — holding byte-identical filtered diffs.
	test('two spellings of the same exclusion share one diff-cache entry', async () => {
		const m = createReviewFake();
		const scope = wipScope({ includeUnstaged: true });

		await m.graphInspect.reviewChanges('/repo', scope, undefined, ['nested-repo/']);
		const [firstKey] = [...m.diffCache.keys()];

		await m.graphInspect.reviewChanges('/repo', scope, undefined, ['nested-repo']);

		assert.strictEqual(m.diffCache.size, 1, 'the un-normalized spelling should not add a second entry');
		assert.deepStrictEqual([...m.diffCache.keys()], [firstKey]);
	});

	test('a genuinely different exclusion set still gets its own diff-cache entry', async () => {
		const m = createReviewFake();
		const scope = wipScope({ includeUnstaged: true });

		await m.graphInspect.reviewChanges('/repo', scope, undefined, ['nested-repo/']);
		await m.graphInspect.reviewChanges('/repo', scope, undefined, ['new.txt']);

		assert.strictEqual(m.diffCache.size, 2);
	});
});

// Fix under test (#5658): pass 1 of a two-pass review sees nothing but the JSON file manifest built
// here, so every field on it has to be trustworthy — a hardcoded `status: 'M'` or hunk-header-inflated
// line counts fed pass 1 wrong data with nothing to catch it. This diff is padded well past
// `shouldUseSinglePass`'s ~22400-character (8000-token) fallback threshold so `reviewChanges` takes the
// two-pass branch and the manifest actually gets built.

/** One context line long enough that a handful of them, repeated, push the whole diff past the
 *  single-pass token threshold without needing hundreds of lines to do it. */
const paddingContextLines = Array.from({ length: 12 }, (_, i) => ` context padding line ${i} ${'x'.repeat(2000)}`);

/** A diff with one file of each shape the manifest has to get right: a plain modification (with
 *  padding context so the diff clears the two-pass threshold), a new file, a rename with content
 *  changes, and a binary file. */
const diffForTwoPassManifest = [
	'diff --git a/modified.txt b/modified.txt',
	'index 1111111..2222222 100644',
	'--- a/modified.txt',
	'+++ b/modified.txt',
	'@@ -1,15 +1,16 @@',
	...paddingContextLines,
	'-removed line one',
	'-removed line two',
	'+added line one',
	'+added line two',
	'+added line three',
	' trailing context line',
	'diff --git a/added.txt b/added.txt',
	'new file mode 100644',
	'index 0000000..3333333',
	'--- /dev/null',
	'+++ b/added.txt',
	'@@ -0,0 +1,4 @@',
	'+added file line one',
	'+added file line two',
	'+added file line three',
	'+added file line four',
	'diff --git a/renamed_old.txt b/renamed_new.txt',
	'similarity index 80%',
	'rename from renamed_old.txt',
	'rename to renamed_new.txt',
	'index 4444444..5555555 100644',
	'--- a/renamed_old.txt',
	'+++ b/renamed_new.txt',
	'@@ -1,3 +1,3 @@',
	' unchanged line',
	'-old content',
	'+new content',
	' trailing line',
	'diff --git a/binary.png b/binary.png',
	'index 6666666..7777777 100644',
	'Binary files a/binary.png and b/binary.png differ',
	'',
].join('\n');

interface ManifestFile {
	path: string;
	status: string;
	additions: number;
	deletions: number;
}

function reviewedManifest(stub: sinon.SinonStub): ManifestFile[] {
	assert.ok(stub.called, 'the pass-1 review-overview action should have been invoked');
	const files = (stub.firstCall.args[0] as { files: string }).files;
	return JSON.parse(files) as ManifestFile[];
}

suite('graphInspectServices — two-pass file manifest (#5658)', () => {
	test('reports real per-file status and changed-line counts — not a blanket "M" or inflated counts', async () => {
		const m = createReviewFake(diffForTwoPassManifest);

		const result = await m.graphInspect.reviewChanges(
			'/repo',
			wipScope({ includeUnstaged: true }),
			undefined,
			undefined,
		);

		assert.ok(!('error' in result), `review should not have errored: ${JSON.stringify(result)}`);
		// Confirms the diff was actually large enough to take the two-pass branch, rather than the
		// assertions below silently reading stale (unset) stub state.
		sinon.assert.notCalled(m.reviewChanges);
		sinon.assert.calledOnce(m.reviewOverview);

		const files = reviewedManifest(m.reviewOverview);
		const byPath = new Map(files.map(f => [f.path, f]));

		const modified = byPath.get('modified.txt');
		assert.ok(modified, 'modified.txt should be in the manifest');
		assert.strictEqual(modified.status, 'M');
		assert.strictEqual(modified.additions, 3, 'only the 3 real `+` lines, not the 16-line hunk header count');
		assert.strictEqual(modified.deletions, 2, 'only the 2 real `-` lines, not the padding context lines');

		const added = byPath.get('added.txt');
		assert.ok(added, 'added.txt should be in the manifest');
		assert.strictEqual(
			added.status,
			'A',
			'a new file must not read as a blanket "M" against a nonexistent prior version',
		);
		assert.strictEqual(added.additions, 4);
		assert.strictEqual(added.deletions, 0, 'the `-0,0` hunk header must not be read as a phantom deletion');

		const renamed = byPath.get('renamed_new.txt');
		assert.ok(renamed, 'renamed_new.txt should be in the manifest, keyed by its new path');
		assert.strictEqual(renamed.status, 'R');
		assert.strictEqual(renamed.additions, 1);
		assert.strictEqual(renamed.deletions, 1);

		const binary = byPath.get('binary.png');
		assert.ok(binary, 'binary.png should be in the manifest');
		assert.strictEqual(binary.status, 'M');
		assert.strictEqual(binary.additions, 0, 'a binary file has no line-based hunks to count');
		assert.strictEqual(binary.deletions, 0);
	});
});

// `subscribeToAutoRebaseProgress` only reaches `this.container.autoRebase` and `this.session`, so the same
// fake-`this` approach applies. The webview keeps a single auto-rebase run slot, but the service tracks a
// session per repo and they can run concurrently — so the feed has to drop other repos' events or one repo's
// run (or the `undefined` it clears with) blanks another's live progress.

type SubscribeToAutoRebaseProgress = (
	buffer: undefined,
	tracker: undefined,
) => (handler: (data: unknown) => void) => () => void;

function fakeSession(id: string) {
	return { id: id, phase: 'resolving', preRun: {}, steps: [] };
}

function createAutoRebaseFeed(graphRepoPath: string | undefined) {
	let emit: ((e: { repoPath: string; session?: unknown }) => void) | undefined;

	const fakeThis = {
		container: {
			autoRebase: {
				getSession: sinon.stub().returns(undefined),
				onDidChange: (listener: (e: { repoPath: string; session?: unknown }) => void) => {
					emit = listener;
					return { dispose: () => undefined };
				},
			},
		},
		session: graphRepoPath != null ? { repoPath: graphRepoPath } : undefined,
	};

	const fn = (
		GraphInspectServices.prototype as unknown as { subscribeToAutoRebaseProgress: SubscribeToAutoRebaseProgress }
	).subscribeToAutoRebaseProgress;
	const received: unknown[] = [];
	fn.call(fakeThis, undefined, undefined)(data => received.push(data));

	return {
		received: received,
		emit: (repoPath: string, session?: unknown) => {
			assert.ok(emit != null, 'the subscription should have registered an onDidChange listener');
			emit({ repoPath: repoPath, session: session });
		},
	};
}

suite('graphInspectServices — auto-rebase progress is scoped to the graph repo', () => {
	test('forwards updates for the graph repo', () => {
		const feed = createAutoRebaseFeed('/repo-a');

		feed.emit('/repo-a', fakeSession('run-a'));

		assert.strictEqual(feed.received.length, 1);
		assert.strictEqual((feed.received[0] as { sessionId: string }).sessionId, 'run-a');
	});

	test('drops another repo run so it cannot clobber the single run slot', () => {
		const feed = createAutoRebaseFeed('/repo-a');

		feed.emit('/repo-b', fakeSession('run-b'));

		assert.deepStrictEqual(feed.received, [], "another repo's run must not reach the webview");
	});

	test('drops another repo clearing its session — the `undefined` would blank a live run', () => {
		const feed = createAutoRebaseFeed('/repo-a');

		feed.emit('/repo-a', fakeSession('run-a'));
		feed.emit('/repo-b', undefined);

		assert.strictEqual(feed.received.length, 1, "repo B finishing must not push `undefined` over repo A's run");
	});

	test('drops everything while the graph has no repo', () => {
		const feed = createAutoRebaseFeed(undefined);

		feed.emit('/repo-a', fakeSession('run-a'));

		assert.deepStrictEqual(feed.received, []);
	});
});

// Feature under test (#5581): the resolver consults the repository (grep/show/blame) when a hunk alone is
// ambiguous, and every consultation is surfaced in the panel's progress line so a long file doesn't look
// stalled. The message is only ever produced at runtime, so assert the exact payload the webview receives —
// a rename or interpolation slip would otherwise ship silently.

/** One repo consultation, shaped as conflict-tools emits it. */
const toolCallEvent = {
	type: 'resolver:tool-call',
	filePath: 'src/a.ts',
	tool: 'grep',
	args: {},
	stepNumber: 1,
	reason: 'is useTimeout referenced anywhere else?',
} satisfies ConflictProgressEvent;

function createResolveProgressFake() {
	// Every `_resolveProgressEvent.fire(...)` the run makes, in order (including the `undefined` clear).
	const fired: (ResolveProgressUpdate | undefined)[] = [];

	const container = {
		// No `pausedOps` — conflicts can exist without a paused operation, and refs are optional here.
		git: { getRepositoryService: () => ({}) },
		virtualFs: { registerProvider: () => ({ dispose: () => {} }) },
	} as unknown as Container;

	// Stands in for the node-only conflict-tools integration: replays one consultation event through the
	// handler's `onProgress` instead of running a real AI resolution.
	const integration = {
		listUnmergedEntries: () => Promise.resolve([{ path: 'src/a.ts', reason: 'both-modified' }]),
		resolveAllParallel: (args: { onProgress?: (e: ConflictProgressEvent) => void }) => {
			args.onProgress?.(toolCallEvent);
			return Promise.resolve({
				resolutions: [
					{
						filePath: 'src/a.ts',
						content: 'resolved',
						strategy: 'ai',
						confidence: 0.9,
						description: 'why',
					},
				],
				errors: [],
				skipped: [],
			});
		},
		readWorkingFiles: () => Promise.resolve(new Map([['src/a.ts', 'conflicted']])),
	};

	// Same prototype-backed fake as the review tests, with a recording progress event in place of the RPC
	// one — `fire` is what the tool-call arm reaches, `subscribe` is called once by `createServices`.
	const fakeThis = Object.assign(Object.create(GraphInspectServices.prototype) as object, {
		context: { container: container },
		_aiCancellations: new Set(),
		_activeResolveSessions: new Map(),
		_resolveConversationIds: new Map(),
		_composeProgressEvent: { subscribe: () => () => {} },
		_resolveProgressEvent: {
			subscribe: () => () => {},
			fire: (update: ResolveProgressUpdate | undefined) => void fired.push(update),
		},
		getOrCreateConflictToolsForGraph: () => Promise.resolve(integration),
	});

	const { graphInspect } = (GraphInspectServices.prototype.createServices as unknown as CreateServices).call(
		fakeThis,
	);

	return { graphInspect: graphInspect, fired: fired };
}

suite('graphInspectServices — resolve progress reports repo consultation (#5581)', () => {
	test('a resolver tool call becomes an "inspecting" progress message', async () => {
		const m = createResolveProgressFake();

		const result = await m.graphInspect.resolveConflicts('/repo', undefined);

		assert.ok(!('error' in result), `resolve should not have errored: ${JSON.stringify(result)}`);
		assert.deepStrictEqual(
			m.fired.find(u => u?.phase === 'resolver:tool-call'),
			{ phase: 'resolver:tool-call', message: 'src/a.ts: inspecting grep…' },
			'the panel must be told which tool is inspecting which file',
		);
	});

	test('carries the consultation onto the file’s resolution row', async () => {
		// The progress line above is transient — a run's files resolve concurrently onto one message, so
		// it's overwritten long before anyone reads it. The row is where the evidence has to survive, or
		// the rationale states a verdict the user can't audit.
		const m = createResolveProgressFake();

		const result = await m.graphInspect.resolveConflicts('/repo', undefined);

		assert.ok(!('error' in result) && !('cancelled' in result), 'resolve should have produced summaries');
		assert.deepStrictEqual(result.result.resolutions[0].consulted, [
			{ tool: 'grep', reason: 'is useTimeout referenced anywhere else?' },
		]);
	});
});

/** Same prototype-backed shape as {@link createResolveProgressFake}, but with the per-file resolver
 *  metrics under test standing in for the consultation replay. */
function createResolveMetricsFake(metrics: ({ stepCount?: number; toolCallCount?: number } | undefined)[]) {
	const container = {
		git: { getRepositoryService: () => ({}) },
		virtualFs: { registerProvider: () => ({ dispose: () => {} }) },
	} as unknown as Container;

	const paths = metrics.map((_, i) => `src/${i}.ts`);
	const integration = {
		listUnmergedEntries: () => Promise.resolve(paths.map(p => ({ path: p, reason: 'both-modified' }))),
		resolveAllParallel: () =>
			Promise.resolve({
				resolutions: paths.map((p, i) => ({
					filePath: p,
					content: 'resolved',
					strategy: 'ai',
					confidence: 0.9,
					description: 'why',
					metrics: metrics[i],
				})),
				errors: [],
				skipped: [],
			}),
		readWorkingFiles: () => Promise.resolve(new Map(paths.map(p => [p, 'conflicted']))),
	};

	const fakeThis = Object.assign(Object.create(GraphInspectServices.prototype) as object, {
		context: { container: container },
		_aiCancellations: new Set(),
		_activeResolveSessions: new Map(),
		_resolveConversationIds: new Map(),
		_composeProgressEvent: { subscribe: () => () => {} },
		_resolveProgressEvent: { subscribe: () => () => {}, fire: () => {} },
		getOrCreateConflictToolsForGraph: () => Promise.resolve(integration),
	});

	return (GraphInspectServices.prototype.createServices as unknown as CreateServices).call(fakeThis).graphInspect;
}

suite('graphInspectServices — resolver effort aggregation', () => {
	async function resolveMetrics(metrics: ({ stepCount?: number; toolCallCount?: number } | undefined)[]) {
		const graphInspect = createResolveMetricsFake(metrics);
		const result = await graphInspect.resolveConflicts('/repo', undefined);
		assert.ok(!('error' in result) && !('cancelled' in result), `resolve failed: ${JSON.stringify(result)}`);
		return result.result.metrics;
	}

	test('sums each file’s step and tool-call counts over the run', async () => {
		// The panel resolves files concurrently but reports one run-level total, so the per-file counts
		// have to be added rather than last-write-wins.
		assert.deepStrictEqual(
			await resolveMetrics([
				{ stepCount: 3, toolCallCount: 2 },
				{ stepCount: 4, toolCallCount: 1 },
			]),
			{ steps: 7, toolCalls: 3 },
		);
	});

	test('stays undefined when no resolution reported counts, rather than collapsing to 0', async () => {
		// `autoRebase/step/resolved` reports undefined in this case. Sending 0 instead would make a
		// provider that reports nothing look like one that resolved the conflict for free, and the two
		// paths exist to be compared on exactly this.
		assert.deepStrictEqual(await resolveMetrics([undefined, undefined]), {
			steps: undefined,
			toolCalls: undefined,
		});
	});

	test('sums only the files that reported, ignoring the ones that did not', async () => {
		assert.deepStrictEqual(await resolveMetrics([{ stepCount: 5, toolCallCount: 2 }, undefined]), {
			steps: 5,
			toolCalls: 2,
		});
	});

	test('tracks the two counts independently — tools can be unreported while steps are not', async () => {
		assert.deepStrictEqual(await resolveMetrics([{ stepCount: 6 }]), { steps: 6, toolCalls: undefined });
	});
});

/**
 * Prototype-backed fake for the compose conversation lifecycle, in the same shape as
 * {@link createResolveMetricsFake}. Records the `conversationId` each generate/refine was handed and
 * every ID flushed through `AIProviderService.flushBYOKUsage` — together the two observable halves of
 * "one conversation per compose session".
 */
/** Mirrors what the webview sends: compose is WIP-anchored, so the session key is the WIP anchor's. */
function sessionKeyFor(repoPath: string): ComposeSessionKey {
	return `wip|${repoPath}` as ComposeSessionKey;
}

function createComposeConversationFake(options?: { failGenerate?: boolean }) {
	const flushed: string[] = [];
	const regenConversations: (string | undefined)[] = [];
	const container = {
		git: {
			getRepositoryService: (repoPath: string) => ({
				path: repoPath,
				commits: { getCommit: () => Promise.resolve(undefined) },
			}),
		},
		usage: { track: () => Promise.resolve() },
		ai: {
			flushBYOKUsage: (conversationId: string) => {
				flushed.push(conversationId);
				return Promise.resolve();
			},
			actions: {
				generateCommitMessage: (_patch: unknown, _source: unknown, o?: { conversationId?: string }) => {
					regenConversations.push(o?.conversationId);
					return Promise.resolve({ result: { summary: 'regenerated', body: undefined } });
				},
			},
		},
	} as unknown as Container;

	const generated: string[] = [];
	const refined: string[] = [];
	let nextKey = 0;
	const planResult = (cacheKey: string) => ({
		cacheKey: cacheKey,
		kind: 'wip-only' as const,
		headSha: 'head',
		rewriteFromSha: 'head',
		selectedShas: undefined,
	});

	let failNext = options?.failGenerate ?? false;
	let failAfterPlan = false;
	const integration = {
		generatePlanForGraphDetails: (input: { conversationId: string }) => {
			generated.push(input.conversationId);
			if (failNext) {
				failNext = false;
				return Promise.reject(new Error('AI is having a day'));
			}
			return Promise.resolve(planResult(`key-${++nextKey}`));
		},
		refinePlanForGraphDetails: (input: { conversationId: string }) => {
			refined.push(input.conversationId);
			return Promise.resolve(planResult(`key-${++nextKey}`));
		},
		discardCachedPlan: () => {},
		getMaskedHunksForCachedCommit: () => ({
			hunks: [
				{
					fileName: 'a.ts',
					diffHeader: 'diff --git a/a.ts b/a.ts',
					content: '@@ -1 +1 @@\n-a\n+b\n',
				},
			],
		}),
		updateCachedPlanCommitMessage: () => {},
	};

	const fakeThis = Object.assign(Object.create(GraphInspectServices.prototype) as object, {
		context: { container: container, host: { instanceId: 'test-instance' } },
		_aiCancellations: new Set(),
		_activeComposeCacheKeys: new Map<string, string>(),
		_composeConversationIds: new Map<string, string>(),
		_composeToolsForGraph: integration,
		_activeResolveSessions: new Map(),
		_resolveConversationIds: new Map<string, string>(),
		_autoRebaseOwnedConversations: new Set<string>(),
		_composeProgressEvent: { subscribe: () => () => {}, fire: () => {} },
		_resolveProgressEvent: { subscribe: () => () => {}, fire: () => {} },
		getOrCreateComposeToolsForGraph: () => Promise.resolve(integration),
		// Turning a library plan into display commits needs the virtual-FS session machinery, which has
		// nothing to do with the conversation lifecycle under test. Doubles as the seam for a
		// downstream failure: it runs after the library has already produced (and, on a refine,
		// swapped in) its plan.
		deriveComposeCommits: () => {
			if (failAfterPlan) {
				failAfterPlan = false;
				throw new Error('deriving commits blew up');
			}

			return [];
		},
	});

	const { graphInspect } = (GraphInspectServices.prototype.createServices as unknown as CreateServices).call(
		fakeThis,
	);

	const wip: ScopeSelection = { type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] };

	return {
		generated: generated,
		refined: refined,
		flushed: flushed,
		dispose: () => (fakeThis as unknown as { dispose: () => void }).dispose(),
		// `sessionKey` defaults to the shape the webview actually sends for a compose — every compose is
		// WIP-anchored, so `wip|<repoPath>`. Tests that care about two sessions on ONE repo pass it.
		compose: (repoPath: string, sessionKey: ComposeSessionKey = sessionKeyFor(repoPath)) =>
			graphInspect.composeChanges(repoPath, sessionKey, wip, undefined, undefined, undefined),
		refine: (repoPath: string, priorCacheKey: string, sessionKey: ComposeSessionKey = sessionKeyFor(repoPath)) =>
			graphInspect.composeChanges(repoPath, sessionKey, wip, 'tighten it up', undefined, undefined, undefined, {
				mode: 'refine',
				priorCacheKey: priorCacheKey,
			}),
		// An empty commit list short-circuits `executeComposeCommit` before any git work, so this
		// exercises the apply path's conversation teardown and nothing else.
		apply: (repoPath: string, sessionKey: ComposeSessionKey = sessionKeyFor(repoPath)) =>
			graphInspect.commitCompose(repoPath, sessionKey, { commits: [], base: undefined as never }),
		failNextAfterPlan: () => (failAfterPlan = true),
		discard: (repoPath: string, cacheKey: string | undefined) =>
			graphInspect.discardCompose(sessionKeyFor(repoPath), cacheKey),
		regenConversations: regenConversations,
		regenerateMessage: (repoPath: string, cacheKey: string) =>
			graphInspect.regenerateProposedCommitMessage(sessionKeyFor(repoPath), cacheKey, 'commit-1'),
		trackedKey: (repoPath: string) =>
			(fakeThis as unknown as { _activeComposeCacheKeys: Map<string, string> })._activeComposeCacheKeys.get(
				sessionKeyFor(repoPath),
			),
	};
}

async function composeAndGetKey(
	m: ReturnType<typeof createComposeConversationFake>,
	repoPath: string,
	sessionKey?: ComposeSessionKey,
): Promise<string> {
	const result = await m.compose(repoPath, sessionKey);
	assert.ok(!('error' in result) && !('cancelled' in result), `compose failed: ${JSON.stringify(result)}`);
	assert.ok(result.result.cacheKey != null, 'a successful compose must register a cache key');
	return result.result.cacheKey;
}

suite('graphInspectServices — compose conversation lifecycle', () => {
	test('a refine continues the generate’s conversation', async () => {
		// The whole point: a plan the user refines is one session, not two.
		const m = createComposeConversationFake();

		const key = await composeAndGetKey(m, '/repo');
		await m.refine('/repo', key);

		assert.strictEqual(m.generated.length, 1);
		assert.strictEqual(m.refined[0], m.generated[0], 'the refine must reuse the generate’s conversation ID');
		assert.deepStrictEqual(m.flushed, [], 'an ongoing session must not report its usage yet');
	});

	test('a cold start while a plan is live abandons that conversation and mints a new one', async () => {
		// Walking back to the start of the compose UX and generating again is a new session — the prior
		// plan is discarded, so its accumulated usage has to be reported before the ID is dropped.
		const m = createComposeConversationFake();

		await m.compose('/repo');
		await m.compose('/repo');

		assert.strictEqual(m.generated.length, 2);
		assert.notStrictEqual(m.generated[1], m.generated[0], 'a fresh compose must not reuse the abandoned ID');
		assert.deepStrictEqual(m.flushed, [m.generated[0]], 'the abandoned conversation must be flushed exactly once');
	});

	test('retrying a generate that failed continues the same conversation', async () => {
		// The failed attempt already sent requests under that ID. Minting a new one for the retry would
		// split one compose into two sessions — the bug this wiring exists to fix.
		const m = createComposeConversationFake({ failGenerate: true });

		const failed = await m.compose('/repo');
		assert.ok('error' in failed, 'the first generate was supposed to fail');

		await m.compose('/repo');

		assert.strictEqual(m.generated.length, 2);
		assert.strictEqual(m.generated[1], m.generated[0], 'a retry after failure is the same session');
		assert.deepStrictEqual(m.flushed, [], 'nothing was abandoned — no plan was ever produced');
	});

	test('regenerating one commit’s message continues the compose session', async () => {
		// Regenerating a message is a distinct AI action, but it happens inside a compose the user is
		// already in — so it belongs to that session rather than reading as a task of its own.
		const m = createComposeConversationFake();
		const key = await composeAndGetKey(m, '/repo');

		await m.regenerateMessage('/repo', key);

		assert.deepStrictEqual(
			m.regenConversations,
			[m.generated[0]],
			'the regen must carry the session’s conversation',
		);
		assert.deepStrictEqual(m.flushed, [], 'and must not end it — the session is still open');

		// Still refinable afterwards, under the same conversation.
		await m.refine('/repo', key);
		assert.strictEqual(m.refined.at(-1), m.generated[0]);
	});

	test('discarding a plan ends its conversation right away', async () => {
		// Discard drops the webview's only handle on the plan. Without telling the host, the plan and its
		// conversation sat there until the next compose on this session or panel teardown.
		const m = createComposeConversationFake();
		const key = await composeAndGetKey(m, '/repo');

		await m.discard('/repo', key);

		assert.deepStrictEqual(m.flushed, [m.generated[0]], 'the discarded session must be closed');

		await composeAndGetKey(m, '/repo');
		assert.notStrictEqual(m.generated[1], m.generated[0], 'the next compose is a new session');
	});

	test('a discard that arrives late cannot end a newer session', async () => {
		// The call is fire-and-forget from the webview, so it can land after the user has already started
		// over. Naming the plan it believes it is discarding is what makes that case a no-op instead of
		// tearing down the live plan and conversation that replaced it.
		const m = createComposeConversationFake();
		const staleKey = await composeAndGetKey(m, '/repo');
		await m.discard('/repo', staleKey);
		const liveKey = await composeAndGetKey(m, '/repo');
		const flushedBefore = [...m.flushed];

		await m.discard('/repo', staleKey);

		assert.deepStrictEqual(m.flushed, flushedBefore, 'the live session must be untouched');
		await m.refine('/repo', liveKey);
		assert.strictEqual(m.refined.at(-1), m.generated[1], 'and must still be refinable');
	});

	test('applying the plan ends the conversation, and the next compose starts a new one', async () => {
		const m = createComposeConversationFake();

		await m.compose('/repo');
		await m.apply('/repo');

		assert.deepStrictEqual(m.flushed, [m.generated[0]], 'apply is terminal — the session must report once');

		await m.compose('/repo');

		assert.notStrictEqual(m.generated[1], m.generated[0], 'a post-apply compose is a new session');
	});

	test('concurrent composes in a repo and its worktree each keep their own conversation', async () => {
		// A worktree is a distinct repo path, so both plans can be live at once — each refine has to
		// resume its own run's conversation rather than whichever ran most recently.
		const m = createComposeConversationFake();

		const mainKey = await composeAndGetKey(m, '/repo');
		const worktreeKey = await composeAndGetKey(m, '/repo/.worktrees/feature');
		assert.notStrictEqual(m.generated[1], m.generated[0], 'two runs are two sessions');

		await m.refine('/repo', mainKey);
		await m.refine('/repo/.worktrees/feature', worktreeKey);

		assert.deepStrictEqual(
			m.refined,
			[m.generated[0], m.generated[1]],
			'each refine must resume its own repo’s conversation',
		);
		assert.deepStrictEqual(m.flushed, [], 'neither session was abandoned by the other');
	});

	test('a refine that fails after swapping the plan lets go of the dead key', async () => {
		// A refine that reaches the library swaps in a new plan and drops the prior one. If a later
		// step then throws, the new plan is discarded — leaving the key we had registered naming a plan
		// the library no longer holds. Keeping it would let the next attempt satisfy the refine gate
		// with a dead key and fail the lookup instead of starting fresh.
		const m = createComposeConversationFake();
		const firstKey = await composeAndGetKey(m, '/repo');
		assert.strictEqual(m.trackedKey('/repo'), firstKey, 'precondition: the plan is registered');

		m.failNextAfterPlan();
		const result = await m.refine('/repo', firstKey);

		assert.ok('error' in result, 'the refine should have surfaced the downstream failure');
		assert.strictEqual(m.trackedKey('/repo'), undefined, 'the dead key must not stay registered');
		assert.deepStrictEqual(m.flushed, [], 'a retryable failure must not end the session');

		// The retry cold-starts, because the plan really is gone — but it continues the same
		// conversation, since the user is retrying this session rather than abandoning it.
		await composeAndGetKey(m, '/repo');
		assert.strictEqual(m.generated[1], m.generated[0], 'the retry must continue the same conversation');
		assert.deepStrictEqual(m.flushed, [], 'and still not have ended it');
	});

	test('two sessions on ONE repo path stay separate', async () => {
		// Not reachable through today's UI — compose is only enterable on the WIP anchor, so one repo has
		// one compose session. That invariant lives in a single webview line (`enterModeForWip` nulls
		// `shas`), and the host is keyed so it doesn't have to trust it: if compose ever becomes
		// reachable from a second anchor, these two must not share a conversation or evict each other's
		// plan. Keyed by repo path, both assertions below fail.
		const m = createComposeConversationFake();
		const multicommitKey = 'multicommit|/repo|c1,c2' as string as ComposeSessionKey;

		const firstKey = await composeAndGetKey(m, '/repo', sessionKeyFor('/repo'));
		const secondKey = await composeAndGetKey(m, '/repo', multicommitKey);

		assert.notStrictEqual(m.generated[1], m.generated[0], 'the second session must mint its own ID');
		assert.deepStrictEqual(m.flushed, [], 'neither session abandoned the other');

		await m.refine('/repo', firstKey, sessionKeyFor('/repo'));
		await m.refine('/repo', secondKey, multicommitKey);

		assert.deepStrictEqual(
			m.refined,
			[m.generated[0], m.generated[1]],
			'each refine must resume its own session, not whichever ran last',
		);
	});

	test('disposing the panel flushes every conversation still open', async () => {
		// Usage accumulated for an unapplied plan would otherwise be silently dropped on teardown.
		const m = createComposeConversationFake();

		await m.compose('/repo');
		await m.compose('/other');
		m.dispose();

		assert.deepStrictEqual([...m.flushed].sort(), [...m.generated].sort());
	});
});
