import * as assert from 'node:assert';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import { getSearchQueryComparisonKey } from '@gitlens/git/utils/search.utils.js';
import type { IpcParams } from '../../../ipc/handlerRegistry.js';
import type { SearchHistoryStoreRequest, SearchRequest } from '../protocol.js';
import {
	aiDeferred,
	aiError,
	aiHang,
	aiResult,
	buildGitGraphSearch,
	buildGitSearchError,
	createSearchHarness,
} from './graphSearchServiceHarness.js';

function plainSearch(query: string, matchRegex: boolean): IpcParams<typeof SearchRequest> {
	return { search: { query: query, matchRegex: matchRegex } };
}

function nlSearch(query: string): IpcParams<typeof SearchRequest> {
	return { search: { query: query, naturalLanguage: true } };
}

/** Polls a predicate on the microtask queue instead of a fixed sleep, for scripting a race against an
 *  in-flight promise chain without hardcoding how many hops it takes to settle. */
async function pollUntil(predicate: () => boolean, maxIterations = 50): Promise<void> {
	for (let i = 0; i < maxIterations && !predicate(); i++) {
		await Promise.resolve();
	}
}

suite('GraphSearchService flows', () => {
	test('falls back to a literal match when a regex pattern fails to compile mid-keystroke', async () => {
		const harness = createSearchHarness();

		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'Unmatched ( or \\('));
		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'fix(', matchRegex: false }, [['sha1', { date: 1, i: 0 }]]),
		);

		const state = await harness.search(plainSearch('fix(', true));

		assert.ok(state != null);
		assert.ok(state.results != null && 'count' in state.results, 'expected a results envelope, not an error');
		assert.deepStrictEqual(state.fallback, { matchedAs: 'literal', detail: 'Unmatched ( or \\(' });
		assert.strictEqual(state.query!.matchRegex, true);
		assert.strictEqual(harness.graph.searchGraph.getCall(1).args[0].matchRegex, false);
		assert.strictEqual(
			harness.service.search!.comparisonKey,
			getSearchQueryComparisonKey({ query: 'fix(', matchRegex: true }),
		);
	});

	test('does not fall back when the pattern is already a literal (non-regex) search', async () => {
		const harness = createSearchHarness();

		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'bad'));

		const state = await harness.search(plainSearch('fix(', false));

		assert.ok(state?.results != null && 'error' in state.results);
		assert.strictEqual(harness.graph.searchGraph.callCount, 1);
	});

	test('NL auto-repair with a different query retries once and succeeds', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiResult({ query: 'A' }));
		harness.ai.queue(aiResult({ query: 'B' }));
		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'bad A'));
		harness.queueSearchGraphResult(
			buildGitGraphSearch(
				{ query: 'B', matchRegex: true, naturalLanguage: { query: 'sentence', processedQuery: 'B' } },
				[['sha1', { date: 1, i: 0 }]],
			),
		);

		const state = await harness.search(nlSearch('sentence'));

		assert.strictEqual(harness.graph.searchGraph.getCall(0).args[0].query, 'A');
		assert.strictEqual(harness.graph.searchGraph.getCall(1).args[0].query, 'B');
		assert.strictEqual(harness.graph.searchGraph.callCount, 2);
		assert.ok(state?.results != null && 'count' in state.results);
		assert.strictEqual((state.query!.naturalLanguage as { processedQuery?: string })?.processedQuery, 'B');

		const events = harness.telemetryEvents().filter(e => e.name === 'graph/searched');
		assert.strictEqual(events.length, 1);
		const data = events[0].data as Record<string, unknown>;
		assert.strictEqual(data['nl.repair.attempted'], true);
		assert.strictEqual(data['nl.repair.succeeded'], true);
	});

	test('NL auto-repair that returns the same query falls through to the last-resort literal fallback', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiResult({ query: 'A' }));
		harness.ai.queue(aiResult({ query: 'A' }));
		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'bad A'));
		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'bad A again'));
		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'A', matchRegex: false }, [['sha1', { date: 1, i: 0 }]]),
		);

		const state = await harness.search(nlSearch('sentence'));

		assert.strictEqual(harness.graph.searchGraph.callCount, 3);
		assert.ok(state?.results != null && 'count' in state.results);
		assert.ok(state.fallback != null);
	});

	test('NL search surfaces invalidRef when even repair cannot resolve the AI-guessed ref', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiResult({ query: 'ref:nope' }));
		harness.ai.queue(aiResult({ query: 'ref:nope2' }));
		harness.queueSearchGraphError(buildGitSearchError('invalidRef', 'nope'));
		harness.queueSearchGraphError(buildGitSearchError('invalidRef', 'nope'));
		harness.queueSearchGraphError(buildGitSearchError('invalidRef', 'nope'));

		const state = await harness.search(nlSearch('sentence'));

		assert.ok(state != null);
		assert.deepStrictEqual(state.results, {
			error: "No branch or tag named 'nope'",
			reason: 'invalidRef',
			detail: 'nope',
		});
		assert.strictEqual(harness.graph.searchGraph.callCount, 3);
	});

	test('an AI failure during NL conversion surfaces as aiUnavailable without ever touching git', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiError(new Error('Rate limited')));

		const state = await harness.search(nlSearch('sentence'));

		assert.ok(state != null);
		assert.deepStrictEqual(state.results, { error: 'Error: Rate limited', reason: 'aiUnavailable' });
		assert.strictEqual(harness.graph.searchGraph.callCount, 0);

		const states = harness.states();
		assert.strictEqual(states.length, 1);
		assert.deepStrictEqual(states[0]?.results, { error: 'Error: Rate limited', reason: 'aiUnavailable' });
	});

	test('an aborted NL conversion produces no search state at all', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiHang());

		const controller = new AbortController();
		const searching = harness.search(nlSearch('sentence'), controller.signal);

		// `onSearchRequest` awaits `buildRepoSearchContext` (its own microtask chain over the grounding
		// stubs) before the AI round-trip is even issued — wait for the AI call itself, the reliable
		// signal that the conversion is in flight, instead of a fixed hop count.
		await pollUntil(() => harness.ai.generateSearchQuery.callCount >= 1);
		assert.strictEqual(harness.ai.generateSearchQuery.callCount, 1);

		controller.abort();

		assert.strictEqual(await searching, undefined, 'an aborted search answers with no state');
		assert.deepStrictEqual(harness.states(), [], 'an aborted search emits no state');
		assert.strictEqual(harness.service.search, undefined);
	});

	test('a stuck AI conversion times out after nlConversionTimeoutMs', async () => {
		const harness = createSearchHarness({ nlConversionTimeoutMs: 50 });

		harness.ai.queue(aiHang());

		const state = await harness.search(nlSearch('sentence'));

		assert.ok(state != null);
		assert.deepStrictEqual(state.results, { error: 'The AI took too long to respond', reason: 'aiUnavailable' });
		assert.strictEqual(harness.graph.searchGraph.callCount, 0);
	});

	test('a search that supersedes mid-repair drops the stale repair response', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiResult({ query: 'A' }));
		const deferred = aiDeferred();
		harness.ai.queue(deferred.fn);
		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'bad A'));

		const first = harness.search(nlSearch('sentence A'));

		// Wait for the repair round's AI call to be issued (and pending).
		await pollUntil(() => harness.ai.generateSearchQuery.callCount >= 2);
		assert.strictEqual(harness.ai.generateSearchQuery.callCount, 2);

		// An unrelated, immediately-successful search runs to completion, superseding the repair in flight.
		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'other', matchRegex: true }, [['sha2', { date: 1, i: 0 }]]),
		);
		const second = await harness.search(plainSearch('other', true));

		deferred.resolve({ query: 'A' });
		const firstResult = await first;

		assert.ok(second != null, 'the newer search has its own state');
		assert.strictEqual(second.query!.query, 'other');

		assert.strictEqual(firstResult, undefined, 'the superseded search answers with no state');

		assert.strictEqual(harness.service.search?.query.query, 'other');

		// The repair round's own "now searching" notify (fired unconditionally before git ever runs)
		// legitimately carries query 'A' — that's a real, live state, not a bug. What must never happen
		// is that query clobbering the newer search afterwards: nothing emitted from the newer search
		// onward may name the superseded query.
		const states = harness.states();
		const otherIndex = states.findIndex(s => s?.query?.query === 'other');
		assert.ok(otherIndex >= 0, "the newer search's own state was emitted");
		assert.ok(
			states.slice(otherIndex).every(s => s?.query?.query !== 'A'),
			"the superseded search's query must never reappear after the newer search started",
		);
		assert.strictEqual(states.at(-1)?.query?.query, 'other');
	});

	test('a zero-result NL search offers counted relaxations on a follow-up notification', async () => {
		const harness = createSearchHarness();
		const query = 'message:aaa after:"2035-01-01"';

		harness.ai.queue(aiResult({ query: query, alternates: ['message:bbb'] }));
		harness.queueSearchGraphResult(
			buildGitGraphSearch(
				{
					query: query,
					matchRegex: true,
					naturalLanguage: { query: 'sentence', processedQuery: query, alternates: ['message:bbb'] },
				},
				[],
			),
		);
		harness.graph.countSearchResults.callsFake((search: SearchQuery) =>
			Promise.resolve(search.query === 'message:aaa' ? 42 : 0),
		);

		const state = await harness.search(nlSearch('sentence'));

		assert.ok(state != null);
		assert.deepStrictEqual(state.relaxations, [
			{ label: 'without the date filter', query: 'message:aaa', count: 42, capped: undefined },
		]);

		const relaxationStates = harness.states().filter(s => s?.relaxations != null);
		assert.strictEqual(relaxationStates.length, 1);
		assert.deepStrictEqual(relaxationStates[0]?.relaxations, state.relaxations);

		const searchedEvent = harness.telemetryEvents().find(e => e.name === 'graph/searched');
		assert.ok(searchedEvent);
		assert.strictEqual((searchedEvent.data as Record<string, unknown>)['nl.relaxations.offered'], 1);
	});

	test('a zero-result NL search offers a respell candidate for a misspelled author', async () => {
		const harness = createSearchHarness();
		const query = 'author:Kieth';

		harness.contributors.getContributorsLite.resolves([{ name: 'Keith Daulton', email: 'keith@example.com' }]);
		harness.ai.queue(aiResult({ query: query }));
		harness.queueSearchGraphResult(
			buildGitGraphSearch(
				{ query: query, matchRegex: true, naturalLanguage: { query: 'sentence', processedQuery: query } },
				[],
			),
		);
		harness.graph.countSearchResults.callsFake((search: SearchQuery) =>
			Promise.resolve(search.query === 'author:"Keith Daulton"' ? 7 : 0),
		);

		const state = await harness.search(nlSearch('sentence'));

		assert.ok(state != null);
		assert.deepStrictEqual(state.relaxations, [
			{ label: "as 'Keith Daulton'", query: 'author:"Keith Daulton"', count: 7, capped: undefined },
		]);

		const relaxationStates = harness.states().filter(s => s?.relaxations != null);
		assert.strictEqual(relaxationStates.length, 1);
		assert.deepStrictEqual(relaxationStates[0]?.relaxations, state.relaxations);
	});

	test('a search superseded during relaxation probing yields no state for the stale response', async () => {
		const harness = createSearchHarness();
		const query = 'message:aaa after:"2035-01-01"';

		harness.ai.queue(aiResult({ query: query, alternates: ['message:bbb'] }));
		harness.queueSearchGraphResult(
			buildGitGraphSearch(
				{
					query: query,
					matchRegex: true,
					naturalLanguage: { query: 'sentence', processedQuery: query, alternates: ['message:bbb'] },
				},
				[],
			),
		);

		let releaseCounts!: () => void;
		harness.graph.countSearchResults.callsFake(
			() =>
				new Promise<number>(resolve => {
					releaseCounts = () => resolve(0);
				}),
		);

		const first = harness.search(nlSearch('sentence'));

		await pollUntil(() => harness.graph.countSearchResults.callCount > 0);
		assert.ok(harness.graph.countSearchResults.callCount > 0);

		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'other', matchRegex: true }, [['sha2', { date: 1, i: 0 }]]),
		);
		await harness.search(plainSearch('other', true));

		releaseCounts();
		const firstResult = await first;

		assert.strictEqual(firstResult, undefined, 'the superseded search answers with no state');
		assert.ok(
			harness.states().every(s => s?.relaxations == null),
			'no emitted state may carry relaxations for the superseded search',
		);
		assert.strictEqual(harness.service.search?.query.query, 'other');
	});

	test('a continuation (`more`) surfaces a git error directly, without NL repair or literal fallback', async () => {
		const harness = createSearchHarness();
		const query = { query: 'foo', matchRegex: true };

		harness.queueSearchGraphResult(
			buildGitGraphSearch(query, [['sha1', { date: 1, i: 0 }]], {
				paging: { limit: 100, cursor: { search: query, state: 'cursor-1' } },
			}),
		);
		await harness.search(plainSearch('foo', true));

		harness.queueContinueSearchGraphError(buildGitSearchError('invalidPattern', 'bad'));

		const state = await harness.search({ ...plainSearch('foo', true), more: true });

		assert.ok(state?.results != null && 'error' in state.results);
		assert.strictEqual(harness.graph.continueSearchGraph.callCount, 1);
	});
});

