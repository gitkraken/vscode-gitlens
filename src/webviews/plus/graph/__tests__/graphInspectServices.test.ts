import * as assert from 'assert';
import * as sinon from 'sinon';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import type { Container } from '../../../../container.js';
import type { ConflictProgressEvent } from '../../../../plus/coretools/conflict/types.js';
import { GraphInspectServices } from '../graphInspectServices.js';
import type { GraphInspectService, ResolveProgressUpdate, ScopeSelection } from '../graphService.js';

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
