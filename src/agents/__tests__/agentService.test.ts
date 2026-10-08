import * as assert from 'node:assert';
import type { GkAgent } from '../agentService.js';
import { AgentService } from '../agentService.js';

// Short enough to keep the suite fast, long enough that "rejects at once" is clearly distinguishable from a wait
const timeoutMs = 200;
const reapMs = 500;
const abandonMarginMs = 200;

const codex: GkAgent = {
	name: 'codex',
	displayName: 'Codex',
	detected: true,
	executable: '/usr/bin/codex',
	mcpSupported: true,
	mcpInstalled: false,
	hooksSupported: true,
	hooksInstalled: false,
};

type Deferred = { promise: Promise<GkAgent[]>; resolve: (v: GkAgent[]) => void; reject: (e: unknown) => void };

function deferred(): Deferred {
	let resolve!: (v: GkAgent[]) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<GkAgent[]>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise: promise, resolve: resolve, reject: reject };
}

/** A fetcher whose every call returns the next queued deferred, counting calls. */
function queuedFetcher(...queue: Deferred[]): { fetch: () => Promise<GkAgent[]>; calls: () => number } {
	let calls = 0;
	return {
		fetch: () => {
			const next = queue[calls++];
			assert.ok(next != null, `unexpected fetch #${calls}`);
			return next.promise;
		},
		calls: () => calls,
	};
}

function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function assertTimesOut(promise: Promise<unknown>): Promise<void> {
	await assert.rejects(
		promise,
		(ex: unknown) => ex instanceof Error && ex.message === "Agent detection didn't finish",
	);
}

