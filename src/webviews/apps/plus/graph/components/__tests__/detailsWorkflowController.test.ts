import * as assert from 'assert';
import type { ReactiveController } from 'lit';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type {
	BranchComparisonOptions,
	ComposeResult,
	ReviewResult,
	ScopeSelection,
} from '../../../../../plus/graph/graphService.js';
import { createResource } from '../../../../shared/state/resource.js';
import type { GraphCrossPaneState } from '../../graphCrossPaneState.js';
import { abortRunningOperations, createGraphCrossPaneState } from '../../graphCrossPaneState.js';
import { anchorKey } from '../anchorKey.js';
import type { DetailsResources, ResolvedServices } from '../detailsActions.js';
import { DetailsActions } from '../detailsActions.js';
import type { DetailsState } from '../detailsState.js';
import { createDetailsState } from '../detailsState.js';
import type { DetailsSelection, DetailsWorkflowHost } from '../detailsWorkflowController.js';
import { DetailsWorkflowController } from '../detailsWorkflowController.js';

/** Drain the two `.then` hops of the generate-message dispatch (RPC→map→onRunSettled). */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Convenience: anchor key for a WIP at the given repoPath. */
const wipKey = (repoPath: string) => anchorKey({ sha: uncommitted, shas: undefined, repoPath: repoPath });

function makeReviewResult(label: string): ReviewResult {
	return { result: { overview: label, focusAreas: [], mode: 'single-pass' } } as unknown as ReviewResult;
}

function makeComposeResult(label: string): ComposeResult {
	return {
		result: { commits: [], baseCommit: { sha: '0'.repeat(40), message: label } },
	} as unknown as ComposeResult;
}

/** Build a `RunningOperationBucket` entry with the given kind + result (defaults to `'complete'`). */
function makeReviewBucket(
	repoPath: string,
	result: ReviewResult,
	execState: 'generating' | 'complete' | 'backed' | 'error' | 'orphaned' = 'complete',
	prompt?: string,
): import('../detailsState.js').RunningOperationBucket {
	return {
		review: {
			kind: 'review' as const,
			anchor: { kind: 'wip' as const, repoPath: repoPath, sha: uncommitted },
			execState: execState,
			result: result,
			prompt: prompt,
		},
	};
}
function makeComposeBucket(
	repoPath: string,
	result: ComposeResult,
	execState: 'generating' | 'complete' | 'backed' | 'error' | 'orphaned' = 'complete',
	prompt?: string,
): import('../detailsState.js').RunningOperationBucket {
	return {
		compose: {
			kind: 'compose' as const,
			anchor: { kind: 'wip' as const, repoPath: repoPath, sha: uncommitted },
			execState: execState,
			result: result,
			prompt: prompt,
		},
	};
}

function createResources(): DetailsResources {
	return {
		commit: createResource(async (_signal, _repoPath: string, _sha: string) => undefined),
		wip: createResource(async (_signal, _repoPath: string) => undefined),
		compare: createResource(async (_signal, _repoPath: string, _fromSha: string, _toSha: string) => undefined),
		branchCompareSummary: createResource(
			async (
				_signal,
				_repoPath: string,
				_leftRef: string,
				_rightRef: string,
				_options: BranchComparisonOptions,
			) => undefined,
		),
		branchCompareSide: createResource(
			async (
				_signal,
				_repoPath: string,
				_leftRef: string,
				_rightRef: string,
				_side: 'ahead' | 'behind',
				_options: BranchComparisonOptions,
			) => undefined,
		),
		review: createResource(async () => ({ error: { message: 'not implemented' } })),
		compose: createResource(async () => ({ error: { message: 'not implemented' } })),
		resolve: createResource(async () => ({ error: { message: 'not implemented' } })),
		scopeFiles: createResource(async (_signal, _repoPath: string, _scope: ScopeSelection) => []),
	};
}

function createServices(overrides?: {
	reviewChanges?: (...args: unknown[]) => Promise<ReviewResult>;
	composeChanges?: (...args: unknown[]) => Promise<ComposeResult>;
}): ResolvedServices {
	const noopUnsubscribe = () => {};
	return {
		repository: {
			onRepositoryChanged: () => noopUnsubscribe,
			onRepositoryWorkingChanged: () => noopUnsubscribe,
		},
		graphInspect: {
			reviewChanges: overrides?.reviewChanges ?? (async () => ({ error: { message: 'not implemented' } })),
			composeChanges: overrides?.composeChanges ?? (async () => ({ error: { message: 'not implemented' } })),
		},
	} as unknown as ResolvedServices;
}

class FakeHost implements DetailsWorkflowHost {
	repoPath?: string;
	readonly crossPaneState: GraphCrossPaneState = createGraphCrossPaneState();
	private _graphRepoPath: string | undefined;
	private _selection: DetailsSelection;
	private _controllers: ReactiveController[] = [];

	/** Captures `applyGeneratedCommitMessage` calls so generate-message tests can assert routing. */
	readonly generatedMessages: Array<{ repoPath: string; message: string }> = [];

	updateComplete: Promise<boolean> = Promise.resolve(true);

	constructor(initial: { repoPath?: string; graphRepoPath?: string; selection?: DetailsSelection }) {
		this.repoPath = initial.repoPath;
		this._graphRepoPath = initial.graphRepoPath;
		this._selection = initial.selection ?? {
			sha: initial.repoPath != null ? 'abc' : undefined,
			shas: undefined,
			repoPath: initial.repoPath,
		};
	}

	setRepoPath(path: string | undefined): void {
		this.repoPath = path;
		this._selection = { ...this._selection, repoPath: path };
	}
	setGraphRepoPath(path: string | undefined): void {
		this._graphRepoPath = path;
	}

	graphRepoPath(): string | undefined {
		return this._graphRepoPath;
	}
	isWipSelection(): boolean {
		return this._selection.sha === uncommitted;
	}
	currentSelection(): DetailsSelection {
		return this._selection;
	}
	applyGeneratedCommitMessage(repoPath: string, message: string): void {
		this.generatedMessages.push({ repoPath: repoPath, message: message });
	}

