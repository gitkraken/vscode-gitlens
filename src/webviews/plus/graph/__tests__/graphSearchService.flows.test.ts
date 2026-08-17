import * as assert from 'node:assert';
import type { GitGraphSearch, GitGraphSearchProgress } from '@gitlens/git/models/graphSearch.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import { getSearchQueryComparisonKey } from '@gitlens/git/utils/search.utils.js';
import type { SearchParams } from '../protocol.js';
import {
	aiDeferred,
	aiError,
	aiHang,
	aiHangDeaf,
	aiResult,
	buildGitGraphSearch,
	buildGitSearchError,
	createSearchHarness,
} from './graphSearchServiceHarness.js';

function plainSearch(query: string, matchRegex: boolean): SearchParams {
	return { search: { query: query, matchRegex: matchRegex } };
}

function nlSearch(query: string): SearchParams {
	return { search: { query: query, naturalLanguage: true } };
}

/** Polls a predicate on the microtask queue instead of a fixed sleep, for scripting a race against an
 *  in-flight promise chain without hardcoding how many hops it takes to settle. */
async function pollUntil(predicate: () => boolean, maxIterations = 50): Promise<void> {
	for (let i = 0; i < maxIterations && !predicate(); i++) {
		await Promise.resolve();
	}
}

/** A test-controlled release valve for {@link pausedStream} — lets a test hold a stream's final value back
 *  until an explicit `release()`, instead of racing it against whatever else is in flight. */
function deferredGate(): { promise: Promise<void>; release: () => void } {
	let release!: () => void;
	const promise = new Promise<void>(resolve => {
		release = resolve;
	});

	return { promise: promise, release: release };
}

/** Models a provider stream that keeps running past an abort — draining, not breaking, exactly like
 *  `processSearchStream` now expects — and only answers with its final value once `gate` releases. Held
 *  open on a caller-controlled gate (rather than the abort event itself) so a test can pin the exact
 *  moment the final value lands relative to other in-flight work. */
async function* pausedStream(
	progress: GitGraphSearchProgress[],
	buildFinal: (signal: AbortSignal | undefined) => GitGraphSearch,
	gate: Promise<void>,
	signal: AbortSignal | undefined,
): AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void> {
	for (const p of progress) {
		yield p;
	}

	await gate;

	return buildFinal(signal);
}