suite('AgentService.getAll', () => {
	test('concurrent callers share one fetch', async () => {
		const d = deferred();
		const fetcher = queuedFetcher(d);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		const first = service.getAll();
		const second = service.getAll();
		d.resolve([codex]);

		assert.deepStrictEqual(await first, [codex]);
		assert.deepStrictEqual(await second, [codex]);
		assert.strictEqual(fetcher.calls(), 1);
	});

	test('rejects when the fetch runs past the deadline', async () => {
		const fetcher = queuedFetcher(deferred());
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		await assertTimesOut(service.getAll());
	});

	test('a caller arriving after the deadline rejects at once, without a second wait or fetch', async () => {
		const fetcher = queuedFetcher(deferred());
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		await assertTimesOut(service.getAll());

		const start = Date.now();
		await assertTimesOut(service.getAll());
		const elapsed = Date.now() - start;

		assert.ok(elapsed < timeoutMs / 2, `late caller waited ${elapsed}ms`);
		assert.strictEqual(fetcher.calls(), 1);
	});

	test('a timeout caches nothing; the next successful fetch caches', async () => {
		const hung = deferred();
		const retry = deferred();
		const fetcher = queuedFetcher(hung, retry);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		await assertTimesOut(service.getAll());

		// The hung process is reaped (the exec timeout rejects the fetch) — nothing was cached, so the
		// next caller dispatches a fresh fetch rather than reading a stale or empty list
		hung.reject(new Error('reaped'));
		await hung.promise.catch(() => undefined);

		const next = service.getAll();
		retry.resolve([codex]);
		assert.deepStrictEqual(await next, [codex]);
		assert.strictEqual(fetcher.calls(), 2);

		// Served from the cache
		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.strictEqual(fetcher.calls(), 2);
	});

	test('passes the reap window to the fetch as its exec timeout', async () => {
		let received: number | undefined;
		const service = new AgentService(
			t => {
				received = t;
				return Promise.resolve([codex]);
			},
			timeoutMs,
			reapMs,
			abandonMarginMs,
		);

		await service.getAll();
		assert.strictEqual(received, reapMs);
	});

	test('a fetch that never settles is abandoned after the reap window and its margin, not before', async () => {
		const retry = deferred();
		const fetcher = queuedFetcher(deferred(), retry);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		await assertTimesOut(service.getAll());

		// Past the deadline but inside the reap window: still joins the hung fetch, so no new process
		const start = Date.now();
		await assertTimesOut(service.getAll());
		assert.ok(Date.now() - start < timeoutMs / 2, 'rejected at once');
		assert.strictEqual(fetcher.calls(), 1);

		// Past the reap window but inside the margin (the kill may not have landed yet): still joins it
		await wait(reapMs - timeoutMs + abandonMarginMs / 2);
		await assertTimesOut(service.getAll());
		assert.strictEqual(fetcher.calls(), 1);

		await wait(abandonMarginMs / 2 + 50);

		const next = service.getAll();
		assert.strictEqual(fetcher.calls(), 2);
		retry.resolve([codex]);
		assert.deepStrictEqual(await next, [codex]);
	});

	test('an abandoned fetch settling late does not clear the in-flight fetch that replaced it', async () => {
		const hung = deferred();
		const replacement = deferred();
		const fetcher = queuedFetcher(hung, replacement);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		await assertTimesOut(service.getAll());
		await wait(reapMs + abandonMarginMs + 50);

		// Dispatches the replacement, which runs past its own deadline
		const waiting = service.getAll();
		assert.strictEqual(fetcher.calls(), 2);

		// The abandoned fetch fails late — the replacement stays the shared in-flight fetch
		hung.reject(new Error('reaped'));
		await hung.promise.catch(() => undefined);
		await wait(0);

		const joined = service.getAll();
		assert.strictEqual(fetcher.calls(), 2, 'joined the replacement instead of dispatching a third fetch');

		replacement.resolve([codex]);
		assert.deepStrictEqual(await waiting, [codex]);
		assert.deepStrictEqual(await joined, [codex]);
	});

	test("a late success from an abandoned fetch does not overwrite its replacement's cached result", async () => {
		const hung = deferred();
		const replacement = deferred();
		const fetcher = queuedFetcher(hung, replacement);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		await assertTimesOut(service.getAll());
		await wait(reapMs + abandonMarginMs + 50);

		const next = service.getAll();
		replacement.resolve([codex]);
		assert.deepStrictEqual(await next, [codex]);

		hung.resolve([]);
		await hung.promise;
		await wait(0);

		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.strictEqual(fetcher.calls(), 2);
	});

	test('a fetch that succeeds after its deadline caches and fires onDidChangeAgents once', async () => {
		const d = deferred();
		const fetcher = queuedFetcher(d);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);
		let fired = 0;
		service.onDidChangeAgents(() => fired++);

		await assertTimesOut(service.getAll());
		assert.strictEqual(fired, 0);

		d.resolve([codex]);
		await d.promise;
		await wait(0);

		assert.strictEqual(fired, 1);
		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.strictEqual(fetcher.calls(), 1, 'served from the cache');
	});

	test('a fetch that succeeds before its deadline does not fire onDidChangeAgents', async () => {
		const d = deferred();
		const fetcher = queuedFetcher(d);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);
		let fired = 0;
		service.onDidChangeAgents(() => fired++);

		const pending = service.getAll();
		d.resolve([codex]);
		assert.deepStrictEqual(await pending, [codex]);
		await wait(0);

		assert.strictEqual(fired, 0);
	});

	test('fires onDidChangeAgents for a late success after a caller fell back, whatever the clock says', async () => {
		// Freezing the clock makes the fetch settle "before" its deadline by `Date.now()`, while the caller's real
		// timer still runs out: the event must follow the caller's fallback, not a clock comparison at settle
		const realNow = Date.now;
		const frozen = realNow();
		Date.now = () => frozen;
		try {
			const d = deferred();
			const fetcher = queuedFetcher(d);
			const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);
			let fired = 0;
			service.onDidChangeAgents(() => fired++);

			await assertTimesOut(service.getAll());

			d.resolve([codex]);
			await d.promise;
			await wait(0);

			assert.strictEqual(fired, 1);
		} finally {
			Date.now = realNow;
		}
	});
});

