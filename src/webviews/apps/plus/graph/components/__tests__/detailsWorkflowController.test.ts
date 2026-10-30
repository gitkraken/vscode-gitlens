import * as assert from 'assert';
import type { ReactiveController } from 'lit';
import type { AIReviewFinding, AIReviewResult } from '@gitlens/ai/models/results.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Wip } from '../../../../../commitDetails/protocol.js';
import type {
	BranchComparisonOptions,
	ComposeResult,
	ReviewResult,
	ScopeFile,
	ScopeSelection,
} from '../../../../../plus/graph/graphService.js';
import { createResource } from '../../../../shared/state/resource.js';
import type { GraphCrossPaneState } from '../../graphCrossPaneState.js';
import { abortRunningOperations, createGraphCrossPaneState } from '../../graphCrossPaneState.js';
import type { AnchorKey } from '../anchorKey.js';
import { anchorKey } from '../anchorKey.js';
import type { DetailsResources, ResolvedServices } from '../detailsActions.js';
import { DetailsActions } from '../detailsActions.js';
import type { DetailsState, RunningOperationBucket } from '../detailsState.js';
import { createDetailsState } from '../detailsState.js';
import type { DetailsSelection, DetailsWorkflowHost } from '../detailsWorkflowController.js';
import { DetailsWorkflowController, withoutFindingOpening } from '../detailsWorkflowController.js';
import { formatReviewForAgentContext } from '../reviewFormat.js';
import {
	emptyReviewSession,
	getReviewReplies,
	getReviewThreadItems,
	withFindingNote,
	withFindingState,
	withReviewComments,
} from '../reviewSession.js';

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
		pastAgentSessions: createResource(async (_signal, _worktreePath: string, _limit?: number) => undefined),
		pastAgentSessionDetail: createResource(
			async (_signal, _sessionId: string, _providerId: string | undefined, _cwd: string | undefined) => undefined,
		),
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
	discardCompose?: (...args: unknown[]) => Promise<void>;
	sendEvent?: (name: string, data: Record<string, unknown>) => Promise<void>;
	warnReviewHandOffDropped?: (to: 'reviewer' | 'agent') => Promise<void>;
}): ResolvedServices {
	const noopUnsubscribe = () => {};
	return {
		repository: {
			onRepositoryChanged: () => noopUnsubscribe,
			onRepositoryWorkingChanged: () => noopUnsubscribe,
			onRepositoryOrWorktreeChanged: () => noopUnsubscribe,
		},
		graphInspect: {
			reviewChanges: overrides?.reviewChanges ?? (async () => ({ error: { message: 'not implemented' } })),
			composeChanges: overrides?.composeChanges ?? (async () => ({ error: { message: 'not implemented' } })),
			discardCompose: overrides?.discardCompose ?? (() => Promise.resolve()),
			warnReviewHandOffDropped: overrides?.warnReviewHandOffDropped ?? (() => Promise.resolve()),
		},
		telemetry: {
			sendEvent: overrides?.sendEvent ?? (() => Promise.resolve()),
		},
	} as unknown as ResolvedServices;
}

class FakeHost implements DetailsWorkflowHost {
	compareOrientation: 'horizontal' | 'vertical' = 'vertical';
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
	branchSheetRefreshes = 0;
	refreshBranchSheet(): void {
		this.branchSheetRefreshes++;
	}
	currentSelection(): DetailsSelection {
		return this._selection;
	}
	applyGeneratedCommitMessage(repoPath: string, message: string): void {
		this.generatedMessages.push({ repoPath: repoPath, message: message });
	}

	/** Test-controlled snapshot returned by `readEngagedRefineState` — set by the capture-on-leave
	 *  tests to simulate the live compose/resolve panel's posture + draft. */
	engagedExclusions: { files: ReadonlySet<string>; commits?: ReadonlySet<string> } | undefined;
	readEngagedExclusions(): { files: ReadonlySet<string>; commits?: ReadonlySet<string> } | undefined {
		return this.engagedExclusions;
	}

	engagedIdleDraft: string | undefined;
	readonly handOffs: string[] = [];
	sendReviewFindingToAgent(findingId: string, instructions?: string): void {
		this.handOffs.push(`address:${findingId}:${instructions ?? ''}`);
	}
	askReviewerAboutFinding(findingId: string, question?: string): void {
		this.handOffs.push(`ask:${findingId}:${question ?? ''}`);
	}

	readEngagedIdleDraft(): string | undefined {
		return this.engagedIdleDraft;
	}

