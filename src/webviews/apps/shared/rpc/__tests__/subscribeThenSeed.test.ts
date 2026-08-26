import * as assert from 'assert';
import { MessageChannel } from 'node:worker_threads';
import type { Endpoint } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { SubscribeThenSeed } from '../subscribeThenSeed.js';

/** Node's MessagePort is an EventTarget, so it satisfies Supertalk's Endpoint directly. */
function asEndpoint(port: import('node:worker_threads').MessagePort): Endpoint {
	return port as unknown as Endpoint;
}

type TestServices = { ping(): string };

/** A host/client Connection pair over one MessageChannel, primed so handshakes resolve. */
function createPair() {
	const { port1, port2 } = new MessageChannel();
	const host = new Connection(asEndpoint(port1));
	const client = new Connection(asEndpoint(port2));
	// `subscribe()` piggybacks on handshakes but does not initiate one — in production the app's
	// RpcController drives `waitForReady`; prime it here the same way, with the host exposing a
	// macrotask later (MessagePort delivery order), or `Subscription.ready` never settles.
	void client.waitForReady();
	setTimeout(() => host.expose({ ping: () => 'pong' } satisfies TestServices), 0);
	return {
		client: client,
		dispose: () => {
			host.close();
			client.close();
			port1.close();
			port2.close();
		},
	};
}

function defer<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise: promise, resolve: resolve, reject: reject };
}

/** Yields a few macrotasks so handshakes and stale-run continuations settle. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await new Promise<void>(resolve => setImmediate(resolve));
	}
}

suite('SubscribeThenSeed Test Suite', () => {
	test('a superseded run resolving late must not disturb the newer run’s buffering', async () => {
		const { client, dispose } = createPair();
		try {
			const sts = new SubscribeThenSeed<TestServices>();
			const order: string[] = [];
			const seedA = defer<void>();
			const seedB = defer<void>();

			// Run A starts and blocks on its seed fetch.
			const runA = sts.run({
				connection: client,
				subscriber: () => () => {},
				seed: () => seedA.promise,
				applySeed: () => order.push('seedA'),
			});

			// Run B supersedes A while A's fetch is still pending.
			const runB = sts.run({
				connection: client,
				subscriber: () => () => {},
				seed: () => seedB.promise,
				applySeed: () => order.push('seedB'),
			});

			// A push lands during B's seed window — it must stay buffered behind B's seed.
			sts.during(() => order.push('push1'));

			// A resolves late: stale — must neither apply nor touch B's buffer.
			seedA.resolve();
			await settle();
			await runA;
			assert.deepStrictEqual<string[]>(order, [], "the stale run must not apply or release B's buffer");

			// Another push while B is still seeding — still buffered.
			sts.during(() => {
				order.push('push2');
			});

			seedB.resolve();
			await runB;
			assert.deepStrictEqual(order, ['seedB', 'push1', 'push2'], 'seed first, then the buffered pushes in order');

			// Steady state: pushes apply immediately.
			sts.during(() => {
				order.push('live');
			});
			assert.strictEqual(order.at(-1), 'live');
		} finally {
			dispose();
		}
	});

	test('a rejected seed fetch releases the buffered pushes instead of wedging the buffer', async () => {
		const { client, dispose } = createPair();
		try {
			const sts = new SubscribeThenSeed<TestServices>();
			const order: string[] = [];
			const seed = defer<void>();

			const run = sts.run({
				connection: client,
				subscriber: () => () => {},
				seed: () => seed.promise,
				applySeed: () => order.push('seed'),
			});

			sts.during(() => order.push('push1'));

			// Let run() reach its seed await before rejecting — a rejection with no handler attached
			// yet would fire a global unhandled-rejection and fail unrelated tests.
			await settle();
			seed.reject(new Error('fetch failed'));
			await assert.rejects(run, /fetch failed/);

			assert.deepStrictEqual(
				order,
				['push1'],
				'the buffered push must be released — it is newer than the failed seed',
			);

			// The buffer must not stay started: later pushes apply immediately.
			sts.during(() => order.push('push2'));
			assert.deepStrictEqual(order, ['push1', 'push2']);
		} finally {
			dispose();
		}
	});

	test('a remount (reset + new run) racing an in-flight seed keeps the new mount’s buffering intact', async () => {
		const { client, dispose } = createPair();
		try {
			const sts = new SubscribeThenSeed<TestServices>();
			const order: string[] = [];
			const seedA = defer<void>();
			const seedB = defer<void>();

			// Mount 1's run blocks on its seed…
			void sts
				.run({
					connection: client,
					subscriber: () => () => {},
					seed: () => seedA.promise,
					applySeed: () => order.push('seedA'),
				})
				.catch(() => {});

			// …the element unmounts (reset) and remounts (a fresh run).
			sts.reset();
			const runB = sts.run({
				connection: client,
				subscriber: () => () => {},
				seed: () => seedB.promise,
				applySeed: () => order.push('seedB'),
			});

			sts.during(() => order.push('pushB'));

			// Mount 1's stale seed resolves — must not tear down mount 2's buffering.
			seedA.resolve();
			await settle();
			assert.deepStrictEqual<string[]>(order, [], "the stale mount's seed must change nothing");

			seedB.resolve();
			await runB;
			assert.deepStrictEqual(order, ['seedB', 'pushB']);
		} finally {
			dispose();
		}
	});
});