suite('AgentService.getAll stale-while-revalidate', () => {
	const cacheTtlMs = 50;

	const claude: GkAgent = { ...codex, name: 'claude-cli', displayName: 'Claude Code' };

	/** A service whose first fetch has succeeded with `[codex]` and whose cache has since expired. */
	async function createExpired(...queue: Deferred[]) {
		const first = deferred();
		const fetcher = queuedFetcher(first, ...queue);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs, cacheTtlMs);

		const pending = service.getAll();
		first.resolve([codex]);
		assert.deepStrictEqual(await pending, [codex]);

		await wait(cacheTtlMs + 20);
		return { service: service, fetcher: fetcher };
	}

	// Intentionally changed from waiting on the refresh until its deadline: an expired list now returns at once
	test('an expired cache resolves with the last successful list at once and refreshes in the background', async () => {
		const refresh = deferred();
		const { service, fetcher } = await createExpired(refresh);

		const start = Date.now();
		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.ok(Date.now() - start < timeoutMs / 2, 'resolved at once');
		assert.strictEqual(fetcher.calls(), 2, 'a refresh was dispatched');

		// Later callers share that refresh rather than dispatching another
		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.strictEqual(fetcher.calls(), 2);

		refresh.resolve([codex, claude]);
		await refresh.promise;
		await wait(0);

		assert.deepStrictEqual(await service.getAll(), [codex, claude]);
		assert.strictEqual(fetcher.calls(), 2, 'served from the refreshed cache');
	});

	// Intentionally changed from "after the deadline": a stale list no longer waits for the deadline at all
	test('a refresh that runs past the deadline keeps serving the last successful list at once', async () => {
		const { service, fetcher } = await createExpired(deferred());

		assert.deepStrictEqual(await service.getAll(), [codex]);
		await wait(timeoutMs + 20);

		const start = Date.now();
		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.ok(Date.now() - start < timeoutMs / 2, 'resolved at once');
		assert.strictEqual(fetcher.calls(), 2);
	});

	test('a refresh landing after a stale list was served caches and fires onDidChangeAgents once', async () => {
		const refresh = deferred();
		const { service, fetcher } = await createExpired(refresh);
		let fired = 0;
		service.onDidChangeAgents(() => fired++);

		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.strictEqual(fired, 0);

		refresh.resolve([codex, claude]);
		await refresh.promise;
		await wait(0);

		assert.strictEqual(fired, 1);
		assert.deepStrictEqual(await service.getAll(), [codex, claude]);
		assert.strictEqual(fetcher.calls(), 2, 'served from the cache');
	});

	test('an abandoned refresh is replaced, still serving the last successful list meanwhile', async () => {
		const retry = deferred();
		const { service, fetcher } = await createExpired(deferred(), retry);

		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.strictEqual(fetcher.calls(), 2);

		await wait(reapMs + abandonMarginMs + 50);

		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.strictEqual(fetcher.calls(), 3, 'the hung refresh was abandoned and a new one dispatched');

		retry.resolve([codex, claude]);
		await retry.promise;
		await wait(0);
		assert.deepStrictEqual(await service.getAll(), [codex, claude]);
	});

	test('a refresh landing with the same list as the stale one served does not fire onDidChangeAgents', async () => {
		const refresh = deferred();
		const { service, fetcher } = await createExpired(refresh);
		let fired = 0;
		service.onDidChangeAgents(() => fired++);

		assert.deepStrictEqual(await service.getAll(), [codex]);

		// An equal list, but not the same instance — a fresh parse of the same CLI output
		refresh.resolve([{ ...codex }]);
		await refresh.promise;
		await wait(0);

		assert.strictEqual(fired, 0, 'subscribers already show this list');
		assert.deepStrictEqual(await service.getAll(), [codex]);
		assert.strictEqual(fetcher.calls(), 2, 'still cached the refresh');
	});

	test('invalidateCache drops the last successful list, so a timeout rejects', async () => {
		const { service } = await createExpired(deferred());

		service.invalidateCache();

		await assertTimesOut(service.getAll());
	});

	test('invalidateCache drops an unexpired list, so the next read refreshes', async () => {
		const first = deferred();
		const refresh = deferred();
		const fetcher = queuedFetcher(first, refresh);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		const pending = service.getAll();
		first.resolve([codex]);
		await pending;

		service.invalidateCache();

		const fresh = service.getAll({ fresh: true });
		refresh.resolve([codex, claude]);
		assert.deepStrictEqual(await fresh, [codex, claude]);
		assert.strictEqual(fetcher.calls(), 2);
	});
});