	engagedRefineState: { refineMode: boolean; refineDraft: string } | undefined = undefined;
	readEngagedRefineState(): { refineMode: boolean; refineDraft: string } | undefined {
		return this.engagedRefineState;
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

/** A deep review's entry state without the ids its run handed out, which are random */
function withoutRunFindingIds<T extends { runFindingIds?: unknown }>(
	deepReview: T | undefined,
): Omit<T, 'runFindingIds'> | undefined {
	if (deepReview == null) return undefined;

	const { runFindingIds: _, ...rest } = deepReview;
	return rest;
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

		controller.runReview('/A', undefined, undefined, 0);

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

		controller.runReview('/A', 'my prompt', undefined, 0);
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

	test('focus-area runs ride on the review entry: superseded on re-run, aborted by discard, cleared on settle', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('two-pass'), 'complete', 'my prompt')]]),
		);
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		const first = controller.review.startFocusAreaRun('area-1');
		assert.ok(first);
		assert.strictEqual(first.prompt, 'my prompt', "the overview run's instructions reach the detail run");
		const other = controller.review.startFocusAreaRun('area-2');
		assert.ok(other);

		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.focusAreaRuns?.size, 2, 'both runs tracked on the entry');

		// Re-running the same area supersedes its earlier run; the other area is untouched.
		const second = controller.review.startFocusAreaRun('area-1');
		assert.ok(second);
		assert.strictEqual(first.signal.aborted, true);
		assert.strictEqual(second.signal.aborted, false);
		assert.strictEqual(other.signal.aborted, false);

		// Settling with a stale signal is a no-op; settling the live one drops it.
		controller.review.settleFocusAreaRun('area-1', first.signal);
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.focusAreaRuns?.get('area-1')?.signal, second.signal);
		controller.review.settleFocusAreaRun('area-1', second.signal);
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.focusAreaRuns?.has('area-1'), false);
		assert.strictEqual(entry?.focusAreaRuns?.size, 1);

		// Discard drops the findings along with every run still riding on them.
		controller.review.discard();
		assert.strictEqual(other.signal.aborted, true, 'discard aborts the in-flight detail run');
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.focusAreaRuns, undefined);
		assert.strictEqual(entry?.result, undefined);
	});

	test('review session lives on the entry before any run and survives a run being dispatched', async () => {
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/A',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const actions = new DetailsActions(
			state,
			createServices({ reviewChanges: async () => makeReviewResult('run') }),
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

		// No run yet — marking a file creates the idle entry that carries the session.
		controller.review.setFilesViewed([{ path: 'src/a.ts', contentId: 'a1' }], true);
		controller.review.setFileExcluded('src/b.ts', true);
		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.execState, 'backed');
		assert.strictEqual(entry?.result, undefined);
		assert.strictEqual(entry?.session?.viewed.get('src/a.ts')?.contentId, 'a1');
		assert.strictEqual(entry?.session?.excluded.has('src/b.ts'), true);

		// A no-op edit leaves the registry untouched.
		const before = host.crossPaneState.runningOperations.get();
		controller.review.setFileExcluded('src/b.ts', true);
		assert.strictEqual(host.crossPaneState.runningOperations.get(), before);

		controller.runReview('/A', undefined, undefined, 0);
		await flush();

		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.execState, 'complete');
		assert.strictEqual(entry?.session?.viewed.get('src/a.ts')?.contentId, 'a1', 'progress outlives the run');

		controller.review.setFindingState('f1', 'dismissed');
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.session?.findingStates.get('f1'), 'dismissed');

		// Discarding the findings keeps the reader's progress and the mode.
		controller.review.discard();
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.execState, 'backed');
		assert.strictEqual(entry?.result, undefined);
		assert.strictEqual(actions.resources.review.value.get(), undefined);
		assert.strictEqual(entry?.session?.viewed.get('src/a.ts')?.contentId, 'a1', 'viewed marks survive discard');
		assert.strictEqual(entry?.session?.excluded.has('src/b.ts'), true);
		assert.strictEqual(entry?.session?.findingStates.size, 0, 'finding states go with the findings');
		assert.strictEqual(state.activeMode.get(), 'review');
		assert.strictEqual(state.reviewForwardAvailable.get(), false, 'nothing to resume');
	});

	test('the entry records the content findings were made against: a run starts it over, the agent adds to it, discard drops it', async () => {
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/A',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const reviewed = {
			result: {
				overview: 'run',
				mode: 'single-pass',
				focusAreas: [
					{
						id: 'area',
						label: 'Area',
						rationale: '',
						severity: 'warning',
						files: ['src/a.ts'],
						findings: [
							{ id: 'f1', severity: 'warning', title: 'one', description: '', filePath: 'src/a.ts' },
						],
					},
				],
			},
		} as unknown as ReviewResult;
		const actions = new DetailsActions(
			state,
			createServices({ reviewChanges: async () => reviewed }),
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
		actions.resources.scopeFiles.mutate([
			{ path: 'src/a.ts', contentId: 'a1' },
			{ path: 'src/b.ts', contentId: 'b1' },
		] as never);

		controller.runReview('/A', undefined, undefined, 0);
		await flush();
		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		const idOf = (title: string) => {
			const value = entry?.result;
			return value != null && 'result' in value
				? value.result.focusAreas.flatMap(a => a.findings ?? []).find(f => f.title === title)?.id
				: undefined;
		};
		const one = idOf('one')!;
		assert.deepStrictEqual([...(entry?.findingsContent?.get(one) ?? [])], [['src/a.ts', 'a1']]);

		// The agent's report comes in after the reader edited a file — it is recorded as it is now
		actions.resources.scopeFiles.mutate([
			{ path: 'src/a.ts', contentId: 'a2' },
			{ path: 'src/b.ts', contentId: 'b1' },
		] as never);
		controller.review.applyDeepReviewState({
			run: 1,
			anchor: { kind: 'wip', repoPath: '/A', sha: uncommitted },
			anchorKey: wipKey('/A'),
			purpose: 'review',
			handOff: 'delivered',
			active: false,
			done: true,
			findings: [
				{
					seq: 1,
					finding: {
						id: 'agent-1',
						severity: 'warning',
						title: 'agent',
						description: '',
						filePath: 'src/a.ts',
						source: 'agent',
					},
				},
			],
			notes: [],
		});
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.deepStrictEqual([...(entry?.findingsContent?.get(one) ?? [])], [['src/a.ts', 'a1']]);
		assert.deepStrictEqual([...(entry?.findingsContent?.get(idOf('agent')!) ?? [])], [['src/a.ts', 'a2']]);

		controller.review.discard();
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.findingsContent, undefined, 'the record goes with the findings');
	});

	test('reading updates from the host land on the entry: the active file, and editor-made marks applied once', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.review.applyReadingState({ anchor: wipKey('/A'), active: 'src/a.ts', marked: [], markedBefore: 0 });
		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.execState, 'backed', 'reading before any run creates the idle entry');
		assert.deepStrictEqual(entry?.reading, { active: 'src/a.ts', marksApplied: 0 });

		controller.review.applyReadingState({
			anchor: wipKey('/A'),
			active: 'src/b.ts',
			marked: ['src/a.ts'],
			markedBefore: 0,
		});
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.session?.viewed.has('src/a.ts'), true, 'the editor mark reaches the session');
		assert.deepStrictEqual(entry?.reading, { active: 'src/b.ts', marksApplied: 1 });

		// The panel un-marks a file; the host's append-only list still names it, but it was applied already.
		controller.review.setFilesViewed([{ path: 'src/a.ts' }], false);
		controller.review.applyReadingState({
			anchor: wipKey('/A'),
			active: undefined,
			marked: ['src/a.ts', 'src/b.ts'],
			markedBefore: 0,
		});
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.session?.viewed.has('src/a.ts'), false, 'an already-applied mark is not re-applied');
		assert.strictEqual(entry?.session?.viewed.has('src/b.ts'), true);
		assert.deepStrictEqual(entry?.reading, { active: undefined, marksApplied: 2 }, 'no review diff is active');

		controller.review.applyReadingState(undefined);
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.reading, undefined, 'the review is left; the session stays');
		assert.strictEqual(entry?.session?.viewed.has('src/b.ts'), true);
	});

	test('reading state survives a run being dispatched', async () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.review.applyReadingState({
			anchor: wipKey('/A'),
			active: 'src/a.ts',
			marked: ['src/a.ts'],
			markedBefore: 0,
		});
		controller.runReview('/A', undefined, undefined, 0);
		await flush();
		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.deepStrictEqual(entry?.reading, { active: 'src/a.ts', marksApplied: 1 });
	});

	test('a reading plan lands with its order, is kept across runs, and clears back to tree order', async () => {
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/A',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const orient = {
			overview: 'plan',
			groups: [
				{
					id: 'g1',
					label: 'Core',
					kind: 'core',
					summary: 'the core',
					files: [
						{ path: 'src/b.ts', note: '' },
						{ path: 'src/a.ts', note: '' },
					],
				},
			],
		} as const;
		const actions = new DetailsActions(
			state,
			createServices({ reviewChanges: async () => makeReviewResult('run') }),
			createResources(),
		);
		actions.orientChanges = async () => ({ result: orient });
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();

		state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		actions.resources.scopeFiles.mutate([{ path: 'src/a.ts' }, { path: 'src/b.ts' }] as never);

		controller.review.runOrient('/A', undefined, undefined);
		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.ok(entry?.orientRun, 'the plan is being made');
		await flush();
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.orientRun, undefined);
		assert.strictEqual(entry?.orient, orient);
		assert.deepStrictEqual(entry?.session?.order, ['src/b.ts', 'src/a.ts'], 'the order applies as the plan lands');

		controller.runReview('/A', undefined, undefined, 0);
		await flush();
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.orient, orient, 'the plan outlives the run');
		assert.deepStrictEqual(entry?.session?.order, ['src/b.ts', 'src/a.ts']);

		controller.review.clearOrient();
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.orient, undefined);
		assert.strictEqual(entry?.session?.order, undefined, 'dismissing the plan drops its order too');
	});

	test('an Orient in flight outlives a Review Diff run, and lets go of the review once it is called off', async () => {
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const actions = new DetailsActions(
			state,
			createServices({ reviewChanges: async () => makeReviewResult('run') }),
			createResources(),
		);
		let answer: ((result: { error: { message: string } }) => void) | undefined;
		let signal: AbortSignal | undefined;
		// The signal is the last argument, whatever comes before it
		actions.orientChanges = (...args: unknown[]) => {
			signal = args.at(-1) as AbortSignal;
			return new Promise(resolve => (answer = resolve));
		};
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();

		state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		const entry = () => host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;

		controller.review.runOrient('/A', undefined, undefined);
		const orientRun = entry()?.orientRun;
		controller.runReview('/A', undefined, undefined, 0);
		await flush();
		assert.strictEqual(entry()?.orientRun, orientRun, 'still planning');
		assert.strictEqual(signal?.aborted, false);

		controller.review.discard();
		assert.strictEqual(signal?.aborted, true);
		answer?.({ error: { message: 'Orient was cancelled.' } });
		await flush();
		assert.strictEqual(entry()?.orientRun, undefined, 'not left running');
		assert.strictEqual(entry()?.orientError, undefined, 'a call-off is no failure');
	});

	test("a thread's reply records the note first, then asks the reviewer or hands the finding to the fixer", () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('r'), 'complete')]]),
		);

		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [
				{ seq: 1, findingId: 'f1', action: 'reply', text: 'just a note' },
				{ seq: 2, findingId: 'f1', action: 'askReviewer', text: 'is this reachable?' },
				{ seq: 3, findingId: 'f2', action: 'askReviewer' },
				{ seq: 4, findingId: 'f2', action: 'address', text: 'use the shared helper' },
			],
		});
		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.deepStrictEqual(
			entry?.session?.notes.get('f1')?.map(n => n.text),
			['just a note', 'is this reachable?'],
		);
		assert.deepStrictEqual(
			entry?.session?.notes.get('f2')?.map(n => n.text),
			['use the shared helper'],
			'an ask with no words leaves no note',
		);
		assert.deepStrictEqual(host.handOffs, [
			'ask:f1:is this reachable?',
			'ask:f2:',
			'address:f2:use the shared helper',
		]);
	});

	test('a comment opened on a line joins the session — before any run too — and can be handed off, edited and removed', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		const place = { path: 'a.ts', line: 2, lineEnd: 3 };

		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [
				{ seq: 1, findingId: 'user-1', action: 'comment', text: 'why here?', place: place },
				{ seq: 2, findingId: 'user-1', action: 'askReviewer' },
			],
		});
		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.deepStrictEqual(
			entry?.session?.comments?.map(c => [c.id, c.source, c.description, c.filePath]),
			[['user-1', 'user', 'why here?', 'a.ts']],
		);
		assert.strictEqual(entry?.execState, 'complete', 'the review opens to the comment');
		assert.deepStrictEqual(host.handOffs, ['ask:user-1:']);

		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [
				{ seq: 1, findingId: 'user-1', action: 'comment', text: 'why here?', place: place },
				{ seq: 2, findingId: 'user-1', action: 'askReviewer' },
				{ seq: 3, findingId: 'user-1', action: 'editComment', text: 'why here, not in the caller?' },
			],
		});
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.session?.comments?.[0].description, 'why here, not in the caller?');

		controller.review.discard();
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.session?.comments?.length, 1, "discarding the AI's findings keeps the comments");
		assert.strictEqual(entry?.execState, 'complete', 'and the panel stays on them');

		controller.review.deleteFinding('user-1');
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.session?.comments, undefined);
	});

	test('deleting the last finding, from its card or its thread, ends the review as Delete Findings does', () => {
		const { host, state, controller, actions } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const sent: string[] = [];
		actions.sendTelemetryEvent = name => void sent.push(name);
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		const reviewWith = (ids: string[]) =>
			({
				result: {
					overview: 'two things',
					mode: 'single-pass',
					focusAreas: [
						{
							id: 'area',
							label: 'Area',
							rationale: '',
							severity: 'warning',
							files: [],
							findings: ids.map(id => ({ id: id, severity: 'warning', title: id, description: '' })),
						},
					],
				},
			}) as unknown as ReviewResult;
		const entry = () => host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;

		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', reviewWith(['f1', 'f2']), 'complete')]]),
		);
		controller.review.setFilesViewed([{ path: 'a.ts' }], true);
		// A reading plan being made
		const orientRun = new AbortController();
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), { review: { ...entry()!, orientRun: orientRun } }]]),
		);
		controller.review.deleteFinding('f1');
		assert.strictEqual(entry()?.execState, 'complete', 'one finding left, the review stays');
		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [{ seq: 1, findingId: 'f2', action: 'delete' }],
		});
		assert.strictEqual(entry()?.execState, 'backed', 'back on the checklist, as after Delete Findings');
		assert.strictEqual(entry()?.result, undefined);
		assert.ok(entry()?.session?.viewed.has('a.ts'), 'the reading stays');
		assert.deepStrictEqual(
			[entry()?.orientRun, orientRun.signal.aborted],
			[orientRun, false],
			'and so does the plan being made',
		);
		assert.ok(!sent.includes('graphDetails/review/discarded'), 'the reader deleted findings, not the review');

		// While the agent may still report into it, the review stays
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						review: {
							...makeReviewBucket('/A', reviewWith(['f3']), 'complete').review!,
							deepReview: { run: 1, active: true, done: false, count: 0, seqApplied: 0 },
						},
					},
				],
			]),
		);
		controller.review.deleteFinding('f3');
		assert.strictEqual(entry()?.execState, 'complete', 'the agent may still report into it');
	});

	test("deleting from a thread: a note by its id, or the finding — the AI's from the result, with its state and notes", () => {
		const { host, state, controller, actions } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		const reviewed = {
			result: {
				overview: '',
				mode: 'single-pass',
				focusAreas: [
					{
						id: 'area',
						label: 'Area',
						rationale: '',
						severity: 'warning',
						files: [],
						findings: [
							{ id: 'f1', severity: 'warning', title: 'one', description: '' },
							{ id: 'f2', severity: 'warning', title: 'two', description: '' },
						],
					},
				],
			},
		} as unknown as ReviewResult;
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', reviewed, 'complete')]]),
		);
		const findingIds = () => {
			const value = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review?.result;
			return value != null && 'result' in value
				? value.result.focusAreas.flatMap(a => a.findings?.map(f => f.id) ?? [])
				: [];
		};
		const [first, second] = findingIds();

		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [
				{ seq: 1, findingId: first, action: 'reply', text: 'one' },
				{ seq: 2, findingId: first, action: 'reply', text: 'two' },
				{ seq: 3, findingId: second, action: 'dismiss' },
			],
		});
		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		const noteId = entry?.session?.notes.get(first)?.[0].id;

		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [
				{ seq: 1, findingId: first, action: 'reply', text: 'one' },
				{ seq: 2, findingId: first, action: 'reply', text: 'two' },
				{ seq: 3, findingId: second, action: 'dismiss' },
				{ seq: 4, findingId: first, action: 'deleteNote', noteId: noteId },
				{ seq: 5, findingId: second, action: 'delete' },
				{
					seq: 6,
					findingId: first,
					action: 'editNote',
					noteId: entry?.session?.notes.get(first)?.[1].id,
					text: 'two, edited',
				},
			],
		});
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.deepStrictEqual(
			entry?.session?.notes.get(first)?.map(n => n.text),
			['two, edited'],
		);
		assert.deepStrictEqual(findingIds(), [first]);
		assert.strictEqual(entry?.session?.findingStates.has(second), false);
		const shown = actions.resources.review.value.get();
		assert.deepStrictEqual(
			shown != null && 'result' in shown ? shown.result.focusAreas.flatMap(a => a.findings?.map(f => f.id)) : [],
			[first],
			'the shown review loses it too',
		);
	});

	test("what the reader does in one review's editor stays with it — a commit of the same repo or another repo gets none", () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const commitKey = anchorKey({ sha: 'c1', shas: undefined, repoPath: '/A' });
		const showWip = () => {
			state.activeModeContext.set('wip');
			state.activeModeSha.set(uncommitted);
		};
		const showCommit = () => {
			state.activeModeContext.set('commit');
			state.activeModeSha.set('c1');
		};
		state.activeMode.set('review');
		state.activeModeRepoPath.set('/A');
		showWip();
		const commitBucket = makeReviewBucket('/A', makeReviewResult('c'), 'complete');
		commitBucket.review!.anchor = { kind: 'commit', repoPath: '/A', sha: 'c1' };
		host.crossPaneState.runningOperations.set(
			new Map([
				[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('w'), 'complete')],
				[commitKey, commitBucket],
			]),
		);
		const review = (key: AnchorKey) => host.crossPaneState.runningOperations.get().get(key)?.review;
		const place = { path: 'a.ts', line: 1, lineEnd: 1 };

		// In the working tree: a comment, a question to the reviewer, a dismissal; a file marked in the editor
		const wipJournal = [
			{ seq: 1, findingId: 'user-1', action: 'comment' as const, text: 'why here?', place: place },
			{ seq: 2, findingId: 'f1', action: 'askReviewer' as const, text: 'reachable?' },
			{ seq: 3, findingId: 'f1', action: 'dismiss' as const },
		];
		controller.review.applyThreadActions({ anchor: wipKey('/A'), actions: wipJournal });
		controller.review.applyReadingState({ anchor: wipKey('/A'), marked: ['a.ts'], markedBefore: 0 });
		assert.deepStrictEqual(host.handOffs, ['ask:f1:reachable?']);

		// On to the commit: the host starts its journal and marks over, numbering on
		showCommit();
		controller.review.applyReadingState({ anchor: commitKey, marked: [], markedBefore: 1 });
		// A panel catching up replays the working tree's journal and marks — they go to the working tree, once
		controller.review.applyThreadActions({ anchor: wipKey('/A'), actions: wipJournal });
		controller.review.applyReadingState({ anchor: wipKey('/A'), marked: ['a.ts'], markedBefore: 0 });
		assert.strictEqual(review(commitKey)?.session?.comments, undefined, "the reader's comment stays home");
		assert.strictEqual(review(commitKey)?.session?.findingStates.has('f1'), false);
		assert.strictEqual(review(commitKey)?.session?.viewed.has('a.ts'), false, 'so does the mark');
		assert.strictEqual(review(commitKey)?.threadActionsApplied, undefined);
		assert.deepStrictEqual(host.handOffs, ['ask:f1:reachable?'], 'and the question is not asked again');

		controller.review.applyThreadActions({
			anchor: commitKey,
			actions: [{ seq: 4, findingId: 'f1', action: 'reply', text: 'fine here' }],
		});
		controller.review.applyReadingState({ anchor: commitKey, marked: ['b.ts'], markedBefore: 1 });
		assert.deepStrictEqual(
			review(commitKey)
				?.session?.notes.get('f1')
				?.map(n => n.text),
			['fine here'],
		);
		assert.deepStrictEqual([...(review(commitKey)?.session?.viewed.keys() ?? [])], ['b.ts']);

		// Another repo's comment, arriving while this one is shown, makes no review for it here
		controller.review.applyThreadActions({
			anchor: wipKey('/B'),
			actions: [{ seq: 5, findingId: 'user-2', action: 'comment', text: 'elsewhere', place: place }],
		});
		controller.review.applyReadingState({ anchor: wipKey('/B'), marked: ['c.ts'], markedBefore: 2 });
		assert.strictEqual(host.crossPaneState.runningOperations.get().get(wipKey('/B')), undefined);

		// Back in the working tree: its new journal and marks number on, and only what is new lands
		showWip();
		controller.review.applyReadingState({ anchor: wipKey('/A'), marked: [], markedBefore: 3 });
		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [{ seq: 6, findingId: 'f1', action: 'reopen' }],
		});
		controller.review.applyReadingState({ anchor: wipKey('/A'), marked: ['c.ts'], markedBefore: 3 });
		const wip = review(wipKey('/A'));
		assert.deepStrictEqual(
			wip?.session?.comments?.map(c => c.id),
			['user-1'],
		);
		assert.deepStrictEqual(
			wip?.session?.notes.get('f1')?.map(n => n.text),
			['reachable?'],
			"the commit's reply is not here",
		);
		assert.strictEqual(wip?.session?.findingStates.has('f1'), false, 'reopened');
		assert.deepStrictEqual([...(wip?.session?.viewed.keys() ?? [])], ['a.ts', 'c.ts']);
		assert.strictEqual(wip?.threadActionsApplied, 6);
		assert.deepStrictEqual(host.handOffs, ['ask:f1:reachable?']);
	});

	test("a hand-off taken in a review that is no longer shown keeps the reply, isn't sent, and says so", () => {
		const host = new FakeHost({ repoPath: '/A', graphRepoPath: '/A' });
		const state = createDetailsState();
		const warned: string[] = [];
		const actions = new DetailsActions(
			state,
			createServices({
				warnReviewHandOffDropped: to => {
					warned.push(to);
					return Promise.resolve();
				},
			}),
			createResources(),
		);
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();
		state.activeMode.set('review');
		state.activeModeContext.set('commit');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set('c1');
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('w'), 'complete')]]),
		);

		// Taken in the working tree's threads, arriving once the commit is shown
		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [
				{ seq: 1, findingId: 'f1', action: 'askReviewer', text: 'reachable?' },
				{ seq: 2, findingId: 'f1', action: 'askReviewer', text: 'and here?' },
				{ seq: 3, findingId: 'f2', action: 'address', text: 'use a guard' },
				{ seq: 4, findingId: 'f3', action: 'sendToAgent' },
			],
		});
		const wip = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.deepStrictEqual(
			wip?.session?.notes.get('f1')?.map(n => n.text),
			['reachable?', 'and here?'],
			'the replies stay with their review',
		);
		assert.strictEqual(wip?.threadActionsApplied, 4);
		assert.deepStrictEqual(host.handOffs, [], 'nothing goes to the shown review');
		assert.deepStrictEqual(warned, ['reviewer', 'agent'], 'one warning for each kind of request dropped');

		// A journal with nothing new for a review left behind says nothing
		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [{ seq: 4, findingId: 'f3', action: 'sendToAgent' }],
		});
		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [{ seq: 5, findingId: 'f1', action: 'reply', text: 'never mind' }],
		});
		assert.deepStrictEqual(warned, ['reviewer', 'agent']);
	});

	test('a reading let go clears the review it was reading, not the one shown by then', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const commitKey = anchorKey({ sha: 'c1', shas: undefined, repoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeRepoPath.set('/A');
		state.activeModeContext.set('commit');
		state.activeModeSha.set('c1');
		controller.review.applyReadingState({ anchor: commitKey, active: 'b.ts', marked: [], markedBefore: 0 });

		state.activeModeContext.set('wip');
		state.activeModeSha.set(uncommitted);
		controller.review.applyReadingState({ anchor: wipKey('/A'), active: 'a.ts', marked: [], markedBefore: 0 });
		// The commit is shown again before the host lets the working tree's reading go
		state.activeModeContext.set('commit');
		state.activeModeSha.set('c1');
		controller.review.applyReadingState(undefined);

		const review = (key: AnchorKey) => host.crossPaneState.runningOperations.get().get(key)?.review;
		assert.strictEqual(review(wipKey('/A'))?.reading, undefined);
		assert.deepStrictEqual(review(commitKey)?.reading, { active: 'b.ts', marksApplied: 0 });
	});

	test("a reading let go after the controller was rebuilt clears the shown review's", () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeRepoPath.set('/A');
		controller.review.applyReadingState({ anchor: wipKey('/A'), active: 'a.ts', marked: [], markedBefore: 0 });
		// A controller built since never saw which review was read — the entries outlive it
		(controller as unknown as { _readingAnchor?: AnchorKey })._readingAnchor = undefined;

		controller.review.applyReadingState(undefined);
		assert.strictEqual(host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review?.reading, undefined);
	});

	test("the reader's first comment on a review with no entry yet makes that review's entry, and no other", () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeContext.set('commit');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set('c1');
		const commitKey = anchorKey({ sha: 'c1', shas: undefined, repoPath: '/A' });
		const place = { path: 'a.ts', line: 1, lineEnd: 1 };

		// The working tree's journal comes in late — no entry for it, and none for the commit from it
		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [{ seq: 1, findingId: 'user-1', action: 'comment', text: 'wip', place: place }],
		});
		assert.strictEqual(host.crossPaneState.runningOperations.get().size, 0);

		controller.review.applyThreadActions({
			anchor: commitKey,
			actions: [{ seq: 2, findingId: 'user-2', action: 'comment', text: 'commit', place: place }],
		});
		const entry = host.crossPaneState.runningOperations.get().get(commitKey)?.review;
		assert.strictEqual(entry?.anchor.kind, 'commit');
		assert.strictEqual(entry?.anchor.sha, 'c1');
		assert.deepStrictEqual(
			entry?.session?.comments?.map(c => c.id),
			['user-2'],
		);
		assert.strictEqual(entry?.threadActionsApplied, 2);
		assert.deepStrictEqual([...host.crossPaneState.runningOperations.get().keys()], [commitKey]);
	});

	test("deleting a thread's opening keeps the thread: the first reply opens it, until none is left", () => {
		const result = {
			overview: '',
			mode: 'single-pass',
			focusAreas: [
				{
					id: 'area',
					label: 'Area',
					rationale: '',
					severity: 'warning',
					files: [],
					findings: [
						{
							id: 'f1',
							severity: 'warning',
							title: 'one',
							description: 'AI words',
							filePath: 'a.ts',
							lineRange: { start: 3, end: 4 },
						},
					],
				},
			],
		} as unknown as AIReviewResult;
		let session = withFindingNote(emptyReviewSession, 'f1', { author: 'user', text: 'why?', at: 1 });
		session = withFindingNote(session, 'f1', { author: 'agent', text: 'because', at: 2 });
		session = withFindingState(session, 'f1', 'dismissed');

		let next = withoutFindingOpening(result, session, 'f1');
		assert.deepStrictEqual(next.result?.focusAreas, [], 'the AI finding leaves the result');
		assert.deepStrictEqual(
			next.session.comments?.map(c => [c.id, c.source, c.author, c.description, c.filePath, c.lineRange]),
			[['f1', 'user', undefined, 'why?', 'a.ts', { start: 3, end: 4 }]],
		);
		assert.deepStrictEqual(
			next.session.notes.get('f1')?.map(n => n.text),
			['because'],
		);
		assert.strictEqual(next.session.findingStates.get('f1'), 'dismissed', 'the thread keeps its state');

		next = withoutFindingOpening(next.result, next.session, 'f1');
		assert.deepStrictEqual(
			next.session.comments?.map(c => [c.author, c.description]),
			[['agent', 'because']],
		);
		assert.strictEqual(next.session.notes.has('f1'), false);

		next = withoutFindingOpening(next.result, next.session, 'f1');
		assert.strictEqual(next.session.comments, undefined, 'with no reply left, the thread goes');
		assert.strictEqual(next.session.findingStates.has('f1'), false);
	});

	test('a second deep review starts its counters over, and a report lands on the review it was started from', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);
		const anchor = { kind: 'wip', repoPath: '/A', sha: uncommitted };
		const finding = (id: string, title = id) =>
			({
				id: id,
				severity: 'warning',
				title: title,
				description: '',
				filePath: 'a.ts',
				source: 'agent',
			}) as const;

		controller.review.applyDeepReviewState({
			run: 1,
			anchor: anchor,
			anchorKey: wipKey('/A'),
			purpose: 'review',
			handOff: 'delivered',
			active: false,
			done: true,
			findings: [
				{ seq: 1, finding: finding('agent-1') },
				{ seq: 2, finding: finding('agent-2') },
			],
			notes: [],
		});
		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		let result = entry?.result != null && 'result' in entry.result ? entry.result.result : undefined;
		const [first, second] = result?.focusAreas.find(a => a.id === 'agent')?.findings?.map(f => f.id) ?? [];
		controller.review.setFindingState(first, 'dismissed');

		// The next run numbers from 1 again — its first findings must not read as already applied, nor share
		// an id (and with it a state, notes, a thread) with the earlier run's first finding
		controller.review.applyDeepReviewState({
			run: 2,
			anchor: anchor,
			anchorKey: wipKey('/A'),
			purpose: 'review',
			handOff: 'delivered',
			active: true,
			done: false,
			findings: [{ seq: 1, finding: finding('agent-1', 'agent-3') }],
			notes: [],
		});
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		result = entry?.result != null && 'result' in entry.result ? entry.result.result : undefined;
		const agentFindings = result?.focusAreas.find(a => a.id === 'agent')?.findings ?? [];
		assert.deepStrictEqual(
			agentFindings.map(f => f.title),
			['agent-1', 'agent-2', 'agent-3'],
		);
		assert.strictEqual(new Set(agentFindings.map(f => f.id)).size, 3, 'every finding has an id of its own');
		assert.deepStrictEqual(
			agentFindings.slice(0, 2).map(f => f.id),
			[first, second],
			'the earlier ones keep theirs',
		);
		assert.ok(!agentFindings.some(f => f.id.startsWith('agent-')), "the channel's numbering doesn't survive");
		assert.deepStrictEqual(
			[...(entry?.session?.findingStates.keys() ?? [])],
			[first],
			'the state stays on its finding',
		);
		assert.deepStrictEqual(withoutRunFindingIds(entry?.deepReview), {
			run: 2,
			purpose: 'review',
			handOff: 'delivered',
			active: true,
			done: false,
			count: 1,
			seqApplied: 1,
			notesApplied: 0,
		});

		// The reader moved to a commit; the agent's next report still belongs to the WIP review
		state.activeModeSha.set('c1');
		controller.review.applyDeepReviewState({
			run: 2,
			anchor: anchor,
			anchorKey: wipKey('/A'),
			purpose: 'review',
			handOff: 'delivered',
			active: true,
			done: false,
			findings: [
				{ seq: 1, finding: finding('agent-3') },
				{ seq: 2, finding: finding('agent-4') },
			],
			notes: [],
		});
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.deepReview?.seqApplied, 2);
		assert.strictEqual(
			host.crossPaneState.runningOperations.get().get(anchorKey({ sha: 'c1', shas: undefined, repoPath: '/A' })),
			undefined,
			'no entry is conjured for the review that happens to be shown',
		);
	});

	test('what a deep review reports joins the result as the agent area, once per sequence, even before any run', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		const f1 = {
			id: 'agent-1',
			severity: 'warning',
			title: 'one',
			description: '',
			filePath: 'a.ts',
			source: 'agent',
		} as const;
		const f2 = {
			id: 'agent-2',
			severity: 'critical',
			title: 'two',
			description: '',
			filePath: 'b.ts',
			source: 'agent',
		} as const;
		const anchor = { kind: 'wip', repoPath: '/A', sha: uncommitted };
		controller.review.applyDeepReviewState({
			run: 1,
			anchor: anchor,
			anchorKey: wipKey('/A'),
			purpose: 'review',
			handOff: 'delivered',
			active: true,
			done: false,
			findings: [{ seq: 1, finding: f1 }],
			notes: [],
		});
		let entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.execState, 'complete', 'a result exists now, so the panel shows it');
		assert.deepStrictEqual(withoutRunFindingIds(entry?.deepReview), {
			run: 1,
			purpose: 'review',
			handOff: 'delivered',
			active: true,
			done: false,
			count: 1,
			seqApplied: 1,
			notesApplied: 0,
		});
		let result = entry?.result != null && 'result' in entry.result ? entry.result.result : undefined;
		assert.deepStrictEqual(
			result?.focusAreas.map(a => [a.id, a.findings?.map(f => f.title)]),
			[['agent', ['one']]],
		);
		// What the agent is shown, and names in its notes, is the id the finding has in the review
		const one = result?.focusAreas[0].findings?.[0].id ?? '';

		controller.review.applyDeepReviewState({
			run: 1,
			anchor: anchor,
			anchorKey: wipKey('/A'),
			purpose: 'review',
			handOff: 'delivered',
			active: false,
			done: true,
			findings: [
				{ seq: 1, finding: f1 },
				{ seq: 2, finding: f2 },
			],
			notes: [{ seq: 1, findingId: one, text: 'the caller guards this' }],
		});
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		result = entry?.result != null && 'result' in entry.result ? entry.result.result : undefined;
		assert.deepStrictEqual(
			entry?.session?.notes.get(one)?.map(n => [n.author, n.text]),
			[['agent', 'the caller guards this']],
			'what the agent added to a finding lands as a note on it',
		);
		assert.strictEqual(entry?.deepReview?.notesApplied, 1);
		const area = result?.focusAreas.find(a => a.id === 'agent');
		assert.deepStrictEqual(
			area?.findings?.map(f => f.title),
			['one', 'two'],
			'a replayed finding is not added twice',
		);
		assert.strictEqual(area?.findings?.[0].id, one);
		assert.strictEqual(area?.severity, 'critical');
		assert.deepStrictEqual(withoutRunFindingIds(entry?.deepReview), {
			run: 1,
			purpose: 'review',
			handOff: 'delivered',
			active: false,
			done: true,
			count: 2,
			seqApplied: 2,
			notesApplied: 1,
		});

		// Putting the strip away holds for the run — a later report of it doesn't bring it back; a new run does
		controller.review.hideDeepReview();
		const report = (run: number) =>
			controller.review.applyDeepReviewState({
				run: run,
				anchor: anchor,
				anchorKey: wipKey('/A'),
				purpose: 'review',
				handOff: 'delivered',
				active: true,
				done: true,
				findings: [],
				notes: [],
			});
		report(1);
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.deepReview?.hidden, true);
		report(2);
		entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
		assert.strictEqual(entry?.deepReview?.hidden, undefined);
	});

	suite('running Review Diff again', () => {
		const anchor = { kind: 'wip', repoPath: '/A', sha: uncommitted };
		const agentFinding = (id: string) =>
			({ id: id, severity: 'warning', title: id, description: '', filePath: 'a.ts', source: 'agent' }) as const;
		const modelResult = (title: string): ReviewResult =>
			({
				result: {
					overview: title,
					mode: 'single-pass',
					focusAreas: [
						{
							id: 'area-1',
							label: 'Area',
							rationale: '',
							severity: 'warning',
							files: ['a.ts'],
							findings: [{ id: 'area-1-f1', severity: 'warning', title: title, description: '' }],
						},
					],
				},
			}) as unknown as ReviewResult;

		function setupReRun(reviewChanges: () => Promise<ReviewResult>): {
			host: FakeHost;
			state: DetailsState;
			actions: DetailsActions;
			controller: DetailsWorkflowController;
			entry: () => RunningOperationBucket['review'];
			/** The areas with their findings' titles — the ids are the review's own, see `idOf` */
			areas: () => [string, string[] | undefined][];
			idOf: (title: string) => string | undefined;
		} {
			const host = new FakeHost({
				repoPath: '/A',
				graphRepoPath: '/A',
				selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
			});
			const state = createDetailsState();
			const actions = new DetailsActions(
				state,
				createServices({ reviewChanges: reviewChanges }),
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

			const entry = () => host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review;
			const areas = (): [string, string[] | undefined][] => {
				const value = entry()?.result;
				return value != null && 'result' in value
					? value.result.focusAreas.map(a => [a.id, a.findings?.map(f => f.title)])
					: [];
			};
			const idOf = (title: string): string | undefined => {
				const value = entry()?.result;
				return value != null && 'result' in value
					? value.result.focusAreas.flatMap(a => a.findings ?? []).find(f => f.title === title)?.id
					: undefined;
			};
			return {
				host: host,
				state: state,
				actions: actions,
				controller: controller,
				entry: entry,
				areas: areas,
				idOf: idOf,
			};
		}

		test("keeps the deep review's channel state and the agent's findings, with what the agent reports meanwhile", async () => {
			let settle!: (value: ReviewResult) => void;
			const { controller, actions, entry, areas, idOf } = setupReRun(
				() => new Promise<ReviewResult>(resolve => (settle = resolve)),
			);
			controller.review.applyDeepReviewState({
				run: 1,
				anchor: anchor,
				anchorKey: wipKey('/A'),
				purpose: 'review',
				handOff: 'delivered',
				active: true,
				done: false,
				findings: [{ seq: 1, finding: agentFinding('agent-1') }],
				notes: [],
			});
			const agentId = idOf('agent-1')!;
			controller.review.setFindingState(agentId, 'dismissed');
			const deepReview = entry()?.deepReview;

			controller.runReview('/A', undefined, undefined, 0);
			assert.strictEqual(entry()?.execState, 'generating');
			assert.strictEqual(entry()?.deepReview, deepReview, 'the status strip stays while the channel is open');
			assert.deepStrictEqual(areas(), [['agent', ['agent-1']]], "the agent's findings ride through the run");

			// The agent reports again while the model runs — only what's past the applied sequence is new
			controller.review.applyDeepReviewState({
				run: 1,
				anchor: anchor,
				anchorKey: wipKey('/A'),
				purpose: 'review',
				handOff: 'delivered',
				active: true,
				done: false,
				findings: [
					{ seq: 1, finding: agentFinding('agent-1') },
					{ seq: 2, finding: agentFinding('agent-2') },
				],
				notes: [],
			});
			assert.strictEqual(entry()?.execState, 'generating');

			settle(modelResult('model'));
			await flush();
			assert.strictEqual(entry()?.execState, 'complete');
			assert.deepStrictEqual(areas(), [
				['area-1', ['model']],
				['agent', ['agent-1', 'agent-2']],
			]);
			assert.strictEqual(entry()?.deepReview?.seqApplied, 2);
			assert.strictEqual(idOf('agent-1'), agentId);
			assert.strictEqual(entry()?.session?.findingStates.get(agentId), 'dismissed', 'its state still applies');
			const shown = actions.resources.review.value.get();
			assert.strictEqual(shown, entry()?.result, 'the panel shows the merged result');
		});

		test('cancelling a re-run leaves the review as it was before it, with the agent findings', async () => {
			let run = 0;
			const pending: ((value: ReviewResult) => void)[] = [];
			const { controller, entry, areas } = setupReRun(() =>
				++run === 1
					? Promise.resolve(modelResult('first'))
					: new Promise<ReviewResult>(resolve => pending.push(resolve)),
			);
			controller.runReview('/A', undefined, undefined, 0);
			await flush();
			controller.review.applyDeepReviewState({
				run: 1,
				anchor: anchor,
				anchorKey: wipKey('/A'),
				purpose: 'review',
				handOff: 'delivered',
				active: true,
				done: false,
				findings: [{ seq: 1, finding: agentFinding('agent-1') }],
				notes: [],
			});

			controller.runReview('/A', undefined, undefined, 0);
			assert.strictEqual(entry()?.execState, 'generating');
			controller.cancelOperation('review');
			assert.strictEqual(entry()?.execState, 'complete');
			assert.deepStrictEqual(areas(), [
				['area-1', ['first']],
				['agent', ['agent-1']],
			]);
		});

		test('stepping back and running again re-queues nothing for the findings already seen', async () => {
			const result = {
				result: {
					overview: '',
					mode: 'single-pass',
					focusAreas: [
						{
							id: 'area-1',
							label: 'Area',
							rationale: '',
							severity: 'warning',
							files: ['a.ts'],
							findings: [
								{
									id: 'area-1-f1',
									severity: 'warning',
									title: 'Leak',
									description: '',
									filePath: 'a.ts',
								},
							],
						},
					],
				},
			} as unknown as ReviewResult;
			const { controller, entry } = setupReRun(async () => result);
			controller.runReview('/A', undefined, undefined, 0);
			await flush();
			controller.review.setFilesViewed([{ path: 'a.ts' }], true);

			controller.review.back();
			controller.runReview('/A', undefined, undefined, 0);
			await flush();
			assert.strictEqual(entry()?.execState, 'complete');
			assert.deepStrictEqual(
				Array.from(entry()?.session?.viewed ?? [], ([path, mark]) => [path, mark.requeued === true]),
				[['a.ts', false]],
			);
		});

		test('a thread action after the re-run applies only what the journal added since', async () => {
			let run = 0;
			const { controller, host, entry, areas, idOf } = setupReRun(async () => modelResult(`run ${++run}`));
			controller.runReview('/A', undefined, undefined, 0);
			await flush();

			const journal = [
				{ seq: 1, findingId: idOf('run 1')!, action: 'delete' as const },
				{ seq: 2, findingId: 'user-1', action: 'askReviewer' as const, text: 'why?' },
			];
			controller.review.applyThreadActions({ anchor: wipKey('/A'), actions: journal });
			assert.deepStrictEqual(areas(), []);
			assert.strictEqual(entry()?.threadActionsApplied, 2);

			controller.runReview('/A', undefined, undefined, 0);
			assert.strictEqual(entry()?.threadActionsApplied, 2, 'the cursor outlives the dispatch');
			await flush();
			assert.deepStrictEqual(areas(), [['area-1', ['run 2']]]);
			const second = idOf('run 2')!;

			controller.review.applyThreadActions({
				anchor: wipKey('/A'),
				actions: [...journal, { seq: 3, findingId: second, action: 'reply', text: 'agreed' }],
			});
			assert.deepStrictEqual(areas(), [['area-1', ['run 2']]], 'the earlier delete is not replayed');
			assert.deepStrictEqual(host.handOffs, ['ask:user-1:why?'], 'nor is the earlier hand-off');
			assert.deepStrictEqual(
				entry()
					?.session?.notes.get(second)
					?.map(n => n.text),
				['agreed'],
			);
			assert.strictEqual(entry()?.threadActionsApplied, 3);
		});

		test("a failed run leaves the agent's findings to Go Back and to the retry", async () => {
			let fail = true;
			const { controller, state, entry, areas } = setupReRun(async () =>
				fail ? { error: { message: 'boom' } } : modelResult('retried'),
			);
			controller.review.applyDeepReviewState({
				run: 1,
				anchor: anchor,
				anchorKey: wipKey('/A'),
				purpose: 'review',
				handOff: 'delivered',
				active: true,
				done: false,
				findings: [{ seq: 1, finding: agentFinding('agent-1') }],
				notes: [],
			});

			controller.runReview('/A', undefined, undefined, 0);
			await flush();
			assert.strictEqual(entry()?.execState, 'error');
			const preError = state.reviewPreErrorValue.get();
			assert.deepStrictEqual(
				preError != null && 'result' in preError
					? preError.result.focusAreas.map(a => [a.id, a.findings?.map(f => f.title)])
					: undefined,
				[['agent', ['agent-1']]],
			);

			// The agent reports over the error: the earlier finding comes along with the new one
			controller.review.applyDeepReviewState({
				run: 1,
				anchor: anchor,
				anchorKey: wipKey('/A'),
				purpose: 'review',
				handOff: 'delivered',
				active: true,
				done: false,
				findings: [
					{ seq: 1, finding: agentFinding('agent-1') },
					{ seq: 2, finding: agentFinding('agent-2') },
				],
				notes: [],
			});
			assert.deepStrictEqual(areas(), [['agent', ['agent-1', 'agent-2']]]);

			// And a failed run again, then a retry that succeeds
			controller.runReview('/A', undefined, undefined, 0);
			await flush();
			assert.strictEqual(entry()?.execState, 'error');
			fail = false;
			controller.review.retryFromError('/A', undefined, 0);
			await flush();
			assert.strictEqual(entry()?.execState, 'complete');
			assert.deepStrictEqual(areas(), [
				['area-1', ['retried']],
				['agent', ['agent-1', 'agent-2']],
			]);
		});

		suite('finding ids', () => {
			type Found = Pick<AIReviewFinding, 'title' | 'filePath'>;
			const found = (title: string, path: string): Found => ({ title: title, filePath: path });
			const positional = (areaId: string, findings: Found[]): AIReviewFinding[] =>
				findings.map((f, j) => ({
					id: `${areaId}-f${j + 1}`,
					severity: 'warning',
					title: f.title,
					description: '',
					filePath: f.filePath,
					lineRange: { start: j + 1, end: j + 1 },
				}));
			/** A result as the model gives it: areas `area-N`, findings numbered by place, `area-N-fM` */
			const resultOf = (mode: 'single-pass' | 'two-pass', ...areas: (Found[] | undefined)[]): ReviewResult =>
				({
					result: {
						overview: '',
						mode: mode,
						focusAreas: areas.map((findings, i) => ({
							id: `area-${i + 1}`,
							label: `Area ${i + 1}`,
							rationale: '',
							severity: 'warning',
							files: [],
							...(findings != null ? { findings: positional(`area-${i + 1}`, findings) } : {}),
						})),
					},
				}) as unknown as ReviewResult;
			const resultIn = (entry: RunningOperationBucket['review']) =>
				entry?.result != null && 'result' in entry.result ? entry.result.result : undefined;

			test("a re-run keeps each finding's state and notes on the finding itself, wherever it lands now", async () => {
				const runs = [
					resultOf('single-pass', [found('alpha', 'a.ts'), found('beta', 'b.ts')]),
					// The same two again in another order, one of them in another area now — and something new in
					// the first place
					resultOf('single-pass', [found('gamma', 'a.ts'), found('Beta ', 'b.ts')], [found('ALPHA', 'a.ts')]),
				];
				let run = 0;
				const { controller, entry, areas, idOf } = setupReRun(async () => runs[run++]);
				controller.runReview('/A', undefined, undefined, 0);
				await flush();
				const alpha = idOf('alpha')!;
				const beta = idOf('beta')!;
				assert.ok(!alpha.startsWith('area-') && !beta.startsWith('area-'), 'the ids by place do not survive');
				assert.notStrictEqual(alpha, beta);
				controller.review.setFindingState(alpha, 'dismissed');
				controller.review.addFindingNote(beta, 'is this reachable?');

				controller.runReview('/A', undefined, undefined, 0);
				await flush();
				assert.deepStrictEqual(areas(), [
					['area-1', ['gamma', 'Beta ']],
					['area-2', ['ALPHA']],
				]);
				assert.strictEqual(
					idOf('ALPHA'),
					alpha,
					'the same file and title — whatever the case — is the same finding',
				);
				assert.strictEqual(idOf('Beta '), beta);
				const gamma = idOf('gamma')!;
				assert.ok(gamma !== alpha && gamma !== beta, 'a new finding gets an id of its own');

				const session = entry()?.session;
				assert.strictEqual(session?.findingStates.get(alpha), 'dismissed');
				assert.strictEqual(
					session?.findingStates.has(gamma),
					false,
					'the finding in its old place inherits nothing',
				);
				assert.deepStrictEqual(
					session?.notes.get(beta)?.map(n => n.text),
					['is this reachable?'],
				);
				assert.strictEqual(session?.notes.has(gamma), false);
				assert.deepStrictEqual(
					getReviewReplies(resultIn(entry()), session).map(r => r.finding.title),
					['Beta '],
					"the reader's reply shows on the finding it was made on",
				);

				// The agent is told the same ids it is to add its notes under
				const context = formatReviewForAgentContext(resultIn(entry())!, session?.findingStates, session?.notes);
				assert.ok(context.includes(`id: ${alpha} · `) && context.includes(`id: ${gamma} · `), context);
				assert.ok(!context.includes('area-1-f'), context);
			});

			test('two alike findings in a file stay two; found once again, the first one keeps its id', async () => {
				const runs = [
					resultOf('single-pass', [found('dup', 'a.ts'), found('dup', 'a.ts')]),
					resultOf('single-pass', [found('dup', 'a.ts')]),
				];
				let run = 0;
				const { controller, entry } = setupReRun(async () => runs[run++]);
				controller.runReview('/A', undefined, undefined, 0);
				await flush();
				const [first, second] = resultIn(entry())!.focusAreas[0].findings!.map(f => f.id);
				assert.notStrictEqual(first, second);
				controller.review.setFindingState(second, 'dismissed');

				controller.runReview('/A', undefined, undefined, 0);
				await flush();
				assert.deepStrictEqual(
					resultIn(entry())!.focusAreas[0].findings!.map(f => f.id),
					[first],
				);
				assert.strictEqual(entry()?.session?.findingStates.has(first), false);
			});

			test("a thread whose opening was deleted keeps its id; a later run's finding never takes it", async () => {
				const { controller, entry, idOf } = setupReRun(async () =>
					resultOf('single-pass', [found('alpha', 'a.ts')]),
				);
				controller.runReview('/A', undefined, undefined, 0);
				await flush();
				const alpha = idOf('alpha')!;
				// A second run finds it again, so the finding is one the review knew before when its opening goes
				controller.runReview('/A', undefined, undefined, 0);
				await flush();
				assert.strictEqual(idOf('alpha'), alpha);
				controller.review.addFindingNote(alpha, 'why?');
				controller.review.setFindingState(alpha, 'dismissed');
				controller.review.applyThreadActions({
					anchor: wipKey('/A'),
					actions: [{ seq: 1, findingId: alpha, action: 'deleteOpening' }],
				});
				assert.deepStrictEqual(
					entry()?.session?.comments?.map(c => [c.id, c.description]),
					[[alpha, 'why?']],
				);

				controller.runReview('/A', undefined, undefined, 0);
				await flush();
				const again = idOf('alpha')!;
				assert.notStrictEqual(again, alpha, "the comment's id is not the finding's to take back");
				const session = entry()?.session;
				assert.deepStrictEqual(
					session?.comments?.map(c => [c.id, c.description]),
					[[alpha, 'why?']],
				);
				assert.strictEqual(session?.findingStates.get(alpha), 'dismissed', 'the thread keeps its state');
				assert.strictEqual(session?.findingStates.has(again), false);
				const threads = getReviewThreadItems(withReviewComments(resultIn(entry()), session), session);
				assert.deepStrictEqual(
					threads.map(t => [t.id, t.source ?? 'model']),
					[
						[alpha, 'user'],
						[again, 'model'],
					],
				);
			});

			test("a two-pass area's details keep the ids of the area's findings before, and of the run before", async () => {
				const { controller, entry } = setupReRun(async () => resultOf('two-pass', undefined, undefined));
				const ids = (areaId: string) =>
					resultIn(entry())
						?.focusAreas.find(a => a.id === areaId)
						?.findings?.map(f => [f.title, f.id]);
				controller.runReview('/A', undefined, undefined, 0);
				await flush();

				const detail = controller.review.enrichFocusAreaFindings('area-1', {
					findings: positional('area-1', [found('alpha', 'a.ts')]),
				});
				const alpha = ids('area-1')![0][1];
				assert.deepStrictEqual(
					detail.findings.map(f => f.id),
					[alpha],
					'the panel gets the ids the review keeps',
				);
				controller.review.setFindingState(alpha, 'dismissed');

				// Analyzing the area again
				controller.review.enrichFocusAreaFindings('area-1', {
					findings: positional('area-1', [found('beta', 'b.ts'), found('alpha', 'a.ts')]),
				});
				const beta = ids('area-1')![0][1];
				assert.deepStrictEqual(ids('area-1'), [
					['beta', beta],
					['alpha', alpha],
				]);
				assert.notStrictEqual(beta, alpha);
				// The same finding in another area is that area's own
				controller.review.enrichFocusAreaFindings('area-2', {
					findings: positional('area-2', [found('alpha', 'a.ts')]),
				});
				const elsewhere = ids('area-2')![0][1];
				assert.ok(elsewhere !== alpha && elsewhere !== beta);

				// A new run: its details come in after it settled, and still find their findings from before
				controller.runReview('/A', undefined, undefined, 0);
				await flush();
				controller.review.enrichFocusAreaFindings('area-1', {
					findings: positional('area-1', [found('alpha', 'a.ts'), found('beta', 'b.ts')]),
				});
				assert.deepStrictEqual(ids('area-1'), [
					['alpha', alpha],
					['beta', beta],
				]);
				assert.strictEqual(entry()?.session?.findingStates.get(alpha), 'dismissed');
			});

			test('an agent finding reported again keeps its id, its state and its place', () => {
				const { controller, entry } = setupReRun(async () => resultOf('single-pass'));
				const report = (run: number, findings: { seq: number; finding: AIReviewFinding }[]) =>
					controller.review.applyDeepReviewState({
						run: run,
						anchor: anchor,
						anchorKey: wipKey('/A'),
						purpose: 'review',
						handOff: 'delivered',
						active: true,
						done: false,
						findings: findings,
						notes: [],
					});
				const agentFindings = () => resultIn(entry())?.focusAreas.find(a => a.id === 'agent')?.findings ?? [];

				report(1, [
					{ seq: 1, finding: agentFinding('one') },
					{ seq: 2, finding: agentFinding('two') },
				]);
				const [one, two] = agentFindings().map(f => f.id);
				controller.review.setFindingState(one, 'dismissed');

				// A later run reports the first one again — under the channel's own numbering, `agent-2`
				report(2, [
					{ seq: 1, finding: { ...agentFinding('three'), id: 'agent-1' } },
					{ seq: 2, finding: { ...agentFinding('one'), id: 'agent-2', description: 'still there' } },
				]);
				const now = agentFindings();
				assert.deepStrictEqual(
					now.map(f => [f.title, f.description]),
					[
						['one', 'still there'],
						['two', ''],
						['three', ''],
					],
				);
				assert.deepStrictEqual(
					now.slice(0, 2).map(f => f.id),
					[one, two],
				);
				assert.strictEqual(new Set(now.map(f => f.id)).size, 3);
				assert.strictEqual(entry()?.session?.findingStates.get(one), 'dismissed');
			});

			test('two alike agent findings in separate reports of one run stay two', () => {
				const { controller, entry } = setupReRun(async () => resultOf('single-pass'));
				const report = (findings: { seq: number; finding: AIReviewFinding }[]) =>
					controller.review.applyDeepReviewState({
						run: 1,
						anchor: anchor,
						anchorKey: wipKey('/A'),
						purpose: 'review',
						handOff: 'delivered',
						active: true,
						done: false,
						findings: findings,
						notes: [],
					});
				const agentFindings = () => resultIn(entry())?.focusAreas.find(a => a.id === 'agent')?.findings ?? [];

				const first = { seq: 1, finding: { ...agentFinding('same'), lineRange: { start: 1, end: 1 } } };
				report([first]);
				const [id] = agentFindings().map(f => f.id);
				controller.review.setFindingState(id, 'dismissed');
				// The next report of the same run: the same title in the same file, at other lines
				report([
					first,
					{ seq: 2, finding: { ...agentFinding('same'), id: 'agent-2', lineRange: { start: 9, end: 9 } } },
				]);

				const now = agentFindings();
				assert.deepStrictEqual(
					now.map(f => f.lineRange?.start),
					[1, 9],
					'the first is not replaced',
				);
				assert.strictEqual(new Set(now.map(f => f.id)).size, 2);
				assert.strictEqual(entry()?.session?.findingStates.get(id), 'dismissed');
			});
		});
	});

	test('findings on files already viewed put them back in the queue — from a settled run, a detail run and the agent', async () => {
		const finding = (id: string, path: string, source?: 'agent') =>
			({ id: id, severity: 'warning', title: id, description: '', filePath: path, source: source }) as const;
		const runResult = {
			result: {
				overview: '',
				mode: 'two-pass',
				focusAreas: [
					{
						id: 'area-1',
						label: 'One',
						rationale: '',
						severity: 'warning',
						files: [],
						findings: [finding('area-1-f1', 'a.ts')],
					},
					{ id: 'area-2', label: 'Two', rationale: '', severity: 'warning', files: [] },
				],
			},
		} as unknown as ReviewResult;
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/A',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		const actions = new DetailsActions(
			state,
			createServices({ reviewChanges: async () => runResult }),
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
		const requeued = () => {
			const session = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.review?.session;
			return [...(session?.viewed ?? [])].filter(([, m]) => m.requeued).map(([p]) => p);
		};

		controller.review.setFilesViewed([{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }], true);
		controller.runReview('/A', undefined, undefined, 0);
		await flush();
		assert.deepStrictEqual(requeued(), ['a.ts'], 'the run found something in a.ts');

		// Marking it viewed again takes it out of the queue
		controller.review.setFilesViewed([{ path: 'a.ts' }], true);
		assert.deepStrictEqual(requeued(), []);

		// A detail run fills in the second area: b.ts is new to the findings, a.ts isn't
		controller.review.enrichFocusAreaFindings('area-2', {
			findings: [finding('area-2-f1', 'b.ts'), finding('area-1-f1', 'a.ts')],
		});
		assert.deepStrictEqual(requeued(), ['b.ts']);
		controller.review.setFilesViewed([{ path: 'b.ts' }], true);

		// The reader's own comment and the agent's word on a finding already there re-queue nothing
		controller.review.applyThreadActions({
			anchor: wipKey('/A'),
			actions: [
				{
					seq: 1,
					findingId: 'u1',
					action: 'comment',
					text: 'mine',
					place: { path: 'c.ts', line: 1, lineEnd: 1 },
				},
			],
		});
		const anchor = { kind: 'wip', repoPath: '/A', sha: uncommitted };
		controller.review.applyDeepReviewState({
			run: 1,
			anchor: anchor,
			anchorKey: wipKey('/A'),
			purpose: 'review',
			handOff: 'delivered',
			active: true,
			done: false,
			findings: [],
			notes: [{ seq: 1, findingId: 'area-1-f1', text: 'still holds' }],
		});
		assert.deepStrictEqual(requeued(), []);

		// What the agent reports new does
		controller.review.applyDeepReviewState({
			run: 1,
			anchor: anchor,
			anchorKey: wipKey('/A'),
			purpose: 'review',
			handOff: 'delivered',
			active: true,
			done: false,
			findings: [{ seq: 1, finding: finding('agent-1', 'c.ts', 'agent') }],
			notes: [{ seq: 1, findingId: 'area-1-f1', text: 'still holds' }],
		});
		assert.deepStrictEqual(requeued(), ['c.ts']);
	});

	test('abortRunningOperations aborts focus-area runs along with the overview run', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeReviewBucket('/A', makeReviewResult('two-pass'))]]),
		);
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		const run = controller.review.startFocusAreaRun('area-1');
		assert.ok(run);

		abortRunningOperations(host.crossPaneState);

		assert.strictEqual(run.signal.aborted, true);
		assert.strictEqual(host.crossPaneState.runningOperations.get().size, 0);
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

	test('closing a backed entry preserves its result and Resume', () => {
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

		// Closing hides the backed result without discarding its Resume.
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(host.crossPaneState.runningOperations.get().size, 1, 'entry preserved');
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });
		assert.strictEqual(state.reviewForwardAvailable.get(), true);
		assert.strictEqual(controller.review.forward(), true);
		assert.deepStrictEqual(actions.resources.review.value.get(), makeReviewResult('to-destroy'));
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

	test('closing a backed operation forgets the remembered mode without discarding the entry', () => {
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

		// Explicit Close forgets engagement but preserves the operation.
		controller.toggleMode('review', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(host.crossPaneState.runningOperations.get().size, 1, 'entry preserved');
		assert.strictEqual(
			controller.getRememberedMode({ sha: uncommitted, shas: undefined, repoPath: '/A' }),
			undefined,
			'remembered mode forgotten on explicit Close',
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

	test('toggle-out captures the compose Refine posture + unsubmitted draft onto the preserved entry', () => {
		// User has a ready compose plan, toggled Recompose on and typed a draft, then toggles the
		// compose chip off. The entry survives (hideMode) and now carries the posture + draft so a
		// return restores them. Also exercises the dedup guard: execState/result are unchanged, so
		// without the refine-field comparison the write would be dropped.
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const result = makeComposeResult('capture-on-leave');
		host.crossPaneState.runningOperations.set(new Map([[wipKey('/A'), makeComposeBucket('/A', result)]]));
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		host.engagedRefineState = { refineMode: true, refineDraft: 'merge commits 1 and 2' };

		controller.toggleMode('compose', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), null, 'panel hidden');
		const surviving = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.ok(surviving, 'entry persists through toggle-out');
		assert.strictEqual(surviving.result, result, 'result preserved');
		assert.strictEqual(surviving.refineMode, true, 'refine posture captured despite unchanged execState/result');
		assert.strictEqual(surviving.refineDraft, 'merge commits 1 and 2', 'refine draft captured');
	});

	test('capture-on-leave stores undefined for a closed gate / whitespace-only draft', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeComposeBucket('/A', makeComposeResult('x'))]]),
		);
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		host.engagedRefineState = { refineMode: false, refineDraft: '   ' };

		controller.toggleMode('compose', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(entry?.refineMode, undefined, 'closed gate stored as undefined');
		assert.strictEqual(entry?.refineDraft, undefined, 'whitespace-only draft stored as undefined');
	});

	test('capture-on-leave no-ops when the live panel reports nothing (readEngagedRefineState undefined)', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		host.crossPaneState.runningOperations.set(
			new Map([[wipKey('/A'), makeComposeBucket('/A', makeComposeResult('x'))]]),
		);
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		host.engagedRefineState = undefined;

		controller.toggleMode('compose', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.ok(entry, 'entry preserved');
		assert.strictEqual(entry.refineMode, undefined);
		assert.strictEqual(entry.refineDraft, undefined);
	});

	test('capture-on-leave no-ops when the engaged anchor has no registry entry', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		// No entry planted — the gate/draft belong to no persisted plan.
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		host.engagedRefineState = { refineMode: true, refineDraft: 'orphan' };

		controller.toggleMode('compose', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(
			host.crossPaneState.runningOperations.get().get(wipKey('/A')),
			undefined,
			'no phantom entry created by capture',
		);
	});

	test('switchAnchorWithinMode captures the OUTGOING anchor Refine state, leaves the incoming untouched', () => {
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

		host.crossPaneState.runningOperations.set(
			new Map([
				[wipKey('/A'), makeComposeBucket('/A', makeComposeResult('A-plan'))],
				[wipKey('/B'), makeComposeBucket('/B', makeComposeResult('B-plan'))],
			]),
		);
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		host.engagedRefineState = { refineMode: true, refineDraft: 'A draft' };

		controller.switchAnchorWithinMode({ sha: uncommitted, shas: undefined, repoPath: '/B' });

		const a = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(a?.refineMode, true, 'outgoing /A captured its posture');
		assert.strictEqual(a?.refineDraft, 'A draft', 'outgoing /A captured its draft');
		const b = host.crossPaneState.runningOperations.get().get(wipKey('/B'))?.compose;
		assert.strictEqual(b?.refineMode, undefined, 'incoming /B posture untouched');
		assert.strictEqual(b?.refineDraft, undefined, 'incoming /B draft untouched');
	});

	test('a fresh compose run drops any captured Refine posture + draft from the entry', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		// Prior plan carries captured refine state.
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						compose: {
							kind: 'compose' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'complete' as const,
							result: makeComposeResult('prior'),
							refineMode: true,
							refineDraft: 'stale draft',
						},
					},
				],
			]),
		);
		state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/A');
		state.activeModeSha.set(uncommitted);

		controller.runCompose('/A', 'new instructions', undefined, undefined, 0);

		// The fresh generating entry (registered synchronously by dispatchOperation) drops the stale
		// refine fields — a new run starts in the default posture with an empty box.
		const generating = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(generating?.execState, 'generating');
		assert.strictEqual(generating?.refineMode, undefined, 'refine posture dropped on fresh dispatch');
		assert.strictEqual(generating?.refineDraft, undefined, 'refine draft dropped on fresh dispatch');
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

		controller.runCompose('/A', 'my prompt', undefined, undefined, 0);

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