	addController(c: ReactiveController): void {
		this._controllers.push(c);
	}
	removeController(c: ReactiveController): void {
		const i = this._controllers.indexOf(c);
		if (i >= 0) {
			this._controllers.splice(i, 1);
		}
	}
	requestUpdate(): void {}

	connectAll(): void {
		for (const c of this._controllers) {
			c.hostConnected?.();
		}
	}
	disconnectAll(): void {
		for (const c of this._controllers) {
			c.hostDisconnected?.();
		}
	}
	tickHostUpdate(): void {
		for (const c of this._controllers) {
			c.hostUpdate?.();
		}
	}
}

function setup(initial: { repoPath?: string; graphRepoPath?: string }): {
	host: FakeHost;
	state: DetailsState;
	actions: DetailsActions;
	controller: DetailsWorkflowController;
} {
	const host = new FakeHost(initial);
	const state = createDetailsState();
	const actions = new DetailsActions(state, createServices(), createResources());
	const controller = new DetailsWorkflowController(host, actions);
	host.connectAll();
	// First post-connect hostUpdate establishes the `_lastSeenGraphRepoPath` baseline
	// so subsequent ticks can detect transitions. Mirrors real Lit lifecycle (hostConnected
	// then hostUpdate before next render).
	host.tickHostUpdate();
	return { host: host, state: state, actions: actions, controller: controller };
}

function enterMockMode(state: DetailsState, repoPath: string, sha: string): void {
	state.activeMode.set('compose');
	state.activeModeContext.set('wip');
	state.activeModeRepoPath.set(repoPath);
	state.activeModeSha.set(sha);
}

suite('DetailsWorkflowController.hostUpdate — repo-switch handling', () => {
	test('first hostUpdate after connect does not exit mode (no prior graph repo)', () => {
		const host = new FakeHost({ repoPath: '/A', graphRepoPath: '/A' });
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());
		new DetailsWorkflowController(host, actions);

		// Pre-set an active mode BEFORE the first hostUpdate to verify it isn't spuriously
		// exited just because `_lastSeenGraphRepoPath` is transitioning from undefined → '/A'.
		enterMockMode(state, '/A', uncommitted);

		host.connectAll();
		host.tickHostUpdate();

		assert.strictEqual(state.activeMode.get(), 'compose');
		assert.strictEqual(state.activeModeRepoPath.get(), '/A');
	});

	test('graph-repo switch with active mode in different repo exits the mode', () => {
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		enterMockMode(state, '/A', uncommitted);

		host.setGraphRepoPath('/B');
		host.tickHostUpdate();

		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(state.activeModeRepoPath.get(), undefined);
	});

	test('graph-repo switch with active mode in same repo does not exit', () => {
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		enterMockMode(state, '/A', uncommitted);

		// Edge case — graph repo "switches" to the same value (shouldn't happen in practice
		// but guards against equality false positives).
		host.setGraphRepoPath('/A');
		host.tickHostUpdate();

		assert.strictEqual(state.activeMode.get(), 'compose');
		assert.strictEqual(state.activeModeRepoPath.get(), '/A');
	});

	test('graph-repo switch with no active mode is a no-op for state', () => {
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		host.setGraphRepoPath('/B');
		host.tickHostUpdate();

		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(state.activeModeRepoPath.get(), undefined);
	});

	test('panel render-target switch (host.repoPath) does not by itself exit review/compose', () => {
		// Worktree row jump: same graph repo, different worktree path. `hostUpdate` Trigger 2
		// must NOT touch activeMode — the actual hide on row switch happens through
		// `willUpdate → switchAnchorWithinMode`, not here. Trigger 2 only re-wires the repo
		// subscription. (Compare stays sticky via a separate branch.)
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/parent' });
		enterMockMode(state, '/A', uncommitted); // compose on /A

		host.setRepoPath('/B');
		host.tickHostUpdate();

		assert.strictEqual(state.activeMode.get(), 'compose', 'hostUpdate alone should NOT exit mode');
		assert.strictEqual(
			state.activeModeRepoPath.get(),
			'/A',
			'activeModeRepoPath untouched until switchAnchorWithinMode hides',
		);
	});

	test('graph-repo switch hides an engaged review/compose mode (registry already cleared)', () => {
		// Trigger 1 path: graph-repo switcher fires. `cancelAllRunningOperations` clears the
		// registry; then for review/compose we `hideMode` (state-clear, no destroy) so the panel
		// doesn't continue rendering against a now-empty bucket.
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		enterMockMode(state, '/A', uncommitted);

		host.setGraphRepoPath('/B');
		host.tickHostUpdate();

		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(state.activeModeRepoPath.get(), undefined);
	});

	test('panel render-target switch with no active mode does not call exitMode', () => {
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/parent' });
		// No mode set.
		host.setRepoPath('/B');
		host.tickHostUpdate();

		// Mode-related state should remain idle.
		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(state.activeModeRepoPath.get(), undefined);
	});

	test('panel render-target switch clears webview enrichment caches', () => {
		const { host, actions } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		// Seed both caches with prior-repo entries.
		actions['_commitEnrichmentCache'].set('sha1:/A', { commit: undefined });
		actions['_wipEnrichmentCache'].set('main:/A', {});
		assert.strictEqual(actions['_commitEnrichmentCache'].size, 1);
		assert.strictEqual(actions['_wipEnrichmentCache'].size, 1);

		host.setRepoPath('/B');
		host.tickHostUpdate();

		assert.strictEqual(actions['_commitEnrichmentCache'].size, 0);
		assert.strictEqual(actions['_wipEnrichmentCache'].size, 0);
	});
});