suite('GraphSearchService flows', () => {
	test('falls back to a literal match when a regex pattern fails to compile mid-keystroke', async () => {
		const harness = createSearchHarness();

		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'Unmatched ( or \\('));
		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'fix(', matchRegex: false }, [['sha1', { date: 1, i: 0 }]]),
		);

		const rsp = await harness.search(plainSearch('fix(', true));

		assert.ok(rsp != null);
		const { state } = rsp;
		assert.ok(state.results != null && 'count' in state.results, 'expected a results envelope, not an error');
		assert.deepStrictEqual(state.fallback, { matchedAs: 'literal', detail: 'Unmatched ( or \\(' });
		assert.strictEqual(state.query.matchRegex, true);
		assert.strictEqual(harness.graph.searchGraph.getCall(1).args[0].matchRegex, false);
		assert.strictEqual(
			harness.service.activeSearch!.comparisonKey,
			getSearchQueryComparisonKey({ query: 'fix(', matchRegex: true }),
		);
	});

	test('does not fall back when the pattern is already a literal (non-regex) search', async () => {
		const harness = createSearchHarness();

		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'bad'));

		const rsp = await harness.search(plainSearch('fix(', false));

		assert.ok(rsp?.state.results != null && 'error' in rsp.state.results);
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

		const rsp = await harness.search(nlSearch('sentence'));

		assert.strictEqual(harness.graph.searchGraph.getCall(0).args[0].query, 'A');
		assert.strictEqual(harness.graph.searchGraph.getCall(1).args[0].query, 'B');
		assert.strictEqual(harness.graph.searchGraph.callCount, 2);
		assert.ok(rsp?.state.results != null && 'count' in rsp.state.results);
		assert.strictEqual((rsp.state.query.naturalLanguage as { processedQuery?: string })?.processedQuery, 'B');

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

		const rsp = await harness.search(nlSearch('sentence'));

		assert.strictEqual(harness.graph.searchGraph.callCount, 3);
		assert.ok(rsp?.state.results != null && 'count' in rsp.state.results);
		assert.ok(rsp.state.fallback != null);
	});

	test('NL search surfaces invalidRef when even repair cannot resolve the AI-guessed ref', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiResult({ query: 'ref:nope' }));
		harness.ai.queue(aiResult({ query: 'ref:nope2' }));
		harness.queueSearchGraphError(buildGitSearchError('invalidRef', 'nope'));
		harness.queueSearchGraphError(buildGitSearchError('invalidRef', 'nope'));
		harness.queueSearchGraphError(buildGitSearchError('invalidRef', 'nope'));

		const rsp = await harness.search(nlSearch('sentence'));

		assert.ok(rsp != null);
		assert.deepStrictEqual(rsp.state.results, {
			error: "No branch or tag named 'nope'",
			reason: 'invalidRef',
			detail: 'nope',
		});
		assert.strictEqual(harness.graph.searchGraph.callCount, 3);
	});

	test('an AI failure during NL conversion surfaces as aiUnavailable without ever touching git', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiError(new Error('Rate limited')));

		const rsp = await harness.search(nlSearch('sentence'));

		assert.ok(rsp != null);
		assert.deepStrictEqual(rsp.state.results, { error: 'Error: Rate limited', reason: 'aiUnavailable' });
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

		// `search` awaits `buildRepoSearchContext` (its own microtask chain over the grounding stubs)
		// before the AI round-trip is even issued — wait for the AI call itself, the reliable signal
		// that the conversion is in flight, instead of a fixed hop count.
		await pollUntil(() => harness.ai.generateSearchQuery.callCount >= 1);
		assert.strictEqual(harness.ai.generateSearchQuery.callCount, 1);

		controller.abort();

		assert.strictEqual(await searching, undefined, 'an aborted search answers with no state');
		assert.deepStrictEqual(harness.states(), [], 'an aborted search emits no state');
		assert.strictEqual(harness.service.activeSearch, undefined);
	});

	test('a stuck AI conversion times out after nlConversionTimeoutMs, even when the call never observes its cancellation token', async () => {
		const harness = createSearchHarness({ nlConversionTimeoutMs: 50 });

		// Deaf hang: a real stuck call (blocked model resolution) hangs before it subscribes to the
		// token, so the timeout must recover by racing — a cooperative aiHang() would mask that.
		harness.ai.queue(aiHangDeaf());

		const rsp = await harness.search(nlSearch('sentence'));

		assert.ok(rsp != null);
		assert.deepStrictEqual(rsp.state.results, {
			error: 'The AI took too long to respond',
			reason: 'aiUnavailable',
		});
		assert.strictEqual(harness.graph.searchGraph.callCount, 0);
	});

	test('a search that supersedes mid-repair drops the stale repair response', async () => {
		const harness = createSearchHarness();

		harness.ai.queue(aiResult({ query: 'A' }));
		const deferred = aiDeferred();
		harness.ai.queue(deferred.fn);
		harness.queueSearchGraphError(buildGitSearchError('invalidPattern', 'bad A'));

		const firstController = new AbortController();
		const first = harness.search(nlSearch('sentence A'), firstController.signal);

		// Wait for the repair round's AI call to be issued (and pending).
		await pollUntil(() => harness.ai.generateSearchQuery.callCount >= 2);
		assert.strictEqual(harness.ai.generateSearchQuery.callCount, 2);

		// An unrelated, immediately-successful search supersedes the repair in flight — the caller (the
		// app's `CancellableRequest`) aborts the previous search's signal before issuing the next one.
		firstController.abort();
		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'other', matchRegex: true }, [['sha2', { date: 1, i: 0 }]]),
		);
		const second = await harness.search(plainSearch('other', true));

		deferred.resolve({ query: 'A' });
		const firstResult = await first;

		assert.ok(second != null, 'the newer search has its own state');
		assert.strictEqual(second.state.query.query, 'other');

		assert.strictEqual(firstResult, undefined, 'the superseded search answers with no state');

		assert.strictEqual(harness.service.activeSearch?.query.query, 'other');

		// The repair round's own "now searching" emission (fired unconditionally before git ever runs)
		// legitimately carries query 'A' — that's a real, live state, not a bug. What must never happen
		// is that query clobbering the newer search afterwards: nothing emitted from the newer search
		// onward may name the superseded query.
		const states = harness.states();
		const otherIndex = states.findIndex(s => s?.query.query === 'other');
		assert.ok(otherIndex >= 0, "the newer search's own state was emitted");
		assert.ok(
			states.slice(otherIndex).every(s => s?.query.query !== 'A'),
			"the superseded search's query must never reappear after the newer search started",
		);
		assert.strictEqual(states.at(-1)?.query.query, 'other');
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

		const rsp = await harness.search(nlSearch('sentence'));

		assert.ok(rsp != null);
		assert.deepStrictEqual(rsp.state.relaxations, [
			{ label: 'without the date filter', query: 'message:aaa', count: 42, capped: undefined },
		]);

		const relaxationStates = harness.states().filter(s => s?.relaxations != null);
		assert.strictEqual(relaxationStates.length, 1);
		assert.deepStrictEqual(relaxationStates[0]?.relaxations, rsp.state.relaxations);

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

		const rsp = await harness.search(nlSearch('sentence'));

		assert.ok(rsp != null);
		assert.deepStrictEqual(rsp.state.relaxations, [
			{ label: "as 'Keith Daulton'", query: 'author:"Keith Daulton"', count: 7, capped: undefined },
		]);

		const relaxationStates = harness.states().filter(s => s?.relaxations != null);
		assert.strictEqual(relaxationStates.length, 1);
		assert.deepStrictEqual(relaxationStates[0]?.relaxations, rsp.state.relaxations);
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

		// One candidate probe per present relaxation group/alternate runs concurrently — collect every
		// resolver so releasing can settle all of them, not just the last `callsFake` invocation.
		const releaseCounts: Array<() => void> = [];
		harness.graph.countSearchResults.callsFake(
			() =>
				new Promise<number>(resolve => {
					releaseCounts.push(() => resolve(0));
				}),
		);

		const firstController = new AbortController();
		const first = harness.search(nlSearch('sentence'), firstController.signal);

		await pollUntil(() => harness.graph.countSearchResults.callCount > 0);
		assert.ok(harness.graph.countSearchResults.callCount > 0);

		// A newer search supersedes the relaxation probe in flight — the caller aborts the previous
		// search's signal before issuing the next one, same as `CancellableRequest`.
		firstController.abort();
		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'other', matchRegex: true }, [['sha2', { date: 1, i: 0 }]]),
		);
		await harness.search(plainSearch('other', true));

		for (const release of releaseCounts) {
			release();
		}

		const firstResult = await first;

		assert.strictEqual(firstResult, undefined, 'the superseded search answers with no state');
		assert.ok(
			harness.states().every(s => s?.relaxations == null),
			'no emitted state may carry relaxations for the superseded search',
		);
		assert.strictEqual(harness.service.activeSearch?.query.query, 'other');
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

		const rsp = await harness.search({ ...plainSearch('foo', true), more: true });

		assert.ok(rsp?.state.results != null && 'error' in rsp.state.results);
		assert.strictEqual(harness.graph.continueSearchGraph.callCount, 1);
	});

	test('reveals the first match through the rows plane, never on the search payload', async () => {
		const harness = createSearchHarness();

		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'foo', matchRegex: true }, [['sha1', { date: 1, i: 0 }]]),
		);

		const rsp = await harness.search(plainSearch('foo', true));

		assert.ok(rsp != null);
		assert.strictEqual(harness.context.setSelectedRows.callCount, 1);
		assert.strictEqual(harness.context.setSelectedRows.firstCall.args[0], 'sha1');
		assert.ok(
			harness.context.notifyDidChangeRows.getCalls().some(c => c.args[0] === true),
			'the reveal must emit selection on the rows plane',
		);

		// The reveal target answers the caller once, on the response — deliberately NOT part of
		// `GraphSearchState` (see graphService.ts), so replaying `state` on reconnect can never re-scroll
		// the user somewhere they never asked to go.
		assert.strictEqual(rsp.revealSha, 'sha1');
	});

	test('pausing mid-stream keeps the cursor, and a `more` continuation resumes from it instead of restarting', async () => {
		const harness = createSearchHarness();
		const query: SearchQuery = { query: 'foo', matchRegex: true };
		const comparisonKey = getSearchQueryComparisonKey(query);

		// The real provider answers a cancelled stream with a final value carrying the resumable cursor
		// (see `packages/git-cli/src/providers/graph.ts`'s cancellation return) — the stream must stay
		// paused (not yet resolved) until the test explicitly aborts and releases it.
		const cursorValue = buildGitGraphSearch(query, [['sha1', { date: 1, i: 0 }]], {
			hasMore: true,
			paging: { limit: 100, cursor: { search: query, state: 'cursor-1' } },
		});
		const gate = deferredGate();

		harness.queueSearchGraphStream(signal =>
			pausedStream(
				[
					{
						repoPath: '/repo',
						query: query,
						queryFilters: { files: false, refs: false },
						comparisonKey: comparisonKey,
						results: new Map([['sha1', { date: 1, i: 0 }]]),
						runningTotal: 1,
						hasMore: true,
					},
				],
				() => cursorValue,
				gate.promise,
				signal,
			),
		);

		const controller = new AbortController();
		const searching = harness.search(plainSearch('foo', true), controller.signal);

		// `setSelectedRows` only fires once the first batch's results have actually been processed — the
		// "now searching" state fired before the stream even starts doesn't tell us the batch landed.
		await pollUntil(() => harness.context.setSelectedRows.callCount >= 1);
		assert.strictEqual(harness.context.setSelectedRows.callCount, 1, 'the first batch landed');

		controller.abort();
		gate.release();

		assert.strictEqual(await searching, undefined, 'a paused search answers with no state');

		harness.queueContinueSearchGraphResult(
			buildGitGraphSearch(
				query,
				[
					['sha1', { date: 1, i: 0 }],
					['sha2', { date: 2, i: 1 }],
				],
				{ hasMore: false },
			),
		);

		const rsp = await harness.search({ ...plainSearch('foo', true), more: true });

		assert.strictEqual(harness.graph.continueSearchGraph.callCount, 1, 'resumes from the kept cursor');
		assert.strictEqual(harness.graph.searchGraph.callCount, 1, 'never restarts a fresh search');
		assert.ok(rsp?.state.results != null && 'count' in rsp.state.results);
		assert.strictEqual(rsp.state.results.count, 2, 'the results accumulated before the pause are still present');
		assert.deepStrictEqual(Object.keys(rsp.state.results.ids ?? {}).sort(), ['sha1', 'sha2']);
	});

	test('cancel() aborts a background continuation, keeping the paused results and cursor for resume', async () => {
		const harness = createSearchHarness();
		const query: SearchQuery = { query: 'foo', matchRegex: true };
		const comparisonKey = getSearchQueryComparisonKey(query);

		// A completed foreground search with more available — what the data controller's auto-load-more
		// continues in the background under its OWN signal (deliberately not the request's, so a
		// superseding search doesn't kill it — which is exactly why a pause must reach it via cancel()).
		harness.queueSearchGraphResult(
			buildGitGraphSearch(query, [['sha1', { date: 1, i: 0 }]], {
				hasMore: true,
				paging: { limit: 100, cursor: { search: query, state: 'cursor-1' } },
			}),
		);
		await harness.search(plainSearch('foo', true));

		const cursorValue = buildGitGraphSearch(
			query,
			[
				['sha1', { date: 1, i: 0 }],
				['sha2', { date: 2, i: 1 }],
			],
			{ hasMore: true, paging: { limit: 100, cursor: { search: query, state: 'cursor-2' } } },
		);

		// The continuation streams one batch, then runs until its signal aborts — a pause that only
		// aborted the request signal would leave this running to the end of history. The gate must
		// handle an ALREADY-aborted signal (cancel() can land before the stream is even created), the
		// same case the real provider guards explicitly.
		harness.queueContinueSearchGraphStream(signal =>
			pausedStream(
				[
					{
						repoPath: '/repo',
						query: query,
						queryFilters: { files: false, refs: false },
						comparisonKey: comparisonKey,
						results: new Map([['sha2', { date: 2, i: 1 }]]),
						runningTotal: 2,
						hasMore: true,
					},
				],
				() => cursorValue,
				new Promise<void>(resolve => {
					if (signal?.aborted) {
						resolve();
						return;
					}

					signal?.addEventListener('abort', () => resolve(), { once: true });
				}),
				signal,
			),
		);

		const stateCountBefore = harness.states().length;
		const continuation = harness.service.continueInBackground(query);

		// Let the continuation's first batch land before pausing — the scenario is a pause DURING
		// accumulated background work, not before it starts.
		await pollUntil(() => harness.service.activeSearch?.results.has('sha2') === true);
		assert.strictEqual(harness.service.activeSearch?.results.has('sha2'), true, 'the batch landed');
		assert.strictEqual(
			harness.service.activeSearch?.results.has('sha1'),
			true,
			"a continuation batch accumulates onto the results it continues from — totals never dip below what's shown",
		);

		harness.service.cancel();

		const changed = await continuation;
		assert.strictEqual(changed, true, 'the batch that landed before the pause counts as a change');
		assert.strictEqual(harness.service.activeSearch?.hasMore, true, 'the paused search stays resumable');
		assert.strictEqual(
			harness.service.activeSearch?.paging?.cursor?.state,
			'cursor-2',
			"the aborted continuation's cursor-bearing return still landed",
		);
		assert.strictEqual(harness.service.activeSearch?.results.size, 2);
		assert.strictEqual(
			harness.states().length,
			stateCountBefore,
			'cancel() and the drained continuation emit nothing',
		);

		// A background continuation arriving AFTER the pause (a rows page-in still in flight from before
		// it) must decline outright — running would walk the rest of history and publish the full tally
		// (hasMore false) over the paused state.
		const declined = await harness.service.continueInBackground(query);
		assert.strictEqual(declined, false, 'a paused search refuses new background continuations');
		assert.strictEqual(
			harness.graph.continueSearchGraph.callCount,
			1,
			'the declined continuation never reaches the provider',
		);

		// A resume ends the pause: the next `more` search continues from the kept cursor.
		harness.queueContinueSearchGraphResult(
			buildGitGraphSearch(
				query,
				[
					['sha1', { date: 1, i: 0 }],
					['sha2', { date: 2, i: 1 }],
					['sha3', { date: 3, i: 2 }],
				],
				{ hasMore: false },
			),
		);
		const rsp = await harness.search({ ...plainSearch('foo', true), more: true });
		assert.ok(rsp?.state.results != null && 'count' in rsp.state.results);
		assert.strictEqual(rsp.state.results.count, 3, 'resume continues from the paused cursor');
	});

	test("an abort caused by a newer search must not let the paused stream's cursor value land over it", async () => {
		const harness = createSearchHarness();
		const query: SearchQuery = { query: 'foo', matchRegex: true };
		const comparisonKey = getSearchQueryComparisonKey(query);

		const cursorValue = buildGitGraphSearch(query, [['sha1', { date: 1, i: 0 }]], {
			hasMore: true,
			paging: { limit: 100, cursor: { search: query, state: 'cursor-1' } },
		});
		const gate = deferredGate();

		harness.queueSearchGraphStream(signal =>
			pausedStream(
				[
					{
						repoPath: '/repo',
						query: query,
						queryFilters: { files: false, refs: false },
						comparisonKey: comparisonKey,
						results: new Map([['sha1', { date: 1, i: 0 }]]),
						runningTotal: 1,
						hasMore: true,
					},
				],
				() => cursorValue,
				gate.promise,
				signal,
			),
		);

		const firstController = new AbortController();
		const first = harness.search(plainSearch('foo', true), firstController.signal);

		await pollUntil(() => harness.context.setSelectedRows.callCount >= 1);

		// An unrelated, immediately-successful search supersedes the paused one — the caller (the app's
		// `CancellableRequest`) aborts the previous search's signal before issuing the next one. The
		// paused stream's gate stays held, so `second` fully settles before the paused stream's final
		// value has any chance to land.
		firstController.abort();
		harness.queueSearchGraphResult(
			buildGitGraphSearch({ query: 'other', matchRegex: true }, [['sha2', { date: 1, i: 0 }]]),
		);
		const second = await harness.search(plainSearch('other', true));

		gate.release();
		const firstResult = await first;

		assert.ok(second != null, 'the newer search has its own state');
		assert.strictEqual(second.state.query.query, 'other');

		assert.strictEqual(firstResult, undefined, 'the superseded search answers with no state');
		assert.strictEqual(harness.service.activeSearch?.query.query, 'other');

		// The paused search's own emissions legitimately carry query 'foo' — those are real, live states,
		// not a bug. What must never happen is that query clobbering the newer search afterwards: nothing
		// emitted from the newer search onward may name the superseded query.
		const states = harness.states();
		const otherIndex = states.findIndex(s => s?.query.query === 'other');
		assert.ok(otherIndex >= 0, "the newer search's own state was emitted");
		assert.ok(
			states.slice(otherIndex).every(s => s?.query.query !== 'foo'),
			"the paused search's query must never reappear after the newer search started",
		);
		assert.strictEqual(states.at(-1)?.query.query, 'other');
	});
});