suite('DetailsWorkflowController — Close preserves AI work', () => {
	for (const kind of ['review', 'compose'] as const) {
		test(`${kind}: Restart, Close, and anchor navigation preserve valid Resume`, () => {
			const { host, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			const selection = { repoPath: '/A', sha: uncommitted, shas: undefined };
			const bucket =
				kind === 'review'
					? makeReviewBucket('/A', makeReviewResult('saved'), 'complete', 'instructions')
					: makeComposeBucket('/A', makeComposeResult('saved'), 'complete', 'instructions');
			host.crossPaneState.runningOperations.set(new Map([[wipKey('/A'), bucket]]));
			controller.toggleMode(kind, selection);
			controller[kind].back();
			controller.toggleMode(kind, selection);
			assert.strictEqual(
				host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.[kind]?.result,
				bucket[kind]?.result,
			);
			controller.toggleMode(kind, selection);
			controller.switchAnchorWithinMode({ repoPath: '/A', sha: 'other-commit', shas: undefined });
			controller.toggleMode(kind, selection);
			assert.strictEqual(controller[kind].forward(), true, 'Resume survives the round trip');
			assert.strictEqual(actions.resources[kind].value.get(), bucket[kind]?.result);
		});

		test(`${kind}: input edits invalidate Resume permanently across a Close and navigation`, () => {
			const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			const selection = { repoPath: '/A', sha: uncommitted, shas: undefined };
			host.crossPaneState.runningOperations.set(
				new Map([
					[
						wipKey('/A'),
						kind === 'review'
							? makeReviewBucket('/A', makeReviewResult('old'))
							: makeComposeBucket('/A', makeComposeResult('old')),
					],
				]),
			);
			controller.toggleMode(kind, selection);
			controller[kind].back();
			controller[kind].invalidateSnapshot();
			host.engagedIdleDraft = 'new instructions';
			controller.toggleMode(kind, selection);
			controller.toggleMode(kind, selection);
			assert.strictEqual(controller[kind].forward(), false, 'old result must not become resumable again');
			controller.switchAnchorWithinMode({ repoPath: '/A', sha: 'other-commit', shas: undefined });
			controller.toggleMode(kind, selection);
			assert.strictEqual(controller[kind].forward(), false);
			assert.strictEqual(
				host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.[kind]?.idleDraft,
				'new instructions',
			);
		});

		test(`${kind}: unsubmitted idle input and selected scope survive Close before the first run`, () => {
			const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			const selection = { repoPath: '/A', sha: uncommitted, shas: undefined };
			controller.toggleMode(kind, selection);
			const scope: ScopeSelection = {
				type: 'wip',
				includeStaged: false,
				includeUnstaged: false,
				includeShas: ['chosen'],
			};
			state.scope.set(scope);
			host.engagedIdleDraft = 'not submitted';
			host.engagedExclusions = { files: new Set(['excluded.ts']), commits: new Set(['omitted']) };
			controller.toggleMode(kind, selection);
			controller.toggleMode(kind, selection);
			const entry = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.[kind];
			assert.strictEqual(entry?.idleDraft, 'not submitted');
			assert.deepStrictEqual(entry?.excludedFiles, new Set(['excluded.ts']));
			if (kind === 'compose') {
				assert.deepStrictEqual(
					host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose?.commitExcludedIds,
					new Set(['omitted']),
				);
			}
			assert.strictEqual(state.scope.get(), scope);
			assert.strictEqual(controller[kind].forward(), false);
			// Empty is an intentional draft too; it must not fall back to the old instructions.
			host.engagedIdleDraft = '';
			controller.toggleMode(kind, selection);
			assert.strictEqual(host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.[kind]?.idleDraft, '');
		});

		test(`${kind}: error Close preserves the prior result for Go Back and Resume`, () => {
			const { host, state, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			const selection = { repoPath: '/A', sha: uncommitted, shas: undefined };
			const reviewPrior = makeReviewResult('prior');
			const composePrior = makeComposeResult('prior');
			host.crossPaneState.runningOperations.set(
				new Map([
					[
						wipKey('/A'),
						kind === 'review'
							? makeReviewBucket('/A', { error: { message: 'failed' } }, 'error', 'retry me')
							: makeComposeBucket('/A', { error: { message: 'failed' } }, 'error', 'retry me'),
					],
				]),
			);
			controller.toggleMode(kind, selection);
			if (kind === 'review') {
				state.reviewPreErrorValue.set(reviewPrior);
			} else {
				state.composePreErrorValue.set(composePrior);
				state.composeLastFailedAction.set('commit-all');
				state.composeLastCommitAllIncludedIds.set(['included']);
			}
			controller.toggleMode(kind, selection);
			controller.toggleMode(kind, selection);
			if (kind === 'compose') {
				assert.strictEqual(state.composeLastFailedAction.get(), 'commit-all');
				assert.deepStrictEqual(state.composeLastCommitAllIncludedIds.get(), ['included']);
			}
			controller[kind].backFromError();
			assert.strictEqual(controller[kind].forward(), true);
			assert.strictEqual(actions.resources[kind].value.get(), kind === 'review' ? reviewPrior : composePrior);
		});

		test(`${kind}: closing a backed result cannot expose its Resume on another anchor`, () => {
			const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			const selection = { repoPath: '/A', sha: uncommitted, shas: undefined };
			host.crossPaneState.runningOperations.set(
				new Map([
					[
						wipKey('/A'),
						kind === 'review'
							? makeReviewBucket('/A', makeReviewResult('A'))
							: makeComposeBucket('/A', makeComposeResult('A')),
					],
				]),
			);
			controller.toggleMode(kind, selection);
			controller[kind].back();
			controller.toggleMode(kind, selection);
			controller.toggleMode(kind, { repoPath: '/B', sha: uncommitted, shas: undefined });
			assert.strictEqual(controller[kind].forward(), false, 'B cannot restore A');
			assert.strictEqual(
				kind === 'review' ? state.reviewForwardAvailable.get() : state.composeForwardAvailable.get(),
				false,
			);
			controller.switchAnchorWithinMode(selection);
			controller.toggleMode(kind, selection);
			assert.strictEqual(controller[kind].forward(), true, 'A retains its own Resume');
		});

		test(`${kind}: Close keeps a generating operation alive`, () => {
			const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			const selection = { repoPath: '/A', sha: uncommitted, shas: undefined };
			const abortController = new AbortController();
			const promise = new Promise<ReviewResult | ComposeResult>(() => {});
			host.crossPaneState.runningOperations.set(
				new Map([
					[
						wipKey('/A'),
						{
							[kind]: {
								kind: kind,
								anchor: { kind: 'wip', repoPath: '/A', sha: uncommitted },
								execState: 'generating',
								abortController: abortController,
								promise: promise,
							},
						},
					],
				]),
			);
			controller.toggleMode(kind, selection);
			controller.toggleMode(kind, selection);
			assert.strictEqual(abortController.signal.aborted, false);
			assert.strictEqual(host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.[kind]?.promise, promise);
		});

		test(`${kind}: repository teardown cannot resurrect an unsubmitted draft`, () => {
			const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			controller.toggleMode(kind, { repoPath: '/A', sha: uncommitted, shas: undefined });
			host.engagedIdleDraft = 'belongs to A';
			host.setGraphRepoPath('/B');
			host.tickHostUpdate();
			assert.strictEqual(host.crossPaneState.runningOperations.get().size, 0);
		});

		test(`${kind}: saved exclusions survive generation and an error for Retry`, async () => {
			const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			const selection = { repoPath: '/A', sha: uncommitted, shas: undefined };
			controller.toggleMode(kind, selection);
			host.engagedIdleDraft = 'instructions';
			host.engagedExclusions = { files: new Set(['excluded.ts']), commits: new Set(['omit']) };
			controller.toggleMode(kind, selection);
			controller.toggleMode(kind, selection);
			state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: true, includeShas: [] });
			if (kind === 'compose') {
				controller.runCompose('/A', 'instructions', ['excluded.ts'], undefined, 1);
			} else {
				controller.runReview('/A', 'instructions', ['excluded.ts'], 1);
			}
			assert.deepStrictEqual(
				host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.[kind]?.excludedFiles,
				new Set(['excluded.ts']),
			);
			await flush();
			const failed = host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.[kind];
			assert.strictEqual(failed?.execState, 'error');
			assert.deepStrictEqual(
				failed?.excludedFiles,
				new Set(['excluded.ts']),
				'the panel keeps its exclusions for Retry',
			);
		});

		test(`${kind}: explicit Discard cannot recreate a saved idle draft`, () => {
			const { host, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
			const selection = { repoPath: '/A', sha: uncommitted, shas: undefined };
			controller.toggleMode(kind, selection);
			host.engagedIdleDraft = 'discard this';
			controller[kind].discard();
			assert.strictEqual(host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.[kind], undefined);
		});
	}
});

suite('DetailsWorkflowController.compare lifecycle', () => {
	test('open telemetry counts accepted comparisons and excludes unavailable and repeated opens', () => {
		const { controller, actions } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const events: string[] = [];
		actions.sendTelemetryEvent = name => {
			if (name === 'graphDetails/compare/opened') {
				events.push(name);
			}
		};
		const selection = { sha: undefined, shas: undefined, repoPath: '/A' };
		controller.openCompare(selection);
		assert.deepStrictEqual(events, [], 'no comparison seed means no open');

		controller.openCompare(selection, { leftRef: 'main', rightRef: 'feature' });
		controller.openCompare(selection);
		controller.openCompareAsPanel();
		controller.openCompare(selection);
		assert.deepStrictEqual(events, ['graphDetails/compare/opened'], 'no-op opens in either form are excluded');

		controller.openCompare(selection, { leftRef: 'main', rightRef: 'topic' });
		controller.closeCompare();
		controller.openCompare(selection, { leftRef: 'main', rightRef: 'topic' });
		assert.deepStrictEqual(events, Array(3).fill('graphDetails/compare/opened'), 'retarget and reopen count');
	});

	test('restoring captured refs updates Compare without counting another open', () => {
		const { controller, actions, state } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const events: string[] = [];
		actions.sendTelemetryEvent = name => {
			events.push(name);
		};
		const selection = { sha: undefined, shas: undefined, repoPath: '/A' };
		const refs = { leftRef: 'main', rightRef: 'feature' };
		controller.openCompare(selection, refs);
		controller.closeCompare();
		controller.openCompare(selection, refs, { silent: true });
		assert.strictEqual(state.comparePresentation.get(), 'sheet');
		assert.strictEqual(state.branchCompareRightRef.get(), 'feature');
		assert.deepStrictEqual(events, ['graphDetails/compare/opened']);
	});

	test('promotion telemetry counts only sheet transitions with the effective orientation', () => {
		const { controller, actions, host } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		const events: unknown[] = [];
		actions.sendTelemetryEvent = (name, data) => {
			if (name === 'graphDetails/compare/promoted') {
				events.push(data);
			}
		};
		controller.openCompareAsPanel();
		assert.deepStrictEqual(events, [], 'closed comparisons cannot promote');
		const selection = { sha: undefined, shas: undefined, repoPath: '/A' };
		const refs = { leftRef: 'main', rightRef: 'feature' };
		host.compareOrientation = 'horizontal';
		controller.openCompare(selection, refs);
		controller.openCompareAsPanel();
		controller.openCompareAsPanel('vertical');
		assert.deepStrictEqual(events, [{ orientation: 'horizontal', altKey: false }]);
		controller.closeCompare();
		controller.openCompare(selection, refs);
		controller.openCompareAsPanel('vertical');
		assert.deepStrictEqual(events, [
			{ orientation: 'horizontal', altKey: false },
			{ orientation: 'vertical', altKey: true },
		]);
	});

	test('closed comparisons cannot be promoted and closing resets explicit layout', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		controller.openCompareAsPanel('horizontal');
		assert.strictEqual(state.comparePresentation.get(), 'closed');
		assert.strictEqual(state.compareSplitOrientation.get(), undefined);

		controller.openCompare(
			{ sha: undefined, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', rightRef: 'feature' },
		);
		controller.openCompareAsPanel('horizontal');
		state.compareSplitPosition.set(65);
		assert.strictEqual(state.comparePresentation.get(), 'pinned');
		assert.strictEqual(state.compareSplitOrientation.get(), 'horizontal');

		controller.closeCompare();
		assert.strictEqual(state.comparePresentation.get(), 'closed');
		assert.strictEqual(state.compareSplitOrientation.get(), undefined);
		assert.strictEqual(state.compareSplitPosition.get(), 50);
	});

	test('openCompare with explicit refs opens the sheet and seeds branchCompare state', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		assert.strictEqual(state.comparePresentation.get(), 'closed');

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);

		assert.strictEqual(state.comparePresentation.get(), 'sheet');
		assert.strictEqual(state.branchCompareLeftRef.get(), 'main');
		assert.strictEqual(state.branchCompareRightRef.get(), 'feature');
	});

	test('openCompare records the GRAPH repo as the birth record — not the selection — and closeCompare clears it', () => {
		const { state, controller } = setup({ repoPath: '/A/wt', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A/wt' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		assert.strictEqual(state.branchCompareGraphRepoPath.get(), '/A');

		controller.closeCompare();
		assert.strictEqual(state.branchCompareGraphRepoPath.get(), undefined);
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

	test('closeCompare closes the presentation and all compare state', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		// Pre-set to a non-default tab so the post-close assertion below actually exercises
		// `closeCompare`'s reset (would pass vacuously if we pre-set 'ahead', the default).
		state.branchCompareActiveTab.set('behind');

		controller.closeCompare();

		assert.strictEqual(state.comparePresentation.get(), 'closed');
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

		assert.strictEqual(state.comparePresentation.get(), 'pinned');
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
		assert.strictEqual(state.comparePresentation.get(), 'sheet', 'fresh open is always a sheet');
		assert.strictEqual(state.branchCompareRightRef.get(), 'topic', 'refs were updated');
	});

	test('graph-repo switch closes any open compare (sheet)', () => {
		const { host, state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.openCompare(
			{ sha: uncommitted, shas: undefined, repoPath: '/A' },
			{ leftRef: 'main', leftRefType: 'branch', rightRef: 'feature', rightRefType: 'branch' },
		);
		assert.strictEqual(state.comparePresentation.get(), 'sheet');

		host.setGraphRepoPath('/B');
		host.tickHostUpdate();

		assert.strictEqual(state.comparePresentation.get(), 'closed');
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

		assert.strictEqual(state.comparePresentation.get(), 'closed');
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
			onRepositoryOrWorktreeChanged: () => noopUnsubscribe,
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
		telemetry: {
			sendEvent: () => Promise.resolve(),
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

suite('DetailsWorkflowController.enterComposeWithScope — recompose seeding', () => {
	/** WIP fixture whose `changes.files` carry only the `staged` flag the scope builder reads. */
	function makeWipWithFiles(staged: readonly boolean[]): Wip {
		return {
			changes: { files: staged.map(s => ({ staged: s })) },
			repositoryCount: 1,
			repo: { uri: 'file:///A', name: 'A', path: '/A', isWorktree: false },
		} as unknown as Wip;
	}

	/** Pin the branch-commits cache so toggleMode's WIP-side fetch gate is skipped (getBranchCommits unmocked). */
	function pinBranchCommits(state: DetailsState, actions: DetailsActions, repoPath: string): void {
		state.branchCommits.set([]);
		actions['_branchCommitsFetchedRepoPath'] = repoPath;
	}

	test('seeds the scope with includeShas; includeWip=false forces both flags false even when a file exists', () => {
		const { state, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		pinBranchCommits(state, actions, '/A');
		state.wip.set(makeWipWithFiles([false]));

		controller.enterComposeWithScope({ sha: uncommitted, shas: undefined, repoPath: '/A' }, ['h', 'a', 'b'], false);

		assert.strictEqual(state.activeMode.get(), 'compose');
		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ['h', 'a', 'b'],
		});
	});

	test('includeWip=true folds staged + unstaged working changes into the scope', () => {
		const { state, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		pinBranchCommits(state, actions, '/A');
		state.wip.set(makeWipWithFiles([true, false]));

		controller.enterComposeWithScope({ sha: uncommitted, shas: undefined, repoPath: '/A' }, ['h', 'a'], true);

		assert.strictEqual(state.activeMode.get(), 'compose');
		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: true,
			includeShas: ['h', 'a'],
		});
	});

	test('seeded includeShas survive a late branch-commits arrival (the includeShas-non-empty bail protects it)', async () => {
		const host = new FakeHost({
			repoPath: '/A',
			graphRepoPath: '/A',
			selection: { sha: uncommitted, shas: undefined, repoPath: '/A' },
		});
		const state = createDetailsState();
		// getBranchCommits resolves so fetchBranchCommits runs its late-re-derivation block to the guard.
		const services = {
			repository: {
				onRepositoryChanged: () => () => {},
				onRepositoryWorkingChanged: () => () => {},
			},
			graphInspect: {
				getBranchCommits: async () => ({
					commits: [{ sha: 'x', pushed: false }],
					hasMore: false,
				}),
			},
			telemetry: { sendEvent: () => Promise.resolve() },
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();
		pinBranchCommits(state, actions, '/A');
		state.wip.set(makeWipWithFiles([false]));

		controller.enterComposeWithScope({ sha: uncommitted, shas: undefined, repoPath: '/A' }, ['h', 'a'], false);
		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ['h', 'a'],
		});

		// Drive the late-arriving branch-commits path directly; the seeded (non-empty) includeShas
		// must bail the re-derivation instead of being clobbered by the default scope.
		await actions.fetchBranchCommits('/A');

		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ['h', 'a'],
		});
	});

	test('compose WIP gate intact — toggleMode on a non-WIP commit selection still no-ops', () => {
		const { state, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });

		controller.toggleMode('compose', { sha: 'real-commit-sha', shas: undefined, repoPath: '/A' });

		assert.strictEqual(state.activeMode.get(), null);
	});

	test('re-invoking with a new range while idle-composing switches the scope in place (no toggle-off)', () => {
		const { state, actions, controller } = setup({ repoPath: '/A', graphRepoPath: '/A' });
		pinBranchCommits(state, actions, '/A');
		state.wip.set(makeWipWithFiles([false]));
		const sel = { sha: uncommitted, shas: undefined, repoPath: '/A' };

		controller.enterComposeWithScope(sel, ['h', 'a'], false);
		assert.strictEqual(state.activeMode.get(), 'compose');
		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ['h', 'a'],
		});

		// Still idle on the same WIP anchor (no run registered) → the new range replaces the scope
		// rather than re-clicking a no-op or toggling compose off.
		controller.enterComposeWithScope(sel, ['h', 'a', 'b'], false);
		assert.strictEqual(state.activeMode.get(), 'compose', 'stays in compose mode');
		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ['h', 'a', 'b'],
		});
	});
});

