import * as assert from 'assert';
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
	test('composeCommitTo clears stale compose plan after successful commit', async () => {
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

		await actions.composeCommitTo('/repo', 0, 'abc');

		assert.deepStrictEqual(committedPlan, {
			commits: composeResult.result.commits,
			base: composeResult.result.baseCommit,
			mode: 'up-to',
			upToIndex: 0,
		});
		assert.strictEqual(state.activeMode.get(), null);
		assert.strictEqual(state.activeModeContext.get(), null);
		assert.strictEqual(state.composeForwardAvailable.get(), false);
		assert.strictEqual(resources.compose.status.get(), 'idle');
		assert.strictEqual(resources.compose.value.get(), undefined);
		assert.deepStrictEqual(fetchedDetails, { sha: 'abc', repoPath: '/repo' });
	});

	test('toggleCompareWorkingTree invalidates side data and refetches summary with the toggle enabled', async () => {
		const state = createDetailsState();
		state.branchCompareLeftRef.set('feature');
		state.branchCompareRightRef.set('main');
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
			allFiles: [{ repoPath: '/repo', path: 'changed.ts', status: 'M', staged: false, source: 'workingTree' }],
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

	test('markBranchCompareStale only marks active working-tree comparisons and refresh clears it', async () => {
		const state = createDetailsState();
		state.branchCompareLeftRef.set('feature');
		state.branchCompareRightRef.set('main');
		state.activeMode.set('compare');

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
});
