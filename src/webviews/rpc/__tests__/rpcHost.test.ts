import * as assert from 'assert';
import type { Endpoint, Remote } from '@eamodio/supertalk';
import { Connection, subscribe } from '@eamodio/supertalk';
import * as sinon from 'sinon';
import type { Disposable, Event, Webview } from 'vscode';
import { Emitter } from '../../apps/shared/events.js';
import { decodeRpcPayload, encodeRpcPayload, isRpcMessage, RPC_NAMESPACE } from '../constants.js';
import type { EventRegistration } from '../eventVisibilityBuffer.js';
import {
	createRpcEvent,
	createRpcEventSubscription,
	SubscriptionTracker,
	trackRpcRegistration,
} from '../eventVisibilityBuffer.js';
import { RpcHost } from '../rpcHost.js';
import type { Unsubscribe } from '../services/types.js';

// ============================================================
// Test Helpers
// ============================================================

/**
 * Creates a connected mock Webview + client Endpoint pair.
 *
 * Messages sent via `webview.postMessage()` are delivered to the client
 * endpoint's listeners (after RPC namespace unwrapping). Messages sent
 * via `clientEndpoint.postMessage()` are delivered to the webview's
 * `onDidReceiveMessage` listeners (after RPC namespace wrapping).
 */
function createMockBridge() {
	// Webview → Client listeners
	const clientListeners = new Set<(event: MessageEvent) => void>();
	// Client → Webview listeners
	const webviewListeners = new Set<(message: unknown) => void>();

	const mockWebview: Pick<Webview, 'postMessage' | 'onDidReceiveMessage'> = {
		postMessage: function (message: unknown): Thenable<boolean> {
			// Host sends wrapped + encoded RPC message → decode and deliver raw payload to client listeners
			queueMicrotask(() => {
				if (isRpcMessage(message)) {
					const payload =
						message.payload instanceof Uint8Array || message.payload instanceof ArrayBuffer
							? decodeRpcPayload(message.payload)
							: message.payload;
					// oxlint-disable-next-line typescript/consistent-type-assertions
					const event = { data: payload } as MessageEvent;
					// Snapshot: VS Code's emitter does not invoke listeners added during dispatch
					for (const listener of [...clientListeners]) {
						listener(event);
					}
				}
			});
			return Promise.resolve(true);
		},
		onDidReceiveMessage: createMockEvent(webviewListeners),
	};

	const clientEndpoint: Endpoint = {
		postMessage: function (message: unknown): void {
			// Client sends raw message → encode, wrap with namespace, and deliver to webview listeners
			const wrapped = { [RPC_NAMESPACE]: true, payload: encodeRpcPayload(message) };
			queueMicrotask(() => {
				// Snapshot: VS Code's emitter does not invoke listeners added during dispatch
				for (const listener of [...webviewListeners]) {
					listener(wrapped);
				}
			});
		},
		addEventListener: function (_type: string, listener: (event: MessageEvent) => void): void {
			clientListeners.add(listener);
		},
		removeEventListener: function (_type: string, listener: (event: MessageEvent) => void): void {
			clientListeners.delete(listener);
		},
	};

	return { mockWebview: mockWebview as unknown as Webview, clientEndpoint: clientEndpoint };
}

/**
 * Creates a mock VS Code Event (onDidReceiveMessage-compatible).
 */
function createMockEvent(listeners: Set<(message: unknown) => void>): Event<unknown> {
	return function onDidReceiveMessage(listener: (message: unknown) => void): Disposable {
		listeners.add(listener);
		return { dispose: () => listeners.delete(listener) };
	};
}

/**
 * Simulates the webview side: creates a Connection, announces the session (the way
 * `connectRpcSession` does), and returns the resolved services. The host exposes in response to
 * the announcement — no explicit host-side call is needed.
 */
async function connectClient<T extends object>(
	clientEndpoint: Endpoint,
): Promise<{
	services: Remote<T>;
	connection: Connection;
}> {
	const connection = new Connection(clientEndpoint, { nestedProxies: true });

	// Announce the session, then wait for the host's expose() ready signal. waitForReady is
	// registered first so the placeholder root lands at a non-zero local id — see
	// `connectRpcSession` for why that ordering matters.
	const ready = connection.waitForReady();
	connection.expose({});
	const services = (await ready) as Remote<T>;
	return { services: services, connection: connection };
}

