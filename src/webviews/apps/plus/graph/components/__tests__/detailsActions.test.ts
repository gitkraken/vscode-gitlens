import * as assert from 'assert';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Wip } from '../../../../../commitDetails/protocol.js';
import type {
	BranchCommitEntry,
	BranchCommitsResult,
	BranchComparisonOptions,
	BranchComparisonSummary,
	CommitResult,
	ComposeResult,
	ComposeSessionKey,
	DeepReviewAvailability,
	ScopeSelection,
} from '../../../../../plus/graph/graphService.js';
import { createResource } from '../../../../shared/state/resource.js';
import type { AppState } from '../../context.js';
import type { DetailsResources, ResolvedServices } from '../detailsActions.js';
import {
	DetailsActions,
	getRewrittenScopeShas,
	mapRewrittenCommit,
	remapScopeRange,
	scopeSelectionEqual,
} from '../detailsActions.js';
import { createDetailsState } from '../detailsState.js';

function createResources(overrides: Partial<DetailsResources> = {}): DetailsResources {
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
		...overrides,
	};
}

const sessionKey = 'wip|/repo' as string as ComposeSessionKey;

function createServices(
	commitCompose?: (repoPath: string, sessionKey: ComposeSessionKey, plan: unknown) => Promise<CommitResult>,
): ResolvedServices {
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
		state.composeRefineExcludedCommitIds.set(new Set(['c1']));

		let committedPlan: unknown;
		const resources = createResources();
		resources.compose.mutate(composeResult);

		const actions = new DetailsActions(
			state,
			createServices(async (_repoPath, _sessionKey, plan) => {
				committedPlan = plan;
				return { success: true };
			}),
			resources,
		);
		let fetchedDetails: { sha: string | undefined; repoPath: string | undefined } | undefined;
		actions.fetchDetails = async (sha, repoPath) => {
			fetchedDetails = { sha: sha, repoPath: repoPath };
		};

		await actions.composeCommitAll('/repo', sessionKey, 'abc');

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
			createServices(async (_repoPath, _sessionKey, plan) => {
				committedPlan = plan;
				return { success: true };
			}),
			resources,
		);
		actions.fetchDetails = async () => undefined;

		await actions.composeCommitAll('/repo', sessionKey, 'abc', undefined, ['c1']);

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
		state.branchCompareLoadedBySide.ahead.set(true);
		state.branchCompareLoadedBySide.behind.set(true);
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
		assert.strictEqual(state.branchCompareLoadedBySide.ahead.get(), false);
		assert.strictEqual(state.branchCompareLoadedBySide.behind.get(), false);
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
		state.comparePresentation.set('sheet');

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
		state.branchCompareLoadedBySide.ahead.set(true);
		state.branchCompareLoadedBySide.behind.set(true);
		state.branchCompareSelectedCommitShaByTab.set(new Map([['behind', 'def']]));
		actions.markBranchCompareStale();
		assert.strictEqual(state.branchCompareStale.get(), true);

		actions.refreshBranchCompare('/repo');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(summaryFetches, [{ includeWorkingTree: true }]);
		assert.strictEqual(state.branchCompareStale.get(), false);
		assert.strictEqual(state.branchCompareLoadedBySide.ahead.get(), false);
		assert.strictEqual(state.branchCompareLoadedBySide.behind.get(), false);
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

	// A working-tree change (WIP tick) while a wip-scope mode is open must refetch the scoped file
	// list, or the curation list (and the eventual run) stays pinned to the pre-change file set.
	function wipFor(repoPath: string): Wip {
		return {
			changes: undefined,
			repositoryCount: 1,
			repo: { uri: `file://${repoPath}`, name: 'repo', path: repoPath, isWorktree: false },
			stats: { added: 0, deleted: 0, modified: 0 },
		};
	}

	function scopeFilesRecorder(sink: Array<[string, ScopeSelection]>) {
		return createResource(async (_signal, repoPath: string, scope: ScopeSelection) => {
			sink.push([repoPath, scope]);
			return [];
		});
	}

	const wipScope: ScopeSelection = { type: 'wip', includeStaged: true, includeUnstaged: false, includeShas: [] };

	test('applyWipPayload refetches scope files on a wip-scope mode tick for the active repo', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeRepoPath.set('/repo');
		state.scope.set(wipScope);

		const fetches: Array<[string, ScopeSelection]> = [];
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: wipFor('/repo') })),
			scopeFiles: scopeFilesRecorder(fetches),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.refetchWipQuiet('/repo');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(fetches, [['/repo', wipScope]]);
	});

	test('applyWipPayload does not refetch scope files when no mode is active', async () => {
		const state = createDetailsState();
		state.activeMode.set(null);
		state.activeModeRepoPath.set('/repo');
		state.scope.set(wipScope);

		const fetches: Array<[string, ScopeSelection]> = [];
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: wipFor('/repo') })),
			scopeFiles: scopeFilesRecorder(fetches),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.refetchWipQuiet('/repo');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(fetches, []);
	});

	test('applyWipPayload does not refetch scope files for a non-wip scope', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeRepoPath.set('/repo');
		state.scope.set({ type: 'commit', sha: 'abc' });

		const fetches: Array<[string, ScopeSelection]> = [];
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: wipFor('/repo') })),
			scopeFiles: scopeFilesRecorder(fetches),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.refetchWipQuiet('/repo');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(fetches, []);
	});

	test("applyWipPayload does not refetch scope files for a background repo's tick", async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeRepoPath.set('/foreground');
		state.scope.set(wipScope);

		const fetches: Array<[string, ScopeSelection]> = [];
		const resources = createResources({
			wip: createResource(async (_signal, _repoPath: string) => ({ wip: wipFor('/background') })),
			scopeFiles: scopeFilesRecorder(fetches),
		});
		const actions = new DetailsActions(state, createServices(), resources);

		await actions.refetchWipQuiet('/background');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(fetches, []);
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
				setWipStatus: () => {},
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
			setWipStatus: () => {},
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
		state.comparePresentation.set('sheet');
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

suite('DetailsActions.revalidateWipIfStale', () => {
	/** A cached, non-live wip entry shaped like `getWipState`'s return. Built through variables rather than
	 *  an asserted literal so the assertion lands on an identifier. */
	function cachedEntry(path: string) {
		const shell = { repo: { path: path } };
		return { wip: shell as unknown as Wip, isLive: false, ageMs: 0 };
	}

	/** Minimal `graphState` for the revalidate path: a non-live cached entry per repo. */
	function graphStateWith(paths: string[]) {
		return {
			getWipState: (repoPath: string) =>
				paths.includes(repoPath) ? { wip: { repo: { path: repoPath } }, isLive: false, ageMs: 0 } : undefined,
			ingestWip: () => {},
		};
	}

	// `resources.wip` is ONE shared slot that cancels the previous fetch. So a revalidate fired for a repo
	// the panel has since navigated away from doesn't just waste a read — it cancels the fetch the CURRENT
	// selection is waiting on, and that path reads the shared slot. The re-run therefore has to check that
	// the panel still shows the repo it is about to revalidate.
	test('a queued re-run does not fire for a repo the panel has navigated away from', async () => {
		const state = createDetailsState();
		let release!: () => void;
		const gate = new Promise<void>(r => (release = r));
		const fetched: string[] = [];
		const resources = createResources({
			wip: createResource(async (_signal, repoPath: string) => {
				fetched.push(repoPath);
				await gate;
				return undefined;
			}),
		});

		const actions = new DetailsActions(state, createServices(), resources);
		actions['graphState'] = graphStateWith(['/repo-a', '/repo-b']) as never;

		const cachedA = cachedEntry('/repo-a');
		// A revalidate for A starts, then a second ask for A arrives while it's in flight and is queued.
		actions['revalidateWipIfStale'](cachedA, '/repo-a', 'uncommitted:/repo-a', undefined);
		actions['revalidateWipIfStale'](cachedA, '/repo-a', 'uncommitted:/repo-a', undefined);
		assert.deepStrictEqual(fetched, ['/repo-a'], 'the second ask must queue, not stack a second fetch');

		// The selection moves to B before A settles.
		actions['_lastFetchedRepoPath'] = '/repo-b';
		actions['_lastFetchedKey'] = 'uncommitted:/repo-b';
		release();
		await new Promise(r => setTimeout(r, 0));

		assert.deepStrictEqual(fetched, ['/repo-a'], 'the queued re-run must not fetch A over the selection of B');
	});

	test('a queued re-run fires when the panel is still showing that repo', async () => {
		const state = createDetailsState();
		let release!: () => void;
		const gate = new Promise<void>(r => (release = r));
		const fetched: string[] = [];
		const resources = createResources({
			wip: createResource(async (_signal, repoPath: string) => {
				fetched.push(repoPath);
				await gate;
				return undefined;
			}),
		});

		const actions = new DetailsActions(state, createServices(), resources);
		actions['graphState'] = graphStateWith(['/repo-a']) as never;
		actions['_lastFetchedRepoPath'] = '/repo-a';
		actions['_lastFetchedKey'] = 'uncommitted:/repo-a';

		const cachedA = cachedEntry('/repo-a');
		actions['revalidateWipIfStale'](cachedA, '/repo-a', 'uncommitted:/repo-a', undefined);
		actions['revalidateWipIfStale'](cachedA, '/repo-a', 'uncommitted:/repo-a', undefined);

		release();
		await new Promise(r => setTimeout(r, 0));

		assert.deepStrictEqual(fetched, ['/repo-a', '/repo-a'], 'the queued ask must be honoured');
	});
});

suite('DetailsActions.ensureBranchCommitsCover', () => {
	const commit = (sha: string): BranchCommitEntry => ({ sha: sha, pushed: false }) as unknown as BranchCommitEntry;

	/** Services stub exposing a call-counting `getBranchCommits` alongside the base graphInspect shape. */
	function servicesWithBranchCommits(getBranchCommits: () => Promise<BranchCommitsResult>): {
		services: ResolvedServices;
		calls: () => number;
	} {
		let count = 0;
		const services = {
			graphInspect: {
				commitCompose: async () => ({ success: true }),
				getBranchCommits: () => {
					count++;
					return getBranchCommits();
				},
			},
			telemetry: { sendEvent: () => Promise.resolve() },
		} as unknown as ResolvedServices;
		return { services: services, calls: () => count };
	}

	test('all seeded shas already loaded → no fetch, no load-more', async () => {
		const state = createDetailsState();
		const { services, calls } = servicesWithBranchCommits(async () => ({ commits: [], hasMore: false }));
		const actions = new DetailsActions(state, services, createResources());

		// Pin the fetched-repo path + preload the shas so both the fetch and the paging loop are skipped.
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('h'), commit('a')]);
		state.branchCommitsHasMore.set(true);

		await actions.ensureBranchCommitsCover('/repo', ['h', 'a']);

		assert.strictEqual(calls(), 0, 'getBranchCommits should not be called when the range is already covered');
	});

	test('a seeded sha missing + hasMore → pages once via load-more until covered', async () => {
		const state = createDetailsState();
		const { services, calls } = servicesWithBranchCommits(async () => ({
			commits: [commit('h'), commit('a')],
			hasMore: false,
		}));
		const actions = new DetailsActions(state, services, createResources());

		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('h')]);
		state.branchCommitsHasMore.set(true);

		await actions.ensureBranchCommitsCover('/repo', ['h', 'a']);

		assert.strictEqual(calls(), 1, 'exactly one load-more page fills the missing sha');
		assert.deepStrictEqual(
			state.branchCommits.get()?.map(c => c.sha),
			['h', 'a'],
			'loaded commits now cover the seeded range',
		);
	});

	test('no-op for an empty seed or missing repo path', async () => {
		const state = createDetailsState();
		const { services, calls } = servicesWithBranchCommits(async () => ({ commits: [], hasMore: false }));
		const actions = new DetailsActions(state, services, createResources());

		await actions.ensureBranchCommitsCover('/repo', []);
		await actions.ensureBranchCommitsCover(undefined, ['h']);

		assert.strictEqual(calls(), 0, 'nothing to cover');
	});
});