suite('DetailsWorkflowController.toggleMode — stale-on-re-entry', () => {
	test('compose: re-entering WIP in a different worktree resets the prior result', () => {
		// WIP A (worktree /A) → ran compose → exited → click WIP B (worktree /B) → click Compose.
		// Both rows have sha === uncommitted; only repoPath differs. Without repoPath in the
		// staleness key, B's re-entry would render A's compose result.
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/parent',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();

		// Pre-set branchCommits so toggleMode's WIP-side fetchBranchCommits gate is skipped
		// (services.graphInspect is not mocked).
		state.branchCommits.set([]);

		// Simulate "ran compose for WIP A": resource holds A's value, fetched-for marker is A's key.
		const priorResult = { error: { message: 'WIP A compose result' } };
		actions.resources.compose.mutate(priorResult);
		controller['_composeFetchedForSelection'] = wipKey('/A');

		assert.notStrictEqual(actions.resources.compose.value.get(), undefined);

		// Switch to WIP B and re-enter compose.
		host.setRepoPath('/B');
		host.tickHostUpdate();
		controller.toggleMode('compose', { sha: uncommitted, shas: undefined, repoPath: '/B' });

		assert.strictEqual(
			actions.resources.compose.value.get(),
			undefined,
			'compose resource should reset when re-entering for a WIP row in a different worktree',
		);
		assert.strictEqual(controller['_composeFetchedForSelection'], undefined);
	});

	test('review: re-entering WIP in a different worktree resets the prior result', () => {
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/parent',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();

		state.branchCommits.set([]);

		const priorResult = { error: { message: 'WIP A review result' } };
		actions.resources.review.mutate(priorResult);
		controller['_reviewFetchedForSelection'] = wipKey('/A');

		assert.notStrictEqual(actions.resources.review.value.get(), undefined);

		host.setRepoPath('/B');
		host.tickHostUpdate();
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/B' });

		assert.strictEqual(
			actions.resources.review.value.get(),
			undefined,
			'review resource should reset when re-entering for a WIP row in a different worktree',
		);
		assert.strictEqual(controller['_reviewFetchedForSelection'], undefined);
	});

	test('compose: re-entering for the same WIP selection projects a saved registry result back into the resource', () => {
		// Under the new model, results live on the registry entry; the resource is a projection.
		// Re-entering an anchor with a complete entry mutates the registered result back into the
		// resource so the panel re-renders without re-running.
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/parent',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();

		state.branchCommits.set([]);

		const priorResult = makeComposeResult('WIP A compose result');
		host.crossPaneState.runningOperations.set(new Map([[wipKey('/A'), makeComposeBucket('/A', priorResult)]]));
		controller['_composeFetchedForSelection'] = wipKey('/A');

		controller.toggleMode('compose', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(actions.resources.compose.value.get(), priorResult);
		assert.strictEqual(controller['_composeFetchedForSelection'], wipKey('/A'));
	});
});

suite('DetailsWorkflowController — running-operations registry', () => {
	test('runReview registers a generating entry immediately and transitions to complete on resolve', async () => {
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/A',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const expected = makeReviewResult('runReview-success');
		const actions = new DetailsActions(
			state,
			createServices({ reviewChanges: async () => expected }),
			createResources(),
		);
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();

		state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.runReview('/A', undefined, undefined);

		// Immediately after dispatch — entry should be 'generating'.
		const generatingEntry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.ok(generatingEntry, 'entry registered synchronously on dispatch');
		assert.strictEqual(generatingEntry.execState, 'generating');
		assert.strictEqual(generatingEntry.result, undefined);
		assert.ok(generatingEntry.abortController, 'abortController held on the entry');
		assert.ok(generatingEntry.promise, 'in-flight promise held on the entry');

		// Flush so the RPC's microtask + onRunSettled settle.
		await flush();

		const completed = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.ok(completed);
		assert.strictEqual(completed.execState, 'complete');
		assert.strictEqual(completed.result, expected);
	});

	test('cancelOperation aborts a generating run and preserves the entry in backed+no-result', () => {
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/A',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		// Slow fetcher — won't resolve during the test.
		const actions = new DetailsActions(
			state,
			createServices({ reviewChanges: () => new Promise(() => {}) }),
			createResources(),
		);
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();

		state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.runReview('/A', 'my prompt', undefined);
		const entryAbort = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review?.abortController;
		assert.ok(entryAbort);
		assert.strictEqual(entryAbort.signal.aborted, false);

		controller.cancelOperation('review');

		// Run aborted, but entry kept in backed+no-result so the run's `prompt` survives for the
		// AI-input seed on the next idle render. Avoids forcing the user to retype after a cancel.
		assert.strictEqual(entryAbort.signal.aborted, true, 'controller aborted');
		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.execState, 'backed', "entry kept in 'backed'");
		assert.strictEqual(entry?.result, undefined, 'no result');
		assert.strictEqual(entry?.prompt, 'my prompt', 'prompt preserved on entry for AI input seed');
	});

	test('toggle-out (toggleMode early-exit on review/compose) leaves the registry entry intact', () => {
		// User toggles Review off while a complete operation is registered — hideMode path:
		// activeMode clears, registry entry stays.
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const result = makeReviewResult('keep-across-toggle');
		host.crossPaneState.runningOperations.set(new Map([[wipKey('/A'), makeReviewBucket('/A', result)]]));
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), null, 'panel hidden');
		const surviving = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.ok(surviving, 'entry persists through toggle-out');
		assert.strictEqual(surviving.result, result);
	});

	test('toggleMode tail projects a complete result into the resource on re-entry', () => {
		const { host, state, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.branchCommits.set([]);
		const result = makeReviewResult('restored');
		host.crossPaneState.runningOperations.set(new Map([[wipKey('/A'), makeReviewBucket('/A', result)]]));

		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), 'review');
		assert.strictEqual(actions.resources.review.value.get(), result);
	});

	test('toggleMode tail leaves the resource idle when entry is generating (panel reads execState)', () => {
		const { host, state, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.branchCommits.set([]);
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('unused'), 'generating')]]),
		);

		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), 'review');
		assert.strictEqual(actions.resources.review.value.get(), undefined, 'projection leaves resource idle');
	});

	test('review.back transitions complete → backed; forward flips backed → complete; prompt survives both', () => {
		const { host, state, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const result = makeReviewResult('back-fwd');
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', result, 'complete', 'my review prompt')]]),
		);
		actions.resources.review.mutate(result);
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.review.back();
		const backed = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(backed?.execState, 'backed');
		assert.strictEqual(backed?.prompt, 'my review prompt', 'prompt preserved through back()');

		controller.review.forward();
		const restored = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(restored?.execState, 'complete');
		assert.strictEqual(restored?.prompt, 'my review prompt', 'prompt preserved through forward()');
	});

	test('toggleMode early-exit on a backed entry destroys it (Back-then-close gate)', () => {
		const { host, state, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		// User had a complete review on /A, clicked Back → execState becomes 'backed'.
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('to-destroy'), 'backed')]]),
		);
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		// Seed back-snapshot so destroy-clears can be observed.
		controller['_reviewBackSnapshot'] = makeReviewResult('back-snap');
		state.reviewForwardAvailable.set(true);

		// Toggle Review off while engaged on 'backed' — should destroy.
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(host.crossPaneState.runningOperations.get().size, 0, 'entry destroyed');
		assert.strictEqual(controller['_reviewBackSnapshot'], undefined, 'back snapshot cleared');
		assert.strictEqual(state.reviewForwardAvailable.get(), false);
		assert.strictEqual(actions.resources.review.value.get(), undefined);
	});

	test('switchAnchorWithinMode invalidates the controller-level back snapshots (no cross-anchor contamination)', () => {
		// Regression: `review.back()` snapshots the result into a controller field for `forward()`
		// to restore. If the user back-then-switches to a different anchor before clicking forward,
		// the snapshot would otherwise leak across anchors and a Forward on the new anchor would
		// re-mutate it with the prior anchor's result. switchAnchorWithinMode must invalidate.
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.branchCommits.set([]);

		// Plant snapshots as if the user had just clicked Back on the engaged anchor.
		controller['_reviewBackSnapshot'] = makeReviewResult('A-review-back-snap');
		controller['_composeBackSnapshot'] = makeComposeResult('A-compose-back-snap');
		state.reviewForwardAvailable.set(true);
		state.composeForwardAvailable.set(true);
		state.reviewBackPreview.set({ findingCount: 1, fileCount: 1 });
		state.composeBackPreview.set({ commitCount: 1, fileCount: 1 });

		// Engaged on /A; selection moves to /B.
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.switchAnchorWithinMode({ sha: uncommitted, shas: undefined, repoPath: '/B' });

		assert.strictEqual(controller['_reviewBackSnapshot'], undefined, 'review back-snapshot cleared');
		assert.strictEqual(controller['_composeBackSnapshot'], undefined, 'compose back-snapshot cleared');
		assert.strictEqual(state.reviewForwardAvailable.get(), false);
		assert.strictEqual(state.composeForwardAvailable.get(), false);
		assert.strictEqual(state.reviewBackPreview.get(), undefined);
		assert.strictEqual(state.composeBackPreview.get(), undefined);
	});

	test('switchAnchorWithinMode hides mode + leaves the prior generating entry intact', () => {
		// User started a Review on /A (generating). Selection changes to /B (a different WIP).
		// The mode HIDES (does not follow the new selection); the /A entry persists so the run
		// keeps going and can be resumed via the remembered-mode restore path when the user
		// returns to /A.
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/parent',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();
		state.branchCommits.set([]);

		// Manually plant a generating entry for /A (simulating a runReview already in flight).
		const generatingCtl = new AbortController();
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						review: {
							kind: 'review' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'generating' as const,
							abortController: generatingCtl,
							promise: new Promise<ReviewResult>(() => {}),
						},
					},
				],
			]),
		);
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		host.setRepoPath('/B');
		controller.switchAnchorWithinMode({ sha: uncommitted, shas: undefined, repoPath: '/B' });

		// /A's entry must survive (run keeps going).
		const aEntry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.ok(aEntry, "/A's generating entry persists across anchor switch");
		assert.strictEqual(aEntry.execState, 'generating');
		assert.strictEqual(generatingCtl.signal.aborted, false, "the in-flight run isn't aborted");
		// /B is NOT auto-engaged — mode hides on switch; user has to toggle in (or rely on the
		// remembered-mode restore on a return visit).
		assert.strictEqual(host.crossPaneState.runningOperations.get().get(wipKey('/B')), undefined);
		assert.strictEqual(state.activeMode.get(), null, 'mode hides on row switch');
		assert.strictEqual(state.activeModeRepoPath.get(), undefined, 'active anchor cleared on hide');
	});

	test('both kinds (review + compose) coexist on the same anchor', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.branchCommits.set([]);
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						...makeReviewBucket('/A', makeReviewResult('R'), 'complete'),
						...makeComposeBucket('/A', makeComposeResult('C'), 'generating'),
					},
				],
			]),
		);
		// Toggle into Review on /A — should project the complete review result.
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		const bucket = host.crossPaneState.runningOperations.get().get(wipKey('/A'));
		assert.ok(bucket?.review, 'review entry survives');
		assert.ok(bucket?.compose, 'compose entry survives alongside review');
		assert.strictEqual(bucket.review.execState, 'complete');
		assert.strictEqual(bucket.compose.execState, 'generating');
	});

	test('orphanRunningOperationsForRepoPaths marks matching entries as orphaned + aborts generating', () => {
		const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const generatingCtl = new AbortController();
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/worktree-X'),
					{
						compose: {
							kind: 'compose' as const,
							anchor: { kind: 'wip' as const, repoPath: '/worktree-X', sha: uncommitted },
							execState: 'generating' as const,
							abortController: generatingCtl,
							promise: new Promise<ComposeResult>(() => {}),
						},
					},
				],
				[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('keep'))],
			]),
		);

		controller.orphanRunningOperationsForRepoPaths(new Set(['/worktree-X']));

		const registry = host.crossPaneState.runningOperations.get();
		assert.strictEqual(registry.size, 2, 'entries marked, not removed');
		assert.strictEqual(registry.get(wipKey('/worktree-X'))?.compose?.execState, 'orphaned');
		assert.strictEqual(registry.get(wipKey('/A'))?.review?.execState, 'complete');
		assert.strictEqual(generatingCtl.signal.aborted, true, 'generating-entry abort fired');
	});

	test('cancelAllRunningOperations (repo-switch) aborts every entry and clears the registry', () => {
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const ctlA = new AbortController();
		const ctlW = new AbortController();
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						review: {
							kind: 'review' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'generating' as const,
							abortController: ctlA,
							promise: new Promise<ReviewResult>(() => {}),
						},
					},
				],
				[
					wipKey('/worktree'),
					{
						compose: {
							kind: 'compose' as const,
							anchor: { kind: 'wip' as const, repoPath: '/worktree', sha: uncommitted },
							execState: 'generating' as const,
							abortController: ctlW,
							promise: new Promise<ComposeResult>(() => {}),
						},
					},
				],
			]),
		);
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		host.setGraphRepoPath('/Different');
		host.tickHostUpdate();

		assert.strictEqual(host.crossPaneState.runningOperations.get().size, 0);
		assert.strictEqual(ctlA.signal.aborted, true);
		assert.strictEqual(ctlW.signal.aborted, true);
		assert.strictEqual(state.activeMode.get(), null);
	});

	test('toggleMode entry remembers the active mode for the anchor', () => {
		const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.toggleMode('compose', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(
			controller.getRememberedMode({ sha: uncommitted, shas: undefined, repoPath: '/A' }),
			'compose',
		);
	});

	test('toggleMode same-mode hide forgets the remembered mode (explicit user dismiss)', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });
		assert.strictEqual(
			controller.getRememberedMode({ sha: uncommitted, shas: undefined, repoPath: '/A' }),
			'review',
		);

		// Second toggleMode with the same mode = hide path → forget.
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(
			controller.getRememberedMode({ sha: uncommitted, shas: undefined, repoPath: '/A' }),
			undefined,
			'remembered mode forgotten on explicit close',
		);
	});

	test('destroyEngagedOperation (Back-then-close) forgets the remembered mode', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const result = makeReviewResult('destroy-forgets');
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						review: {
							kind: 'review' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'backed' as const,
							result: result,
						},
					},
				],
			]),
		);
		host.crossPaneState.lastModeByAnchor.set(new Map([[wipKey('/A'), 'review']]));
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		// Same-mode click on a 'backed' entry routes through destroyEngagedOperation.
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(host.crossPaneState.runningOperations.get().size, 0, 'entry destroyed');
		assert.strictEqual(
			controller.getRememberedMode({ sha: uncommitted, shas: undefined, repoPath: '/A' }),
			undefined,
			'remembered mode forgotten on destroy',
		);
	});

	test('switchAnchorWithinMode hides; prior anchor keeps its remembered mode, new anchor stays unremembered', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });
		assert.strictEqual(
			controller.getRememberedMode({ sha: uncommitted, shas: undefined, repoPath: '/A' }),
			'review',
		);

		// Switch to a commit anchor — mode hides, no auto-transfer.
		controller.switchAnchorWithinMode({ sha: 'commit-b', shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), null, 'mode hides on row switch');
		assert.strictEqual(
			controller.getRememberedMode({ sha: 'commit-b', shas: undefined, repoPath: '/A' }),
			undefined,
			'new anchor is NOT auto-remembered (no toggleMode on switch)',
		);
		assert.strictEqual(
			controller.getRememberedMode({ sha: uncommitted, shas: undefined, repoPath: '/A' }),
			'review',
			'prior WIP anchor still remembers — return visit will auto-restore',
		);
	});

	test('cancelAllRunningOperations clears the remembered-mode map', () => {
		const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		host.crossPaneState.lastModeByAnchor.set(
			new Map([
				[wipKey('/A'), 'review'],
				[wipKey('/B'), 'compose'],
			]),
		);

		controller['cancelAllRunningOperations']();

		assert.strictEqual(host.crossPaneState.lastModeByAnchor.get().size, 0);
	});

	test('hostDisconnected does NOT abort or clear the registry (preserves across details-pane visibility toggle)', () => {
		const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const generatingCtl = new AbortController();
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						review: {
							kind: 'review' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'generating' as const,
							abortController: generatingCtl,
							promise: new Promise<ReviewResult>(() => {}),
						},
					},
				],
			]),
		);

		controller.hostDisconnected();

		assert.strictEqual(host.crossPaneState.runningOperations.get().size, 1, 'registry survives panel disconnect');
		assert.strictEqual(generatingCtl.signal.aborted, false, 'in-flight run keeps going across disconnect');
	});
});