// ============================================================
// Tests
// ============================================================

suite('RpcHost Integration Test Suite', () => {
	suite('Handshake & Service Exposure', () => {
		test('should expose services and allow method calls', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const services = {
				echo: function (msg: string): string {
					return `Echo: ${msg}`;
				},
				add: function (a: number, b: number): number {
					return a + b;
				},
			};

			const host = new RpcHost(mockWebview, services);
			try {
				const { services: remote, connection } = await connectClient<{
					echo(msg: string): string;
					add(a: number, b: number): number;
				}>(clientEndpoint);

				const echoResult = await remote.echo('hello');
				assert.strictEqual(echoResult, 'Echo: hello');

				const addResult = await remote.add(2, 3);
				assert.strictEqual(addResult, 5);

				connection.close();
			} finally {
				host.dispose();
			}
		});

		test('should expose nested service objects', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const services = {
				git: {
					getCommit: function (sha: string): { sha: string; message: string } {
						return { sha: sha, message: `Commit ${sha}` };
					},
				},
				config: {
					get: function (key: string): string {
						return `value-of-${key}`;
					},
				},
			};

			const host = new RpcHost(mockWebview, services);
			try {
				const { services: remote, connection } = await connectClient<{
					git: { getCommit(sha: string): { sha: string; message: string } };
					config: { get(key: string): string };
				}>(clientEndpoint);

				const git = await remote.git;
				// oxlint-disable-next-line typescript/await-thenable -- RPC proxy wraps all calls as promises at runtime despite sync static types
				const commit = await git.getCommit('abc123');
				assert.deepStrictEqual(commit, { sha: 'abc123', message: 'Commit abc123' });

				const config = await remote.config;
				// oxlint-disable-next-line typescript/await-thenable -- RPC proxy wraps all calls as promises at runtime despite sync static types
				const value = await config.get('editor.fontSize');
				assert.strictEqual(value, 'value-of-editor.fontSize');

				connection.close();
			} finally {
				host.dispose();
			}
		});

		test('should propagate errors from service methods', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const services = {
				fail: function (): never {
					throw new Error('service failure');
				},
			};

			const host = new RpcHost(mockWebview, services);
			try {
				const { services: remote, connection } = await connectClient<{ fail(): never }>(clientEndpoint);

				await assert.rejects(
					async () => remote.fail(),
					(err: Error) => {
						assert.ok(err.message.includes('service failure'));
						return true;
					},
				);

				connection.close();
			} finally {
				host.dispose();
			}
		});

		test('should propagate async errors from service methods', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const services = {
				failAsync: async function (): Promise<never> {
					throw new Error('async failure');
				},
			};

			const host = new RpcHost(mockWebview, services);
			try {
				const { services: remote, connection } = await connectClient<{ failAsync(): Promise<never> }>(
					clientEndpoint,
				);

				await assert.rejects(
					async () => remote.failAsync(),
					(err: Error) => {
						assert.ok(err.message.includes('async failure'));
						return true;
					},
				);

				connection.close();
			} finally {
				host.dispose();
			}
		});
	});

	suite('Reconnection', () => {
		test('should support reconnection via a second client session', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			let callCount = 0;
			const services = {
				ping: function (): string {
					return `pong-${++callCount}`;
				},
			};

			const host = new RpcHost(mockWebview, services);
			try {
				// First connection
				const first = await connectClient<{ ping(): string }>(clientEndpoint);
				const result1 = await first.services.ping();
				assert.strictEqual(result1, 'pong-1');
				first.connection.close();

				// Second connection (simulates webview refresh)
				const second = await connectClient<{ ping(): string }>(clientEndpoint);
				const result2 = await second.services.ping();
				assert.strictEqual(result2, 'pong-2');
				second.connection.close();
			} finally {
				host.dispose();
			}
		});

		test('should dispose tracked subscriptions on reconnection', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const disposeSpy = sinon.spy();
			tracker.track(disposeSpy);

			const services = { ping: () => 'pong' };
			const host = new RpcHost(mockWebview, services, undefined, tracker);
			try {
				// First client session — announcements are generation boundaries, so even the
				// first one cleans registrations that predate it (there are none in production).
				const first = await connectClient<{ ping(): string }>(clientEndpoint);
				first.connection.close();

				assert.strictEqual(disposeSpy.callCount, 0, 'first serve has nothing stale to clean');

				// Second client session (simulates webview refresh): the set is already empty, so
				// the count stays at 1 — nothing leaked between the two boundaries.
				const second = await connectClient<{ ping(): string }>(clientEndpoint);
				assert.strictEqual(disposeSpy.callCount, 1, 'tracker stays clean across reconnections');

				second.connection.close();
			} finally {
				host.dispose();
			}
		});
	});

	suite('Session Health Gate', () => {
		test('serves only the first announcement per generation, ignoring stragglers until invalidation', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const disposeSpy = sinon.spy();
			tracker.track(disposeSpy);

			const services = {
				ping: function (): string {
					return 'pong';
				},
			};
			const servedSessions: string[] = [];
			// Mirrors the controller's `_sessionState` policy exactly, including the hook-driven
			// latch: `onClientSession` fires only for SERVED announcements and moves the state to
			// `served-awaiting-validation`, so an interleaved announcement before the (modeled)
			// `connect()` cannot trigger a second destructive swap.
			let sessionState: 'none' | 'served-awaiting-validation' | 'healthy' = 'none';
			const host = new RpcHost(
				mockWebview,
				services,
				{
					shouldServeSession: () => sessionState === 'none',
					onClientSession: () => {
						servedSessions.push(sessionState);
						sessionState = 'served-awaiting-validation';
					},
				},
				tracker,
			);
			try {
				// First announcement — no session yet — is served normally. Its boundary reset
				// cleans the setup-tracked registration (in production the tracker starts empty).
				const first = await connectClient<{ ping(): string }>(clientEndpoint);
				assert.strictEqual(await first.services.ping(), 'pong');
				assert.deepStrictEqual(servedSessions, ['none']);
				assert.strictEqual(disposeSpy.callCount, 0, 'first serve has nothing stale to clean');

				// An interleaved announcement while the first generation awaits its connect() must
				// NOT serve again (that would swap mid-generation) — the latch preserves the live
				// registrations and the re-announce fallback still unblocks its waiter.
				const interloper = await connectClient<{ ping(): string }>(clientEndpoint);
				assert.strictEqual(await interloper.services.ping(), 'pong', 'waiter must be unblocked');
				assert.deepStrictEqual(servedSessions, ['none'], 'latched window must not serve');
				assert.strictEqual(disposeSpy.callCount, 0, 'preserved: nothing new disposed in the latched window');

				// Validated (healthy): duplicates/stale arrivals keep being ignored (the reset
				// finds an empty set — nothing leaks either way).
				sessionState = 'healthy';
				const stale = await connectClient<{ ping(): string }>(clientEndpoint);
				assert.strictEqual(await stale.services.ping(), 'pong');
				assert.deepStrictEqual(servedSessions, ['none'], 'healthy session must not be re-served');
				assert.strictEqual(disposeSpy.callCount, 0, 'healthy ignore adds no disposals');

				// The original live session keeps working untouched throughout.
				assert.strictEqual(await first.services.ping(), 'pong');

				stale.connection.close();
				interloper.connection.close();

				// Invalidation (new generation) reopens serving.
				sessionState = 'none';
				const second = await connectClient<{ ping(): string }>(clientEndpoint);
				assert.strictEqual(await second.services.ping(), 'pong');
				assert.deepStrictEqual(
					servedSessions,
					['none', 'none'],
					'announcement must be served once invalidated',
				);
				assert.strictEqual(disposeSpy.callCount, 1, 'tracker was already clean — count unchanged');

				second.connection.close();
			} finally {
				host.dispose();
			}
		});

		// Production shape for a same-iframe element remount: ONE long-lived client Connection that
		// re-handshakes (`reset()` + `waitForReady()` + `expose()`, mirroring `connectRpcSession`),
		// with an app-side retained `subscribe()` — supertalk replays that subscriber on EVERY
		// handshake and drops the superseded unsubscribe handle WITHOUT calling it. The host's
		// ignore path (remount keeps the connection) never resets the tracker; `reset()` mints a
		// NEW caller session for the connection, and it's that new session's own `connect()` call
		// (mirrored here by `services.connect`) that supersedes the previous mount's registration —
		// see `WebviewController.connect()`.
		type ThingService = { onThing(cb: (n: number) => void): Promise<() => void>; connect(): Promise<void> };

		/**
		 * Same ordering as `connectRpcSession`: reset, wait (pins odd ids), then expose. Returns the
		 * freshly-resolved remote so callers can make a genuine post-handshake `connect()` call
		 * attributed to the NEW session `reset()` just minted.
		 */
		async function remount<T extends object>(connection: Connection): Promise<Remote<T>> {
			connection.reset();
			const ready = connection.waitForReady();
			connection.expose({});
			return (await ready) as Remote<T>;
		}

		const settle = () => new Promise(resolve => setTimeout(resolve, 20));

		test('a stale announcement from a SECOND connection must not disrupt the validated live client', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const emitter = new Emitter<number>();
			const received: number[] = [];

			// Mirrors the controller's `_sessionState` policy exactly (see the test above) — the gate
			// under test here, not a same-connection remount: the straggler is a wholly separate
			// `Connection`, e.g. a duplicate/late-arriving handshake.
			let sessionState: 'none' | 'served-awaiting-validation' | 'healthy' = 'none';
			const services = {
				onThing: createRpcEventSubscription<number>(
					undefined,
					'thing',
					'save-last',
					buffered => emitter.event(buffered),
					undefined,
					tracker,
				),
				// Mirrors `WebviewController.connect()`'s release step: the validating caller session
				// supersedes every other tracked registration.
				connect: (): Promise<void> => {
					tracker.releaseAllExcept(tracker.callerSession);
					return Promise.resolve();
				},
			};
			const host = new RpcHost(
				mockWebview,
				services,
				{
					shouldServeSession: () => sessionState === 'none',
					onClientSession: () => {
						sessionState = 'served-awaiting-validation';
					},
				},
				tracker,
			);

			const live = new Connection(clientEndpoint, { nestedProxies: true });
			let straggler: Connection | undefined;
			try {
				// The live client: announces, is served, and validates (`connect()` in production).
				subscribe<ThingService>(live, async remote => remote.onThing(n => received.push(n)));
				const liveReady = live.waitForReady();
				live.expose({});
				const liveRemote = (await liveReady) as Remote<ThingService>;
				await settle();
				sessionState = 'healthy';
				await liveRemote.connect(); // connect() validates — nothing stale yet

				emitter.fire(1);
				await settle();
				assert.deepStrictEqual(received, [1], 'the live client receives the first event');

				// A stale announcement from a distinct Connection, e.g. a late-arriving duplicate
				// handshake. `shouldServeSession()` is false (already healthy), so the host ignores it
				// and re-posts its captured handshake frame — which still resolves the straggler's
				// `waitForReady()` and replays ITS retained subscription, tagged with the straggler's
				// OWN caller session. Critically, the straggler never calls `connect()`, so it must
				// never release anything.
				straggler = new Connection(clientEndpoint, { nestedProxies: true });
				subscribe<ThingService>(straggler, async remote => remote.onThing(() => {}));
				const strugglerReady = straggler.waitForReady();
				straggler.expose({});
				await strugglerReady;
				await settle();

				emitter.fire(2);
				await settle();
				assert.deepStrictEqual(
					received,
					[1, 2],
					'the live client must keep receiving events after the stale announcement',
				);
			} finally {
				host.dispose();
				emitter.dispose();
				live.close();
				straggler?.close();
			}
		});

		test('a pre-validation interloper does not survive the served client validating', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const emitter = new Emitter<number>();
			const receivedA: number[] = [];
			const receivedB: number[] = [];

			let sessionState: 'none' | 'served-awaiting-validation' | 'healthy' = 'none';
			const services = {
				onThing: createRpcEventSubscription<number>(
					undefined,
					'thing',
					'save-last',
					buffered => emitter.event(buffered),
					undefined,
					tracker,
				),
				connect: (): Promise<void> => {
					tracker.releaseAllExcept(tracker.callerSession);
					sessionState = 'healthy';
					return Promise.resolve();
				},
			};
			const host = new RpcHost(
				mockWebview,
				services,
				{
					shouldServeSession: () => sessionState === 'none',
					onClientSession: () => {
						sessionState = 'served-awaiting-validation';
					},
				},
				tracker,
			);

			const a = new Connection(clientEndpoint, { nestedProxies: true });
			const b = new Connection(clientEndpoint, { nestedProxies: true });
			try {
				// A announces and is served.
				subscribe<ThingService>(a, async remote => remote.onThing(n => receivedA.push(n)));
				const aReady = a.waitForReady();
				a.expose({});
				const aRemote = (await aReady) as Remote<ThingService>;
				await settle();
				assert.strictEqual(sessionState, 'served-awaiting-validation', 'A was served but not yet validated');

				// B announces BEFORE A validates — ignored (still served-awaiting-validation) and
				// re-posted; B's retained subscriber still replays off the re-posted frame and
				// registers under B's OWN caller session. This is the race: without session
				// attribution, B's registration (made AFTER A's) would look newer than A's and survive
				// a naive "supersede the older one" validation instead of the other way around.
				subscribe<ThingService>(b, async remote => remote.onThing(n => receivedB.push(n)));
				const bReady = b.waitForReady();
				b.expose({});
				await bReady;
				await settle();
				assert.strictEqual(tracker.size, 2, 'both registrations are live pending validation');

				// A validates.
				await aRemote.connect();

				assert.strictEqual(tracker.size, 1, "only A's registration remains tracked");
				emitter.fire(1);
				await settle();
				assert.deepStrictEqual(receivedA, [1], 'A keeps receiving events');
				assert.deepStrictEqual(receivedB, [], 'B never receives — its registration was released');
			} finally {
				host.dispose();
				emitter.dispose();
				a.close();
				b.close();
			}
		});

		test("an interloper's connect() cannot become the active client before the served client's own connect()", async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const emitter = new Emitter<number>();
			const receivedA: number[] = [];
			const receivedB: number[] = [];

			let sessionState: 'none' | 'served-awaiting-validation' | 'healthy' = 'none';
			// Declared before `services` so `connect` can close over the real `host.pendingServedSession`.
			let host!: RpcHost<object>;
			// Mirrors `WebviewController.connect()`'s identity gate exactly: only the session
			// `RpcHost` actually SERVED (`host.pendingServedSession`) may validate while not yet
			// healthy; anything else is a straggler — rejected, releasing only its own registrations.
			const services = {
				onThing: createRpcEventSubscription<number>(
					undefined,
					'thing',
					'save-last',
					buffered => emitter.event(buffered),
					undefined,
					tracker,
				),
				connect: (): Promise<void> => {
					const session = tracker.callerSession;
					if (sessionState !== 'healthy' && session !== host.pendingServedSession) {
						tracker.releaseSession(session);
						return Promise.resolve();
					}

					sessionState = 'healthy';
					tracker.releaseAllExcept(session);
					return Promise.resolve();
				},
			};
			host = new RpcHost(
				mockWebview,
				services,
				{
					shouldServeSession: () => sessionState === 'none',
					onClientSession: () => {
						sessionState = 'served-awaiting-validation';
					},
				},
				tracker,
			);

			const a = new Connection(clientEndpoint, { nestedProxies: true });
			const b = new Connection(clientEndpoint, { nestedProxies: true });
			try {
				subscribe<ThingService>(a, async remote => remote.onThing(n => receivedA.push(n)));
				const aReady = a.waitForReady();
				a.expose({});
				const aRemote = (await aReady) as Remote<ThingService>;
				await settle();
				assert.strictEqual(sessionState, 'served-awaiting-validation', 'A was served but not yet validated');

				subscribe<ThingService>(b, async remote => remote.onThing(n => receivedB.push(n)));
				const bReady = b.waitForReady();
				b.expose({});
				const bRemote = (await bReady) as Remote<ThingService>;
				await settle();

				// B's connect() arrives first — with no active client yet, B must be rejected, not
				// accepted merely for winning the round trip.
				await bRemote.connect();
				assert.strictEqual(sessionState, 'served-awaiting-validation', "B's connect() must not validate");

				// A's own connect() still succeeds normally.
				await aRemote.connect();
				assert.strictEqual(sessionState, 'healthy');

				emitter.fire(1);
				await settle();
				assert.deepStrictEqual(receivedA, [1]);
				assert.deepStrictEqual(receivedB, [], "B's registration was released, not validated");
			} finally {
				host.dispose();
				emitter.dispose();
				a.close();
				b.close();
			}
		});

		test('a same-connection remount keeps event delivery exactly-once via createRpcEventSubscription', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const emitter = new Emitter<number>();
			const received: number[] = [];

			let healthy = false;
			const services = {
				onThing: createRpcEventSubscription<number>(
					undefined,
					'thing',
					'save-last',
					buffered => emitter.event(buffered),
					undefined,
					tracker,
				),
				connect: (): Promise<void> => {
					tracker.releaseAllExcept(tracker.callerSession);
					return Promise.resolve();
				},
			};
			const host = new RpcHost(mockWebview, services, { shouldServeSession: () => !healthy }, tracker);
			const connection = new Connection(clientEndpoint, { nestedProxies: true });
			try {
				// App-side retained subscription — supertalk replays this on EVERY handshake.
				subscribe<ThingService>(connection, async remote => {
					return await remote.onThing(n => received.push(n));
				});

				let remote = await remount<ThingService>(connection);
				await settle();
				await remote.connect(); // simulates connect() validating this session — nothing stale yet
				emitter.fire(1);
				await settle();
				assert.deepStrictEqual(received, [1]);
				healthy = true; // session validated — the next announcement is ignored, not served

				// Element remount: same Connection, reset + re-handshake. Supertalk replays and mints
				// a NEW caller session.
				remote = await remount<ThingService>(connection);
				await settle();
				await remote.connect(); // simulates connect() validating the remount — releases the old session's debris
				emitter.fire(2);
				await settle();
				assert.deepStrictEqual(received, [1, 2], 'exactly-once delivery across the remount');
				assert.strictEqual(tracker.size, 1, 'the superseded registration must not linger in the tracker');
			} finally {
				host.dispose();
				emitter.dispose();
				connection.close();
			}
		});

		test('a same-connection remount keeps event delivery exactly-once via createRpcEvent', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const evt = createRpcEvent<number>('thing', 'save-last');
			const received: number[] = [];

			let healthy = false;
			const services = {
				onThing: evt.subscribe(undefined, tracker),
				connect: (): Promise<void> => {
					tracker.releaseAllExcept(tracker.callerSession);
					return Promise.resolve();
				},
			};
			const host = new RpcHost(mockWebview, services, { shouldServeSession: () => !healthy }, tracker);
			const connection = new Connection(clientEndpoint, { nestedProxies: true });
			try {
				subscribe<ThingService>(connection, async remote => {
					return await remote.onThing(n => received.push(n));
				});

				let remote = await remount<ThingService>(connection);
				await settle();
				await remote.connect(); // simulates connect() validating this session — nothing stale yet
				evt.fire(1);
				await settle();
				assert.deepStrictEqual(received, [1]);
				healthy = true;

				remote = await remount<ThingService>(connection);
				await settle();
				await remote.connect(); // simulates connect() validating the remount — releases the old session's debris
				evt.fire(2);
				await settle();
				assert.deepStrictEqual(received, [1, 2], 'exactly-once delivery across the remount');
				assert.strictEqual(tracker.size, 1, 'the superseded registration must not linger in the tracker');
			} finally {
				host.dispose();
				connection.close();
			}
		});

		test('a same-connection remount keeps a custom parameterized event delivery exactly-once via trackRpcRegistration', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const registrations = new Set<EventRegistration>();
			const emitter = new Emitter<{ id: string; n: number }>();
			const received: number[] = [];
			const disposeSpy = sinon.spy();

			// Shaped like repository.ts's custom sites: parameterized, attaches a Disposable source,
			// tracks via trackRpcRegistration instead of a bare tracker.track().
			function onThing(id: string, cb: (n: number) => void): Unsubscribe {
				return trackRpcRegistration(registrations, tracker, () => {
					const disposable = emitter.event(e => {
						if (e.id === id) {
							cb(e.n);
						}
					});
					return () => {
						disposeSpy();
						disposable.dispose();
					};
				});
			}

			type CustomThingService = {
				onThing(id: string, cb: (n: number) => void): Promise<() => void>;
				connect(): Promise<void>;
			};

			let healthy = false;
			const services = {
				onThing: onThing,
				connect: (): Promise<void> => {
					tracker.releaseAllExcept(tracker.callerSession);
					return Promise.resolve();
				},
			};
			const host = new RpcHost(mockWebview, services, { shouldServeSession: () => !healthy }, tracker);
			const connection = new Connection(clientEndpoint, { nestedProxies: true });
			try {
				subscribe<CustomThingService>(connection, async remote => {
					return await remote.onThing('a', n => received.push(n));
				});

				let remote = await remount<CustomThingService>(connection);
				await settle();
				await remote.connect(); // simulates connect() validating this session — nothing stale yet
				emitter.fire({ id: 'a', n: 1 });
				await settle();
				assert.deepStrictEqual(received, [1]);
				healthy = true; // session validated — the next announcement is ignored, not served

				// Element remount: same Connection, reset + re-handshake. Supertalk replays and mints
				// a NEW caller session.
				remote = await remount<CustomThingService>(connection);
				await settle();
				await remote.connect(); // simulates connect() validating the remount — releases the old session's debris
				emitter.fire({ id: 'a', n: 2 });
				await settle();
				assert.deepStrictEqual(received, [1, 2], 'exactly-once delivery across the remount');
				assert.strictEqual(disposeSpy.callCount, 1, 'the source disposable was disposed exactly once');
				assert.strictEqual(tracker.size, 1, 'the superseded registration must not linger in the tracker');
			} finally {
				host.dispose();
				emitter.dispose();
				connection.close();
			}
		});

		test('two same-generation registrations for different parameters both stay live', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const registrations = new Set<EventRegistration>();
			const emitter = new Emitter<{ id: string; n: number }>();
			const receivedA: number[] = [];
			const receivedB: number[] = [];

			function onThing(id: string, cb: (n: number) => void): Unsubscribe {
				return trackRpcRegistration(registrations, tracker, () => {
					const disposable = emitter.event(e => {
						if (e.id === id) {
							cb(e.n);
						}
					});
					return () => {
						disposable.dispose();
					};
				});
			}

			const services = { onThing: onThing };
			const host = new RpcHost(mockWebview, services, undefined, tracker);
			const { services: remote, connection } = await connectClient<{
				onThing(id: string, cb: (n: number) => void): Promise<() => void>;
			}>(clientEndpoint);
			try {
				// Two concurrent same-generation subscribers, different parameters, no remount between them.
				await remote.onThing('a', n => receivedA.push(n));
				await remote.onThing('b', n => receivedB.push(n));

				emitter.fire({ id: 'a', n: 1 });
				emitter.fire({ id: 'b', n: 2 });
				await settle();

				assert.deepStrictEqual(receivedA, [1], 'param "a" registration stays live');
				assert.deepStrictEqual(receivedB, [2], 'param "b" registration stays live');
				assert.strictEqual(tracker.size, 2, 'both same-generation registrations remain tracked');
			} finally {
				host.dispose();
				emitter.dispose();
				connection.close();
			}
		});
	});

	suite('Timeout Diagnostic', () => {
		test('should clear the 30s connect timer when a client session announces', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const services = { ping: () => 'pong' };

			const host = new RpcHost(mockWebview, services);
			try {
				assert.notStrictEqual(
					(host as unknown as { _connectTimer?: ReturnType<typeof setTimeout> })._connectTimer,
					undefined,
					'expected connect timer to be scheduled before the client session',
				);

				const { connection } = await connectClient(clientEndpoint);

				assert.strictEqual(
					(host as unknown as { _connectTimer?: ReturnType<typeof setTimeout> })._connectTimer,
					undefined,
					'expected connect timer to be cleared after the client session announced',
				);

				connection.close();
			} finally {
				host.dispose();
			}
		});
	});

	suite('Dispose', () => {
		test('should dispose cleanly without a prior client session', () => {
			const { mockWebview } = createMockBridge();
			const services = { ping: () => 'pong' };

			const host = new RpcHost(mockWebview, services);
			// Should not throw
			host.dispose();
		});

		test('should dispose tracked subscriptions on dispose()', () => {
			const { mockWebview } = createMockBridge();
			const tracker = new SubscriptionTracker();
			const disposeSpy = sinon.spy();
			tracker.track(disposeSpy);

			const services = { ping: () => 'pong' };
			const host = new RpcHost(mockWebview, services, undefined, tracker);

			host.dispose();
			assert.strictEqual(disposeSpy.callCount, 1, 'should dispose tracked subscriptions');
		});
	});
});