type SentEvent = { name: string; data: Record<string, unknown> };

/** Harness for the resolve-session gesture counts: records every telemetry event and lets each
 *  resolve/re-resolve RPC be scripted, so a run can be made to succeed, fail, or cancel. */
function setupResolveCounts(options?: { resolveResults?: unknown[]; reresolveResults?: unknown[] }): {
	controller: DetailsWorkflowController;
	state: DetailsState;
	sent: SentEvent[];
} {
	const sent: SentEvent[] = [];
	const resolveResults = [...(options?.resolveResults ?? [])];
	const reresolveResults = [...(options?.reresolveResults ?? [])];
	const okResolve = { result: { resolutions: [] } };
	const okReresolve = { result: { filePath: 'a.ts', strategy: 'ai', confidence: 1 } };

	const services = {
		repository: {
			onRepositoryChanged: () => () => {},
			onRepositoryWorkingChanged: () => () => {},
			onRepositoryOrWorktreeChanged: () => () => {},
		},
		graphInspect: {
			resolveConflicts: () => Promise.resolve(resolveResults.shift() ?? okResolve),
			reresolveFile: () => Promise.resolve(reresolveResults.shift() ?? okReresolve),
			discardResolutions: () => Promise.resolve(),
		},
		telemetry: {
			sendEvent: (name: string, data: Record<string, unknown>) => {
				sent.push({ name: name, data: data });
				return Promise.resolve();
			},
		},
	} as unknown as ResolvedServices;

	const host = new FakeHost({ repoPath: '/A', graphRepoPath: '/A' });
	const state = createDetailsState();
	const actions = new DetailsActions(state, services, createResources());
	const controller = new DetailsWorkflowController(host, actions);
	host.connectAll();
	host.tickHostUpdate();
	state.activeMode.set('resolve');
	state.activeModeRepoPath.set('/A');

	return { controller: controller, state: state, sent: sent };
}