suite('DetailsActions.clearEnrichmentCaches', () => {
	test('aborts in-flight branch-commits controllers but leaves enrichment controller alone', () => {
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());

		const branchCommits = new AbortController();
		const branchLoadMore = new AbortController();
		const enrichment = new AbortController();
		actions['_branchCommitsController'] = branchCommits;
		actions['_branchCommitsLoadMoreController'] = branchLoadMore;
		actions['_enrichmentController'] = enrichment;

		actions.clearEnrichmentCaches();

		assert.strictEqual(branchCommits.signal.aborted, true);
		assert.strictEqual(branchLoadMore.signal.aborted, true);
		// _enrichmentController is intentionally NOT aborted — see clearEnrichmentCaches doc.
		// fetchDetails's resetEnrichment aborts the prior controller when a new selection
		// arrives, and the WIP enrichment legs are guarded by enrichmentGuard + signal checks.
		// Aborting here can race with a freshly-created controller for the new selection.
		assert.strictEqual(enrichment.signal.aborted, false);
	});

	test('clears both LRU caches', () => {
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());

		actions['_commitEnrichmentCache'].set('sha1:/A', { commit: undefined });
		actions['_wipEnrichmentCache'].set('main:/A', {});
		assert.strictEqual(actions['_commitEnrichmentCache'].size, 1);
		assert.strictEqual(actions['_wipEnrichmentCache'].size, 1);

		actions.clearEnrichmentCaches();

		assert.strictEqual(actions['_commitEnrichmentCache'].size, 0);
		assert.strictEqual(actions['_wipEnrichmentCache'].size, 0);
	});
});