suite('remapScopeRange', () => {
	/** `sha` or `sha:subject`; a rewritten commit keeps its subject unless it was reworded. */
	const commits = (...entries: string[]): BranchCommitEntry[] =>
		entries.map(entry => {
			const [sha, subject] = entry.split(':');
			const message = `${subject ?? sha.replaceAll("'", '')}\n\nbody`;
			return { sha: sha, message: message, pushed: false } as unknown as BranchCommitEntry;
		});

	// Lists are newest first, as the branch commits and the scope keep them
	const cases: {
		name: string;
		shas: string[];
		wip?: boolean;
		prev?: string[];
		next: string[];
		patchIds?: Record<string, string>;
		mergeBases?: { prev?: string; next?: string };
		expected: string[] | undefined;
	}[] = [
		{
			name: 'nothing changed',
			shas: ['c', 'b'],
			prev: ['c', 'b', 'a'],
			next: ['c', 'b', 'a'],
			expected: undefined,
		},
		{ name: 'no earlier list', shas: ['b'], next: ["b'"], expected: undefined },
		{
			name: 'amend of the tip',
			shas: ['c', 'b'],
			prev: ['c', 'b', 'a'],
			next: ["c'", 'b', 'a'],
			expected: ["c'", 'b'],
		},
		{
			name: 'amend of an earlier commit',
			shas: ['c', 'b', 'a'],
			prev: ['c', 'b', 'a'],
			next: ["c'", "b'", 'a'],
			expected: ["c'", "b'", 'a'],
		},
		{
			name: 'fixup folded in by an autosquash rebase',
			shas: ['f:fixup! b', 'c', 'b'],
			prev: ['f:fixup! b', 'c', 'b', 'a'],
			next: ["c'", "b'", 'a'],
			expected: ["c'", "b'"],
		},
		{ name: 'reword', shas: ['b'], prev: ['c', 'b', 'a'], next: ["c'", "b':reworded", 'a'], expected: ["b'"] },
		{
			name: 'reword while another commit is dropped, matched by patch id',
			shas: ['b'],
			prev: ['d', 'c', 'b', 'a'],
			next: ["c'", "b':reworded", 'a'],
			patchIds: { b: 'pb', c: 'pc', "c'": 'pc', "b'": 'pb' },
			expected: ["b'"],
		},
		{
			name: 'a patch id tells apart commits with the same subject',
			shas: ['b:wip'],
			prev: ['c:wip', 'b:wip', 'a'],
			next: ["b':wip", "c':wip", 'a'],
			patchIds: { b: 'pb', c: 'pc', "b'": 'pb', "c'": 'pc' },
			expected: ["b'"],
		},
		{ name: 'reorder', shas: ['b'], prev: ['c', 'b', 'a'], next: ["b'", "c'", 'a'], expected: ["b'"] },
		{
			name: 'reorder of the whole range',
			shas: ['c', 'b'],
			prev: ['c', 'b', 'a'],
			next: ["b'", "c'", 'a'],
			expected: ["b'", "c'"],
		},
		{ name: 'drop', shas: ['c', 'b'], prev: ['c', 'b', 'a'], next: ["c'", 'a'], expected: ["c'"] },
		{ name: 'only the dropped commit', shas: ['b'], prev: ['c', 'b', 'a'], next: ["c'", 'a'], expected: undefined },
		{
			name: 'oldest loaded commit rewritten, same count',
			shas: ['b', 'a'],
			prev: ['b', 'a'],
			next: ["b'", "a':reworded"],
			expected: ["b'", "a'"],
		},
		{
			name: 'commits below the rewrite that the new page no longer loads',
			shas: ['u', 'mb'],
			prev: ['t', 'u', 'mb', 'p1'],
			next: ["t'", 'u'],
			expected: undefined,
		},
		{
			name: 'a rewritten tip with older commits no longer loaded',
			shas: ['t', 'u', 'mb'],
			prev: ['t', 'u', 'mb', 'p1'],
			next: ["t'", 'u'],
			expected: ["t'", 'u', 'mb'],
		},
		{
			name: 'a commit on top of a range holding the tip joins it',
			shas: ['c', 'b'],
			prev: ['c', 'b', 'a'],
			next: ['d', 'c', 'b', 'a'],
			expected: ['d', 'c', 'b'],
		},
		{
			name: 'a commit on top of a range without the tip does not join it',
			shas: ['b', 'a'],
			prev: ['c', 'b', 'a'],
			next: ['d', 'c', 'b', 'a'],
			expected: undefined,
		},
		{
			name: 'working changes committed on top join the range',
			shas: [],
			wip: true,
			prev: ['c', 'b'],
			next: ['d', 'c', 'b'],
			expected: ['d'],
		},
		{
			name: 'working changes and the tip, committed on top',
			shas: ['c', 'b'],
			wip: true,
			prev: ['c', 'b'],
			next: ['d', 'c', 'b'],
			expected: ['d', 'c', 'b'],
		},
		{
			name: 'a commit inserted inside the range joins it',
			shas: ['c', 'b', 'a'],
			prev: ['c', 'b', 'a', 'base'],
			next: ["c'", 'x', "b'", 'a', 'base'],
			expected: ["c'", 'x', "b'", 'a'],
		},
		{
			name: 'a rebase onto the base branch',
			shas: ['c', 'b', 'a'],
			prev: ['c', 'b', 'a'],
			next: ["c'", "b'", "a'"],
			expected: ["c'", "b'", "a'"],
		},
		{ name: 'an undo of the tip', shas: ['c', 'b'], prev: ['c', 'b', 'a'], next: ['b', 'a'], expected: ['b'] },
		{
			name: 'an undo of the only commit in the range',
			shas: ['c'],
			prev: ['c', 'b'],
			next: ['b'],
			expected: undefined,
		},
		{
			name: 'an oldest commit that no longer maps widens the range to the rewritten ones',
			shas: ['c', 'b'],
			prev: ['d', 'c', 'b', 'a'],
			next: ["c'", "b':reworded", 'a'],
			expected: ["c'", "b'"],
		},
		{
			name: 'a first commit on a branch: working changes committed on top of its merge base',
			shas: [],
			wip: true,
			// With no commits of its own the window is the plain branch log; after the commit it leaves out its merge base
			prev: ['m0', 'm1', 'm2'],
			next: ['c1'],
			mergeBases: { next: 'm0' },
			expected: ['c1'],
		},
		{
			name: 'a first commit on a branch, over a scope on its tip',
			shas: ['m0'],
			prev: ['m0', 'm1', 'm2'],
			next: ['c1'],
			mergeBases: { next: 'm0' },
			expected: ['c1'],
		},
		{
			name: "an undo of a branch's only commit",
			shas: ['c1'],
			prev: ['c1'],
			next: ['m0', 'm1', 'm2'],
			mergeBases: { prev: 'm0' },
			expected: undefined,
		},
		{
			name: 'a scope commit that became the merge base',
			shas: ['b'],
			prev: ['c', 'b', 'a'],
			next: ['c'],
			mergeBases: { next: 'b' },
			expected: undefined,
		},
		{
			name: 'a squash with a new message',
			shas: ['c', 'b'],
			prev: ['c', 'b', 'a'],
			next: ['s:squashed', 'a'],
			expected: ['s'],
		},
	];

	const shaOf = (entry: string) => entry.split(':')[0];
	for (const c of cases) {
		test(c.name, () => {
			assert.deepStrictEqual(
				remapScopeRange(
					{ includeShas: c.shas.map(shaOf), includesWip: c.wip ?? false },
					c.prev != null ? commits(...c.prev) : undefined,
					commits(...c.next),
					c.mergeBases,
					c.patchIds,
				),
				c.expected,
			);
		});
	}

	test('patch ids are asked only for replaced scope commits and the rewritten ones', () => {
		assert.deepStrictEqual(getRewrittenScopeShas(['c', 'b'], commits('c', 'b', 'a'), commits("c'", 'b', 'a')), [
			'c',
			"c'",
		]);
		assert.deepStrictEqual(
			getRewrittenScopeShas(['c', 'b'], commits('c', 'b', 'a'), commits('d', 'c', 'b', 'a')),
			[],
			'nothing replaced',
		);
	});
});