suite('AgentService.getAll fresh', () => {
	const cacheTtlMs = 50;

	const claude: GkAgent = { ...codex, name: 'claude-cli', displayName: 'Claude Code' };

	test('an unexpired cache is fresh enough', async () => {
		const first = deferred();
		const fetcher = queuedFetcher(first);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		const pending = service.getAll();
		first.resolve([codex]);
		await pending;

		assert.deepStrictEqual(await service.getAll({ fresh: true }), [codex]);
		assert.strictEqual(fetcher.calls(), 1, 'served from the cache');
	});

	test('an expired cache waits for the refresh instead of returning the stale list', async () => {
		const first = deferred();
		const refresh = deferred();
		const fetcher = queuedFetcher(first, refresh);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs, cacheTtlMs);

		const pending = service.getAll();
		first.resolve([codex]);
		await pending;
		await wait(cacheTtlMs + 20);

		const fresh = service.getAll({ fresh: true });
		refresh.resolve([codex, claude]);
		assert.deepStrictEqual(await fresh, [codex, claude]);
		assert.strictEqual(fetcher.calls(), 2);
	});

	test('an expired cache whose refresh runs past the deadline rejects rather than return the stale list', async () => {
		const first = deferred();
		const fetcher = queuedFetcher(first, deferred());
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs, cacheTtlMs);

		const pending = service.getAll();
		first.resolve([codex]);
		await pending;
		await wait(cacheTtlMs + 20);

		// A display read gets the stale list at once and dispatches the refresh; a fresh read joins that refresh
		assert.deepStrictEqual(await service.getAll(), [codex]);
		await assertTimesOut(service.getAll({ fresh: true }));
		assert.strictEqual(fetcher.calls(), 2);
	});

	test('a fresh caller arriving after the shared deadline still waits for a slow fetch', async () => {
		const d = deferred();
		const fetcher = queuedFetcher(d);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		await assertTimesOut(service.getAll());

		// Past the shared deadline: a display read would reject at once, but a fresh read still waits
		const fresh = service.getAll({ fresh: true });
		await wait(timeoutMs / 2);
		d.resolve([codex]);
		assert.deepStrictEqual(await fresh, [codex]);
		assert.strictEqual(fetcher.calls(), 1, 'joined the in-flight fetch');
	});

	test('a fetch that fails while a caller waits rejects with the detection error, not the raw failure', async () => {
		const d = deferred();
		const fetcher = queuedFetcher(d);
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		const display = service.getAll();
		const fresh = service.getAll({ fresh: true });
		// As a killed `gk agents list` rejects, naming the command path
		d.reject(new Error('Command failed: /path/to/gk agents list --json'));

		await assertTimesOut(display);
		await assertTimesOut(fresh);
	});

	test("a fresh caller's wait is capped at the in-flight fetch's abandonment", async () => {
		const fetcher = queuedFetcher(deferred());
		const service = new AgentService(fetcher.fetch, timeoutMs, reapMs, abandonMarginMs);

		await assertTimesOut(service.getAll());
		// Leaves less than a full window before the fetch is abandoned (at reap + margin from dispatch)
		await wait(reapMs + abandonMarginMs - timeoutMs - timeoutMs / 2);

		const start = Date.now();
		await assertTimesOut(service.getAll({ fresh: true }));
		const elapsed = Date.now() - start;
		assert.ok(elapsed < timeoutMs * 0.85, `waited ${elapsed}ms, past the abandonment`);
		assert.strictEqual(fetcher.calls(), 1);
	});
});