const generateEvents = (sent: SentEvent[]) =>
	sent.filter(e => e.name.startsWith('graphDetails/resolve/generateResolutions/'));

suite('DetailsWorkflowController — resolve session refine/retry counts', () => {
	test('a cold run reports run.kind start with every count at zero', async () => {
		const m = setupResolveCounts();

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();

		const events = generateEvents(m.sent);
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].data['run.kind'], 'start');
		assert.strictEqual(events[0].data['refine.count'], 0);
		assert.strictEqual(events[0].data['retryFromError.count'], 0);
		assert.strictEqual(events[0].data['retryFile.count'], 0);
	});

	test('each refine increments refine.count within the session', async () => {
		const m = setupResolveCounts();

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		m.controller.runResolve('/A', undefined, undefined, 'refine');
		await flush();
		m.controller.runResolve('/A', undefined, undefined, 'refine');
		await flush();

		const events = generateEvents(m.sent);
		assert.deepStrictEqual(
			events.map(e => e.data['refine.count']),
			[0, 1, 2],
			'the count accumulates across the session rather than resetting per run',
		);
		assert.deepStrictEqual(
			events.map(e => e.data['run.kind']),
			['start', 'refine', 'refine'],
		);
	});

	test('a retry after an error reports run.kind retry, not start', async () => {
		// The bug this fixes: `refine` was derived from the resource, which holds `{error}` after a
		// failure — so a retry was indistinguishable from a cold start.
		const m = setupResolveCounts({ resolveResults: [{ error: { message: 'boom' } }] });

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		m.controller.resolve.retryFromError();
		await flush();

		const events = generateEvents(m.sent);
		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[1].data['run.kind'], 'retry', 'a retry must not look like a cold start');
		assert.strictEqual(events[1].data.refine, true);
		assert.strictEqual(events[1].data['retryFromError.count'], 1);
	});

	test('a cold run resets counts carried over from the previous session', async () => {
		const m = setupResolveCounts();

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		m.controller.runResolve('/A', undefined, undefined, 'refine');
		await flush();
		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();

		const events = generateEvents(m.sent);
		assert.strictEqual(events[2].data['refine.count'], 0, 'a new session starts clean');
	});

	test('a per-file retry emits its own event carrying the running counts', async () => {
		const m = setupResolveCounts();

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		m.controller.runResolve('/A', undefined, undefined, 'refine');
		await flush();
		await m.controller.resolve.retryFile('a.ts', 'prefer ours');

		const retry = m.sent.filter(e => e.name === 'graphDetails/resolve/retryFile/completed');
		assert.strictEqual(retry.length, 1, 'the per-file retry path reported nothing before this');
		assert.strictEqual(retry[0].data['retryFile.count'], 1);
		assert.strictEqual(retry[0].data['refine.count'], 1, 'it carries the session context too');
		assert.strictEqual(retry[0].data['customInstructions.length'], 'prefer ours'.length);
		assert.strictEqual(retry[0].data['customInstructions.used'], true);
	});

	test('a failed per-file retry reports the reason', async () => {
		const m = setupResolveCounts({ reresolveResults: [{ error: { message: 'nope' } }] });

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		await m.controller.resolve.retryFile('a.ts', 'try again');

		const retry = m.sent.filter(e => e.name === 'graphDetails/resolve/retryFile/failed');
		assert.strictEqual(retry.length, 1);
		assert.strictEqual(retry[0].data['failed.reason'], 'error');
	});

	test('concurrent per-file retries each count exactly once', async () => {
		// The count is bumped on dispatch rather than on settle — `resolveRetryingFiles` is a Set, so
		// several files can be in flight and a read-modify-write across the await would lose one.
		const m = setupResolveCounts();

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		await Promise.all([m.controller.resolve.retryFile('a.ts', 'x'), m.controller.resolve.retryFile('b.ts', 'y')]);

		const counts = m.sent
			.filter(e => e.name === 'graphDetails/resolve/retryFile/completed')
			.map(e => e.data['retryFile.count']);
		assert.deepStrictEqual(counts.sort(), [1, 2]);
	});

	test('discard carries the session totals', async () => {
		const m = setupResolveCounts();

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		m.controller.runResolve('/A', undefined, undefined, 'refine');
		await flush();
		await m.controller.resolve.retryFile('a.ts', 'x');
		m.controller.resolve.discard();

		const discarded = m.sent.filter(e => e.name === 'graphDetails/resolve/discarded');
		assert.strictEqual(discarded.length, 1);
		assert.strictEqual(discarded[0].data['refine.count'], 1);
		assert.strictEqual(discarded[0].data['retryFile.count'], 1);
	});

	test('cancelling the mode ends the session', async () => {
		const m = setupResolveCounts();

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		m.controller.runResolve('/A', undefined, undefined, 'refine');
		await flush();
		m.controller.cancelOperation('resolve');
		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();

		const events = generateEvents(m.sent);
		assert.strictEqual(events[2].data['refine.count'], 0);
	});
});

