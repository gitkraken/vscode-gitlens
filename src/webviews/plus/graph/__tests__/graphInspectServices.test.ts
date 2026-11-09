import * as assert from 'assert';
import * as sinon from 'sinon';
import type { CommentController, CommentThread } from 'vscode';
import { commands, comments, Uri } from 'vscode';
import { AIError, AIErrorReason } from '@gitlens/ai/errors.js';
import type { AIReviewFinding } from '@gitlens/ai/models/results.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
// Side-effect only: `context.js` below pulls in `system/-webview/command.js`, whose first load is re-entered
// through container.ts's dependency chain before its `registrableCommands` array exists — loading container.ts
// first avoids it (see `graphProducersService.upstreamMetadata.test.ts`)
import '../../../../container.js';
import type { Container } from '../../../../container.js';
import type { ConflictProgressEvent } from '../../../../plus/coretools/conflict/types.js';
import { getContext } from '../../../../system/-webview/context.js';
import { GraphInspectServices } from '../graphInspectServices.js';
import type {
	AddressReviewFindingsArgs,
	AddressReviewFindingsResult,
	ComposeSessionKey,
	DeepReviewArgs,
	DeepReviewAvailability,
	DeepReviewStartResult,
	DeepReviewState,
	GraphInspectService,
	ResolveProgressUpdate,
	ReviewFilesArgs,
	ReviewReadingAction,
	ReviewReadingState,
	ReviewThreadAction,
	ReviewThreadActionsState,
	ScopeSelection,
} from '../graphService.js';
import type { ReviewReadingOwner } from '../reviewReading.js';
import { claimReviewFiles, releaseReviewFiles, stepReviewReading } from '../reviewReading.js';
import type { ReviewThreadsOwner } from '../reviewThreads.js';
import { disposeReviewThreads, setReviewThreads } from '../reviewThreads.js';

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

function createReviewFake(
	diff: string = diffWithNestedRepoGitlink,
	options?: { stagedDiff?: string; stagedFiles?: Record<string, string>; findings?: AIReviewFinding[] },
) {
	const getDiff = sinon.stub();
	getDiff.withArgs(uncommitted).resolves({ contents: diff });
	getDiff.withArgs(uncommittedStaged).resolves(options?.stagedDiff ? { contents: options.stagedDiff } : undefined);

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
		revision: {
			getRevisionContent: async (path: string, rev: string) => {
				const content = rev === uncommittedStaged ? options?.stagedFiles?.[path] : undefined;
				return content != null ? new TextEncoder().encode(content) : undefined;
			},
		},
	};

	const reviewChanges = sinon.stub().returns({
		promise: Promise.resolve({
			result: {
				mode: 'single-pass',
				overview: '',
				focusAreas: options?.findings
					? [
							{
								id: 'a',
								label: 'a',
								rationale: '',
								severity: 'warning',
								files: [],
								findings: options.findings,
							},
						]
					: [],
			},
		}),
	});
	const reviewFocusArea = sinon.stub().returns({ promise: Promise.resolve({ result: { findings: [] } }) });
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
		_reviewReadingEvent: noopEvent,
		_reviewThreadActionsEvent: noopEvent,
		_deepReviewEvent: noopEvent,
		_reviewThreadActions: { actions: [] },
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

suite('graphInspectServices — review finding lines', () => {
	test('re-points finding lines at the file the reader opens, by their quoted text', async () => {
		const stagedDiff = [
			'diff --git a/src/a.ts b/src/a.ts',
			'index 1111111..2222222 100644',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1,2 +1,3 @@',
			' const a = 1;',
			'+const b = 2;',
			' const c = 3;',
			'',
		].join('\n');
		const finding = (id: string, lineRange?: { start: number; end: number }): AIReviewFinding => ({
			id: id,
			severity: 'warning',
			title: id,
			description: '',
			filePath: 'src/a.ts',
			lineRange: lineRange,
		});
		const m = createReviewFake('', {
			stagedDiff: stagedDiff,
			// The file as the diff opens it has two more lines above, and line 3's text no longer appears
			stagedFiles: { 'src/a.ts': '// one\n// two\nconst a = 1;\nconst b = 2;\nconst c = 30;\n' },
			findings: [finding('moved', { start: 2, end: 2 }), finding('gone', { start: 3, end: 3 }), finding('none')],
		});

		const result = await m.graphInspect.reviewChanges('/repo', wipScope({ includeStaged: true }));

		assert.ok('result' in result, `review should not have errored: ${JSON.stringify(result)}`);
		const findings = result.result.focusAreas[0].findings ?? [];
		assert.deepStrictEqual(findings[0].lineRange, { start: 4, end: 4 });
		assert.strictEqual(findings[1].lineRange, undefined, 'a line whose text is gone loses its range');
		assert.strictEqual(findings[1].filePath, 'src/a.ts', 'but keeps its file');
		assert.strictEqual(findings[2].lineRange, undefined, 'a finding without lines is left alone');
	});
});

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

// `subscribeToDeepReviewAvailability` reaches `this.container.ipc`, `this.container.agents` and
// `this.getDeepReviewAvailability`, so the fake-`this` approach applies again. The panel asks once when it
// mounts; these pushes are what lift a "needs the local channel" that was answered before the server was up.

function createDeepReviewAvailabilityFeed(answers: (() => Promise<DeepReviewAvailability>)[]) {
	let startListener: (() => void) | undefined;
	let agentsListener: (() => void) | undefined;
	let disposed = 0;

	const fakeThis = {
		container: {
			ipc: {
				onDidStart: (listener: () => void) => {
					startListener = listener;
					return { dispose: () => void disposed++ };
				},
			},
			agents: {
				onDidChangeAgents: (listener: () => void) => {
					agentsListener = listener;
					return { dispose: () => void disposed++ };
				},
			},
		},
		getDeepReviewAvailability: () => {
			const answer = answers.shift();
			assert.ok(answer != null, 'asked more often than expected');
			return answer();
		},
		_deepReviewAvailabilityChecks: 0,
		refreshDeepReviewAvailability: (GraphInspectServices.prototype as unknown as Record<string, unknown>)
			.refreshDeepReviewAvailability,
	};

	const fn = (
		GraphInspectServices.prototype as unknown as {
			subscribeToDeepReviewAvailability: SubscribeToAutoRebaseProgress;
		}
	).subscribeToDeepReviewAvailability;
	const received: unknown[] = [];
	const unsubscribe = fn.call(fakeThis, undefined, undefined)(data => received.push(data));

	return {
		received: received,
		ipcStarted: () => startListener?.(),
		agentsChanged: () => agentsListener?.(),
		unsubscribe: unsubscribe,
		get disposed() {
			return disposed;
		},
	};
}

