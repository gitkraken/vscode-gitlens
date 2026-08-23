import * as assert from 'assert';
import { MessageChannel } from 'node:worker_threads';
import type { Endpoint } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { createCoachMarkSeenStore } from '../coachMarkSeen.js';

/** Node's MessagePort is an EventTarget, so it satisfies Supertalk's Endpoint directly. */
function asEndpoint(port: import('node:worker_threads').MessagePort): Endpoint {
	return port as unknown as Endpoint;
}

type SeenState = { seen: Partial<Record<string, true>> };

const stateKey = 'graph:coachMarks';

interface FakeRemote {
	getItemState(): Promise<SeenState | undefined>;
	setItemState(key: string, state: SeenState): Promise<void>;
}

interface FakeRemoteContext {
	remote: FakeRemote;
	/** Every `setItemState` payload, in call order. */
	writes: SeenState[];
	keys: string[];
}

function createFakeRemote(options?: {
	stored?: SeenState;
	getItemState?: () => Promise<SeenState | undefined>;
	setItemState?: () => Promise<void>;
}): FakeRemoteContext {
	const writes: SeenState[] = [];
	const keys: string[] = [];

	const remote: FakeRemote = {
		getItemState: options?.getItemState ?? (() => Promise.resolve(options?.stored)),
		setItemState: (key: string, state: SeenState) => {
			keys.push(key);
			writes.push(state);
			return options?.setItemState?.() ?? Promise.resolve();
		},
	};

	return { remote: remote, writes: writes, keys: keys };
}

/** A real supertalk `Connection` pair over a `MessageChannel`; the host stays unexposed until wired. */
function createConnectionPair(): { host: Connection; client: Connection; close: () => void } {
	const { port1, port2 } = new MessageChannel();
	// `onboarding` is a nested (non-root) service on the root proxy — nestedProxies makes it a remote
	// proxy instead of an attempted structured clone, matching how RpcController/RpcHost connect.
	const host = new Connection(asEndpoint(port1), { nestedProxies: true });
	const client = new Connection(asEndpoint(port2), { nestedProxies: true });

	return {
		host: host,
		client: client,
		close: () => {
			host.close();
			client.close();
			port1.close();
			port2.close();
		},
	};
}

/** Expose `remote` as the pair's `onboarding` service and drive the handshake. */
function wire(pair: { host: Connection; client: Connection }, remote: FakeRemote): void {
	pair.host.expose({ onboarding: remote });
	void pair.client.waitForReady();
}

/** Enough time for a same-process MessageChannel round trip (or several) to complete. */
const tick = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms));

function seenKeys(state: SeenState | undefined): string[] {
	return Object.keys(state?.seen ?? {}).sort();
}

