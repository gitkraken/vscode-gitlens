import * as assert from 'assert';
import type { Wip } from '../../../../../commitDetails/protocol.js';
import type {
	BranchComparisonOptions,
	BranchComparisonSummary,
	CommitResult,
	ComposeResult,
	ScopeSelection,
} from '../../../../../plus/graph/graphService.js';
import { createResource } from '../../../../shared/state/resource.js';
import type { DetailsResources, ResolvedServices } from '../detailsActions.js';
import { DetailsActions, scopeSelectionEqual } from '../detailsActions.js';
import { createDetailsState } from '../detailsState.js';

function createResources(overrides: Partial<DetailsResources> = {}): DetailsResources {
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
		...overrides,
	};
}

function createServices(commitCompose?: (repoPath: string, plan: unknown) => Promise<CommitResult>): ResolvedServices {
	return {
		graphInspect: {
			commitCompose: commitCompose ?? (async () => ({ success: true })),
		},
	} as unknown as ResolvedServices;
}

const composeResult: ComposeResult = {
	result: {
		baseCommit: {
			sha: 'base',
			message: 'Base commit',
			rewriteFromSha: 'base-parent',
			kind: 'wip+commits',
			selectedShas: ['abc'],
		},
		commits: [
			{
				id: 'c1',
				message: 'Commit one',
				files: [],
				additions: 1,
				deletions: 0,
				patch: 'diff --git a/file b/file',
			},
		],
	},
};

suite('scopeSelectionEqual', () => {
	test('undefined === undefined', () => {
		assert.strictEqual(scopeSelectionEqual(undefined, undefined), true);
	});

	test('defined vs undefined', () => {
		const a: ScopeSelection = { type: 'commit', sha: 'abc' };
		assert.strictEqual(scopeSelectionEqual(a, undefined), false);
		assert.strictEqual(scopeSelectionEqual(undefined, a), false);
	});

	test('same reference', () => {
		const a: ScopeSelection = { type: 'commit', sha: 'abc' };
		assert.strictEqual(scopeSelectionEqual(a, a), true);
	});

	test('commit: same sha, different objects', () => {
		assert.strictEqual(scopeSelectionEqual({ type: 'commit', sha: 'abc' }, { type: 'commit', sha: 'abc' }), true);
	});

	test('commit: different shas', () => {
		assert.strictEqual(scopeSelectionEqual({ type: 'commit', sha: 'abc' }, { type: 'commit', sha: 'def' }), false);
	});

	test('wip: all fields equal', () => {
		const a: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: false,
			includeShas: ['s1', 's2'],
		};
		const b: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: false,
			includeShas: ['s1', 's2'],
		};
		assert.strictEqual(scopeSelectionEqual(a, b), true);
	});

	test('wip: different includeShas order means not equal', () => {
		const a: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: true,
			includeShas: ['s1', 's2'],
		};
		const b: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: true,
			includeShas: ['s2', 's1'],
		};
		assert.strictEqual(scopeSelectionEqual(a, b), false);
	});

	test('wip: staged flag flip', () => {
		const a: ScopeSelection = { type: 'wip', includeStaged: true, includeUnstaged: false, includeShas: [] };
		const b: ScopeSelection = { type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: [] };
		assert.strictEqual(scopeSelectionEqual(a, b), false);
	});

	test('compare: same endpoints and includeShas', () => {
		const a: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't', includeShas: ['x'] };
		const b: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't', includeShas: ['x'] };
		assert.strictEqual(scopeSelectionEqual(a, b), true);
	});

	test('compare: includeShas undefined vs empty array is NOT equal', () => {
		// Distinct states: undefined means "no selection constraint"; [] means "explicitly empty".
		const a: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't' };
		const b: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't', includeShas: [] };
		assert.strictEqual(scopeSelectionEqual(a, b), false);
	});

	test('compare: both includeShas undefined', () => {
		const a: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't' };
		const b: ScopeSelection = { type: 'compare', fromSha: 'f', toSha: 't' };
		assert.strictEqual(scopeSelectionEqual(a, b), true);
	});

	test('different types are not equal', () => {
		const a: ScopeSelection = { type: 'commit', sha: 'abc' };
		const b: ScopeSelection = { type: 'wip', includeStaged: true, includeUnstaged: true, includeShas: [] };
		assert.strictEqual(scopeSelectionEqual(a, b), false);
	});
});