/** A completed compose result carrying the host's cache key — the handle a refine needs. */
function makeComposeResultWithKey(label: string, cacheKey: string): ComposeResult {
	return {
		result: { commits: [], baseCommit: { sha: '0'.repeat(40), message: label }, cacheKey: cacheKey },
	} as unknown as ComposeResult;
}

/** Like {@link setup}, but captures the args of every `composeChanges` RPC the controller issues. */
function setupComposeCapture(repoPath: string): {
	host: FakeHost;
	state: DetailsState;
	actions: DetailsActions;
	controller: DetailsWorkflowController;
	calls: unknown[][];
} {
	const calls: unknown[][] = [];
	const host = new FakeHost({ repoPath: repoPath, graphRepoPath: repoPath });
	const state = createDetailsState();
	const actions = new DetailsActions(
		state,
		createServices({
			composeChanges: async (...args: unknown[]) => {
				calls.push(args);
				return { error: { message: 'stub' } };
			},
		}),
		createResources(),
	);
	const controller = new DetailsWorkflowController(host, actions);
	host.connectAll();
	host.tickHostUpdate();
	return { host: host, state: state, actions: actions, controller: controller, calls: calls };
}

function seedCompletedPlan(host: FakeHost, state: DetailsState, repoPath: string, cacheKey: string): void {
	host.crossPaneState.runningOperations.set(
		new Map([
			[
				wipKey(repoPath),
				{
					compose: {
						kind: 'compose' as const,
						anchor: { kind: 'wip' as const, repoPath: repoPath, sha: uncommitted },
						execState: 'complete' as const,
						result: makeComposeResultWithKey('plan', cacheKey),
						// `onRunSettled` stamps this on a real completed run; the refine handle is read
						// from here, not from the result, so it survives the entry going to an error.
						cacheKey: cacheKey,
					},
				},
			],
		]),
	);
	state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
	enterMockMode(state, repoPath, uncommitted);
}