suite('DetailsWorkflowController — R1 fix regressions', () => {
	test('review.back() without a success-status resource is a no-op (no stuck-backed entry)', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		// Plant a registry entry in `'complete'` state but DO NOT mutate the resource — the
		// resource is in its initial idle state, status !== 'success'.
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('orig'), 'complete')]]),
		);
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.review.back();

		// Expectation: no `'backed'` transition because no snapshot could be captured.
		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.execState, 'complete', "entry stays 'complete' when no snapshot captured");
		assert.strictEqual(controller['_reviewBackSnapshot'], undefined);
		assert.strictEqual(state.reviewForwardAvailable.get(), false);
	});

	test('compose.back() without a success-status resource is a no-op', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeComposeBucket('/A', makeComposeResult('orig'), 'complete')]]),
		);
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.compose.back();

		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(entry?.execState, 'complete', "entry stays 'complete' when no snapshot captured");
		assert.strictEqual(controller['_composeBackSnapshot'], undefined);
		assert.strictEqual(state.composeForwardAvailable.get(), false);
	});

	test("hideMode clears the exiting mode's error-recovery state only (other kind preserved)", () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		// Plant error-recovery state for BOTH kinds via the typed test-helpers so the property
		// shapes match. Then hide while in review mode — only review's state should clear.
		// (Prompts live on the per-anchor registry entry now, not on global signals — so hideMode
		// doesn't touch them; entry preservation is covered by the back/backFromError tests below.)
		const reviewSnap = makeReviewResult('review-snap');
		const composeSnap = makeComposeResult('compose-snap');
		state.reviewPreErrorValue.set(reviewSnap);
		state.composePreErrorValue.set(composeSnap);
		state.composeLastFailedAction.set('commit-all');

		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		(
			controller as unknown as {
				hideMode: (s: { sha: string; shas?: string[]; repoPath: string }) => void;
			}
		).hideMode({ sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.reviewPreErrorValue.get(), undefined, 'review recovery cleared');
		assert.strictEqual(state.composePreErrorValue.get(), composeSnap, 'compose recovery preserved');
		assert.strictEqual(state.composeLastFailedAction.get(), 'commit-all', 'compose last-action preserved');
	});

	test('onRunSettled bails after hostDisconnected (no write to disposed resources)', async () => {
		const { host, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const anchor = { kind: 'wip' as const, repoPath: '/A', sha: uncommitted };
		const abortController = new AbortController();
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						review: {
							kind: 'review' as const,
							anchor: anchor,
							execState: 'generating' as const,
							abortController: abortController,
							promise: new Promise<ReviewResult>(() => {}),
						},
					},
				],
			]),
		);

		host.disconnectAll();

		const result = makeReviewResult('post-disconnect');
		// Drive onRunSettled directly with a freshly resolved value — verifies the `_disconnected`
		// guard short-circuits before any registry/resource write.
		controller['onRunSettled']('review', anchor, abortController, result, undefined);

		// Resource value remains undefined because the settled callback bailed out
		assert.strictEqual(actions.resources.review.value.get(), undefined);
		// Registry entry is still 'generating' — settle never registered the 'complete' transition
		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.execState, 'generating');
	});

	test('hostConnected resets the _disconnected flag (controller can be re-used)', () => {
		const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		host.disconnectAll();
		assert.strictEqual(controller['_disconnected'], true, 'disconnect sets the flag');

		host.connectAll();
		assert.strictEqual(controller['_disconnected'], false, 'reconnect clears the flag');
	});

	test('compose.backFromError lands on backed scope picker with prior result and preserves entry prompt', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		// The error entry carries the prompt of the run that errored. `composePreErrorValue`
		// holds the prior successful plan that we want Go Back to surface via the Resume bar.
		const errorResult: ComposeResult = { error: { message: 'apply failed' } };
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeComposeBucket('/A', errorResult, 'error', 'user prompt')]]),
		);
		const priorPlan = makeComposeResult('compose-snap');
		state.composePreErrorValue.set(priorPlan);
		state.composeLastFailedAction.set('commit-all');
		state.composeLastCommitAllIncludedIds.set(['c1']);

		controller.compose.backFromError();

		// Entry is repointed at the prior plan in `'backed'`; the spread preserves `prompt` so the
		// AI input seeds with the run's prompt when the panel re-renders idle.
		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(entry?.execState, 'backed', 'entry moved to backed');
		assert.strictEqual(entry?.result, priorPlan, 'entry result is the prior plan, not the error sentinel');
		assert.strictEqual(entry?.prompt, 'user prompt', 'prompt preserved on entry through backFromError spread');
		// Resume affordances are wired so the user can restore the prior plan with one click.
		assert.strictEqual(controller['_composeBackSnapshot'], priorPlan, 'back-snapshot holds prior plan');
		assert.strictEqual(state.composeForwardAvailable.get(), true, 'Resume bar available');
		assert.ok(state.composeBackPreview.get() != null, 'back-preview populated');
		// Error-recovery state is consumed; action tracking cleared so a stale `commit-all` can't
		// steer a later `retryFromError`.
		assert.strictEqual(state.composePreErrorValue.get(), undefined, 'pre-error value cleared');
		assert.strictEqual(state.composeLastFailedAction.get(), undefined, 'last action cleared');
		assert.strictEqual(state.composeLastCommitAllIncludedIds.get(), undefined, 'commit ids cleared');
	});

	test('compose.backFromError with no prior plan keeps the entry in backed+no-result, preserving the prompt', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		const errorResult: ComposeResult = { error: { message: 'first attempt failed' } };
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeComposeBucket('/A', errorResult, 'error', 'first prompt')]]),
		);
		// No `composePreErrorValue` — first attempt errored, nothing to Resume to.

		controller.compose.backFromError();

		// Entry transitions to `'backed'` with no result so the run's `prompt` survives — the
		// AI input re-seeds with "first prompt" on the next idle render. No Resume bar (no plan
		// to restore). Same shape as the Cancel button and `{cancelled:true}` sentinel paths.
		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(entry?.execState, 'backed', "entry moved to 'backed'");
		assert.strictEqual(entry?.result, undefined, 'entry result cleared (was the error sentinel)');
		assert.strictEqual(entry?.prompt, 'first prompt', 'prompt preserved on entry for AI input seed');
		assert.strictEqual(controller['_composeBackSnapshot'], undefined, 'no back-snapshot');
		assert.strictEqual(state.composeForwardAvailable.get(), false, 'no Resume bar');
	});

	test('compose.cancelOperation aborts the run but preserves the entry+prompt in backed+no-result', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		const abortController = new AbortController();
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						compose: {
							kind: 'compose' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'generating' as const,
							abortController: abortController,
							promise: new Promise<ComposeResult>(() => {}),
							prompt: 'my prompt',
						},
					},
				],
			]),
		);

		controller.cancelOperation('compose');

		// Run aborted, entry preserved in backed+no-result, prompt intact for AI-input seed.
		assert.strictEqual(abortController.signal.aborted, true, 'in-flight run aborted');
		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(entry?.execState, 'backed', "entry kept in 'backed'");
		assert.strictEqual(entry?.result, undefined, 'no result');
		assert.strictEqual(entry?.prompt, 'my prompt', 'prompt preserved on entry');
		assert.strictEqual(entry?.abortController, undefined, 'live-run fields cleared');
		assert.strictEqual(entry?.promise, undefined, 'live-run fields cleared');
		assert.strictEqual(controller['_composeBackSnapshot'], undefined, 'no back-snapshot');
		assert.strictEqual(state.composeForwardAvailable.get(), false, 'no Resume bar');
	});

	test('dispatchOperation seeds the entry prompt and survives the generating→complete transition', async () => {
		const { host, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		actions.state.activeMode.set('compose');
		actions.state.activeModeContext.set('wip');
		actions.state.activeModeRepoPath.set('/A');
		actions.state.activeModeSha.set(uncommitted);
		// `runCompose` early-returns without a scope — seed one so dispatch fires.
		actions.state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: true, includeShas: [] });

		const settledResult = makeComposeResult('plan-X');
		// Stub `startCompose` so dispatchOperation drives a synchronous resolved path.
		(actions as unknown as { startCompose: (...args: unknown[]) => Promise<ComposeResult> }).startCompose = () =>
			Promise.resolve(settledResult);

		controller.runCompose('/A', 'my prompt', undefined, undefined);

		// Immediately after dispatch the entry is `'generating'` with the prompt set.
		const generating = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(generating?.execState, 'generating', 'entry in generating');
		assert.strictEqual(generating?.prompt, 'my prompt', 'prompt set on entry at dispatch');

		// Let the promise settle and the `onRunSettled` registration run.
		await new Promise(resolve => setTimeout(resolve, 0));

		const complete = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(complete?.execState, 'complete', 'entry transitioned to complete');
		assert.strictEqual(complete?.prompt, 'my prompt', 'prompt carried through onRunSettled');
	});
});

