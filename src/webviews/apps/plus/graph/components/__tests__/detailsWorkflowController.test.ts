import * as assert from 'assert';
import type { ReactiveController } from 'lit';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { BranchComparisonOptions, ScopeSelection } from '../../../../../plus/graph/graphService.js';
import { createResource } from '../../../../shared/state/resource.js';
import type { DetailsResources, ResolvedServices } from '../detailsActions.js';
import { DetailsActions } from '../detailsActions.js';
import type { DetailsState } from '../detailsState.js';
import { createDetailsState } from '../detailsState.js';
import type { DetailsSelection, DetailsWorkflowHost } from '../detailsWorkflowController.js';
import { DetailsWorkflowController } from '../detailsWorkflowController.js';

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
		scopeFiles: createResource(async (_signal, _repoPath: string, _scope: ScopeSelection) => []),
	};
}

function createServices(): ResolvedServices {
	const noopUnsubscribe = () => {};
	return {
		repository: {
			onRepositoryChanged: () => noopUnsubscribe,
			onRepositoryWorkingChanged: () => noopUnsubscribe,
		},
	} as unknown as ResolvedServices;
}

class FakeHost implements DetailsWorkflowHost {
	repoPath?: string;
	private _graphRepoPath: string | undefined;
	private _selection: DetailsSelection;
	private _controllers: ReactiveController[] = [];

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

	addController(c: ReactiveController): void {
		this._controllers.push(c);
	}
	removeController(c: ReactiveController): void {
		const i = this._controllers.indexOf(c);
		if (i >= 0) this._controllers.splice(i, 1);
	}
	requestUpdate(): void {}

	connectAll(): void {
		for (const c of this._controllers) c.hostConnected?.();
	}
	tickHostUpdate(): void {
		for (const c of this._controllers) c.hostUpdate?.();
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

	test('panel render-target switch (host.repoPath) with mismatched active mode exits', () => {
		const { host, state } = setup({ repoPath: '/A', graphRepoPath: '/parent' });
		enterMockMode(state, '/A', uncommitted);

		// Worktree row jump: same graph repo, but the panel's render target moved to
		// a different worktree's path.
		host.setRepoPath('/B');
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
		controller['_composeFetchedForSelection'] = `/A|${uncommitted}`;

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
		controller['_reviewFetchedForSelection'] = `/A|${uncommitted}`;

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

	test('compose: re-entering for the same WIP selection preserves the prior result', () => {
		// Sanity: same-selection re-entry must not regress (cached result restoration is the
		// reason `exitMode` doesn't `reset()` on same-selection exit).
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

		const priorResult = { error: { message: 'WIP A compose result' } };
		actions.resources.compose.mutate(priorResult);
		controller['_composeFetchedForSelection'] = `/A|${uncommitted}`;

		controller.toggleMode('compose', { sha: uncommitted, shas: undefined, repoPath: '/A' });

		assert.strictEqual(actions.resources.compose.value.get(), priorResult);
		assert.strictEqual(controller['_composeFetchedForSelection'], `/A|${uncommitted}`);
	});
});

suite('DetailsActions.clearEnrichmentCaches', () => {
	test('aborts in-flight branch-commits and enrichment controllers', () => {
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
		assert.strictEqual(enrichment.signal.aborted, true);
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