suite('DetailsActions — scope follows a history rewrite', () => {
	// A rewritten commit (`b'`) keeps the subject of the one it replaced (`b`)
	const commit = (sha: string): BranchCommitEntry =>
		({ sha: sha, message: sha.replace("'", ''), pushed: false }) as unknown as BranchCommitEntry;
	const repo = { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false };
	const wipAt = (revision: number, tip: string): Wip =>
		({
			changes: undefined,
			repositoryCount: 1,
			repo: repo,
			revision: revision,
			// No branch name, so the push doesn't also start a branch-enrichment fetch
			branch: { repoPath: '/repo', reference: { sha: tip } },
		}) as unknown as Wip;

	test('an amend of an earlier commit moves the review scope and refetches its files', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['c', 'b'] });

		let branchCommits: BranchCommitsResult = { commits: [commit('c'), commit('b'), commit('a')], hasMore: false };
		const services = {
			...createServices(),
			graphInspect: { getBranchCommits: async () => branchCommits, getCommitPatchIds: async () => undefined },
		} as unknown as ResolvedServices;
		const fetchedScopes: ScopeSelection[] = [];
		const resources = createResources({
			scopeFiles: createResource(async (_signal, _repoPath: string, scope: ScopeSelection) => {
				fetchedScopes.push(scope);
				return [];
			}),
		});
		const actions = new DetailsActions(state, services, resources);

		actions.applyPushedWip(wipAt(1, 'c'));
		await actions.fetchBranchCommits('/repo');

		// The agent amends b: c is rewritten on top of the new b, the tip moves, ahead/behind stays the same
		branchCommits = { commits: [commit("c'"), commit("b'"), commit('a')], hasMore: false };
		actions.applyPushedWip(wipAt(2, "c'"));
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		const expected: ScopeSelection = {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ["c'", "b'"],
		};
		assert.deepStrictEqual(state.scope.get(), expected);
		assert.deepStrictEqual(fetchedScopes.at(-1), expected, 'the files are reloaded for the rewritten commits');
	});

	test("the host's patch ids map commits whose subjects are the same", async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['b'] });

		const wip = (sha: string) => ({ sha: sha, message: 'wip', pushed: false }) as unknown as BranchCommitEntry;
		const asked: string[][] = [];
		const services = {
			...createServices(),
			graphInspect: {
				// A rebase swapped the two "wip" commits
				getBranchCommits: async () => ({ commits: [wip("b'"), wip("c'"), commit('a')], hasMore: false }),
				getCommitPatchIds: async (_repoPath: string, shas: string[]) => {
					asked.push(shas);
					return { b: 'pb', c: 'pc', "b'": 'pb', "c'": 'pc' };
				},
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([wip('c'), wip('b'), commit('a')]);

		await actions.fetchBranchCommits('/repo');

		assert.deepStrictEqual(asked, [['b', "b'", "c'"]]);
		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ["b'"],
		});
	});

	test("committed working changes join the scope even after the picker's fallback replaced it", async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		state.scope.set({ type: 'wip', includeStaged: true, includeUnstaged: false, includeShas: [] });

		let listCommits!: () => void;
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: () =>
					new Promise<BranchCommitsResult>(resolve => {
						listCommits = () =>
							resolve({ commits: [commit('w'), commit('c'), commit('b')], hasMore: false });
					}),
				getCommitPatchIds: async () => undefined,
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('c'), commit('b')]);

		actions.applyPushedWip(wipAt(1, 'c'));
		// The staged changes are committed as w
		actions.applyPushedWip(wipAt(2, 'w'));
		// The staged row is gone before the new commit is listed, so the picker falls back to its default
		state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['c', 'b'] });
		listCommits();
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: false,
			includeShas: ['w'],
		});
	});

	[
		{
			name: "a branch's first commit joins the working changes it came from",
			scope: [] as string[],
			staged: true,
			prev: ['m0', 'm1'],
			prevMergeBase: undefined as string | undefined,
			tips: ['m0', 'c1'],
			next: { commits: ['c1'], mergeBase: 'm0' as string | undefined },
			expected: ['c1'],
		},
		{
			name: "an undo of a branch's only commit keeps its scope off the base branch's history",
			scope: ['c1'],
			staged: false,
			prev: ['c1'],
			prevMergeBase: 'm0',
			tips: ['c1', 'm0'],
			next: { commits: ['m0', 'm1'], mergeBase: undefined },
			expected: ['c1'],
		},
	].forEach(c => {
		test(c.name, async () => {
			const state = createDetailsState();
			state.activeMode.set('review');
			state.activeModeContext.set('wip');
			state.activeModeRepoPath.set('/repo');
			state.scope.set({ type: 'wip', includeStaged: c.staged, includeUnstaged: false, includeShas: c.scope });

			const services = {
				...createServices(),
				graphInspect: {
					getBranchCommits: async () => ({
						commits: c.next.commits.map(commit),
						mergeBase: c.next.mergeBase != null ? { sha: c.next.mergeBase, message: '' } : undefined,
						hasMore: false,
					}),
					getCommitPatchIds: async () => undefined,
				},
			} as unknown as ResolvedServices;
			const actions = new DetailsActions(state, services, createResources());
			actions['_branchCommitsFetchedRepoPath'] = '/repo';
			state.branchCommits.set(c.prev.map(commit));
			state.branchMergeBase.set(c.prevMergeBase != null ? { sha: c.prevMergeBase, message: '' } : undefined);

			actions.applyPushedWip(wipAt(1, c.tips[0]));
			actions.applyPushedWip(wipAt(2, c.tips[1]));
			await new Promise<void>(resolve => setTimeout(resolve, 0));

			assert.deepStrictEqual(state.scope.get(), {
				type: 'wip',
				includeStaged: c.staged,
				includeUnstaged: false,
				includeShas: c.expected,
			});
		});
	});

	test('a refetch that replaces an aborted one still starts from the scope pinned at the tip move', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		state.scope.set({ type: 'wip', includeStaged: true, includeUnstaged: false, includeShas: [] });

		const pending: (() => void)[] = [];
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: () =>
					new Promise<BranchCommitsResult>(resolve => {
						pending.push(() =>
							resolve({ commits: [commit('w'), commit('c'), commit('b')], hasMore: false }),
						);
					}),
				getCommitPatchIds: async () => undefined,
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('c'), commit('b')]);

		actions.applyPushedWip(wipAt(1, 'c'));
		// The staged changes are committed as w: the tip push pins the scope and starts a refetch…
		actions.applyPushedWip(wipAt(2, 'w'));
		state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['c', 'b'] });
		// …and the branch-state change that follows (ahead/behind moved) starts another, aborting it
		const second = actions.fetchBranchCommits('/repo');
		pending[0]();
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		pending[1]();
		await second;

		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: false,
			includeShas: ['w'],
		});
		assert.strictEqual(actions['_scopeBeforeTipMove'], undefined, 'the pin is consumed');
	});

	test("the picker's fallback for a committed row is held while the remap is pending, so its files never load", async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		const stagedOnly: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: false,
			includeShas: [],
		};
		state.scope.set(stagedOnly);

		let listCommits!: () => void;
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: () =>
					new Promise<BranchCommitsResult>(resolve => {
						listCommits = () =>
							resolve({ commits: [commit('w'), commit('c'), commit('b')], hasMore: false });
					}),
				getCommitPatchIds: async () => undefined,
			},
		} as unknown as ResolvedServices;
		const fetchedScopes: ScopeSelection[] = [];
		const resources = createResources({
			scopeFiles: createResource(async (_signal, _repoPath: string, scope: ScopeSelection) => {
				fetchedScopes.push(scope);
				return [];
			}),
		});
		const actions = new DetailsActions(state, services, resources);
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('c'), commit('b')]);

		actions.applyPushedWip(wipAt(1, 'c'));
		actions.applyPushedWip(wipAt(2, 'w'));
		const fallback: ScopeSelection = {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ['c', 'b'],
		};
		assert.ok(actions.holdScopeForRemap(fallback), 'held while the remap is pending');
		assert.strictEqual(state.scope.get(), stagedOnly);

		listCommits();
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		const expected: ScopeSelection = {
			type: 'wip',
			includeStaged: true,
			includeUnstaged: false,
			includeShas: ['w'],
		};
		assert.deepStrictEqual(state.scope.get(), expected);
		assert.ok(!fetchedScopes.includes(fallback), "the fallback's files are never loaded");
		assert.strictEqual(actions.holdScopeForRemap(fallback), false, 'nothing is held once the remap is done');
	});

	test('a tip move reloads the files once, after the remap, not for the scope it may replace', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		const scope: ScopeSelection = { type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['b'] };
		state.scope.set(scope);

		let listCommits!: () => void;
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: () =>
					new Promise<BranchCommitsResult>(resolve => {
						listCommits = () =>
							resolve({ commits: [commit('d'), commit('c'), commit('b'), commit('a')], hasMore: false });
					}),
				getCommitPatchIds: async () => undefined,
			},
		} as unknown as ResolvedServices;
		const fetchedScopes: ScopeSelection[] = [];
		const resources = createResources({
			scopeFiles: createResource(async (_signal, _repoPath: string, fetched: ScopeSelection) => {
				fetchedScopes.push(fetched);
				return [];
			}),
		});
		const actions = new DetailsActions(state, services, resources);
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('c'), commit('b'), commit('a')]);

		actions.applyPushedWip(wipAt(1, 'c'));
		const before = fetchedScopes.length;
		actions.applyPushedWip(wipAt(2, 'd'));
		assert.strictEqual(fetchedScopes.length, before, 'nothing loads while the remap is pending');

		listCommits();
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(
			fetchedScopes.slice(before),
			[scope],
			'the remap kept the scope, so its files load once',
		);
	});

	test('a selection held during the remap applies when the remap leaves the scope as it was', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['b'] });

		let listCommits!: () => void;
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: () =>
					new Promise<BranchCommitsResult>(resolve => {
						listCommits = () =>
							resolve({ commits: [commit('d'), commit('c'), commit('b'), commit('a')], hasMore: false });
					}),
				getCommitPatchIds: async () => undefined,
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('c'), commit('b'), commit('a')]);

		actions.applyPushedWip(wipAt(1, 'c'));
		// A commit on top of a range without the tip: the remap keeps the scope
		actions.applyPushedWip(wipAt(2, 'd'));
		const picked: ScopeSelection = {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ['c', 'b'],
		};
		assert.ok(actions.holdScopeForRemap(picked));

		listCommits();
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(state.scope.get(), picked);
	});

	test('a scope reaching into pages loaded before the refetch pages back to them', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		// The scope reaches past the merge base, into commits a Load more listed
		state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['c', 'm1'] });

		const firstPage = [commit('c'), commit('b')];
		const pages: { limit?: number }[] = [];
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: async (_repoPath: string, options?: { limit?: number }) => {
					pages.push({ limit: options?.limit });
					return options?.limit != null
						? { commits: [...firstPage, commit('m1'), commit('m0')], hasMore: false }
						: { commits: firstPage, hasMore: true };
				},
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([...firstPage, commit('m1'), commit('m0')]);

		await actions.fetchBranchCommits('/repo');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.ok(
			state.branchCommits.get()?.some(c => c.sha === 'm1'),
			'the scope commit is listed again',
		);
		assert.strictEqual(pages.length, 2, 'one page back');
	});

	test('a scope commit an undo removed does not page through the history', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['c3'] });

		let calls = 0;
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: async () => {
					calls++;
					return { commits: [commit('c2'), commit('c1')], hasMore: true };
				},
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('c3'), commit('c2'), commit('c1')]);

		await actions.fetchBranchCommits('/repo');
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.strictEqual(calls, 1, 'no paging for a commit that is gone');
	});

	test('a pushed tip move refetches once the rebase has landed', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');
		state.scope.set({ type: 'wip', includeStaged: false, includeUnstaged: false, includeShas: ['c', 'b'] });

		let calls = 0;
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: async () => {
					calls++;
					return { commits: [commit("c'"), commit("b'"), commit('a')], hasMore: false };
				},
				getCommitPatchIds: async () => undefined,
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions['_branchCommitsFetchedRepoPath'] = '/repo';
		state.branchCommits.set([commit('c'), commit('b'), commit('a')]);

		actions.applyPushedWip(wipAt(1, 'c'));
		// An `edit` stop on the tip: HEAD is already on the amended commit while paused
		const paused = wipAt(2, "c'");
		paused.changes = { pausedOpStatus: { type: 'rebase' } } as unknown as Wip['changes'];
		actions.applyPushedWip(paused);
		assert.strictEqual(calls, 0, 'no refetch while the rebase is paused');

		// …and the rebase lands with the tip it already had
		actions.applyPushedWip(wipAt(4, "c'"));
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.strictEqual(calls, 1, 'the landed rebase refetches');
		assert.deepStrictEqual(state.scope.get(), {
			type: 'wip',
			includeStaged: false,
			includeUnstaged: false,
			includeShas: ["c'", "b'"],
		});
	});

	test('a tip that moves mid-rebase waits for the rebase to finish', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('wip');
		state.activeModeRepoPath.set('/repo');

		let calls = 0;
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: async () => {
					calls++;
					return { commits: [], hasMore: false };
				},
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());

		actions.applyPushedWip(wipAt(1, 'c'));
		const paused = wipAt(2, 'x');
		paused.changes = { pausedOpStatus: { type: 'rebase' } } as unknown as Wip['changes'];
		actions.applyPushedWip(paused);

		assert.strictEqual(calls, 0, 'no refetch while the rebase is paused');
	});
});