/** Lets the pending answer promises and their continuations settle. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

suite('graphInspectServices — Review in Repo counts a local channel that can start', () => {
	const availability = (GraphInspectServices.prototype as unknown as Record<string, unknown>)
		.getDeepReviewAvailability as (this: object) => Promise<DeepReviewAvailability>;

	function withIpc(canStart: boolean) {
		const ipc = { address: undefined, token: undefined, canStart: canStart, ensureStarted: sinon.spy() };
		// No CLI agents can be detected from this container: that reads as unknown, not as none
		return { ipc: ipc, fakeThis: { container: { ipc: ipc, agents: {} } } };
	}

	test('a server nothing has started yet counts, and asking does not start it', async () => {
		const { ipc, fakeThis } = withIpc(true);
		assert.deepStrictEqual(await availability.call(fakeThis), { available: true });
		assert.strictEqual(ipc.ensureStarted.callCount, 0, 'started when a review is handed over, not for asking');
	});

	test('where no server can start, the review has no channel', async () => {
		const { ipc, fakeThis } = withIpc(false);
		assert.deepStrictEqual(await availability.call(fakeThis), { available: false, reason: 'no-channel' });
		assert.strictEqual(ipc.ensureStarted.callCount, 0);
	});
});

suite('graphInspectServices — Review in Repo availability is sent again when it can change', () => {
	test('sends a fresh answer once the IPC server starts', async () => {
		const feed = createDeepReviewAvailabilityFeed([async () => ({ available: true })]);

		feed.ipcStarted();
		await settle();

		assert.deepStrictEqual(feed.received, [{ available: true }]);
	});

	test('sends a fresh answer when the agents list changes', async () => {
		const feed = createDeepReviewAvailabilityFeed([async () => ({ available: false, reason: 'no-agents' })]);

		feed.agentsChanged();
		await settle();

		assert.deepStrictEqual(feed.received, [{ available: false, reason: 'no-agents' }]);
	});

	test('drops an answer that settles after a newer one', async () => {
		let resolveFirst: ((value: DeepReviewAvailability) => void) | undefined;
		const feed = createDeepReviewAvailabilityFeed([
			() => new Promise(resolve => (resolveFirst = resolve)),
			async () => ({ available: true }),
		]);

		feed.agentsChanged();
		feed.ipcStarted();
		await settle();
		resolveFirst?.({ available: false, reason: 'no-channel' });
		await settle();

		assert.deepStrictEqual(feed.received, [{ available: true }]);
	});

	test("keeps the threads' Ask Reviewer to the latest answer", async () => {
		let resolveFirst: ((value: DeepReviewAvailability) => void) | undefined;
		const feed = createDeepReviewAvailabilityFeed([
			() => new Promise(resolve => (resolveFirst = resolve)),
			async () => ({ available: false, reason: 'no-agents' }),
			async () => ({ available: true }),
		]);

		feed.agentsChanged();
		feed.ipcStarted();
		await settle();
		assert.strictEqual(getContext('gitlens:review:canAsk'), false, 'no agent to answer');

		resolveFirst?.({ available: true });
		await settle();
		assert.strictEqual(getContext('gitlens:review:canAsk'), false, 'an older answer is not the latest');

		feed.agentsChanged();
		await settle();
		assert.strictEqual(getContext('gitlens:review:canAsk'), true);
	});

	test('stops listening when the webview unsubscribes', () => {
		const feed = createDeepReviewAvailabilityFeed([]);

		feed.unsubscribe();

		assert.strictEqual(feed.disposed, 2);
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
		// Resolve All picks its model once up front; `undefined` would read as a dismissed picker and cancel.
		ai: { getModel: async () => ({ id: 'test-model' }) },
		// No automatic rebase run, so the result isn't marked mid-run.
		autoRebase: { getSession: () => undefined },
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
		_reviewReadingEvent: { subscribe: () => () => {} },
		_reviewThreadActionsEvent: { subscribe: () => () => {} },
		_deepReviewEvent: { subscribe: () => () => {} },
		_reviewThreadActions: { actions: [] },
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
		ai: { getModel: async () => ({ id: 'test-model' }) },
		autoRebase: { getSession: () => undefined },
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
		_reviewReadingEvent: { subscribe: () => () => {} },
		_reviewThreadActionsEvent: { subscribe: () => () => {} },
		_deepReviewEvent: { subscribe: () => () => {} },
		_reviewThreadActions: { actions: [] },
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
		_reviewReadingEvent: { subscribe: () => () => {} },
		_reviewThreadActionsEvent: { subscribe: () => () => {} },
		_deepReviewEvent: { subscribe: () => () => {} },
		_reviewThreadActions: { actions: [] },
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

	test('a discard naming no plan leaves the session alone', async () => {
		// A destroyed run that never produced a plan names none. So does a session still waiting on its
		// first generate, and the host cannot tell those apart — so acting on it would let a late call end
		// a conversation the in-flight request is about to report under, splitting the session and leaving
		// its later usage with nothing to flush it. Retry or dispose closes these instead.
		const m = createComposeConversationFake({ failGenerate: true });
		const failed = await m.compose('/repo');
		assert.ok('error' in failed, 'precondition: the generate failed, so no plan was registered');
		assert.strictEqual(m.trackedKey('/repo'), undefined, 'precondition: no plan tracked');

		await m.discard('/repo', undefined);

		assert.deepStrictEqual(m.flushed, [], 'nothing to release, so nothing to end');

		// The retry continues that same conversation, which is what the no-op preserves.
		await composeAndGetKey(m, '/repo');
		assert.strictEqual(m.generated[1], m.generated[0], 'the retry must continue the same conversation');
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

// One user action → one error message. Once AI is unavailable (out of credits, rate limited, offline, …) every
// remaining file fails with the same error, and listing it per file buried the one thing the user needed to
// know — and, because the run is silent, the quota notification's way out never showed.

/** Resolve run whose files resolve or fail as scripted, plus the subscription the quota call to action reads. */
function createResolveUnavailableFake(opts: {
	resolutions: { filePath: string; descriptionKind?: string }[];
	errors: { filePath: string; error: Error }[];
	role?: 'owner' | 'member';
}) {
	const paths = [...opts.resolutions.map(r => r.filePath), ...opts.errors.map(e => e.filePath)];
	const container = {
		git: { getRepositoryService: () => ({}) },
		virtualFs: { registerProvider: () => ({ dispose: () => {} }) },
		ai: { getModel: async () => ({ id: 'model' }) },
		subscription: {
			getSubscription: async () => ({
				activeOrganization: opts.role != null ? { role: opts.role } : undefined,
			}),
		},
		autoRebase: { getSession: () => undefined },
	} as unknown as Container;

	const integration = {
		listUnmergedEntries: () => Promise.resolve(paths.map(p => ({ path: p, reason: 'both-modified' }))),
		resolveAllParallel: () =>
			Promise.resolve({
				resolutions: opts.resolutions.map(r => ({
					filePath: r.filePath,
					content: 'resolved',
					strategy: 'ai',
					confidence: 0.9,
					description: 'why',
					descriptionKind: r.descriptionKind,
				})),
				errors: opts.errors,
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
		_reviewReadingEvent: { subscribe: () => () => {} },
		_reviewThreadActionsEvent: { subscribe: () => () => {} },
		_deepReviewEvent: { subscribe: () => () => {} },
		_resolveProgressEvent: { subscribe: () => () => {}, fire: () => {} },
		getOrCreateConflictToolsForGraph: () => Promise.resolve(integration),
	});

	return (GraphInspectServices.prototype.createServices as unknown as CreateServices).call(fakeThis).graphInspect;
}

/** An escalated automatic rebase whose one-shot handoff is waiting for the Resolve panel. */
function createSeededHandoffFake(handoff: {
	resolutions: { filePath: string; descriptionKind?: string }[];
	errors: { filePath: string; error: Error }[];
}) {
	const session = {
		phase: 'escalated',
		preRun: { headSha: 'orig-head' },
		escalation: { reason: 'ai-unavailable', message: 'stopped', stepNumber: 2, totalSteps: 5 },
	};
	const container = {
		git: {
			getRepositoryService: () => ({
				pausedOps: {
					getPausedOperationStatus: async () => ({
						type: 'rebase',
						isPaused: true,
						source: { ref: 'orig-head' },
					}),
				},
			}),
		},
		virtualFs: { registerProvider: () => ({ dispose: () => {} }) },
		subscription: { getSubscription: async () => ({ activeOrganization: undefined }) },
		autoRebase: {
			getSession: () => session,
			takeEscalationHandoff: () => ({
				sessionId: 'run-1',
				resolutions: handoff.resolutions.map(r => ({
					filePath: r.filePath,
					content: 'resolved',
					strategy: 'ai',
					confidence: 0.9,
					description: 'why',
					descriptionKind: r.descriptionKind,
				})),
				conflictedContents: new Map(handoff.resolutions.map(r => [r.filePath, 'conflicted'])),
				errors: handoff.errors,
				skipped: [],
				consultations: new Map(),
			}),
		},
	} as unknown as Container;

	const fakeThis = Object.assign(Object.create(GraphInspectServices.prototype) as object, {
		context: { container: container },
		_aiCancellations: new Set(),
		_activeResolveSessions: new Map(),
		_resolveConversationIds: new Map(),
		_autoRebaseOwnedConversations: new Set(),
		_composeProgressEvent: { subscribe: () => () => {} },
		_reviewReadingEvent: { subscribe: () => () => {} },
		_reviewThreadActionsEvent: { subscribe: () => () => {} },
		_deepReviewEvent: { subscribe: () => () => {} },
		_resolveProgressEvent: { subscribe: () => () => {}, fire: () => {} },
	});

	return (GraphInspectServices.prototype.createServices as unknown as CreateServices).call(fakeThis).graphInspect;
}

suite('graphInspectServices — AI unavailable during a resolve run', () => {
	test('a run AI resolved nothing in fails once, with the quota call to action', async () => {
		const graphInspect = createResolveUnavailableFake({
			resolutions: [],
			errors: ['a.ts', 'b.ts', 'c.ts'].map(p => ({
				filePath: p,
				error: new AIError(AIErrorReason.UserQuotaExceeded),
			})),
			role: 'owner',
		});

		const result = await graphInspect.resolveConflicts('/repo', undefined);

		assert.ok('error' in result, `expected a single run-level error: ${JSON.stringify(result)}`);
		assert.match(result.error.message, /3 files weren’t resolved/);
		assert.strictEqual(result.error.action, 'purchase-credits');
	});

	test('a member who can’t buy credits is told to ask an admin, with no purchase action', async () => {
		const graphInspect = createResolveUnavailableFake({
			resolutions: [],
			errors: [{ filePath: 'a.ts', error: new AIError(AIErrorReason.UserQuotaExceeded) }],
			role: 'member',
		});

		const result = await graphInspect.resolveConflicts('/repo', undefined);

		assert.ok('error' in result);
		assert.match(result.error.message, /Contact your organization admin or owner/);
		assert.strictEqual(result.error.action, undefined);
	});

	test('a partial run keeps its resolutions and reports the reason once, not on every row', async () => {
		const graphInspect = createResolveUnavailableFake({
			resolutions: [{ filePath: 'done.ts' }],
			errors: ['a.ts', 'b.ts'].map(p => ({ filePath: p, error: new AIError(AIErrorReason.RateLimitExceeded) })),
		});

		const result = await graphInspect.resolveConflicts('/repo', undefined);

		assert.ok('result' in result, `the resolved file must not be thrown away: ${JSON.stringify(result)}`);
		assert.deepStrictEqual(
			result.result.resolutions.map(r => r.filePath),
			['done.ts'],
		);
		assert.deepStrictEqual(result.result.aiUnavailable, { message: 'Rate limit exceeded.' });
		assert.deepStrictEqual(
			result.result.errors?.map(e => ({ filePath: e.filePath, message: e.message })),
			[
				{ filePath: 'a.ts', message: undefined },
				{ filePath: 'b.ts', message: undefined },
			],
		);
	});

	test('an ai-unavailable Auto-Rebase escalation opens as one error, not a row per file', async () => {
		// The handoff used to carry only each error's text, so the panel couldn't tell the run had lost AI.
		const graphInspect = createSeededHandoffFake({
			resolutions: [],
			errors: ['a.ts', 'b.ts'].map(p => ({ filePath: p, error: new AIError(AIErrorReason.NoNetwork) })),
		});

		const result = await graphInspect.getSeededResolveSession('/repo');

		assert.ok(result != null && 'error' in result, `expected a single error: ${JSON.stringify(result)}`);
		assert.match(result.error.message, /2 files weren’t resolved/);
		assert.match(result.error.message, /check your internet connection/);
	});

	test('an escalation that resolved some files keeps them, mid-rebase, with the run-level notice', async () => {
		const graphInspect = createSeededHandoffFake({
			resolutions: [{ filePath: 'done.ts' }],
			errors: [{ filePath: 'a.ts', error: new AIError(AIErrorReason.NoNetwork) }],
		});

		const result = await graphInspect.getSeededResolveSession('/repo');

		assert.ok(result != null && 'result' in result, `expected the seeded result: ${JSON.stringify(result)}`);
		assert.strictEqual(result.result.autoRebase?.sessionId, 'run-1');
		assert.ok(result.result.aiUnavailable != null);
		assert.strictEqual(result.result.errors?.[0].message, undefined);
	});
});

// "Apply & Resume with AI" used to ride only the result seeded from an escalation's one-shot handoff, so
// a Retry (after an `ai-unavailable` handoff opened as an error, or after a failed apply) or a Refine —
// each a fresh `resolveConflicts` run — dropped back to a plain Apply while the run sat paused mid-rebase.

/** A resolve run in a repo whose automatic rebase is in the given state. */
function createResolveDuringAutoRebaseFake(opts: { session: { phase: string } | undefined; pausedOrigHead: string }) {
	const container = {
		git: {
			getRepositoryService: () => ({
				pausedOps: {
					getPausedOperationStatus: async () => ({
						type: 'rebase',
						isPaused: true,
						HEAD: { ref: 'step-commit' },
						onto: { ref: 'onto' },
						source: { ref: opts.pausedOrigHead },
						steps: { current: { commit: { ref: 'step-commit' } } },
					}),
				},
			}),
		},
		virtualFs: { registerProvider: () => ({ dispose: () => {} }) },
		ai: { getModel: async () => ({ id: 'test-model' }) },
		autoRebase: {
			getSession: () =>
				opts.session != null
					? {
							...opts.session,
							id: 'run-1',
							preRun: { headSha: 'orig-head' },
							escalation: { reason: 'ai-unavailable', message: 'stopped', stepNumber: 2, totalSteps: 5 },
						}
					: undefined,
		},
	} as unknown as Container;

	const integration = {
		listUnmergedEntries: () => Promise.resolve([{ path: 'src/a.ts', reason: 'both-modified' }]),
		resolveAllParallel: () =>
			Promise.resolve({
				resolutions: [
					{ filePath: 'src/a.ts', content: 'resolved', strategy: 'ai', confidence: 0.9, description: 'why' },
				],
				errors: [],
				skipped: [],
			}),
		readWorkingFiles: () => Promise.resolve(new Map([['src/a.ts', 'conflicted']])),
	};

	const fakeThis = Object.assign(Object.create(GraphInspectServices.prototype) as object, {
		context: { container: container },
		_aiCancellations: new Set(),
		_activeResolveSessions: new Map(),
		_resolveConversationIds: new Map(),
		_composeProgressEvent: { subscribe: () => () => {} },
		_reviewReadingEvent: { subscribe: () => () => {} },
		_reviewThreadActionsEvent: { subscribe: () => () => {} },
		_deepReviewEvent: { subscribe: () => () => {} },
		_resolveProgressEvent: { subscribe: () => () => {}, fire: () => {} },
		getOrCreateConflictToolsForGraph: () => Promise.resolve(integration),
	});

	return (GraphInspectServices.prototype.createServices as unknown as CreateServices).call(fakeThis).graphInspect;
}

suite('graphInspectServices — a resolve run during an escalated automatic rebase', () => {
	test('is marked mid-run, with the escalated step, so the panel offers Apply & Resume', async () => {
		const graphInspect = createResolveDuringAutoRebaseFake({
			session: { phase: 'escalated' },
			pausedOrigHead: 'orig-head',
		});

		const result = await graphInspect.resolveConflicts('/repo', undefined);

		assert.ok('result' in result, `expected resolutions: ${JSON.stringify(result)}`);
		assert.deepStrictEqual(result.result.autoRebase, { sessionId: 'run-1', stepNumber: 2, totalSteps: 5 });
	});

	test('is not marked mid-run when no automatic rebase is escalated', async () => {
		for (const session of [undefined, { phase: 'running' }, { phase: 'completed' }]) {
			const graphInspect = createResolveDuringAutoRebaseFake({ session: session, pausedOrigHead: 'orig-head' });

			const result = await graphInspect.resolveConflicts('/repo', undefined);

			assert.ok('result' in result, `expected resolutions: ${JSON.stringify(result)}`);
			assert.strictEqual(result.result.autoRebase, undefined, `phase: ${session?.phase}`);
		}
	});

	test('is not marked mid-run when the paused rebase is not the escalated one', async () => {
		// The escalated session lingers when its rebase ends outside the service — a later, unrelated
		// rebase in the same repo must not offer to resume it.
		const graphInspect = createResolveDuringAutoRebaseFake({
			session: { phase: 'escalated' },
			pausedOrigHead: 'other-head',
		});

		const result = await graphInspect.resolveConflicts('/repo', undefined);

		assert.ok('result' in result, `expected resolutions: ${JSON.stringify(result)}`);
		assert.strictEqual(result.result.autoRebase, undefined);
	});
});

// The reading module's owner, kept here rather than in a test of its own: loaded first, its import chain
// reaches the command registry before it is set up
function createReadingOwner(): ReviewReadingOwner & {
	reviewStep: sinon.SinonStub;
	reviewFilesReleased: sinon.SinonStub;
} {
	return { reviewStep: sinon.stub().resolves(), reviewFilesReleased: sinon.stub() };
}

suite('reviewReading — one graph drives the editor', () => {
	let owners: ReviewReadingOwner[] = [];

	teardown(() => {
		for (const owner of owners) {
			releaseReviewFiles(owner);
		}
		owners = [];
	});

	test('tells the instance it was taken from, once, and the editor steps the new one', async () => {
		const first = createReadingOwner();
		const second = createReadingOwner();
		owners = [first, second];

		claimReviewFiles(first, []);
		claimReviewFiles(first, []);
		assert.strictEqual(first.reviewFilesReleased.callCount, 0, 'claiming again is not a hand-over');

		claimReviewFiles(second, []);
		assert.strictEqual(first.reviewFilesReleased.callCount, 1);
		assert.strictEqual(second.reviewFilesReleased.callCount, 0);

		await stepReviewReading('next');
		assert.strictEqual(first.reviewStep.callCount, 0);
		assert.strictEqual(second.reviewStep.callCount, 1);
	});

	test('a release by the instance the files were taken from leaves the new owner in place', async () => {
		const first = createReadingOwner();
		const second = createReadingOwner();
		owners = [first, second];
		// What a released graph does on its way out
		first.reviewFilesReleased.callsFake(() => releaseReviewFiles(first));

		claimReviewFiles(first, []);
		claimReviewFiles(second, []);
		releaseReviewFiles(first);

		await stepReviewReading('previous');
		assert.strictEqual(second.reviewStep.callCount, 1);
	});
});

// With the graph open twice (sidebar and editor tab), each instance's review claims the one editor. Only the
// review-files half of `GraphInspectServices` runs here: `setReviewFiles` reaches the repository service for
// working-file URIs and fires the reading event; the rest of the instance is left out.
type ReviewOwnerFake = {
	setReviewFiles(args: ReviewFilesArgs | undefined): Promise<void>;
	reviewStep(action: ReviewReadingAction, from?: string): Promise<void>;
	reviewThreadAction(findingId: string, action: ReviewThreadAction, text?: string): void;
	clearReviewFiles(): void;
	_reviewFiles?: { paths: string[]; marked: string[] };
	_reviewReadingEvent: { fire: sinon.SinonStub };
	_reviewThreadActionsEvent: { fire: sinon.SinonStub };
};

function createReviewOwnerFake(): ReviewOwnerFake {
	const container = {
		git: {
			getRepositoryService: () => ({
				getAbsoluteUri: (path: string, repoPath: string) => Uri.file(`${repoPath}/${path}`),
			}),
		},
	} as unknown as Container;
	return Object.assign(Object.create(GraphInspectServices.prototype) as object, {
		context: { container: container },
		_reviewReadingEvent: { fire: sinon.stub(), subscribe: () => () => {} },
		_reviewThreadActionsEvent: { fire: sinon.stub(), subscribe: () => () => {} },
		_reviewThreadActionsSeq: 0,
		_reviewMarksMade: 0,
		_reviewReleased: false,
	}) as unknown as ReviewOwnerFake;
}

// The host doesn't read the anchor — a commit's key over the working tree's diff is enough to tell reviews apart
function reviewFiles(paths: string[], anchor = 'wip|/repo'): ReviewFilesArgs {
	return { anchor: anchor, repoPath: '/repo', lhs: 'HEAD', rhs: uncommitted, paths: paths };
}

suite('graphInspectServices — two graphs, one editor', () => {
	let fakes: ReviewOwnerFake[] = [];

	teardown(() => {
		for (const fake of fakes) {
			fake.clearReviewFiles();
		}
		fakes = [];
		disposeReviewThreads();
	});

	test('the graph taken over lets its reading go, holds its review back, and takes it back when worked in', async () => {
		const first = createReviewOwnerFake();
		const second = createReviewOwnerFake();
		fakes = [first, second];

		await first.setReviewFiles(reviewFiles(['a.ts']));
		await second.setReviewFiles(reviewFiles(['b.ts']));

		assert.strictEqual(first._reviewFiles, undefined, 'the first lets its files go');
		assert.strictEqual(
			first._reviewReadingEvent.fire.lastCall.args[0],
			undefined,
			'and its panel stops following the editor',
		);

		// Its own changes meanwhile don't pull the editor back
		await first.setReviewFiles(reviewFiles(['c.ts']));
		assert.strictEqual(first._reviewFiles, undefined);
		assert.deepStrictEqual(second._reviewFiles?.paths, ['b.ts']);

		// Stepped from its panel, it takes the review back as it now stands
		await first.reviewStep('markViewed', 'c.ts');
		const reclaimed = first._reviewFiles as ReviewOwnerFake['_reviewFiles'];
		assert.deepStrictEqual(reclaimed?.paths, ['c.ts']);
		assert.deepStrictEqual(reclaimed?.marked, ['c.ts']);
		assert.strictEqual(second._reviewFiles, undefined, 'and the second lets go in turn');
		assert.strictEqual(second._reviewReadingEvent.fire.lastCall.args[0], undefined);
	});
});

// `startDeepReview` reaches the IPC server, the prompt templates, usage and `gitlens.runPromptInAgent`, and keeps
// its channel and holds on `this` — so a fake `this` with the real channel bookkeeping. The panel never holds
// Review in Repo while a review runs (the agent may never say it is done), so a start over a running review must
// replace it cleanly.

type StartDeepReview = (args: DeepReviewArgs) => Promise<DeepReviewStartResult>;

function createDeepReviewStarter() {
	const routes = new Map<string, (rq: unknown) => Promise<unknown>>();
	const proto = GraphInspectServices.prototype as unknown as Record<string, unknown>;
	const fakeThis = {
		container: {
			ipc: {
				address: 'http://127.0.0.1:1',
				token: 'server-token',
				registerHandler: (name: string, handler: (rq: unknown) => Promise<unknown>) => {
					routes.set(name, handler);
					return { dispose: () => routes.delete(name), [Symbol.dispose]: () => routes.delete(name) };
				},
			},
			ai: { getPrompt: () => Promise.resolve({ prompt: 'review it' }) },
			usage: { track: () => Promise.resolve() },
		},
		getDeepReviewAvailability: () => Promise.resolve({ available: true }),
		_deepReview: undefined as { state: DeepReviewState; route: string } | undefined,
		_deepReviewRuns: 0,
		_deepReviewEvent: { fire: sinon.spy() },
		stopDeepReview: proto.stopDeepReview,
		openDeepReviewChannel: proto.openDeepReviewChannel,
	};
	const fn = (proto as unknown as { startDeepReview: StartDeepReview }).startDeepReview;
	return {
		fakeThis: fakeThis,
		routes: routes,
		start: (args?: Partial<DeepReviewArgs>) =>
			fn.call(fakeThis, {
				repoPath: '/r',
				anchor: { kind: 'wip', repoPath: '/r' },
				anchorKey: 'wip|/r',
				scope: wipScope({ includeUnstaged: true }),
				scopeLabel: 'working changes',
				files: ['a.ts'],
				...args,
			}),
	};
}

suite('graphInspectServices — Review in Repo starts the local channel when it hands a review over', () => {
	let executeCommand: sinon.SinonStub;

	setup(() => {
		executeCommand = sinon.stub(commands, 'executeCommand').resolves('dispatched');
	});

	teardown(() => {
		executeCommand.restore();
	});

	test('a server nothing has started yet is started then, and the review goes out on it', async () => {
		const starter = createDeepReviewStarter();
		const ipc = starter.fakeThis.container.ipc as { address?: string; ensureStarted?: () => Promise<boolean> };
		ipc.address = undefined;
		let started = 0;
		ipc.ensureStarted = () => {
			started++;
			ipc.address = 'http://127.0.0.1:1';
			return Promise.resolve(true);
		};

		assert.deepStrictEqual(await starter.start(), { ok: true });
		assert.strictEqual(started, 1);
		assert.strictEqual(starter.routes.size, 1, 'its channel is open on the server');
	});
});

suite('graphInspectServices — Review in Repo over a running review', () => {
	let executeCommand: sinon.SinonStub;

	setup(() => {
		executeCommand = sinon.stub(commands, 'executeCommand');
	});

	teardown(() => {
		executeCommand.restore();
	});

	test('a new review closes the running one, opens its own channel and goes into the same CLI session', async () => {
		executeCommand.resolves('dispatched');
		const starter = createDeepReviewStarter();

		assert.deepStrictEqual(await starter.start(), { ok: true });
		const first = starter.fakeThis._deepReview!;
		await starter.routes.get(first.route)!({ findings: [{ title: 'one' }] });
		assert.strictEqual(first.state.active && !first.state.done, true, 'running, and the agent never said done');

		assert.deepStrictEqual(await starter.start({ prompt: 'again' }), { ok: true });
		const second = starter.fakeThis._deepReview!;

		assert.notStrictEqual(second, first);
		assert.strictEqual(starter.routes.has(first.route), false, "the running review's route is closed");
		assert.deepStrictEqual(
			[first.state.active, first.state.findings.length],
			[false, 1],
			'what it reported stays with it',
		);
		assert.deepStrictEqual(
			[second.state.run, second.state.purpose, second.state.active, second.state.done],
			[2, 'review', true, false],
		);
		assert.strictEqual(starter.routes.has(second.route), true);

		// The panel hears the old run close, the new one open, and its prompt reach the agent, in that order
		const fired = starter.fakeThis._deepReviewEvent.fire.getCalls().map(c => {
			const s = c.args[0] as DeepReviewState;
			return [s.run, s.active, s.findings.length, s.handOff];
		});
		assert.deepStrictEqual(fired.slice(-3), [
			[1, false, 1, 'delivered'],
			[2, true, 0, 'pending'],
			[2, true, 0, 'delivered'],
		]);

		const sessions = executeCommand.getCalls().map(c => (c.args[1] as { session?: string }).session);
		assert.deepStrictEqual(sessions, ['review:/r', 'review:/r'], 'the next turn of the same conversation');
		assert.strictEqual(
			(executeCommand.firstCall.args[1] as { waitForRetry?: boolean }).waitForRetry,
			true,
			"the channel waits on a failed hand-over's Retry, which reports into it",
		);
	});

	test("a start still waiting on the agent picker doesn't close the review that replaced it", async () => {
		let resolveFirst: ((outcome: string) => void) | undefined;
		executeCommand.onFirstCall().returns(new Promise(resolve => (resolveFirst = resolve)));
		executeCommand.onSecondCall().resolves('dispatched');
		const starter = createDeepReviewStarter();

		const firstStart = starter.start();
		await settle();
		const first = starter.fakeThis._deepReview!;

		assert.deepStrictEqual(await starter.start(), { ok: true });
		const second = starter.fakeThis._deepReview!;
		assert.notStrictEqual(second, first);

		resolveFirst?.('cancelled');
		assert.deepStrictEqual(await firstStart, { ok: false, reason: 'cancelled' });
		assert.strictEqual(second.state.active, true, 'the new review keeps its channel');
		assert.strictEqual(starter.routes.has(second.route), true);
	});

	test('reads as starting until an agent has the prompt, and as not started while its Retry is on offer', async () => {
		let resolveDispatch: ((outcome: string) => void) | undefined;
		let onRetryOffer: ((offered: boolean) => void) | undefined;
		executeCommand.callsFake((_id: string, args: { onRetryOffer?: (offered: boolean) => void }) => {
			onRetryOffer = args.onRetryOffer;
			return new Promise(resolve => (resolveDispatch = resolve));
		});
		const starter = createDeepReviewStarter();

		const start = starter.start();
		await settle();
		const channel = starter.fakeThis._deepReview!;
		assert.strictEqual(channel.state.handOff, 'pending', 'the reader is picking an agent');

		onRetryOffer?.(true);
		assert.deepStrictEqual([channel.state.handOff, channel.state.active], ['failed', true], 'Retry waits');
		onRetryOffer?.(false);
		assert.strictEqual(channel.state.handOff, 'pending', 'retrying');

		resolveDispatch?.('dispatched');
		assert.deepStrictEqual(await start, { ok: true });
		assert.strictEqual(channel.state.handOff, 'delivered');
	});

	test('a whole review into a channel open for questions starts unstarted, and hands it back when no agent gets it', async () => {
		const ask = { focus: { findingId: 'f1', finding: 'The finding', question: 'Why?' } };
		executeCommand.onFirstCall().resolves('dispatched');
		let resolveReview: ((outcome: string) => void) | undefined;
		executeCommand.onSecondCall().returns(new Promise(resolve => (resolveReview = resolve)));
		const starter = createDeepReviewStarter();

		assert.deepStrictEqual(await starter.start(ask), { ok: true });
		const channel = starter.fakeThis._deepReview!;
		assert.deepStrictEqual([channel.state.purpose, channel.state.handOff], ['ask', 'delivered']);

		const review = starter.start();
		await settle();
		assert.strictEqual(starter.fakeThis._deepReview, channel, 'the same channel');
		assert.deepStrictEqual(
			[channel.state.purpose, channel.state.handOff],
			['review', 'pending'],
			"the questions' agent doesn't have this prompt",
		);

		resolveReview?.('cancelled');
		assert.deepStrictEqual(await review, { ok: false, reason: 'cancelled' });
		assert.deepStrictEqual(
			[channel.state.purpose, channel.state.handOff, channel.state.active],
			['ask', 'delivered', true],
			'back to taking questions, not a review that never comes',
		);
	});

	test('a question asked while the review is in its picker leaves a channel for the question, not a review stuck starting', async () => {
		const ask = { focus: { findingId: 'f1', finding: 'The finding', question: 'Why?' } };
		let resolveReview: ((outcome: string) => void) | undefined;
		let resolveQuestion: ((outcome: string) => void) | undefined;
		executeCommand.onFirstCall().returns(new Promise(resolve => (resolveReview = resolve)));
		executeCommand.onSecondCall().returns(new Promise(resolve => (resolveQuestion = resolve)));
		const starter = createDeepReviewStarter();

		const review = starter.start();
		await settle();
		const channel = starter.fakeThis._deepReview!;
		const question = starter.start(ask);
		await settle();
		assert.strictEqual(starter.fakeThis._deepReview, channel, 'the question goes into the same channel');

		// The question's picker replaced the review's
		resolveReview?.('cancelled');
		assert.deepStrictEqual(await review, { ok: false, reason: 'cancelled' });
		assert.strictEqual(channel.state.active, true, 'the question is still on its way');

		resolveQuestion?.('dispatched');
		assert.deepStrictEqual(await question, { ok: true });
		assert.deepStrictEqual(
			[channel.state.purpose, channel.state.handOff, channel.state.active],
			['ask', 'delivered', true],
		);
	});

	test('stays open under an agent reporting from the pasted prompt when the failure toast is dismissed', async () => {
		let onRetryOffer: ((offered: boolean) => void) | undefined;
		let resolveDispatch: ((outcome: string) => void) | undefined;
		executeCommand.callsFake((_id: string, args: { onRetryOffer?: (offered: boolean) => void }) => {
			onRetryOffer = args.onRetryOffer;
			return new Promise(resolve => (resolveDispatch = resolve));
		});
		const starter = createDeepReviewStarter();

		const start = starter.start();
		await settle();
		const channel = starter.fakeThis._deepReview!;
		onRetryOffer?.(true);
		// The reader pasted the copied prompt into an agent, which reports while the toast is still up
		await starter.routes.get(channel.route)!({ findings: [{ title: 'one' }] });
		assert.strictEqual(channel.state.handOff, 'delivered');

		resolveDispatch?.('failed');
		assert.deepStrictEqual(await start, { ok: false, reason: 'error' });
		assert.strictEqual(channel.state.active, true, 'its agent keeps reporting into it');
		assert.strictEqual(starter.routes.has(channel.route), true);
	});

	test("a question's answer or hand-over doesn't stand for a whole review still on its way into the channel", async () => {
		const ask = { focus: { findingId: 'f1', finding: 'The finding', question: 'Why?' } };
		let resolveReview: ((outcome: string) => void) | undefined;
		executeCommand.onFirstCall().resolves('dispatched');
		executeCommand.onSecondCall().returns(new Promise(resolve => (resolveReview = resolve)));
		executeCommand.onThirdCall().resolves('dispatched');
		const starter = createDeepReviewStarter();

		assert.deepStrictEqual(await starter.start(ask), { ok: true });
		const channel = starter.fakeThis._deepReview!;
		const review = starter.start();
		await settle();
		assert.deepStrictEqual([channel.state.purpose, channel.state.handOff], ['review', 'pending']);

		// The questions' agent answers, and another question reaches it, while the review is in the picker
		await starter.routes.get(channel.route)!({ findings: [{ findingId: 'f1', comment: 'Because.' }] });
		assert.deepStrictEqual(await starter.start(ask), { ok: true });
		assert.strictEqual(channel.state.handOff, 'pending', 'no agent has the review yet');

		resolveReview?.('failed');
		assert.deepStrictEqual(await review, { ok: false, reason: 'error' });
		assert.deepStrictEqual(
			[channel.state.purpose, channel.state.handOff, channel.state.active, channel.state.notes.length],
			['ask', 'delivered', true, 1],
			'back to taking questions, with the answer kept',
		);
	});
});

suite("graphInspectServices — a question goes only into its own review's channel", () => {
	let executeCommand: sinon.SinonStub;

	setup(() => {
		executeCommand = sinon.stub(commands, 'executeCommand').resolves('dispatched');
	});

	teardown(() => {
		executeCommand.restore();
	});

	const wip = { kind: 'wip', repoPath: '/r' };
	const commit = { kind: 'commit', repoPath: '/r', sha: 'c1' };
	// The review as the panel keys it — what tells one review's channel from another's
	const atWip = { anchor: wip, anchorKey: 'wip|/r' };
	const atCommit = { anchor: commit, anchorKey: 'commit|/r|c1' };
	const ask = { focus: { findingId: 'f1', finding: 'The finding', question: 'Why?' } };

	test('goes into the channel of the same review, which keeps running', async () => {
		const starter = createDeepReviewStarter();

		assert.deepStrictEqual(await starter.start({ ...atWip }), { ok: true });
		const review = starter.fakeThis._deepReview!;

		// The working tree selected another way still keys the same: the key decides, not the anchor's shape
		assert.deepStrictEqual(await starter.start({ ...atWip, anchor: { ...wip, sha: 'wip-row' }, ...ask }), {
			ok: true,
		});
		assert.strictEqual(starter.fakeThis._deepReview, review);
		assert.deepStrictEqual(
			[review.state.run, review.state.purpose, review.state.active],
			[1, 'review', true],
			'the review goes on in it',
		);
		assert.strictEqual(starter.routes.has(review.route), true);
	});

	test('opens a channel of its own when the open one, for questions, is of another review', async () => {
		const starter = createDeepReviewStarter();

		assert.deepStrictEqual(await starter.start({ ...atWip, ...ask }), { ok: true });
		const first = starter.fakeThis._deepReview!;
		assert.strictEqual(first.state.purpose, 'ask');

		assert.deepStrictEqual(await starter.start({ ...atCommit, ...ask }), { ok: true });
		const second = starter.fakeThis._deepReview!;
		assert.notStrictEqual(second, first);
		assert.notStrictEqual(second.route, first.route, 'the answer comes by another route');
		assert.strictEqual(starter.routes.has(first.route), false);
		assert.strictEqual(starter.routes.has(second.route), true);
		assert.deepStrictEqual(
			[second.state.run, second.state.purpose, second.state.anchor],
			[2, 'ask', commit],
			'and lands in the review it was asked on',
		);

		// Nor does a whole review of the working tree take over the commit's question channel
		assert.deepStrictEqual(await starter.start({ ...atWip }), { ok: true });
		const third = starter.fakeThis._deepReview!;
		assert.notStrictEqual(third, second);
		assert.deepStrictEqual(
			[third.state.run, third.state.purpose, third.state.anchor, second.state.active],
			[3, 'review', wip, false],
		);
	});

	test("replaces another review's running review, as a fresh run does", async () => {
		const starter = createDeepReviewStarter();

		assert.deepStrictEqual(await starter.start({ ...atWip }), { ok: true });
		const review = starter.fakeThis._deepReview!;
		await starter.routes.get(review.route)!({ findings: [{ title: 'one' }] });

		assert.deepStrictEqual(await starter.start({ ...atCommit, ...ask }), { ok: true });
		const question = starter.fakeThis._deepReview!;
		assert.notStrictEqual(question, review);
		assert.strictEqual(starter.routes.has(review.route), false, "the other review's route is closed");
		assert.deepStrictEqual(
			[review.state.active, review.state.findings.length],
			[false, 1],
			'what it reported stays with it',
		);
		assert.deepStrictEqual(
			[question.state.run, question.state.purpose, question.state.anchor, question.state.active],
			[2, 'ask', commit, true],
		);

		// The panel hears the other review's run close and the question's channel open, in that order — and
		// then the question reach the agent
		const fired = starter.fakeThis._deepReviewEvent.fire.getCalls().map(c => {
			const s = c.args[0] as DeepReviewState;
			return [s.run, s.anchor.kind, s.active, s.handOff];
		});
		assert.deepStrictEqual(fired.slice(-3), [
			[1, 'wip', false, 'delivered'],
			[2, 'commit', true, 'pending'],
			[2, 'commit', true, 'delivered'],
		]);
	});
});

// `addressReviewFindingsInChat` reaches agent detection, the prompt templates, usage and `gitlens.runPromptInAgent`
// — a fake `this` with one detected CLI agent, so it never stops at "no agents".
suite('graphInspectServices — Address with Agent says how the hand-over went', () => {
	let executeCommand: sinon.SinonStub;

	setup(() => {
		executeCommand = sinon.stub(commands, 'executeCommand');
	});

	teardown(() => {
		executeCommand.restore();
	});

	function address(): Promise<AddressReviewFindingsResult> {
		const fakeThis = {
			container: {
				agents: {
					getDetectedCliAgents: () =>
						Promise.resolve([
							{
								name: 'agent',
								displayName: 'Agent',
								detected: true,
								executable: '/usr/bin/agent',
								mcpSupported: false,
								mcpInstalled: false,
								hooksSupported: false,
								hooksInstalled: false,
							},
						]),
				},
				ai: { getPrompt: () => Promise.resolve({ prompt: 'address it' }) },
				usage: { track: () => Promise.resolve() },
			},
		};
		const fn = (
			GraphInspectServices.prototype as unknown as {
				addressReviewFindingsInChat: (args: AddressReviewFindingsArgs) => Promise<AddressReviewFindingsResult>;
			}
		).addressReviewFindingsInChat;
		return fn.call(fakeThis, {
			repoPath: '/r',
			scopeLabel: 'working changes',
			reviewMarkdown: '# Review',
			granularity: 'review',
		});
	}

	test('ok only once the prompt reached an agent', async () => {
		executeCommand.resolves('dispatched');
		assert.deepStrictEqual(await address(), { ok: true });
		assert.strictEqual(
			(executeCommand.firstCall.args[1] as { waitForRetry?: boolean }).waitForRetry,
			undefined,
			'nothing here outlives the hand-over, so a failure toast must not hold the panel',
		);
	});

	test('a backed-out picker is a cancel, not a success', async () => {
		executeCommand.resolves('cancelled');
		assert.deepStrictEqual(await address(), { ok: false, reason: 'cancelled' });
	});

	test('a failed hand-over is an error, not a success', async () => {
		executeCommand.resolves('failed');
		assert.deepStrictEqual(await address(), { ok: false, reason: 'error' });
	});
});

suite('graphInspectServices — a question to the reviewer waits in its thread', () => {
	let executeCommand: sinon.SinonStub;
	let thread: CommentThread | undefined;

	setup(() => {
		executeCommand = sinon.stub(commands, 'executeCommand');
		sinon.stub(comments, 'createCommentController').returns({
			createCommentThread: (uri: Uri, range: unknown, threadComments: unknown[]) => {
				thread = {
					uri: uri,
					range: range,
					comments: threadComments,
					dispose: () => {},
				} as unknown as CommentThread;
				return thread;
			},
			dispose: () => {},
		} as unknown as CommentController);
	});

	teardown(() => {
		disposeReviewThreads();
		sinon.restore();
		thread = undefined;
	});

	/** A starter whose instance shows one finding's thread, on the working side of an unstaged diff. */
	function createAskingStarter() {
		const starter = createDeepReviewStarter();
		const container = {
			git: {
				getRepositoryService: () => ({
					getAbsoluteUri: (path: string, repoPath: string) => Uri.file(`${repoPath}/${path}`),
				}),
			},
		} as unknown as Container;
		setReviewThreads(container, starter.fakeThis as unknown as ReviewThreadsOwner, {
			anchor: 'wip',
			repoPath: '/r',
			rhs: uncommitted,
			items: [
				{
					id: 'f1',
					findingId: 'f1',
					path: 'a.ts',
					line: 1,
					lineEnd: 1,
					severity: 'warning',
					title: 'A title',
					description: 'A description',
					state: 'open',
				},
			],
		});
		return starter;
	}

	const ask = { focus: { findingId: 'f1', finding: 'The finding', question: 'Why?' } };

	test('waits from the hand-off, and stops when it is backed out of', async () => {
		let resolveOutcome: ((outcome: string) => void) | undefined;
		executeCommand.returns(new Promise(resolve => (resolveOutcome = resolve)));
		const starter = createAskingStarter();

		const started = starter.start(ask);
		await settle();
		assert.strictEqual(thread?.label, 'Waiting for the reviewer…');

		resolveOutcome?.('cancelled');
		assert.deepStrictEqual(await started, { ok: false, reason: 'cancelled' });
		assert.strictEqual(thread?.label, 'Warning');
	});

	test('stops waiting when the channel closes before the answer', async () => {
		executeCommand.resolves('dispatched');
		const starter = createAskingStarter();

		assert.deepStrictEqual(await starter.start(ask), { ok: true });
		assert.strictEqual(thread?.label, 'Waiting for the reviewer…');

		(starter.fakeThis.stopDeepReview as () => void).call(starter.fakeThis);
		assert.strictEqual(thread?.label, 'Warning');
	});
});

suite('graphInspectServices — what the editor does belongs to one review', () => {
	let fake: ReviewOwnerFake | undefined;

	teardown(() => {
		fake?.clearReviewFiles();
		fake = undefined;
	});

	const journal = (f: ReviewOwnerFake) =>
		f._reviewThreadActionsEvent.fire.lastCall.args[0] as ReviewThreadActionsState;
	const reading = (f: ReviewOwnerFake) => f._reviewReadingEvent.fire.lastCall.args[0] as ReviewReadingState;

	test('stamps thread actions and viewed marks with the review, and starts both over for another — numbering on', async () => {
		const f = createReviewOwnerFake();
		fake = f;
		const commit = 'commit|/repo|c1';

		f.reviewThreadAction('f1', 'dismiss');
		assert.strictEqual(f._reviewThreadActionsEvent.fire.callCount, 0, 'no review yet, nothing to stamp');

		await f.setReviewFiles(reviewFiles(['a.ts']));
		f.reviewThreadAction('f1', 'dismiss');
		await f.reviewStep('markViewed', 'a.ts');
		assert.deepStrictEqual(journal(f), {
			anchor: 'wip|/repo',
			actions: [{ seq: 1, findingId: 'f1', action: 'dismiss' }],
		});
		assert.deepStrictEqual(
			{ ...reading(f), active: undefined },
			{ anchor: 'wip|/repo', active: undefined, marked: ['a.ts'], markedBefore: 0 },
		);

		// Reshaping the same review keeps its marks
		await f.setReviewFiles(reviewFiles(['b.ts', 'a.ts']));
		assert.deepStrictEqual(reading(f).marked, ['a.ts']);

		// A commit of the same repo is another review: neither the marks nor the actions carry over
		await f.setReviewFiles(reviewFiles(['a.ts'], commit));
		assert.deepStrictEqual(
			{ ...reading(f), active: undefined },
			{ anchor: commit, active: undefined, marked: [], markedBefore: 1 },
		);
		f.reviewThreadAction('f1', 'reply', 'fine');
		assert.deepStrictEqual(journal(f), {
			anchor: commit,
			actions: [{ seq: 2, findingId: 'f1', action: 'reply', text: 'fine' }],
		});
		await f.reviewStep('markViewed', 'a.ts');

		// Back on the working tree, both start over again and number on from the commit's
		await f.setReviewFiles(reviewFiles(['a.ts']));
		assert.strictEqual(reading(f).anchor, 'wip|/repo');
		assert.deepStrictEqual(reading(f).marked, []);
		assert.strictEqual(reading(f).markedBefore, 2);
		f.reviewThreadAction('f2', 'reopen');
		assert.deepStrictEqual(journal(f), {
			anchor: 'wip|/repo',
			actions: [{ seq: 3, findingId: 'f2', action: 'reopen' }],
		});
	});
});

suite('graphInspectServices — an Orient too large for the model goes to the agent', () => {
	let executeCommand: sinon.SinonStub;

	setup(() => {
		executeCommand = sinon.stub(commands, 'executeCommand');
	});

	teardown(() => {
		executeCommand.restore();
	});

	const wip = { kind: 'wip', repoPath: '/r' };
	const inRepo = { anchor: wip, anchorKey: 'wip|/r', scopeLabel: 'working changes' };
	const plan = {
		overview: 'A change',
		groups: [{ label: 'Core', kind: 'core', summary: '', files: [{ path: './src/a.ts', note: 'first' }] }],
	};

	type OrientInRepo = (
		repoPath: string,
		scope: unknown,
		prompt: string | undefined,
		args: typeof inRepo,
		signal: AbortSignal | undefined,
	) => Promise<unknown>;

	function orienter() {
		const starter = createDeepReviewStarter();
		const proto = GraphInspectServices.prototype as unknown as Record<string, unknown>;
		const fakeThis = Object.assign(starter.fakeThis, {
			container: {
				...starter.fakeThis.container,
				ai: { getPrompt: sinon.stub().resolves({ prompt: 'plan it' }) },
			},
		});
		const fn = proto.orientInRepo as OrientInRepo;
		return {
			...starter,
			fakeThis: fakeThis,
			orient: (signal?: AbortSignal) =>
				fn.call(fakeThis, '/r', wipScope({ includeUnstaged: true }), undefined, inRepo, signal),
		};
	}

	test('hands the plan to the agent in a channel of its own, and answers with what the agent posts', async () => {
		executeCommand.resolves('dispatched');
		const o = orienter();

		const result = o.orient();
		await settle();
		const channel = o.fakeThis._deepReview!;
		assert.strictEqual(channel.state.purpose, 'ask', 'no review strip for a plan');
		assert.strictEqual(
			(executeCommand.firstCall.args[1] as { session?: string }).session,
			'review:/r',
			"the review's CLI session",
		);
		assert.strictEqual(
			(o.fakeThis.container.ai.getPrompt as sinon.SinonStub).firstCall.args[0],
			'deep-review-orient',
		);

		assert.deepStrictEqual(await o.routes.get(channel.route)!({ plan: plan }), { accepted: 1 });
		const answer = (await result) as { result: { groups: { files: { path: string }[] }[] } };
		assert.deepStrictEqual(
			answer.result.groups[0].files.map(f => f.path),
			['src/a.ts'],
			'the shell path is read as the diff shows it',
		);
		assert.strictEqual(channel.state.active, true, 'the channel stays for what comes next');
	});

	test("goes into the review's open channel rather than replacing it", async () => {
		executeCommand.resolves('dispatched');
		const o = orienter();
		assert.deepStrictEqual(await o.start(), { ok: true });
		const review = o.fakeThis._deepReview!;

		const result = o.orient();
		await settle();
		assert.strictEqual(o.fakeThis._deepReview, review);
		await o.routes.get(review.route)!({ plan: plan });
		assert.ok(((await result) as { result?: unknown }).result != null);
		assert.deepStrictEqual([review.state.purpose, review.state.active], ['review', true]);
	});

	test('a backed-out picker ends it as cancelled, and a channel opened for it closes', async () => {
		executeCommand.resolves('cancelled');
		const o = orienter();
		assert.deepStrictEqual(await o.orient(), { error: { message: 'Orient was cancelled.' } });
		assert.strictEqual(o.fakeThis._deepReview?.state.active, false);
	});

	test('only a too-large refusal goes to the agent, and only for a review that said which it is', async () => {
		const proto = GraphInspectServices.prototype as unknown as Record<string, unknown>;
		const scope = wipScope({ includeUnstaged: true });
		const tooLarge = new AIError(AIErrorReason.RequestTooLarge);
		const viaAgent = { result: { overview: 'from the agent', groups: [] } };
		function orientWith(error: Error, args?: typeof inRepo) {
			const fakeThis: Record<string, unknown> = {
				_aiCancellations: new Set(),
				_graphDetailsDiffCache: new LruMap(4),
				getDiffCacheKey: proto.getDiffCacheKey,
				getNormalizedExclusions: proto.getNormalizedExclusions,
				getReviewTypeForScope: proto.getReviewTypeForScope,
				buildFileManifest: () => Promise.resolve('[]'),
				orientInRepo: sinon.stub().resolves(viaAgent),
				// The request starts at once; a refusal comes through its promise, as from `sendRequest`
				container: {
					ai: {
						actions: {
							reviewOrient: sinon.stub().callsFake(() => {
								const promise = Promise.reject(error);
								promise.catch(() => {});
								return Promise.resolve({ promise: promise });
							}),
						},
					},
				},
			};
			(fakeThis._graphDetailsDiffCache as LruMap<string, unknown>).set(
				(proto.getDiffCacheKey as (...a: unknown[]) => string).call(fakeThis, '/r', scope, undefined),
				{ diff: 'diff --git a/a b/a', message: '', context: '' },
			);
			const fn = proto.orientChanges as (...a: unknown[]) => Promise<unknown>;
			return {
				fakeThis: fakeThis,
				result: fn.call(fakeThis, '/r', scope, undefined, undefined, args, undefined),
			};
		}

		const routed = orientWith(tooLarge, inRepo);
		assert.deepStrictEqual(await routed.result, viaAgent);
		const reviewOrient = (routed.fakeThis.container as { ai: { actions: { reviewOrient: sinon.SinonStub } } }).ai
			.actions.reviewOrient;
		assert.strictEqual(
			(reviewOrient.firstCall.args[2] as { tooLargeHandled?: boolean }).tooLargeHandled,
			true,
			'the model is told the refusal is handled, so it shows no notification',
		);

		const other = orientWith(new Error('rate limited'), inRepo);
		assert.deepStrictEqual(await other.result, { error: { message: 'rate limited' } });
		assert.strictEqual((other.fakeThis.orientInRepo as sinon.SinonStub).callCount, 0);

		const unsaid = orientWith(tooLarge);
		assert.ok(((await unsaid.result) as { error?: unknown }).error != null);
		assert.strictEqual((unsaid.fakeThis.orientInRepo as sinon.SinonStub).callCount, 0);
	});

	test('no agent to hand it to leaves the decision to the caller', async () => {
		const o = orienter();
		Object.assign(o.fakeThis, { getDeepReviewAvailability: () => Promise.resolve({ available: false }) });
		assert.strictEqual(await o.orient(), undefined);
		assert.strictEqual(executeCommand.callCount, 0);
	});
});
