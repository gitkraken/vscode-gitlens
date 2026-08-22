/**
 * Reconnect coverage for the webview client's long-lived RPC connection.
 *
 * The app-side `Connection` is built once and reused across element remounts, so every mount runs
 * `connectRpcSession()` — `reset()` then `waitForReady()` — on the SAME instance. That is what makes
 * supertalk's `subscribe()` resubscription engage, and it puts three things at risk that a
 * thrown-away connection never exercised:
 *
 * 1. The client's `SignalHandler` instance now spans sessions (reset clears its registries).
 * 2. The client's `SequencedChannel` instances now span sessions (reset cycles their generations).
 * 3. An aborted handshake must not leave `waitForReady()`'s pending entry unsettled — the reset
 *    before each `waitForReady()` is what settles it.
 *
 * The host side is unchanged: it still closes its Connection and builds a fresh one per `expose()`,
 * which these tests mirror.
 */
import * as assert from 'assert';
import { MessageChannel } from 'node:worker_threads';
import type { Endpoint, Handler, Options, Remote } from '@eamodio/supertalk';
import { Connection, ConnectionClosedError, subscribe } from '@eamodio/supertalk';
import { SequencedChannel } from '@eamodio/supertalk-core/handlers/channel.js';
import { SignalHandler } from '@eamodio/supertalk-signals';
import { Signal } from 'signal-polyfill';
import { GlAbortSignalHandler } from '../../../system/rpc/abortSignalHandler.js';
import { rpcHandlers } from '../../../system/rpc/handlers.js';
import { connectRpcSession } from '../../apps/shared/rpc/session.js';

const logPrefix = 'RpcClient(test)';

/** Node's MessagePort is an EventTarget, so it satisfies Supertalk's Endpoint directly. */
function asEndpoint(port: import('node:worker_threads').MessagePort): Endpoint {
	return port as unknown as Endpoint;
}

/** Lets queued MessagePort deliveries drain. */
function flush(ms = 10): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

interface Peers {
	/** The client's long-lived connection — never closed between sessions. */
	readonly client: Connection;
	/** The client's long-lived SignalHandler — the instance under test across resets. */
	readonly clientSignals: SignalHandler;
	/** Mirrors `RpcHost.expose()`: first call exposes, later calls close and rebuild first. */
	exposeHost(): void;
	dispose(): void;
}

interface CreatePeersOptions {
	/** Extra client handlers, held for the client's lifetime (e.g. the Graph's rows channel). */
	clientHandlers?: Handler[];
	/** Extra host handlers, held across host reconnects — `RpcHost` reuses these instances. */
	hostHandlers?: Handler[];
	/** Matches `RpcClientOptions.autoWatchSignals` / `RpcHostOptions.autoWatchSignals`. */
	autoWatchSignals?: boolean;
}

/**
 * Builds a client/host pair over one MessageChannel, wired the way production is: the client keeps
 * one endpoint, one handler set, and one Connection; the host rebuilds its Connection (and its
 * SignalHandler) per expose, on the same endpoint.
 */
function createPeers(services: object, options?: CreatePeersOptions): Peers {
	const { port1, port2 } = new MessageChannel();

	const buildOptions = (handlers: Handler[]): Options => ({
		handlers: handlers,
		nestedProxies: true,
		batching: true,
	});

	const clientSignals = new SignalHandler({ autoWatch: options?.autoWatchSignals });
	const client = new Connection(
		asEndpoint(port2),
		buildOptions([...rpcHandlers, clientSignals, new GlAbortSignalHandler(), ...(options?.clientHandlers ?? [])]),
	);

	let host: Connection | undefined;

	return {
		client: client,
		clientSignals: clientSignals,
		exposeHost: function (): void {
			// `RpcHost.expose()` on reconnect: close the old connection, then build a fresh one with a
			// fresh SignalHandler but the caller's own handler instances.
			host?.close();
			host = new Connection(
				asEndpoint(port1),
				buildOptions([
					...rpcHandlers,
					new SignalHandler({ autoWatch: options?.autoWatchSignals }),
					new GlAbortSignalHandler(),
					...(options?.hostHandlers ?? []),
				]),
			);
			host.expose(services);
		},
		dispose: function (): void {
			client.close();
			host?.close();
			port1.close();
			port2.close();
		},
	};
}

/**
 * One mount: start the session, then let the host expose — the same order the webview produces,
 * since `connectRpcSession` registers the handshake synchronously before its first await and the
 * host only exposes once `WebviewReadyRequest` arrives.
 */
function mount<TServices extends object>(peers: Peers, signal?: AbortSignal): Promise<Remote<TServices>> {
	const session = connectRpcSession<TServices>(peers.client, { logPrefix: logPrefix, signal: signal });
	peers.exposeHost();
	return session;
}

interface EchoService {
	echo(value: string): string;
}

const echoService: EchoService = { echo: (value: string) => value };

