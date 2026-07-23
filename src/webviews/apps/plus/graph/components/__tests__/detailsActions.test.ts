import * as assert from 'assert';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Wip } from '../../../../../commitDetails/protocol.js';
import type {
	BranchComparisonOptions,
	BranchComparisonSummary,
	CommitResult,
	ComposeResult,
	ScopeSelection,
} from '../../../../../plus/graph/graphService.js';
import { createResource } from '../../../../shared/state/resource.js';
import type { AppState } from '../../context.js';
import type { DetailsResources, ResolvedServices } from '../detailsActions.js';
import { DetailsActions, scopeSelectionEqual } from '../detailsActions.js';
import { createDetailsState } from '../detailsState.js';

function createResources(overrides: Partial<DetailsResources> = {}): DetailsResources {
	return {
		commit: createResource(async (_signal, _repoPath: string, _sha: string) => undefined),
		wip: createResource(async (_signal, _repoPath: string) => undefined),
		pastAgentSessions: createResource(async (_signal, _worktreePath: string) => undefined),
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
		...overrides,
	};
}

function createServices(commitCompose?: (repoPath: string, plan: unknown) => Promise<CommitResult>): ResolvedServices {
	return {
		graphInspect: {
			commitCompose: commitCompose ?? (async () => ({ success: true })),
		},
		repository: {
			hasRemotes: async () => false,
		},
		telemetry: {
			sendEvent: () => Promise.resolve(),
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
	test('composeCommitAll clears compose plan and engagement after successful commit', async () => {
		const state = createDetailsState();
		state.activeMode.set('compose');
		state.activeModeContext.set('wip');
		state.composeForwardAvailable.set(true);
		state.composeCurrentCacheKey.set('cache-key');
		state.composeRefineExcludedCommitIds.set(new Set(['c1']));

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
		assert.strictEqual(state.composeCurrentCacheKey.get(), undefined);
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
		assert.strictEqual(
			state.composeLastCommitAllIncludedIds.get(),
			undefined,
			'cleared after success — retry-after-error would have nothing to re-issue with',
		);
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
			telemetry: {
				sendEvent: () => Promise.resolve(),
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
			stats: { added: 0, deleted: 0, modified: 0 },
		};
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: wip })),
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
			stats: { added: 0, deleted: 0, modified: 0 },
		};
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: wip })),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.refetchWipQuiet('/repo');

		assert.strictEqual(state.wip.get(), wip);
		assert.strictEqual(state.wipStale.get(), false);
	});

	// WIP payloads race: a refresh response and host pushes can arrive in either order relative to the working tree
	// they reflect. Ordering is by the host's `revision` marker (assigned at read-start), never by arrival.
	const wipRepo = { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false };
	function makeWip(revision: number, modified: number): Wip {
		return {
			changes: undefined,
			repositoryCount: 1,
			repo: wipRepo,
			revision: revision,
			stats: { added: 0, deleted: 0, modified: modified },
		};
	}

	test('refetchWipQuiet drops its result when a push reflecting a newer working tree landed mid-flight', async () => {
		const state = createDetailsState();
		state.activeMode.set(null);

		const staleRefresh = makeWip(1, 1); // read started BEFORE the change
		const newerPush = makeWip(2, 2); // read started AFTER it

		// A wip fetch that resolves only when the test releases it, so the push can land mid-flight.
		let releaseFetch!: (v: { wip: Wip }) => void;
		const fetchGate = new Promise<{ wip: Wip }>(resolve => (releaseFetch = resolve));
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => fetchGate),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		const refreshing = actions.refetchWipQuiet('/repo', true);
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		actions.applyPushedWip(newerPush);
		assert.strictEqual(state.wip.get(), newerPush);

		releaseFetch({ wip: staleRefresh });
		await refreshing;

		assert.strictEqual(state.wip.get(), newerPush, 'an older refresh must not overwrite a newer push');
	});

	test('a delayed push reflecting an older working tree cannot revert newer applied state', () => {
		const state = createDetailsState();
		state.activeMode.set(null);

		const actions = new DetailsActions(state, createServices(), createResources());

		const newer = makeWip(5, 2);
		const delayedOlder = makeWip(4, 1); // produced earlier, delivered later

		actions.applyPushedWip(newer);
		assert.strictEqual(state.wip.get(), newer);

		actions.applyPushedWip(delayedOlder);
		assert.strictEqual(state.wip.get(), newer, 'a delayed older push must be dropped, not revert newer state');
	});

	test('a push reflecting a newer working tree still applies over an older one', () => {
		const state = createDetailsState();
		state.activeMode.set(null);

		const actions = new DetailsActions(state, createServices(), createResources());

		const older = makeWip(1, 1);
		const newer = makeWip(2, 2);

		actions.applyPushedWip(older);
		actions.applyPushedWip(newer);
		assert.strictEqual(state.wip.get(), newer, 'newer revisions must still win');
	});

	// The panel's applied-revision gate and the graph's wip cache have to advance together. If a writer moves one
	// without the other, re-selecting the repo seeds a payload the gate then rejects — and nothing repaints.
	function createGraphStateStub(seed?: { repoPath: string; wip: Wip; isLive: boolean }) {
		const cache = new Map<string, Wip>();
		if (seed != null) {
			cache.set(seed.repoPath, seed.wip);
		}
		return {
			cache: cache,
			stub: {
				getWipState: (repoPath: string) => {
					const wip = cache.get(repoPath);
					return wip != null ? { wip: wip, isLive: seed?.isLive ?? true, ageMs: 0 } : undefined;
				},
				setWip: (repoPath: string, wip: Wip) => void cache.set(repoPath, wip),
				ingestWip: (repoPath: string, wip: Wip) => void cache.set(repoPath, wip),
				setWorkingTreeStats: () => {},
				mergeOverviewWipForRepo: () => {},
			},
		};
	}

	test('refetchWipQuiet writes its accepted result back to the graph cache', async () => {
		const state = createDetailsState();
		state.activeMode.set(null);

		const fresh = makeWip(10, 2);
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: fresh })),
		});
		const actions = new DetailsActions(state, createServices(), resources);
		const graph = createGraphStateStub({ repoPath: '/repo', wip: makeWip(9, 1), isLive: true });
		actions.graphState = graph.stub as unknown as AppState;

		await actions.refetchWipQuiet('/repo', true);

		assert.strictEqual(state.wip.get(), fresh);
		assert.strictEqual(
			graph.cache.get('/repo'),
			fresh,
			'the cache must not be left older than the revision the panel just applied',
		);
	});

	test('an accepted host result ingests authoritatively — never through the optimistic API', async () => {
		const state = createDetailsState();
		state.activeMode.set(null);

		const fresh = makeWip(10, 2);
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: fresh })),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		// `setWip` marks the entry as a pending local edit, which suppresses `isLive` and buys a `git status`
		// revalidate on every revisit — forever on an idle repo. A host RPC response is not a local guess.
		const calls: string[] = [];
		actions.graphState = {
			getWipState: () => undefined,
			setWip: () => calls.push('setWip'),
			ingestWip: () => calls.push('ingestWip'),
			setWorkingTreeStats: () => {},
		} as unknown as AppState;

		await actions.refetchWipQuiet('/repo', true);

		assert.deepStrictEqual(calls, ['ingestWip'], 'a host result must not be cached as an optimistic local edit');
	});

	test('a cached WIP older than what is applied is a miss — it must fetch, not paint nothing', async () => {
		const state = createDetailsState();
		state.activeMode.set(null);

		const fresh = makeWip(10, 2);
		let fetched = 0;
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => {
				fetched++;
				return { wip: fresh };
			}),
		});
		const actions = new DetailsActions(state, createServices(), resources);
		// Live cache entry stranded at an older revision than the panel has applied (an explicit refresh advanced
		// the panel past it). `isLive: true` is the trap: it also suppresses the background revalidate.
		const graph = createGraphStateStub({ repoPath: '/repo', wip: makeWip(9, 1), isLive: true });
		actions.graphState = graph.stub as unknown as AppState;

		actions.applyPushedWip(makeWip(10, 2));
		state.wip.set(undefined);

		await actions.fetchDetails(uncommitted, '/repo');

		assert.strictEqual(fetched, 1, 'a rejected cache seed must fall through to a fetch');
		assert.strictEqual(state.wip.get(), fresh, 'the panel must repaint rather than be left blank');
	});

	test('WIP payloads without a revision are always applied (non-Graph producers)', () => {
		const state = createDetailsState();
		state.activeMode.set(null);

		const actions = new DetailsActions(state, createServices(), createResources());

		const unversioned: Wip = { changes: undefined, repositoryCount: 1, repo: wipRepo };
		actions.applyPushedWip(makeWip(9, 3));
		actions.applyPushedWip(unversioned);
		assert.strictEqual(state.wip.get(), unversioned, 'no revision means no ordering to enforce');
	});

	test('applyPushedWip ignores host pushes for a repo while its commit is in flight', () => {
		const state = createDetailsState();
		const makeWip = (modified: number): Wip => ({
			changes: undefined,
			repositoryCount: 1,
			repo: { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false },
			stats: { added: 0, deleted: 0, modified: modified },
		});
		const original = makeWip(0);
		state.wip.set(original);

		const actions = new DetailsActions(state, createServices(), createResources());

		// During a commit for /repo, the pre-commit hook (e.g. lint-staged) churns the working tree
		// and the host emits transient WIP; applying it would let the optimistic clear empty the panel.
		(actions as unknown as { _committingRepoPath?: string })._committingRepoPath = '/repo';

		const transient = makeWip(1);
		actions.applyPushedWip(transient);
		assert.strictEqual(state.wip.get(), original, 'push for the committing repo must be ignored');

		// A push for a different repo is unaffected by this repo's in-flight commit.
		const otherRepoWip: Wip = {
			changes: undefined,
			repositoryCount: 1,
			repo: { uri: 'file:///other', name: 'other', path: '/other', isWorktree: false },
			stats: { added: 0, deleted: 0, modified: 0 },
		};
		actions.applyPushedWip(otherRepoWip);
		assert.strictEqual(state.wip.get(), otherRepoWip, 'push for a different repo still applies');

		// Once the commit settles, pushes for the repo apply again.
		(actions as unknown as { _committingRepoPath?: string })._committingRepoPath = undefined;
		actions.applyPushedWip(transient);
		assert.strictEqual(state.wip.get(), transient, 'push after the commit settles must apply');
	});

	// The panel's `willUpdate` fetch seeds, then the controller's `hostUpdate` render-target trigger fires
	// (Lit runs `willUpdate` first). The reset has to run BEFORE any seeding — hence in the fetch prologue —
	// or it clobbers what the fetch just wrote. These tests pin that ordering rather than the per-signal
	// preserve gates that used to paper over it.

	test('resetRepoScopedState clears every repo-scoped signal unconditionally', () => {
		const state = createDetailsState();
		state.commit.set({ repoPath: '/repo1', sha: 'c1' } as any);
		state.wip.set({ repo: { path: '/repo1' } } as any);
		state.wipAutolinks.set([{ id: 'auto1' } as any]);
		state.wipMergeTargetLoading.set(true);
		state.autolinks.set([{ id: 'auto1' } as any]);
		state.formattedMessage.set('msg');
		state.commitFrom.set({ repoPath: '/repo1', sha: 'c1' } as any);
		state.reachability.set({ partial: true, refs: [{ name: 'main', refType: 'branch' }] } as any);
		state.reachabilityState.set('loaded');

		const actions = new DetailsActions(state, createServices(), createResources());

		// Matching the target repo is NOT a reason to preserve — callers reset before seeding, so there is
		// never anything fresh to protect. Whether to reset at all is `resetRepoScopedStateOnSwitch`'s call.
		actions.resetRepoScopedState('/repo1');
		assert.strictEqual(state.commit.get(), undefined);
		assert.strictEqual(state.wip.get(), undefined);
		assert.strictEqual(state.wipAutolinks.get(), undefined);
		assert.strictEqual(state.wipMergeTargetLoading.get(), false);
		assert.strictEqual(state.autolinks.get(), undefined);
		assert.strictEqual(state.formattedMessage.get(), undefined);
		assert.strictEqual(state.commitFrom.get(), undefined);
		assert.strictEqual(state.reachability.get(), undefined);
		assert.strictEqual(state.reachabilityState.get(), 'idle');
	});

	test('a fetch seeding a new repo survives the render-target trigger that follows it', async () => {
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());
		const reachability = { partial: true, refs: [{ name: 'feature/git-health', refType: 'branch' }] } as any;

		// Land on /repo1 first so the next fetch is a genuine cross-repo switch.
		await actions.fetchDetails('c1', '/repo1');
		await actions.fetchDetails('c2', '/repo2', reachability);

		// `hostUpdate`'s trigger fires after `willUpdate`'s fetch. It must not clobber the graph-seeded
		// reachability: nothing re-seeds it (the `_lastFetchedKey` dedup early-outs), so a wipe here
		// stranded the branch indicator at `idle` until the user forced a redundant git call.
		actions.resetRepoScopedStateOnSwitch('/repo2');
		assert.strictEqual(state.reachability.get(), reachability, 'graph-seeded reachability must survive');
		assert.strictEqual(state.reachabilityState.get(), 'loaded');
	});

	test('resetRepoScopedStateOnSwitch clears when the fetched repo differs', async () => {
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());

		await actions.fetchDetails('c1', '/repo1');
		state.wipAutolinks.set([{ id: 'auto1' } as any]);

		actions.resetRepoScopedStateOnSwitch('/repo2');
		assert.strictEqual(state.commit.get(), undefined);
		assert.strictEqual(state.wipAutolinks.get(), undefined);
	});

	test('resetRepoScopedStateOnSwitch defers to an active mode or an open compare sheet', async () => {
		const state = createDetailsState();
		const actions = new DetailsActions(state, createServices(), createResources());

		// An active mode owns its own in-flight fetches — resetting would clobber `branchCommitsFetching`
		// back to false mid-air, stranding the picker in "no items + not loading".
		await actions.fetchDetails('c1', '/repo1');
		state.activeMode.set('compose');
		state.branchCommitsFetching.set(true);
		actions.resetRepoScopedStateOnSwitch('/repo2');
		assert.strictEqual(state.branchCommitsFetching.get(), true, 'an in-flight mode fetch must not be clobbered');
		state.activeMode.set(null);

		// An open compare sheet is anchored to its own refs.
		const commit = { repoPath: '/repo1', sha: 'c1' } as any;
		state.commit.set(commit);
		state.compareSheetOpen.set(true);
		actions.resetRepoScopedStateOnSwitch('/repo2');
		assert.strictEqual(state.commit.get(), commit, 'an open compare sheet keeps its repo-scoped state');
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