suite('GraphSearchService search history', () => {
	function storeParams(query: string): IpcParams<typeof SearchHistoryStoreRequest> {
		return { search: { query: query } };
	}

	test('recreates the history instance for the current repo on every access instead of sticking to the first repo used', async () => {
		const harness = createSearchHarness();

		await harness.service.onSearchHistoryStoreRequest(storeParams('foo'));

		assert.strictEqual(harness.storage.storeWorkspace.firstCall.args[0], 'graph:searchHistory:/repo');

		harness.setRepositoryPath('/repoB');

		await harness.service.onSearchHistoryStoreRequest(storeParams('bar'));

		const lastStoreCall = harness.storage.storeWorkspace.lastCall;

		assert.strictEqual(lastStoreCall.args[0], 'graph:searchHistory:/repoB');
		const storedForRepoB = lastStoreCall.args[1] as Array<{ query: string }>;
		assert.strictEqual(storedForRepoB.length, 1);
		assert.strictEqual(storedForRepoB[0].query, 'bar');

		const repoBResponse = harness.service.onSearchHistoryGetRequest();

		assert.strictEqual(repoBResponse.history.length, 1);
		assert.strictEqual(repoBResponse.history[0].query, 'bar');

		harness.setRepositoryPath('/repo');

		const repoAResponse = harness.service.onSearchHistoryGetRequest();

		assert.strictEqual(repoAResponse.history.length, 1);
		assert.strictEqual(repoAResponse.history[0].query, 'foo');
	});
});