suite('DetailsWorkflowController.runCompose — refine continuation across a leave-and-return', () => {
	test('refines the displayed plan after toggling out of compose and back in', () => {
		// `hideMode` is the preserve-leave path: it keeps the registry entry (so the plan is projected
		// back on return) and captures the Refine draft precisely so the user can resume. It used to
		// also drop the refine handle, so the resumed plan was silently regenerated from scratch — and
		// with conversation tracking, re-minted its conversation.
		const m = setupComposeCapture('/A');
		seedCompletedPlan(m.host, m.state, '/A', 'K1');

		// Leave to another anchor and come back — the round trip that runs `hideMode`.
		m.controller.switchAnchorWithinMode({ sha: uncommitted, shas: undefined, repoPath: '/B' });
		m.controller.switchAnchorWithinMode({ sha: uncommitted, shas: undefined, repoPath: '/A' });
		// Re-establish the engaged posture the panel would have on return — the anchor round trip
		// rebuilds scope for whichever anchor it lands on.
		m.state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		enterMockMode(m.state, '/A', uncommitted);

		m.controller.runCompose('/A', 'tighten it up', undefined, undefined, 0);

		assert.strictEqual(m.calls.length, 1, 'one compose RPC should have been issued');
		// composeChanges(repoPath, sessionKey, scope, instructions, excludedFiles, aiExcludedFiles, signal, options)
		const options = m.calls[0][7] as { mode?: string; priorCacheKey?: string } | undefined;
		assert.strictEqual(options?.mode, 'refine', 'the run must be dispatched as a refine, not a cold start');
		assert.strictEqual(options?.priorCacheKey, 'K1', 'and must carry the plan it is refining');
	});

	test('sends the session key of the anchor it is engaged on', () => {
		const m = setupComposeCapture('/A');
		seedCompletedPlan(m.host, m.state, '/A', 'K1');

		m.controller.runCompose('/A', 'tighten it up', undefined, undefined, 0);

		assert.strictEqual(m.calls[0][1], wipKey('/A'), 'session key must be this anchor’s key');
	});

	test('cold-starts when the anchor has no plan to continue', () => {
		// The inverse guard: without a live plan the run must NOT claim to be a refine, or the host
		// would try to continue a session that does not exist.
		const m = setupComposeCapture('/A');
		m.state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		enterMockMode(m.state, '/A', uncommitted);

		m.controller.runCompose('/A', 'organize these', undefined, undefined, 0);

		assert.strictEqual(m.calls.length, 1);
		assert.strictEqual(m.calls[0][7], undefined, 'no continuation options on a cold start');
	});
});