suite('DetailsActions', () => {
	test('composeCommitAll without includedCommitIds clears stale compose plan after successful commit', async () => {
		const state = createDetailsState();
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.composeForwardAvailable.set(true);

		let committedPlan: unknown;
		const resources = createResources();
		resources.compose.mutate(composeResult);

		const actions = new DetailsActions(
			state,
			createServices(async (_repoPath, plan) => {
				committedPlan = plan;
				return { success: true };
			}),
			resources,
		);
		let fetchedDetails: { sha: string | undefined; repoPath: string | undefined } | undefined;
		actions.fetchDetails = async (sha, repoPath) => {
			fetchedDetails = { sha: sha, repoPath: repoPath };
		};

		await actions.composeCommitAll('/repo', 'abc');

		assert.deepStrictEqual(committedPlan, {
			commits: composeResult.result.commits,
			base: composeResult.result.baseCommit,
			includedCommitIds: undefined,
		});
		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(state.activeModeContext.get(), null);
		assert.strictEqual(state.composeForwardAvailable.get(), false);
		assert.strictEqual(resources.compose.status.get(), 'idle');
		assert.strictEqual(resources.compose.value.get(), undefined);
		assert.deepStrictEqual(fetchedDetails, { sha: 'abc', repoPath: '/repo' });
	});

	test('composeCommitAll forwards includedCommitIds when a subset is selected', async () => {
		const state = createDetailsState();
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');

		let committedPlan: unknown;
		const resources = createResources();
		resources.compose.mutate(composeResult);

		const actions = new DetailsActions(
			state,
			createServices(async (_repoPath, plan) => {
				committedPlan = plan;
				return { success: true };
			}),
			resources,
		);
		actions.fetchDetails = async () => undefined;

		await actions.composeCommitAll('/repo', 'abc', undefined, ['c1']);

		assert.deepStrictEqual(committedPlan, {
			commits: composeResult.result.commits,
			base: composeResult.result.baseCommit,
			includedCommitIds: ['c1'],
		});
	});

	test('toggleCompareWorkingTree invalidates side data and refetches summary with the toggle enabled', async () => {
		const state = createDetailsState();
		state.branchCompareLeftRef.set('main');
		state.branchCompareRightRef.set('feature');
		state.branchCompareAheadLoaded.set(true);
		state.branchCompareBehindLoaded.set(true);
		state.branchCompareSelectedCommitShaByTab.set(new Map([['ahead', 'abc']]));
		state.branchCompareAutolinksByScope.set(new Map([['ahead', []]]));
		state.branchCompareEnrichmentRequested.set(true);
		state.branchCompareStale.set(true);

		const summaryFetches: BranchComparisonOptions[] = [];
		const summary: BranchComparisonSummary = {
			aheadCount: 1,
			behindCount: 2,
			allFilesCount: 1,
			allFiles: [{ repoPath: '/repo', path: 'changed.ts', status: 'M', staged: false }],
		};
		const resources = createResources({
			branchCompareSummary: createResource(
				async (
					_signal,
					_repoPath: string,
					_leftRef: string,
					_rightRef: string,
					options: BranchComparisonOptions,
				) => {
					summaryFetches.push(options);
					return summary;
				},
			),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		actions.toggleCompareWorkingTree('/repo');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(summaryFetches, [{ includeWorkingTree: true }]);
		assert.strictEqual(state.branchCompareIncludeWorkingTree.get(), true);
		assert.strictEqual(state.branchCompareAheadLoaded.get(), false);
		assert.strictEqual(state.branchCompareBehindLoaded.get(), false);
		assert.strictEqual(state.branchCompareStale.get(), false);
		assert.strictEqual(state.branchCompareSelectedCommitShaByTab.get().size, 0);
		assert.strictEqual(state.branchCompareAutolinksByScope.get().size, 0);
		assert.strictEqual(state.branchCompareEnrichmentRequested.get(), false);
		assert.deepStrictEqual(state.branchCompareAllFiles.get(), summary.allFiles);
	});

	test('fetchCompareSummary propagates rightRefWorktreePath from summary result', async () => {
		const state = createDetailsState();
		state.branchCompareLeftRef.set('main');
		state.branchCompareRightRef.set('feature');

		const summary: BranchComparisonSummary = {
			aheadCount: 0,
			behindCount: 0,
			allFilesCount: 0,
			allFiles: [],
			rightRefWorktreePath: '/wt/foo',
		};
		const resources = createResources({
			branchCompareSummary: createResource(async () => summary),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.fetchCompareSummary('/repo');

		assert.strictEqual(state.branchCompareRightRefWorktreePath.get(), '/wt/foo');
	});

	test('fetchCompareSummary clears rightRefWorktreePath when summary has none', async () => {
		const state = createDetailsState();
		state.branchCompareLeftRef.set('main');
		state.branchCompareRightRef.set('feature');
		state.branchCompareRightRefWorktreePath.set('/wt/stale');

		const summary: BranchComparisonSummary = {
			aheadCount: 0,
			behindCount: 0,
			allFilesCount: 0,
			allFiles: [],
		};
		const resources = createResources({
			branchCompareSummary: createResource(async () => summary),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.fetchCompareSummary('/repo');

		assert.strictEqual(state.branchCompareRightRefWorktreePath.get(), undefined);
	});

	test('changeCompareRef clears rightRefWorktreePath synchronously on right side change', async () => {
		const state = createDetailsState();
		state.branchCompareLeftRef.set('main');
		state.branchCompareRightRef.set('feature');
		state.branchCompareRightRefWorktreePath.set('/wt/stale');

		const services = {
			graphInspect: {
				// Returning undefined short-circuits before any post-await mutation; we only need to
				// observe the synchronous clear that happens BEFORE chooseRef is awaited.
				chooseRef: async () => undefined,
				commitCompose: async () => ({ success: true }),
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());

		const pending = actions.changeCompareRef('right', '/repo');
		// Synchronous clear must happen before the first microtask boundary.
		assert.strictEqual(state.branchCompareRightRefWorktreePath.get(), undefined);
		await pending;
		assert.strictEqual(state.branchCompareRightRefWorktreePath.get(), undefined);
	});

	test('markBranchCompareStale only marks active working-tree comparisons and refresh clears it', async () => {
		const state = createDetailsState();
		state.branchCompareLeftRef.set('main');
		state.branchCompareRightRef.set('feature');
		state.compareSheetOpen.set(true);

		const summaryFetches: BranchComparisonOptions[] = [];
		const resources = createResources({
			branchCompareSummary: createResource(
				async (
					_signal,
					_repoPath: string,
					_leftRef: string,
					_rightRef: string,
					options: BranchComparisonOptions,
				) => {
					summaryFetches.push(options);
					return { aheadCount: 0, behindCount: 0, allFilesCount: 0, allFiles: [] };
				},
			),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		actions.markBranchCompareStale();
		assert.strictEqual(state.branchCompareStale.get(), false);

		state.branchCompareIncludeWorkingTree.set(true);
		state.branchCompareAheadLoaded.set(true);
		state.branchCompareBehindLoaded.set(true);
		state.branchCompareSelectedCommitShaByTab.set(new Map([['behind', 'def']]));
		actions.markBranchCompareStale();
		assert.strictEqual(state.branchCompareStale.get(), true);

		actions.refreshBranchCompare('/repo');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(summaryFetches, [{ includeWorkingTree: true }]);
		assert.strictEqual(state.branchCompareStale.get(), false);
		assert.strictEqual(state.branchCompareAheadLoaded.get(), false);
		assert.strictEqual(state.branchCompareBehindLoaded.get(), false);
		assert.strictEqual(state.branchCompareSelectedCommitShaByTab.get().size, 0);
	});

	test('refetchWipQuiet marks WIP stale when a mode is active', async () => {
		const state = createDetailsState();
		state.activeMode.set('compose');
		state.wipStale.set(false);

		const wip: Wip = {
			changes: undefined,
			repositoryCount: 1,
			repo: { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false },
		};
		const stats = { added: 0, deleted: 0, modified: 0 };
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: wip, stats: stats })),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.refetchWipQuiet('/repo');

		assert.strictEqual(state.wip.get(), wip);
		assert.strictEqual(state.wipStale.get(), true);
	});

	test('refetchWipQuiet leaves WIP stale untouched when no mode is active', async () => {
		const state = createDetailsState();
		state.activeMode.set(null);
		state.wipStale.set(false);

		const wip: Wip = {
			changes: undefined,
			repositoryCount: 1,
			repo: { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false },
		};
		const stats = { added: 0, deleted: 0, modified: 0 };
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: wip, stats: stats })),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.refetchWipQuiet('/repo');

		assert.strictEqual(state.wip.get(), wip);
		assert.strictEqual(state.wipStale.get(), false);
	});

	test('resetRepoScopedState conditionally clears signals', () => {
		const state = createDetailsState();
		const commit = { repoPath: '/repo1', sha: 'c1' } as any;
		const wip = { repo: { path: '/repo1' } } as any;
		state.commit.set(commit);
		state.wip.set(wip);

		const actions = new DetailsActions(state, createServices(), createResources());

		// 1. Calling with matching path preserves state
		actions.resetRepoScopedState('/repo1');
		assert.strictEqual(state.commit.get(), commit);
		assert.strictEqual(state.wip.get(), wip);

		// 2. Calling with mismatching path clears state
		actions.resetRepoScopedState('/repo2');
		assert.strictEqual(state.commit.get(), undefined);
		assert.strictEqual(state.wip.get(), undefined);
	});

	test('resetRepoScopedState preserves wip enrichment chips alongside state.wip', () => {
		const state = createDetailsState();
		const wip = { repo: { path: '/repo1' } } as any;
		state.wip.set(wip);
		state.wipAutolinks.set([{ id: 'auto1' } as any]);
		state.wipIssues.set([{ entityId: 'issue1' } as any]);
		state.wipMergeTarget.set({ branch: { name: 'main' } } as any);
		state.wipMergeTargetLoading.set(true);
		state.wipPullRequest.set({ id: 'pr1' } as any);
		state.wipPullRequestLoading.set(true);

		const actions = new DetailsActions(state, createServices(), createResources());

		// Matching path: chips survive alongside state.wip.
		actions.resetRepoScopedState('/repo1');
		assert.deepStrictEqual(state.wipAutolinks.get(), [{ id: 'auto1' }]);
		assert.deepStrictEqual(state.wipIssues.get(), [{ entityId: 'issue1' }]);
		assert.deepStrictEqual(state.wipMergeTarget.get(), { branch: { name: 'main' } });
		assert.strictEqual(state.wipMergeTargetLoading.get(), true);
		assert.deepStrictEqual(state.wipPullRequest.get(), { id: 'pr1' });
		assert.strictEqual(state.wipPullRequestLoading.get(), true);

		// Mismatching path: chips wiped along with state.wip.
		actions.resetRepoScopedState('/repo2');
		assert.strictEqual(state.wipAutolinks.get(), undefined);
		assert.strictEqual(state.wipIssues.get(), undefined);
		assert.strictEqual(state.wipMergeTarget.get(), undefined);
		assert.strictEqual(state.wipMergeTargetLoading.get(), false);
		assert.strictEqual(state.wipPullRequest.get(), undefined);
		assert.strictEqual(state.wipPullRequestLoading.get(), false);
	});

	test('resetRepoScopedState preserves single-commit enrichment alongside state.commit', () => {
		const state = createDetailsState();
		const commit = { repoPath: '/repo1', sha: 'c1' } as any;
		state.commit.set(commit);
		state.autolinks.set([{ id: 'auto1' } as any]);
		state.formattedMessage.set('msg');
		state.autolinkedIssues.set([{ id: 'issue1' } as any]);
		state.pullRequest.set({ id: 'pr1' } as any);
		state.signature.set({ verified: true } as any);

		const actions = new DetailsActions(state, createServices(), createResources());

		// Matching path: enrichment survives alongside state.commit.
		actions.resetRepoScopedState('/repo1');
		assert.deepStrictEqual(state.autolinks.get(), [{ id: 'auto1' }]);
		assert.strictEqual(state.formattedMessage.get(), 'msg');
		assert.deepStrictEqual(state.autolinkedIssues.get(), [{ id: 'issue1' }]);
		assert.deepStrictEqual(state.pullRequest.get(), { id: 'pr1' });
		assert.deepStrictEqual(state.signature.get(), { verified: true });

		// Mismatching path: enrichment wiped along with state.commit.
		actions.resetRepoScopedState('/repo2');
		assert.strictEqual(state.autolinks.get(), undefined);
		assert.strictEqual(state.formattedMessage.get(), undefined);
		assert.strictEqual(state.autolinkedIssues.get(), undefined);
		assert.strictEqual(state.pullRequest.get(), undefined);
		assert.strictEqual(state.signature.get(), undefined);
	});

	test('resetRepoScopedState keeps enrichment caches matching the target repo', () => {
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());

		actions['_commitEnrichmentCache'].set('c1:/repo1', { commit: undefined });
		actions['_commitEnrichmentCache'].set('c2:/repo2', { commit: undefined });
		actions['_wipEnrichmentCache'].set('main:/repo1', {});
		actions['_wipEnrichmentCache'].set('main:/repo2', {});

		// Targeted retention: only `/repo1`-keyed entries survive.
		actions.resetRepoScopedState('/repo1');
		assert.strictEqual(actions['_commitEnrichmentCache'].has('c1:/repo1'), true);
		assert.strictEqual(actions['_commitEnrichmentCache'].has('c2:/repo2'), false);
		assert.strictEqual(actions['_wipEnrichmentCache'].has('main:/repo1'), true);
		assert.strictEqual(actions['_wipEnrichmentCache'].has('main:/repo2'), false);

		// No target → both caches fully cleared.
		actions['_commitEnrichmentCache'].set('c1:/repo1', { commit: undefined });
		actions['_wipEnrichmentCache'].set('main:/repo1', {});
		actions.resetRepoScopedState();
		assert.strictEqual(actions['_commitEnrichmentCache'].size, 0);
		assert.strictEqual(actions['_wipEnrichmentCache'].size, 0);
	});
});