suite('DetailsWorkflowController.compare lifecycle', () => {
	test('openCompare with explicit refs flips compareSheetOpen and seeds branchCompare state', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		assert.strictEqual(state.compareSheetOpen.get(), false);
		assert.strictEqual(state.compareAsPanel.get(), false);

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);

		assert.strictEqual(state.compareSheetOpen.get(), true);
		assert.strictEqual(state.branchCompareLeftRef.get(), 'main');
		assert.strictEqual(state.branchCompareRightRef.get(), 'feature');
	});

	test('openCompare while already-open with no overrides is a no-op (preserves in-flight comparison)', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		// Simulate the user mutating the comparison after open — pick a non-default tab so the
		// no-op assertion below actually exercises preservation (not just equality with the default).
		state.branchCompareActiveTab.set('behind');

		controller.openCompare({ sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.branchCompareLeftRef.get(), 'main');
		assert.strictEqual(state.branchCompareActiveTab.get(), 'behind', 'tab selection survives a no-op re-open');
	});

	test('closeCompare clears both visibility signals and all compare state', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		// Pre-set to a non-default tab so the post-close assertion below actually exercises
		// `closeCompare`'s reset (would pass vacuously if we pre-set 'ahead', the default).
		state.branchCompareActiveTab.set('behind');

		controller.closeCompare();

		assert.strictEqual(state.compareSheetOpen.get(), false);
		assert.strictEqual(state.compareAsPanel.get(), false);
		assert.strictEqual(state.branchCompareLeftRef.get(), undefined);
		assert.strictEqual(state.branchCompareRightRef.get(), undefined);
		assert.strictEqual(state.branchCompareActiveTab.get(), 'ahead', 'active tab resets to default');
	});

	test('openCompareAsPanel swaps sheet for panel form (visibility flip, state intact)', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		state.branchCompareActiveTab.set('behind');

		controller.openCompareAsPanel();

		assert.strictEqual(state.compareSheetOpen.get(), false);
		assert.strictEqual(state.compareAsPanel.get(), true);
		assert.strictEqual(state.branchCompareLeftRef.get(), 'main');
		assert.strictEqual(state.branchCompareActiveTab.get(), 'behind', 'tab survives the form swap');
	});

	test('openCompare while in panel form with explicit overrides retargets AND defaults to sheet', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		controller.openCompareAsPanel();

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'topic', rightRefType: 'branch' },
		);

		// Any new open (with overrides) resets the form to sheet. The user re-commits to the panel
		// form if they want it. The only way back to sheet is close+reopen — this test exercises
		// the override path; a no-override repeat-click is the early-return no-op covered above.
		assert.strictEqual(state.compareAsPanel.get(), false, 'panel form is dismissed on re-open');
		assert.strictEqual(state.compareSheetOpen.get(), true, 'fresh open is always a sheet');
		assert.strictEqual(state.branchCompareRightRef.get(), 'topic', 'refs were updated');
	});

	test('graph-repo switch closes any open compare (sheet)', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		assert.strictEqual(state.compareSheetOpen.get(), true);

		host.setGraphRepoPath('/B');
		host.tickHostUpdate();

		assert.strictEqual(state.compareSheetOpen.get(), false);
		assert.strictEqual(state.branchCompareLeftRef.get(), undefined);
	});

	test('graph-repo switch closes any open compare (panel form)', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		controller.openCompareAsPanel();

		host.setGraphRepoPath('/B');
		host.tickHostUpdate();

		assert.strictEqual(state.compareAsPanel.get(), false);
		assert.strictEqual(state.compareSheetOpen.get(), false);
	});
});

