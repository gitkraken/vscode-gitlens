import * as assert from 'assert';
import type { CoachMarkSeenStore } from '../coachMarkSeen.js';
import { createCoachMarkSeenStore } from '../coachMarkSeen.js';

type ConnectArg = Parameters<CoachMarkSeenStore['connect']>[0];
type SeenState = { seen: Partial<Record<string, true>> };

const stateKey = 'graph:coachMarks';

interface FakeRemote {
	remote: ConnectArg;
	/** Every `setItemState` payload, in call order. */
	writes: SeenState[];
	keys: string[];
}

function createFakeRemote(options?: {
	stored?: SeenState;
	getItemState?: () => Promise<SeenState | undefined>;
	setItemState?: () => Promise<void>;
}): FakeRemote {
	const writes: SeenState[] = [];
	const keys: string[] = [];

	const remote = {
		getItemState: options?.getItemState ?? (() => Promise.resolve(options?.stored)),
		setItemState: (key: string, state: SeenState) => {
			keys.push(key);
			writes.push(state);
			return options?.setItemState?.() ?? Promise.resolve();
		},
	};

	return { remote: remote as unknown as ConnectArg, writes: writes, keys: keys };
}

/** Enough microtask ticks to settle connect() > fetch() > persist() chains. */
async function flush(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await Promise.resolve();
	}
}

function seenKeys(state: SeenState | undefined): string[] {
	return Object.keys(state?.seen ?? {}).sort();
}

suite('graph coach-mark seen store', () => {
	test('has() stays undefined until the persisted set is known', async () => {
		const store = createCoachMarkSeenStore();

		// Nothing connected — callers must not force-open on an unknown set
		assert.strictEqual(store.has('details'), undefined);

		const { remote } = createFakeRemote({ stored: { seen: { details: true } } });
		store.connect(remote);

		// Still unknown until the fetch resolves
		assert.strictEqual(store.has('details'), undefined);

		await flush();
		assert.strictEqual(store.has('details'), true);

		store.dispose();
	});

	test('markSeen() accepts a ready-state mark type', async () => {
		const store = createCoachMarkSeenStore();
		const { remote, writes } = createFakeRemote({ stored: { seen: {} } });

		store.connect(remote);
		await flush();

		store.markSeen('composeReady');
		await flush();

		assert.strictEqual(store.has('composeReady'), true);
		assert.strictEqual(store.has('resolveReady'), false);
		assert.deepStrictEqual(seenKeys(writes[0]), ['composeReady']);

		store.dispose();
	});

	test('connect() hydrates from stored state and reports unseen marks as false', async () => {
		const store = createCoachMarkSeenStore();
		const { remote, writes } = createFakeRemote({ stored: { seen: { details: true, review: true } } });

		store.connect(remote);
		await flush();

		assert.strictEqual(store.has('details'), true);
		assert.strictEqual(store.has('review'), true);
		assert.strictEqual(store.has('compose'), false);
		// Nothing local to replay, so hydration must not write back
		assert.strictEqual(writes.length, 0);

		store.dispose();
	});

	test('markSeen() before connect is held locally and replayed on connect', async () => {
		const store = createCoachMarkSeenStore();

		store.markSeen('compose');
		// Seeded immediately so the in-session guard holds before any round-trip
		assert.strictEqual(store.has('compose'), true);

		const { remote, writes, keys } = createFakeRemote({ stored: { seen: { details: true } } });
		store.connect(remote);
		await flush();

		assert.strictEqual(store.has('compose'), true);
		assert.strictEqual(store.has('details'), true);
		assert.strictEqual(writes.length, 1);
		assert.deepStrictEqual(keys, [stateKey]);
		assert.deepStrictEqual(seenKeys(writes[0]), ['compose', 'details']);

		store.dispose();
	});

	test('a fetch in flight when a mark is banked cannot drop it', async () => {
		const store = createCoachMarkSeenStore();

		// The read resolves only after the write below has already landed, and it predates that write —
		// so its payload is stale and must not be treated as authoritative.
		let resolveGet!: (value: SeenState | undefined) => void;
		const { remote, writes } = createFakeRemote({
			getItemState: () =>
				new Promise<SeenState | undefined>(resolve => {
					resolveGet = resolve;
				}),
		});

		store.connect(remote);
		await flush();
		assert.strictEqual(store.has('compose'), undefined);

		store.markSeen('compose');
		await flush();
		assert.strictEqual(writes.length, 1);

		resolveGet(undefined);
		await flush();

		assert.strictEqual(store.has('compose'), true);

		store.dispose();
	});

	test('a superseded connect resolution is ignored', async () => {
		const store = createCoachMarkSeenStore();

		let resolveFirst!: (value: ConnectArg) => void;
		const first = new Promise<ConnectArg>(resolve => {
			resolveFirst = resolve;
		});
		const stale = createFakeRemote({ stored: { seen: { details: true } } });
		const current = createFakeRemote({ stored: { seen: { review: true } } });

		store.connect(first as unknown as ConnectArg);
		store.connect(current.remote);
		await flush();

		assert.strictEqual(store.has('review'), true);

		// The first connect only now resolves — its generation is stale
		resolveFirst(stale.remote);
		await flush();

		assert.strictEqual(store.has('review'), true);
		assert.strictEqual(store.has('details'), false);

		store.dispose();
	});

	test('a failed persist stays queued and is retried on reconnect', async () => {
		const store = createCoachMarkSeenStore();
		const failing = createFakeRemote({
			stored: { seen: {} },
			setItemState: () => Promise.reject(new Error('nope')),
		});

		store.connect(failing.remote);
		await flush();

		store.markSeen('agents');
		await flush();

		assert.strictEqual(failing.writes.length, 1);
		// The local set still reflects it, so the mark won't force-open again this session
		assert.strictEqual(store.has('agents'), true);

		const healthy = createFakeRemote({ stored: { seen: {} } });
		store.connect(healthy.remote);
		await flush();

		assert.strictEqual(healthy.writes.length, 1);
		assert.deepStrictEqual(seenKeys(healthy.writes[0]), ['agents']);
		assert.strictEqual(store.has('agents'), true);

		store.dispose();
	});

	test('dispose() ignores an in-flight connect', async () => {
		const store = createCoachMarkSeenStore();

		let resolveConnect!: (value: ConnectArg) => void;
		const pending = new Promise<ConnectArg>(resolve => {
			resolveConnect = resolve;
		});
		const { remote, writes } = createFakeRemote({ stored: { seen: { compare: true } } });

		store.connect(pending as unknown as ConnectArg);
		store.dispose();

		resolveConnect(remote);
		await flush();

		// Never hydrated, never written to
		assert.strictEqual(store.has('compare'), undefined);
		assert.strictEqual(writes.length, 0);
	});
});