suite('DetailsWorkflowController.runCompose — retrying a failed refine', () => {
	test('retries as a refine, not a cold start, after the refine errored', () => {
		// The entry flips to an error result when a refine fails, so deriving the refine handle from
		// that result loses it and the retry silently restarts the session — discarding a plan that was
		// never invalid. The handle lives on the entry itself precisely so it survives this.
		const m = setupComposeCapture('/A');
		m.host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						compose: {
							kind: 'compose' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'error' as const,
							result: { error: { message: 'the refine blew up' } } as unknown as ComposeResult,
							cacheKey: 'K1',
							prompt: 'tighten it up',
						},
					},
				],
			]),
		);
		m.state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		enterMockMode(m.state, '/A', uncommitted);

		m.controller.compose.retryFromError('/A', uncommitted, undefined, undefined, undefined, 0);

		assert.strictEqual(m.calls.length, 1, 'the retry should have issued a compose RPC');
		const options = m.calls[0][7] as { mode?: string; priorCacheKey?: string } | undefined;
		assert.strictEqual(options?.mode, 'refine', 'a retry after a failed refine is still a refine');
		assert.strictEqual(options?.priorCacheKey, 'K1', 'and continues the same plan');
	});

	test('discarding a compose tells the host to end the session', () => {
		// The host cannot see a Discard on its own: the webview just drops the entry. Without this call
		// the plan and its conversation sit on the host until the next compose here or panel teardown.
		const calls: unknown[][] = [];
		const host = new FakeHost({ repoPath: '/A', graphRepoPath: '/A' });
		const state = createDetailsState();
		const actions = new DetailsActions(
			state,
			createServices({
				discardCompose: (...args: unknown[]) => {
					calls.push(args);
					return Promise.resolve();
				},
			}),
			createResources(),
		);
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();
		seedCompletedPlan(host, state, '/A', 'K1');

		controller.compose.discard();

		assert.strictEqual(calls.length, 1, 'the host must be told the session is over');
		assert.strictEqual(calls[0][0], wipKey('/A'), 'for this anchor’s session');
		assert.strictEqual(calls[0][1], 'K1', 'naming the plan being discarded, so a late call is a no-op');
	});

	test('walking Back to the scope picker cold-starts the next generate', () => {
		// Back retains the plan so `forward()` can restore it without re-running the AI, but the panel
		// is showing the idle scope picker. A generate from there is the user starting over: it must
		// recollect the scope they just chose and abandon the plan's session, not silently refine the
		// plan they walked away from under its old conversation.
		const m = setupComposeCapture('/A');
		seedCompletedPlan(m.host, m.state, '/A', 'K1');
		m.actions.resources.compose.mutate(makeComposeResultWithKey('plan', 'K1'));

		m.controller.compose.back();
		assert.strictEqual(
			m.host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose?.execState,
			'backed',
			'precondition: Back parks the entry in `backed`',
		);

		m.state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		enterMockMode(m.state, '/A', uncommitted);
		m.controller.runCompose('/A', 'organize these instead', undefined, undefined, 0);

		assert.strictEqual(m.calls.length, 1);
		assert.strictEqual(m.calls[0][7], undefined, 'Back then generate must not be dispatched as a refine');
	});

	test('discarding while a commit message is being written does not end the session', () => {
		// A message rewrite runs while its plan reads as complete, so the in-flight check on the run's
		// state cannot see it. Ending the session here would flush it before the rewrite reports back,
		// and that request's usage would then have nothing to flush it.
		const calls: unknown[][] = [];
		const host = new FakeHost({ repoPath: '/A', graphRepoPath: '/A' });
		const state = createDetailsState();
		const actions = new DetailsActions(
			state,
			createServices({
				discardCompose: (...args: unknown[]) => {
					calls.push(args);
					return Promise.resolve();
				},
			}),
			createResources(),
		);
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();
		seedCompletedPlan(host, state, '/A', 'K1');
		state.composeRegeneratingCommitId.set('commit-1');

		controller.compose.discard();

		assert.deepStrictEqual(calls, [], 'the session must outlive the rewrite it belongs to');
		// And the plan itself must still be here — tearing the panel down under a running rewrite would
		// leave its result with nothing to land on. This is what the guard on `discard` itself buys,
		// beyond the one on the teardown helper.
		assert.notStrictEqual(
			host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose,
			undefined,
			'the plan must survive a discard attempted mid-rewrite',
		);

		// Once the rewrite settles, the same gesture ends it as usual.
		state.composeRegeneratingCommitId.set(undefined);
		controller.compose.discard();
		assert.strictEqual(calls.length, 1, 'and ends normally afterwards');
	});

	test('destroying a compose while its run is in flight does not end the session', () => {
		// Aborting is a request to stop, not proof that it stopped. A refine that lands anyway would
		// report under a conversation this call had already closed, so its usage would accumulate against
		// an ID nothing will flush again. Those sessions are left for the next compose here, or dispose.
		const calls: unknown[][] = [];
		const host = new FakeHost({ repoPath: '/A', graphRepoPath: '/A' });
		const state = createDetailsState();
		const actions = new DetailsActions(
			state,
			createServices({
				discardCompose: (...args: unknown[]) => {
					calls.push(args);
					return Promise.resolve();
				},
			}),
			createResources(),
		);
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();

		// A refine in flight: the entry is `generating` and still names the plan it is refining.
		host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						compose: {
							kind: 'compose' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'generating' as const,
							cacheKey: 'K1',
						},
					},
				],
			]),
		);
		enterMockMode(state, '/A', uncommitted);

		controller.compose.discard();

		assert.deepStrictEqual(calls, [], 'an in-flight run’s session must not be closed under it');
	});

	test('a cold start after Back does not carry the abandoned plan’s key onto its entry', () => {
		// The entry's key is what later teardown calls name when they tell the host which plan to let go
		// of. A cold start makes the host discard the plan it held, so inheriting that key would leave the
		// entry naming something already gone — and a Discard or repository switch would then name it too,
		// miss the host's match guard, and leave the session's conversation open.
		const m = setupComposeCapture('/A');
		seedCompletedPlan(m.host, m.state, '/A', 'K1');
		m.actions.resources.compose.mutate(makeComposeResultWithKey('plan', 'K1'));
		m.controller.compose.back();

		m.state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		enterMockMode(m.state, '/A', uncommitted);
		m.controller.runCompose('/A', 'organize these instead', undefined, undefined, 0);

		const dispatched = m.host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(dispatched?.execState, 'generating', 'precondition: the cold start dispatched');
		assert.strictEqual(dispatched?.cacheKey, undefined, 'a cold start must not inherit the dead key');
	});

	test('a refine keeps the plan’s key on its in-flight entry', () => {
		// The inverse: a refine IS continuing that plan, so the key has to survive the in-flight window or
		// a refine that fails could not be retried as a refine.
		const m = setupComposeCapture('/A');
		seedCompletedPlan(m.host, m.state, '/A', 'K1');
		m.controller.runCompose('/A', 'tighten it up', undefined, undefined, 0);

		const dispatched = m.host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
		assert.strictEqual(dispatched?.cacheKey, 'K1', 'a refine keeps the key it is continuing');
	});

	test('going Forward again restores the refine continuation', () => {
		// The inverse: `forward()` returns the entry to `complete` with the plan on screen, so the
		// session it belongs to is resumable again.
		const m = setupComposeCapture('/A');
		seedCompletedPlan(m.host, m.state, '/A', 'K1');
		m.actions.resources.compose.mutate(makeComposeResultWithKey('plan', 'K1'));

		m.controller.compose.back();
		assert.strictEqual(m.controller.compose.forward(), true);

		m.state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		enterMockMode(m.state, '/A', uncommitted);
		m.controller.runCompose('/A', 'tighten it up', undefined, undefined, 0);

		const options = m.calls[0][7] as { mode?: string; priorCacheKey?: string } | undefined;
		assert.strictEqual(options?.mode, 'refine');
		assert.strictEqual(options?.priorCacheKey, 'K1');
	});

	test('a settled error keeps the prior plan’s key on the entry', () => {
		// Guards the mechanism the test above depends on: `onRunSettled` must carry the key forward
		// rather than rebuild the entry without it.
		const m = setupComposeCapture('/A');
		m.state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		enterMockMode(m.state, '/A', uncommitted);
		m.host.crossPaneState.runningOperations.set(
			new Map([
				[
					wipKey('/A'),
					{
						compose: {
							kind: 'compose' as const,
							anchor: { kind: 'wip' as const, repoPath: '/A', sha: uncommitted },
							execState: 'complete' as const,
							result: makeComposeResultWithKey('plan', 'K1'),
							cacheKey: 'K1',
						},
					},
				],
			]),
		);

		// The stubbed RPC resolves to an error, so this run settles as a failure over the live plan.
		m.controller.runCompose('/A', 'tighten it up', undefined, undefined, 0);

		return Promise.resolve().then(() => {
			const entry = m.host.crossPaneState.runningOperations.get().get(wipKey('/A'))?.compose;
			assert.strictEqual(entry?.cacheKey, 'K1', 'the failed run must not drop the plan handle');
		});
	});
});

suite('DetailsWorkflowController — failure telemetry classification', () => {
	/** Harness for the compose/review failure payload: scripts the generate RPC and records every
	 *  telemetry event the run emits. Only the per-kind classification is asserted below — that a
	 *  message assigned into the payload arrives in the payload is a tautology, not a contract. */
	function setupRunFailure(overrides: {
		composeChanges?: (...args: unknown[]) => Promise<ComposeResult>;
		reviewChanges?: (...args: unknown[]) => Promise<ReviewResult>;
	}): { controller: DetailsWorkflowController; sent: SentEvent[] } {
		const sent: SentEvent[] = [];
		const host = new FakeHost({ repoPath: '/A', graphRepoPath: '/A' });
		const state = createDetailsState();
		const actions = new DetailsActions(
			state,
			createServices({
				...overrides,
				sendEvent: (name: string, data: Record<string, unknown>) => {
					sent.push({ name: name, data: data });
					return Promise.resolve();
				},
			}),
			createResources(),
		);
		const controller = new DetailsWorkflowController(host, actions);
		host.connectAll();
		host.tickHostUpdate();
		state.scope.set({ type: 'wip', includeUnstaged: true, includeStaged: false, includeShas: [] });
		enterMockMode(state, '/A', uncommitted);

		return { controller: controller, sent: sent };
	}

	const failedEvents = (sent: SentEvent[], name: string) => sent.filter(e => e.name === name);

	test('a compose failure over an unrewritable scope reports it as invalid-scope', async () => {
		// The distinction that matters for the funnel: an identical retry can never succeed here, so
		// these must not be pooled with transient host/AI errors.
		const m = setupRunFailure({
			composeChanges: async (): Promise<ComposeResult> => ({
				error: { message: 'interior fork', kind: 'invalid-scope' },
			}),
		});

		m.controller.runCompose('/A', undefined, undefined, undefined, 0);
		await flush();

		const events = failedEvents(m.sent, 'graphDetails/compose/generatePlan/failed');
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].data['failure.reason'], 'invalid-scope');
		assert.strictEqual(events[0].data['failure.error.message'], 'interior fork');
	});

	test('a failed review reports the error message and no failure reason', async () => {
		const m = setupRunFailure({
			reviewChanges: async (): Promise<ReviewResult> => ({ error: { message: 'review blew up' } }),
		});

		m.controller.runReview('/A', undefined, undefined, 0);
		await flush();

		const events = failedEvents(m.sent, 'graphDetails/review/generateReview/failed');
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].data['failure.error.message'], 'review blew up');
		// Key ABSENT, not present-and-undefined: review's event never declares `failure.reason`, so the
		// shared compose/review payload must not smuggle the key in. `strictEqual(…, undefined)` would
		// pass either way and wouldn't catch that.
		assert.ok(!('failure.reason' in events[0].data), 'review has no structured failure kind to report');
	});

	test('a cancelled per-file retry reports no error message', async () => {
		const m = setupResolveCounts({ reresolveResults: [{ cancelled: true }] });

		m.controller.runResolve('/A', undefined, undefined, 'start');
		await flush();
		await m.controller.resolve.retryFile('a.ts', 'try again');

		const events = failedEvents(m.sent, 'graphDetails/resolve/retryFile/failed');
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].data['failed.reason'], 'cancelled');
		assert.strictEqual(events[0].data['failure.error.message'], undefined);
	});
});