suite('DetailsActions — Review in Repo availability', () => {
	/** Services whose every event subscription is inert, except the availability push, which the test drives. */
	function setup(fetch: () => Promise<DeepReviewAvailability>) {
		let push: ((availability: DeepReviewAvailability) => void) | undefined;
		const inert = () => () => undefined;
		const withInertEvents = (target: Record<string, unknown>) =>
			new Proxy(target, { get: (t, name) => (typeof name === 'string' ? (t[name] ?? inert) : undefined) });
		const services = {
			graphInspect: withInertEvents({
				getDeepReviewAvailability: fetch,
				onDeepReviewAvailability: (handler: (availability: DeepReviewAvailability) => void) => {
					push = handler;
					return () => undefined;
				},
			}),
			config: withInertEvents({}),
			ai: withInertEvents({}),
		} as unknown as ResolvedServices;

		const state = createDetailsState();
		const actions = new DetailsActions(state, services, createResources());
		return {
			state: state,
			actions: actions,
			subscribe: () => actions['subscribeEvents'](),
			push: (availability: DeepReviewAvailability) => {
				assert.ok(push != null, 'the actions should subscribe to the availability push');
				push(availability);
			},
		};
	}

	test("the host's push lifts an answer given before the local channel was up", async () => {
		const { state, actions, subscribe, push } = setup(async () => ({ available: false, reason: 'no-channel' }));

		await actions.refreshDeepReviewAvailability();
		await subscribe();
		push({ available: true });

		assert.deepStrictEqual(state.deepReviewAvailability.get(), { available: true });
	});

	test('a push outdates a fetch still in flight', async () => {
		let resolveFetch: ((value: DeepReviewAvailability) => void) | undefined;
		const { state, actions, subscribe, push } = setup(() => new Promise(resolve => (resolveFetch = resolve)));

		await subscribe();
		const fetching = actions.refreshDeepReviewAvailability();
		push({ available: true });
		resolveFetch?.({ available: false, reason: 'no-channel' });
		await fetching;

		assert.deepStrictEqual(state.deepReviewAvailability.get(), { available: true });
	});

	test('a refresh after a push replaces it', async () => {
		const { state, actions, subscribe, push } = setup(async () => ({ available: true }));

		await subscribe();
		push({ available: false, reason: 'no-agents' });
		await actions.refreshDeepReviewAvailability();

		assert.deepStrictEqual(state.deepReviewAvailability.get(), { available: true });
	});
});