suite('graph coach-mark seen store', () => {
	test('has() stays undefined until the persisted set is known', async () => {
		const store = createCoachMarkSeenStore();

		// Nothing connected — callers must not force-open on an unknown set
		assert.strictEqual(store.has('details'), undefined);

		const { host, client, close } = createConnectionPair();
		const { remote } = createFakeRemote({ stored: { seen: { details: true } } });
		wire({ host: host, client: client }, remote);
		store.connect(client);

		// Still unknown until the fetch resolves
		assert.strictEqual(store.has('details'), undefined);

		await tick();
		assert.strictEqual(store.has('details'), true);

		store.dispose();
		close();
	});

	test('markSeen() accepts a ready-state mark type', async () => {
		const store = createCoachMarkSeenStore();
		const { host, client, close } = createConnectionPair();
		const { remote, writes } = createFakeRemote({ stored: { seen: {} } });
		wire({ host: host, client: client }, remote);

		store.connect(client);
		await tick();

		store.markSeen('composeReady');
		await tick();

		assert.strictEqual(store.has('composeReady'), true);
		assert.strictEqual(store.has('resolveReady'), false);
		assert.deepStrictEqual(seenKeys(writes[0]), ['composeReady']);

		store.dispose();
		close();
	});

	test('connect() hydrates from stored state and reports unseen marks as false', async () => {
		const store = createCoachMarkSeenStore();
		const { host, client, close } = createConnectionPair();
		const { remote, writes } = createFakeRemote({ stored: { seen: { details: true, review: true } } });
		wire({ host: host, client: client }, remote);

		store.connect(client);
		await tick();

		assert.strictEqual(store.has('details'), true);
		assert.strictEqual(store.has('review'), true);
		assert.strictEqual(store.has('compose'), false);
		// Nothing local to replay, so hydration must not write back
		assert.strictEqual(writes.length, 0);

		store.dispose();
		close();
	});

	test('markSeen() before connect is held locally and replayed on connect', async () => {
		const store = createCoachMarkSeenStore();

		store.markSeen('compose');
		// Seeded immediately so the in-session guard holds before any round-trip
		assert.strictEqual(store.has('compose'), true);

		const { host, client, close } = createConnectionPair();
		const { remote, writes, keys } = createFakeRemote({ stored: { seen: { details: true } } });
		wire({ host: host, client: client }, remote);
		store.connect(client);
		await tick();

		assert.strictEqual(store.has('compose'), true);
		assert.strictEqual(store.has('details'), true);
		assert.strictEqual(writes.length, 1);
		assert.deepStrictEqual(keys, [stateKey]);
		assert.deepStrictEqual(seenKeys(writes[0]), ['compose', 'details']);

		store.dispose();
		close();
	});

	test('a fetch in flight when a mark is banked cannot drop it', async () => {
		const store = createCoachMarkSeenStore();

		// The read resolves only after the write below has already landed, and it predates that write —
		// so its payload is stale and must not be treated as authoritative.
		let resolveGet!: (value: SeenState | undefined) => void;
		const { host, client, close } = createConnectionPair();
		const { remote, writes } = createFakeRemote({
			getItemState: () =>
				new Promise<SeenState | undefined>(resolve => {
					resolveGet = resolve;
				}),
		});
		wire({ host: host, client: client }, remote);

		store.connect(client);
		await tick();
		assert.strictEqual(store.has('compose'), undefined);

		store.markSeen('compose');
		await tick();
		assert.strictEqual(writes.length, 1);

		resolveGet(undefined);
		await tick();

		assert.strictEqual(store.has('compose'), true);

		store.dispose();
		close();
	});

	test('switching to a new connection cancels a previous handshake still in flight', async () => {
		const store = createCoachMarkSeenStore();

		// The stale connection's host is never exposed until after the switch below — its `subscribe()`
		// is still waiting on the handshake when `connect()` is called again.
		const stale = createConnectionPair();
		const staleRemote = createFakeRemote({ stored: { seen: { details: true } } });

		const current = createConnectionPair();
		const currentRemote = createFakeRemote({ stored: { seen: { review: true } } });
		wire(current, currentRemote.remote);

		store.connect(stale.client);
		store.connect(current.client);
		await tick();

		assert.strictEqual(store.has('review'), true);

		// The stale connection's handshake only now completes — its subscription was already cancelled
		wire(stale, staleRemote.remote);
		await tick();

		assert.strictEqual(store.has('review'), true);
		// 'details' only lives in the stale connection's stored state — the current fetch already
		// hydrated `seen` as a defined set, so an absent mark reads as known-false, not unknown.
		assert.strictEqual(store.has('details'), false, 'the superseded connection must never hydrate');

		store.dispose();
		stale.close();
		current.close();
	});

	test('a failed persist stays queued and is retried on reconnect', async () => {
		const store = createCoachMarkSeenStore();
		const failingPair = createConnectionPair();
		const failing = createFakeRemote({
			stored: { seen: {} },
			setItemState: () => Promise.reject(new Error('nope')),
		});
		wire(failingPair, failing.remote);

		store.connect(failingPair.client);
		await tick();

		store.markSeen('agents');
		await tick();

		assert.strictEqual(failing.writes.length, 1);
		// The local set still reflects it, so the mark won't force-open again this session
		assert.strictEqual(store.has('agents'), true);

		const healthyPair = createConnectionPair();
		const healthy = createFakeRemote({ stored: { seen: {} } });
		wire(healthyPair, healthy.remote);
		store.connect(healthyPair.client);
		await tick();

		assert.strictEqual(healthy.writes.length, 1);
		assert.deepStrictEqual(seenKeys(healthy.writes[0]), ['agents']);
		assert.strictEqual(store.has('agents'), true);

		store.dispose();
		failingPair.close();
		healthyPair.close();
	});

	test('dispose() cancels a connect() whose handshake has not completed', async () => {
		const store = createCoachMarkSeenStore();
		const { host, client, close } = createConnectionPair();
		const { remote, writes } = createFakeRemote({ stored: { seen: { compare: true } } });

		store.connect(client);
		store.dispose();

		wire({ host: host, client: client }, remote);
		await tick();

		// Never hydrated, never written to
		assert.strictEqual(store.has('compare'), undefined);
		assert.strictEqual(writes.length, 0);

		close();
	});
});