suite('GraphSearchService search history', () => {
	test('recreates the history instance for the current repo on every access instead of sticking to the first repo used', async () => {
		const harness = createSearchHarness();

		await harness.rpc.storeHistory({ query: 'foo' });

		assert.strictEqual(harness.storage.storeWorkspace.firstCall.args[0], 'graph:searchHistory:/repo');

		harness.setRepositoryPath('/repoB');

		await harness.rpc.storeHistory({ query: 'bar' });

		const lastStoreCall = harness.storage.storeWorkspace.lastCall;

		assert.strictEqual(lastStoreCall.args[0], 'graph:searchHistory:/repoB');
		const storedForRepoB = lastStoreCall.args[1] as Array<{ query: string }>;
		assert.strictEqual(storedForRepoB.length, 1);
		assert.strictEqual(storedForRepoB[0].query, 'bar');

		const repoBResponse = await harness.rpc.getHistory();

		assert.strictEqual(repoBResponse.history.length, 1);
		assert.strictEqual(repoBResponse.history[0].query, 'bar');

		harness.setRepositoryPath('/repo');

		const repoAResponse = await harness.rpc.getHistory();

		assert.strictEqual(repoAResponse.history.length, 1);
		assert.strictEqual(repoAResponse.history[0].query, 'foo');
	});
});