suite('mapRewrittenCommit', () => {
	const commits = (...entries: string[]) =>
		entries.map(entry => {
			const [sha, subject] = entry.split(':');
			return { sha: sha, message: `${subject ?? sha.replaceAll("'", '')}\n\nbody` };
		});
	const cases: {
		name: string;
		sha: string;
		previous: string[];
		next: string[];
		patchIds?: Record<string, string>;
		expected: string | undefined;
	}[] = [
		{ name: 'an amend of the tip', sha: 'c', previous: ['c', 'b'], next: ["c'", "b'"], expected: "c'" },
		{
			name: 'a commit below where the histories part',
			sha: 'a',
			previous: ['c', 'b'],
			next: ["c'", "b'"],
			expected: 'a',
		},
		{
			name: 'a reword while another commit is dropped, by patch id',
			sha: 'b',
			previous: ['c', 'b'],
			next: ["b':reworded"],
			patchIds: { b: 'pb', "b'": 'pb' },
			expected: "b'",
		},
		{ name: 'a dropped commit', sha: 'b', previous: ['c', 'b'], next: ["c'"], expected: undefined },
		{ name: 'a commit added on top', sha: 'c', previous: [], next: ['d'], expected: 'c' },
	];

	for (const c of cases) {
		test(c.name, () => {
			assert.strictEqual(
				mapRewrittenCommit(c.sha, {
					mergeBase: 'base',
					previous: commits(...c.previous),
					next: commits(...c.next),
					patchIds: c.patchIds,
				}),
				c.expected,
			);
		});
	}

	test('a tip move under a commit review asks for what the commit became', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('commit');
		state.activeModeRepoPath.set('/repo');
		state.activeModeSha.set('c');
		const asked: string[] = [];
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: async () => ({ commits: [], hasMore: false }),
				getCommitPatchIds: async () => undefined,
				getRewrittenHistory: async (_repoPath: string, previousTip: string) => {
					asked.push(previousTip);
					return { mergeBase: 'base', previous: commits('c'), next: commits("c'") };
				},
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions.commitReviewsHandler = () => true;
		const moved: string[][] = [];
		actions.anchorRewrittenHandler = history => moved.push(history.next.map(c => c.sha));
		const wipAt = (revision: number, tip: string): Wip =>
			({
				changes: undefined,
				repositoryCount: 1,
				repo: { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false },
				revision: revision,
				branch: { repoPath: '/repo', reference: { sha: tip } },
			}) as unknown as Wip;

		actions.applyPushedWip(wipAt(1, 'c'));
		actions.applyPushedWip(wipAt(2, "c'"));
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(asked, ['c']);
		assert.deepStrictEqual(moved, [["c'"]]);
	});

	test('a rewrite during a run waits for it, then moves from the tip before the first rewrite', async () => {
		const state = createDetailsState();
		state.activeMode.set('review');
		state.activeModeContext.set('commit');
		state.activeModeRepoPath.set('/repo');
		state.activeModeSha.set('c');
		const asked: string[] = [];
		const services = {
			...createServices(),
			graphInspect: {
				getBranchCommits: async () => ({ commits: [], hasMore: false }),
				getCommitPatchIds: async () => undefined,
				getRewrittenHistory: async (_repoPath: string, previousTip: string) => {
					asked.push(previousTip);
					return { mergeBase: 'base', previous: commits('c'), next: commits("c''") };
				},
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		let busy = true;
		actions.anchorBusyHandler = () => busy;
		actions.commitReviewsHandler = () => true;
		const moved: string[][] = [];
		actions.anchorRewrittenHandler = history => moved.push(history.next.map(c => c.sha));
		const wipAt = (revision: number, tip: string): Wip =>
			({
				changes: undefined,
				repositoryCount: 1,
				repo: { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false },
				revision: revision,
				branch: { repoPath: '/repo', reference: { sha: tip } },
			}) as unknown as Wip;

		actions.applyPushedWip(wipAt(1, 'c'));
		// Two amends while an AI review runs on the commit
		actions.applyPushedWip(wipAt(2, "c'"));
		actions.applyPushedWip(wipAt(3, "c''"));
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		assert.deepStrictEqual(asked, [], 'nothing is matched while the run goes on');
		assert.ok(actions.hasDeferredAnchorRewrite);

		busy = false;
		actions.retryDeferredAnchorRewrite();
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(asked, ['c'], 'matched from the tip before the first amend');
		assert.deepStrictEqual(moved, [["c''"]]);
		assert.strictEqual(actions.hasDeferredAnchorRewrite, false);
	});

	test('a tip move with no mode open still moves the commit reviews kept for later', async () => {
		const state = createDetailsState();
		const asked: string[] = [];
		const services = {
			...createServices(),
			graphInspect: {
				getRewrittenHistory: async (_repoPath: string, previousTip: string) => {
					asked.push(previousTip);
					return { mergeBase: 'base', previous: commits('c'), next: commits("c'") };
				},
			},
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions.commitReviewsHandler = repoPath => repoPath === '/repo';
		const moved: string[] = [];
		actions.anchorRewrittenHandler = (_history, repoPath) => moved.push(repoPath);
		const wipAt = (revision: number, tip: string): Wip =>
			({
				changes: undefined,
				repositoryCount: 1,
				repo: { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false },
				revision: revision,
				branch: { repoPath: '/repo', reference: { sha: tip } },
			}) as unknown as Wip;

		actions.applyPushedWip(wipAt(1, 'c'));
		actions.applyPushedWip(wipAt(2, "c'"));
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		assert.deepStrictEqual(asked, ['c']);
		assert.deepStrictEqual(moved, ['/repo']);
	});

	test('a checkout onto another branch is no rewrite', async () => {
		const state = createDetailsState();
		const asked: string[] = [];
		const services = {
			...createServices(),
			graphInspect: {
				getRewrittenHistory: async (_repoPath: string, previousTip: string) => {
					asked.push(previousTip);
					return undefined;
				},
			},
			branches: { getBranchEnrichment: async () => undefined },
		} as unknown as ResolvedServices;
		const actions = new DetailsActions(state, services, createResources());
		actions.commitReviewsHandler = () => true;
		const wipOn = (revision: number, branch: string, tip: string): Wip =>
			({
				changes: undefined,
				repositoryCount: 1,
				repo: { uri: 'file:///repo', name: 'repo', path: '/repo', isWorktree: false },
				revision: revision,
				branch: { repoPath: '/repo', name: branch, reference: { sha: tip } },
			}) as unknown as Wip;

		actions.applyPushedWip(wipOn(1, 'feature/a', 'x'));
		actions.applyPushedWip(wipOn(2, 'feature/b', 'y'));
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		assert.deepStrictEqual(asked, [], 'the checkout leaves the reviews on feature/a where they are');

		actions.applyPushedWip(wipOn(3, 'feature/b', "y'"));
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		assert.deepStrictEqual(asked, ['y'], 'an amend on feature/b is one');
	});
});
