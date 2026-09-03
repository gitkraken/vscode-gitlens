import * as assert from 'assert';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSession, GitGraphSessionMoreResult } from '@gitlens/git/models/graphSession.js';
import { GraphDataController } from '../graphDataController.js';

/**
 * The HOST half of the session's paging contract: the host's job is to REPORT the refusal, not to absorb
 * it. The client is the layer that re-asks, because paging is edge-triggered there and only it knows
 * whether the user is still at the boundary — see `graph-wrapper`'s arm/consume latch
 * (`consumeSupersededPageRetry`).
 *
 * What the host must not do is swallow it. A `'superseded'` that stops here strands the user until they
 * scroll away and back, and on the targeted row-load path it becomes a false "not found".
 */
suite('GraphDataController — superseded pages are reported, not swallowed', () => {
	const proto = GraphDataController.prototype;

	function priv(t: GraphDataController): Record<string, unknown> {
		return t as unknown as Record<string, unknown>;
	}

	/** A session whose `more()` returns the scripted outcomes in order (the last one repeats), recording
	 *  the page depth it was asked for so the test can prove the retry re-derived it from the NEW window. */
	function createFakeSession(
		outcomes: GitGraphSessionMoreResult[],
		ids: Set<string> = new Set(),
		tainted: boolean = false,
	): {
		session: GitGraphSession;
		calls: { limit: number | undefined; targetId: string | undefined }[];
		grow: (sha: string) => void;
	} {
		const calls: { limit: number | undefined; targetId: string | undefined }[] = [];
		let call = 0;
		const current = { ids: ids, rows: [], paging: { hasMore: true } } as unknown as GitGraph;
		const session = {
			repoPath: '/repo',
			window: [],
			current: current,
			tainted: tainted,
			more: (limit?: number, targetId?: string) => {
				calls.push({ limit: limit, targetId: targetId });
				return Promise.resolve(outcomes[Math.min(call++, outcomes.length - 1)]);
			},
		} as unknown as GitGraphSession;
		return { session: session, calls: calls, grow: (sha: string) => ids.add(sha) };
	}

	function createFakeThis(session: GitGraphSession): GraphDataController {
		const fake = Object.create(proto) as GraphDataController;
		priv(fake)._graphSession = session;
		priv(fake)._graphLoading = undefined;
		priv(fake)._pendingRowsQuery = undefined;
		// `host` is a getter over `context` (see `GraphDataController`), so the whole surface this path
		// touches is reachable through the one injected context object.
		priv(fake).context = {
			host: { sendTelemetryEvent: () => {} },
			getIncludedRefTipShas: () => undefined,
		};
		// `setGraph` is the whole publisher/notify pipeline; the page's OUTCOME is what's under test here.
		priv(fake).setGraph = () => {};
		return fake;
	}

	test('a superseded page is SURFACED to the caller, walked exactly once', async () => {
		const { session, calls } = createFakeSession(['superseded']);
		const t = createFakeThis(session);

		const result = await proto.updateGraphWithMoreRows.call(t, undefined, undefined, 7);

		assert.strictEqual(result, 'superseded', 'the outcome reaches the caller — the RPC carries it to the client');
		assert.strictEqual(calls.length, 1, 'the host does not retry blind: it cannot see whether the rows are wanted');
	});

	test('a page that finds nothing is NOT retried — retrying it would spin', async () => {
		const { session, calls } = createFakeSession(['none']);
		const t = createFakeThis(session);

		const result = await proto.updateGraphWithMoreRows.call(t, undefined, undefined, 7);

		assert.strictEqual(result, 'none');
		assert.strictEqual(calls.length, 1, "'none' is terminal — the history is exhausted");
	});

	test('the page RPC hands the outcome back rather than resolving void', async () => {
		// `onGetMoreRows` is what the webview actually calls; if IT drops the outcome the client can never
		// re-ask, which is the stranding this whole contract exists to end.
		const { session } = createFakeSession(['superseded']);
		const t = createFakeThis(session);
		const sync = { hold: () => {}, release: () => {}, flush: () => Promise.resolve(), requireSnapshot: () => {} };
		Object.assign(priv(t).context as object, { getSync: () => sync, getSearch: () => undefined });
		priv(t).notifyDidChangeRows = () => {};
		priv(t).updateState = () => {};
		// `onGetMoreRows` bails early unless the graph looks pageable and the repo etag matches.
		(session.current as unknown as { more: unknown }).more = () => Promise.resolve(undefined);
		Object.assign(priv(t).context as object, {
			getRepository: () => ({ etag: 1 }),
			getEtagRepository: () => 1,
		});

		const result = await proto.onGetMoreRows.call(t, undefined, 7, false);

		assert.strictEqual(result, 'superseded', 'the RPC reply carries it');
	});

	test('loadRow never reports notFound for a page it never actually walked', async () => {
		// The reviewer's case: a superseded refusal used to fall through to `classifyLoadRowFailure`, which
		// answers `notFound` — a claim about the REPOSITORY ("that commit isn't here") made on no evidence,
		// since the walk never ran. The honest answer carries no reason, which the client renders as
		// "Couldn't load <target>" and leaves re-triggerable.
		const { session } = createFakeSession(['superseded']);
		const t = createFakeThis(session);
		// `_graphSync` and `_search` are getters over `context` too — extend the injected context rather
		// than trying to define over the accessors.
		const sync = { hold: () => {}, release: () => {}, flush: () => Promise.resolve(), requireSnapshot: () => {} };
		Object.assign(priv(t).context as object, { getSync: () => sync, getSearch: () => undefined });
		priv(t).notifyDidChangeRows = () => {};
		let classified = false;
		priv(t).classifyLoadRowFailure = () => {
			classified = true;
			return Promise.resolve('notFound');
		};

		const result = await proto.loadRow.call(t, 'a'.repeat(40));

		assert.strictEqual(result.id, undefined, 'the row still did not load');
		assert.strictEqual(result.reason, undefined, 'but we must not claim to know WHY');
		assert.strictEqual(classified, false, 'and must not spend a classification walk on it either');
	});

	test('a TARGETED superseded page is retried by the HOST, and a landed retry reaches loadRow', async () => {
		// Unlike a boundary page, the target id is a stable ask the host can retry itself — see
		// `retryTargetedSupersededPage`. First call is refused; the retry's own walk finds the commit.
		const id = 'b'.repeat(40);
		const ids = new Set<string>();
		const calls: { limit: number | undefined; targetId: string | undefined }[] = [];
		const session = {
			repoPath: '/repo',
			window: [],
			current: { ids: ids, rows: [], paging: { hasMore: true } } as unknown as GitGraph,
			more: (limit?: number, targetId?: string) => {
				calls.push({ limit: limit, targetId: targetId });
				if (calls.length === 1) return Promise.resolve('superseded' as const);

				ids.add(id); // the retry's walk actually lands the commit
				return Promise.resolve('added' as const);
			},
		} as unknown as GitGraphSession;
		const t = createFakeThis(session);
		const sync = { hold: () => {}, release: () => {}, flush: () => Promise.resolve(), requireSnapshot: () => {} };
		Object.assign(priv(t).context as object, { getSync: () => sync, getSearch: () => undefined });
		priv(t).notifyDidChangeRows = () => {};
		let classified = false;
		priv(t).classifyLoadRowFailure = () => {
			classified = true;
			return Promise.resolve('notFound');
		};

		const result = await proto.loadRow.call(t, id);

		assert.strictEqual(result.id, id, 'the retry landed and the row is reported loaded');
		assert.strictEqual(calls.length, 2, 'retried exactly once against the replacing window');
		assert.strictEqual(classified, false);
	});

	test('a TARGETED superseded page already satisfied by the replacing window is not retried', async () => {
		// The session serializes every write, so by the time `more` refuses a queued page the replacing
		// rebuild has already completed — here it already landed the target concurrently with the refusal.
		// Revalidation must find it WITHOUT spending a second walk.
		const id = 'c'.repeat(40);
		const ids = new Set<string>();
		const calls: { limit: number | undefined; targetId: string | undefined }[] = [];
		const session = {
			repoPath: '/repo',
			window: [],
			current: { ids: ids, rows: [], paging: { hasMore: true } } as unknown as GitGraph,
			more: (limit?: number, targetId?: string) => {
				calls.push({ limit: limit, targetId: targetId });
				ids.add(id); // the concurrent rebuild that replaced this page's window already has it
				return Promise.resolve('superseded' as const);
			},
		} as unknown as GitGraphSession;
		const t = createFakeThis(session);
		const sync = { hold: () => {}, release: () => {}, flush: () => Promise.resolve(), requireSnapshot: () => {} };
		Object.assign(priv(t).context as object, { getSync: () => sync, getSearch: () => undefined });
		priv(t).notifyDidChangeRows = () => {};
		let classified = false;
		priv(t).classifyLoadRowFailure = () => {
			classified = true;
			return Promise.resolve('notFound');
		};

		const result = await proto.loadRow.call(t, id);

		assert.strictEqual(result.id, id, 'satisfied by revalidation against the replacing window');
		assert.strictEqual(calls.length, 1, 'revalidation found the target already there — no second walk');
		assert.strictEqual(classified, false);
	});

	test('a BOUNDARY superseded page is still reported, not retried by the host', async () => {
		// Regression guard for the ownership split: only a TARGETED page (`id != null`) gets a host-side
		// retry. A boundary page keeps today's behavior exactly — reported once, client-owned re-ask.
		const { session, calls } = createFakeSession(['superseded']);
		const t = createFakeThis(session);

		const result = await proto.updateGraphWithMoreRows.call(t, undefined, undefined, 7);

		assert.strictEqual(result, 'superseded');
		assert.strictEqual(calls.length, 1, 'no host-side retry for a boundary page');
	});

	test('a TARGETED superseded page is NOT answered from a TAINTED window that already holds the target', async () => {
		// `tainted` means the current window is known-corrupt, and `more` itself refuses it with
		// `'superseded'` for that reason. `session.current.ids.has(targetId)` being true is not enough to
		// short-circuit the retry while tainted — answering `'added'` here would ship the corrupt rows the
		// taint exists to keep off screen, so the loop must keep re-asking `more` until it bottoms out.
		const targetId = 'd'.repeat(40);
		const ids = new Set<string>([targetId]);
		const { session, calls } = createFakeSession(['superseded'], ids, true);
		const t = createFakeThis(session);
		let setGraphCalls = 0;
		priv(t).setGraph = () => {
			setGraphCalls++;
		};

		const result = await proto.updateGraphWithMoreRows.call(t, targetId, undefined, 7);

		const maxRetries = (GraphDataController as unknown as { maxTargetedPageSupersededRetries: number })
			.maxTargetedPageSupersededRetries;
		assert.strictEqual(result, 'superseded', 'a tainted window must not be answered as added');
		assert.strictEqual(setGraphCalls, 0, 'the corrupt window must never be published');
		assert.strictEqual(
			calls.length,
			1 + maxRetries,
			'one initial `more` plus one retry attempt per cap, all refused while tainted',
		);
	});
});