interface GenerateCall {
	repoPath: string;
	currentMessage: string | undefined;
	amend: { sha: string; all: boolean } | undefined;
	signal: AbortSignal;
	resolve: (result: { summary: string; body?: string } | undefined) => void;
	reject: (ex: unknown) => void;
}

/** Services stub whose `generateCommitMessage` parks each call so the test can resolve/reject it on
 *  demand and inspect its args + signal. */
function createGenerateServices(calls: GenerateCall[]): ResolvedServices {
	const noopUnsubscribe = () => {};
	return {
		repository: {
			onRepositoryChanged: () => noopUnsubscribe,
			onRepositoryWorkingChanged: () => noopUnsubscribe,
		},
		graphInspect: {
			reviewChanges: async () => ({ error: { message: 'not implemented' } }),
			composeChanges: async () => ({ error: { message: 'not implemented' } }),
			generateCommitMessage: (
				repoPath: string,
				currentMessage: string | undefined,
				amend: { sha: string; all: boolean } | undefined,
				signal: AbortSignal,
			) =>
				new Promise<{ summary: string; body?: string } | undefined>((resolve, reject) => {
					calls.push({
						repoPath: repoPath,
						currentMessage: currentMessage,
						amend: amend,
						signal: signal,
						resolve: resolve,
						reject: reject,
					});
				}),
		},
	} as unknown as ResolvedServices;
}