suite('RPC Client Session Test Suite', () => {
	suite('subscribe() resubscription — the reason the connection is long-lived', () => {
		test('a subscription anchored on the connection re-runs on every handshake', async () => {
			interface EventService {
				onPing(cb: (value: string) => void): () => void;
			}

			const listeners = new Set<(value: string) => void>();
			const peers = createPeers({
				onPing: (cb: (value: string) => void) => {
					listeners.add(cb);
					return () => listeners.delete(cb);
				},
			} satisfies EventService);
			try {
				const received: string[] = [];
				let subscriberRuns = 0;
				const subscription = subscribe<EventService>(peers.client, remote => {
					subscriberRuns++;
					return remote.onPing(value => received.push(value));
				});

				await mount<EventService>(peers);
				await subscription.ready;
				assert.strictEqual(subscriberRuns, 1);
				for (const cb of listeners) {
					cb('first');
				}
				await flush();
				assert.deepStrictEqual(received, ['first']);

				// Remount. Nothing in the app re-subscribes — the library must do it.
				peers.client.reset();
				listeners.clear();
				await mount<EventService>(peers);
				await subscription.ready;
				await flush();

				assert.strictEqual(subscriberRuns, 2, 'the subscriber must re-run on the second handshake');
				assert.strictEqual(listeners.size, 1, 'the resubscribe must register a fresh host-side listener');
				for (const cb of listeners) {
					cb('second');
				}
				await flush();
				assert.deepStrictEqual(received, ['first', 'second']);

				subscription.unsubscribe();
			} finally {
				peers.dispose();
			}
		});

		test('the cached services proxy is not a legal subscribe() anchor', async () => {
			const peers = createPeers(echoService);
			try {
				const services = await mount<EchoService>(peers);
				// `connectRpcSession` wraps the root in `cacheRemoteServices`, so the wrapper is not the
				// proxy supertalk recorded as a handshake root — callers must anchor on the Connection.
				// supertalk reports an invalid target on `ready` rather than throwing from the call.
				const subscription = subscribe<EchoService>(services, () => undefined);
				await assert.rejects(subscription.ready, (ex: Error) => ex instanceof TypeError);
			} finally {
				peers.dispose();
			}
		});
	});

	suite('abort mid-handshake', () => {
		test('an aborted attempt settles and the next attempt still connects', async () => {
			const peers = createPeers(echoService);
			try {
				const abort1 = new AbortController();
				let firstOutcome: 'pending' | 'resolved' | 'rejected' = 'pending';
				let firstError: unknown;
				const first = connectRpcSession<EchoService>(peers.client, {
					logPrefix: logPrefix,
					signal: abort1.signal,
				});
				void first.then(
					() => (firstOutcome = 'resolved'),
					(ex: unknown) => {
						firstOutcome = 'rejected';
						firstError = ex;
					},
				);

				// Unmount before the host ever exposes — the handshake is still pending.
				abort1.abort(new DOMException('rpc reconnect: host reconnected', 'AbortError'));
				peers.client.reset();

				// Remount: a fresh session on the same connection, then the host's re-expose.
				const services = await mount<EchoService>(peers, new AbortController().signal);
				assert.strictEqual(await services.echo('hello'), 'hello', 'the second attempt must connect');

				await flush();
				assert.strictEqual(firstOutcome, 'rejected', 'the aborted attempt must not stay pending');
				assert.strictEqual((firstError as Error | undefined)?.name, 'AbortError');
			} finally {
				peers.dispose();
			}
		});

		test('an already-aborted signal fails fast and leaves the connection usable', async () => {
			const peers = createPeers(echoService);
			try {
				const aborted = new AbortController();
				aborted.abort(new DOMException('rpc disconnect: host disconnected', 'AbortError'));

				await assert.rejects(
					connectRpcSession<EchoService>(peers.client, { logPrefix: logPrefix, signal: aborted.signal }),
					(ex: Error) => ex.name === 'AbortError',
				);

				const services = await mount<EchoService>(peers);
				assert.strictEqual(await services.echo('hi'), 'hi');
			} finally {
				peers.dispose();
			}
		});

		test('in-flight calls from the previous session reject with a reset ConnectionClosedError', async () => {
			interface StallService extends EchoService {
				stall(): Promise<string>;
			}

			let release: (() => void) | undefined;
			const peers = createPeers({
				echo: (value: string) => value,
				stall: () =>
					new Promise<string>(resolve => {
						release = () => resolve('late');
					}),
			} satisfies StallService);
			try {
				const services = await mount<StallService>(peers);

				const stalled = services.stall();
				await flush();
				assert.ok(release != null, 'the host call must be in flight');

				// Unmount: `RpcClient.stop()` re-arms the connection instead of closing it.
				peers.client.reset();

				await assert.rejects(stalled, (ex: unknown) => {
					assert.ok(ex instanceof ConnectionClosedError, `expected ConnectionClosedError, got ${String(ex)}`);
					assert.strictEqual(ex.reason, 'reset', 'the reason must name the reset, not a close');
					return true;
				});
			} finally {
				peers.dispose();
			}
		});
	});

	suite('SignalHandler across reset', () => {
		test('a bridged signal re-delivers on the reused handler after reset and re-handshake', async () => {
			interface CountService {
				count: Signal.State<number>;
			}

			const count = new Signal.State(0);
			const peers = createPeers(
				{
					get count() {
						return count;
					},
				} satisfies CountService,
				{ autoWatchSignals: true },
			);
			try {
				const session1 = await mount<CountService>(peers);

				const remote1 = (await session1.count) as unknown as { get(): number };
				assert.strictEqual(remote1.get(), 0);

				count.set(5);
				await flush();
				assert.strictEqual(remote1.get(), 5, 'updates must flow in the first session');

				// Remount on the SAME connection and the SAME client SignalHandler.
				const signalsBefore = peers.clientSignals;
				peers.client.reset();
				const session2 = await mount<CountService>(peers);
				assert.strictEqual(peers.clientSignals, signalsBefore, 'the handler instance must be reused');

				const remote2 = (await session2.count) as unknown as { get(): number };
				assert.strictEqual(remote2.get(), 5, 'the re-bridged signal must carry the current value');

				count.set(11);
				await flush();
				assert.strictEqual(remote2.get(), 11, 'updates must flow again after reset');
				assert.strictEqual(remote1.get(), 5, 'the pre-reset RemoteSignal must be inert');
			} finally {
				peers.dispose();
			}
		});

		test('lazy watching re-arms after reset — a post-reset observer still gets updates', async () => {
			interface CountService {
				count: Signal.State<number>;
			}

			const count = new Signal.State(0);
			const peers = createPeers({
				get count() {
					return count;
				},
			} satisfies CountService);
			try {
				const session1 = await mount<CountService>(peers);
				await session1.count;

				peers.client.reset();
				const session2 = await mount<CountService>(peers);

				const remote = (await session2.count) as unknown as { get(): number };

				// Production default is lazy watching: the host only starts watching once something on the
				// client observes the RemoteSignal. That watch message rides the handler's post-reset ctx.
				const observed = new Signal.Computed(() => remote.get());
				const watcher = new Signal.subtle.Watcher(() => {
					watcher.watch();
				});
				watcher.watch(observed);
				observed.get();
				await flush();

				count.set(7);
				await flush();
				assert.strictEqual(remote.get(), 7, 'a lazily-watched signal must update after reset');

				watcher.unwatch(observed);
			} finally {
				peers.dispose();
			}
		});
	});

	suite('SequencedChannel across reset', () => {
		test('the reused channel adopts the post-reset generation without reporting a gap', async () => {
			const clientChannel = new SequencedChannel<string>('test:rows', { replay: 0 });
			const hostChannel = new SequencedChannel<string>('test:rows', { replay: 0 });

			const received: string[] = [];
			const generations: number[] = [];
			const gaps: unknown[] = [];
			clientChannel.subscribe((value, meta) => {
				received.push(value);
				generations.push(meta.generation);
			});
			clientChannel.onGap(gap => gaps.push(gap));

			const peers = createPeers(echoService, {
				clientHandlers: [clientChannel],
				hostHandlers: [hostChannel],
			});
			try {
				await mount<EchoService>(peers);

				hostChannel.send('a');
				hostChannel.send('b');
				await flush();
				assert.deepStrictEqual(received, ['a', 'b']);
				const firstGeneration = generations[0];

				// Remount: the client resets (channel disconnect + connect) and the host rebuilds its
				// Connection, which cycles the SAME host channel instance onto a fresh generation.
				peers.client.reset();
				await mount<EchoService>(peers);

				hostChannel.send('c');
				await flush();

				assert.deepStrictEqual(received, ['a', 'b', 'c'], 'the first post-reset send must be delivered');
				assert.notStrictEqual(
					generations[2],
					firstGeneration,
					'the post-reset send must carry a fresh generation',
				);
				assert.deepStrictEqual(gaps, [], 'adopting a fresh generation must not look like a gap');
				assert.strictEqual(clientChannel.gapped, false);
			} finally {
				peers.dispose();
			}
		});

		test('a send while unmounted does not strand the next session', async () => {
			const clientChannel = new SequencedChannel<string>('test:rows', { replay: 0 });
			const hostChannel = new SequencedChannel<string>('test:rows', { replay: 0 });

			const received: string[] = [];
			clientChannel.subscribe(value => received.push(value));

			const peers = createPeers(echoService, {
				clientHandlers: [clientChannel],
				hostHandlers: [hostChannel],
			});
			try {
				await mount<EchoService>(peers);
				hostChannel.send('a');
				await flush();

				// Unmount. The host's connection is still up here, so this send goes out on the old
				// generation and lands on a client that has already cleared its inbound state.
				peers.client.reset();
				hostChannel.send('stale');
				await flush();

				await mount<EchoService>(peers);
				hostChannel.send('b');
				await flush();

				assert.strictEqual(received.at(-1), 'b', 'the next session must deliver normally');
				assert.strictEqual(clientChannel.gapped, false, 'the channel must not be stuck waiting on recovery');
			} finally {
				peers.dispose();
			}
		});
	});
});