function setupGenerate(calls: GenerateCall[]): {
	host: FakeHost;
	state: DetailsState;
	controller: DetailsWorkflowController;
} {
	const host = new FakeHost({ repoPath: '/A', graphRepoPath: '/A' });
	const state = createDetailsState();
	const actions = new DetailsActions(state, createGenerateServices(calls), createResources());
	const controller = new DetailsWorkflowController(host, actions);
	host.connectAll();
	host.tickHostUpdate();
	return { host: host, state: state, controller: controller };
}

const genEntry = (host: FakeHost, repoPath: string) =>
	host.crossPaneState.runningOperations.get().get(wipKey(repoPath))?.generateMessage;

suite('DetailsWorkflowController.generateMessage', () => {
	test('dispatch registers a generating entry; connected settle routes the message and clears it', async () => {
		const calls: GenerateCall[] = [];
		const { host, controller } = setupGenerate(calls);

		controller.runGenerateMessage('/A');
		assert.strictEqual(genEntry(host, '/A')?.execState, 'generating', 'entry registered as generating');
		assert.strictEqual(host.generatedMessages.length, 0, 'nothing applied while generating');
		assert.strictEqual(calls.length, 1);

		calls[0].resolve({ summary: 'Summary', body: 'Body' });
		await flush();

		assert.deepStrictEqual(host.generatedMessages, [{ repoPath: '/A', message: 'Summary\n\nBody' }]);
		assert.strictEqual(genEntry(host, '/A'), undefined, 'entry removed after applying');
	});

	test('second invocation while generating cancels that worktree only and drops its late result', async () => {
		const calls: GenerateCall[] = [];
		const { host, controller } = setupGenerate(calls);

		controller.runGenerateMessage('/A');
		controller.runGenerateMessage('/B');
		assert.strictEqual(genEntry(host, '/A')?.execState, 'generating');
		assert.strictEqual(genEntry(host, '/B')?.execState, 'generating');
		assert.strictEqual(calls[0].signal.aborted, false, 'A not aborted by B');
		assert.strictEqual(calls[1].signal.aborted, false, 'B not aborted by A');

		// Second click on A = cancel A.
		controller.runGenerateMessage('/A');
		assert.strictEqual(calls[0].signal.aborted, true, 'A aborted');
		assert.strictEqual(genEntry(host, '/A'), undefined, 'A entry removed on cancel');
		assert.strictEqual(genEntry(host, '/B')?.execState, 'generating', 'B untouched');
		assert.strictEqual(calls.length, 2, 'cancel starts no new run');

		// A late resolve of the cancelled run must not route.
		calls[0].resolve({ summary: 'late A' });
		await flush();
		assert.strictEqual(
			host.generatedMessages.some(m => m.repoPath === '/A'),
			false,
			'cancelled A result dropped',
		);

		// B still completes into its own slot.
		calls[1].resolve({ summary: 'B' });
		await flush();
		assert.deepStrictEqual(host.generatedMessages, [{ repoPath: '/B', message: 'B' }]);
		assert.strictEqual(genEntry(host, '/B'), undefined);
	});

	test('a null host result lands nothing but still clears the entry', async () => {
		const calls: GenerateCall[] = [];
		const { host, controller } = setupGenerate(calls);

		controller.runGenerateMessage('/A');
		calls[0].resolve(undefined);
		await flush();

		assert.strictEqual(host.generatedMessages.length, 0, 'no message applied');
		assert.strictEqual(genEntry(host, '/A'), undefined, 'entry cleared');
	});

	test('graph teardown (abortRunningOperations) aborts an in-flight generate-message run; a late settle lands nothing', async () => {
		const calls: GenerateCall[] = [];
		const { host, controller } = setupGenerate(calls);

		controller.runGenerateMessage('/A');
		const sig = genEntry(host, '/A')?.abortController?.signal;
		assert.strictEqual(sig?.aborted, false, 'in flight');

		// gl-graph-app's teardown cancels every in-flight AI run (the registry owner, not the panel).
		abortRunningOperations(host.crossPaneState);
		assert.strictEqual(sig?.aborted, true, 'run aborted on teardown');

		// A late resolve from the aborted run must not route a message (onRunSettled's abort guard).
		calls[0].resolve({ summary: 'too late' });
		await flush();
		assert.strictEqual(host.generatedMessages.length, 0, 'aborted run lands nothing');
	});

	test('graph teardown (abortRunningOperations) aborts review/compose runs too — not just generate-message', () => {
		const state = createGraphCrossPaneState();
		const reviewAbort = new AbortController();
		const composeAbort = new AbortController();
		const genAbort = new AbortController();
		state.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						review: {
							kind: 'review' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'generating' as const,
							abortController: reviewAbort,
							promise: Promise.resolve(makeReviewResult('R')),
						},
						generateMessage: {
							kind: 'generateMessage' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'generating' as const,
							abortController: genAbort,
							promise: Promise.resolve({ message: 'G' }),
						},
					},
				],
				[
					wipKey('/B'),
					{
						compose: {
							kind: 'compose' as const,
							anchor: { kind: 'wip' as const, repoPath: '/B', sha: uncommitted },
							execState: 'generating' as const,
							abortController: composeAbort,
							promise: Promise.resolve(makeComposeResult('C')),
						},
					},
				],
			]),
		);

		abortRunningOperations(state);

		assert.strictEqual(reviewAbort.signal.aborted, true, 'review aborted');
		assert.strictEqual(composeAbort.signal.aborted, true, 'compose aborted');
		assert.strictEqual(genAbort.signal.aborted, true, 'generate-message aborted');
	});
});
