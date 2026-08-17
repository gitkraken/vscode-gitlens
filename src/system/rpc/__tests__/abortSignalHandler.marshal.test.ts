import * as assert from 'assert';
import type { Endpoint } from '@eamodio/supertalk-core';
import { Connection, proxy } from '@eamodio/supertalk-core';
import { GlAbortSignalHandler } from '../abortSignalHandler.js';

/** An in-memory Endpoint pair — what postMessage'd across one side arrives on the other, async
 *  (queueMicrotask) like a real channel. */
function createEndpointPair(): [Endpoint, Endpoint] {
	const listeners = [new Set<(e: MessageEvent) => void>(), new Set<(e: MessageEvent) => void>()] as const;

	function make(self: 0 | 1): Endpoint {
		const other = self === 0 ? 1 : 0;
		return {
			postMessage: (message: unknown) => {
				queueMicrotask(() => {
					for (const listener of listeners[other]) {
						listener({ data: message } as MessageEvent);
					}
				});
			},
			addEventListener: (_type, listener) => listeners[self].add(listener),
			removeEventListener: (_type, listener) => listeners[self].delete(listener),
		};
	}

	return [make(0), make(1)];
}

interface TestService {
	slowOp(arg: string, signal: AbortSignal): Promise<string>;
}

/** End-to-end proof that an `AbortSignal` argument marshals across a Connection pair and that an
 *  abort fired AFTER the call is already in flight reaches the exposed service's signal — the exact
 *  contract the graph search plane's supersede/pause design rests on. */
suite('GlAbortSignalHandler marshaling Test Suite', () => {
	async function createPair(): Promise<{
		remote: TestService;
		received: { signal?: AbortSignal };
		dispose: () => void;
	}> {
		const [clientEndpoint, hostEndpoint] = createEndpointPair();

		const received: { signal?: AbortSignal } = {};
		const service: TestService = {
			slowOp: (_arg: string, signal: AbortSignal) => {
				received.signal = signal;
				return new Promise<string>(resolve => {
					if (signal.aborted) {
						resolve('aborted-before-start');
						return;
					}

					signal.addEventListener('abort', () => resolve('aborted'), { once: true });
				});
			},
		};

		const hostConnection = new Connection(hostEndpoint, { handlers: [new GlAbortSignalHandler()] });
		const clientConnection = new Connection(clientEndpoint, { handlers: [new GlAbortSignalHandler()] });

		const ready = clientConnection.waitForReady();
		hostConnection.expose(service);
		const remote = (await ready) as TestService;

		return {
			remote: remote,
			received: received,
			dispose: () => {
				clientConnection.close();
				hostConnection.close();
			},
		};
	}

	test('an abort fired after the call is in flight reaches the service-side signal', async () => {
		const { remote, received, dispose } = await createPair();
		try {
			const controller = new AbortController();
			const call = remote.slowOp('work', controller.signal);

			// Let the call marshal and start on the host
			await new Promise<void>(resolve => setTimeout(resolve, 10));
			assert.ok(received.signal != null, 'the service should have received a marshaled AbortSignal');
			assert.strictEqual(received.signal.aborted, false, 'not aborted yet');

			controller.abort();

			const result = await call;
			assert.strictEqual(result, 'aborted', 'the abort must reach the service and resolve the call');
			assert.strictEqual(received.signal.aborted, true, 'the marshaled signal must be aborted');
		} finally {
			dispose();
		}
	});

	test('an already-aborted signal arrives aborted', async () => {
		const { remote, dispose } = await createPair();
		try {
			const controller = new AbortController();
			controller.abort();

			const result = await remote.slowOp('work', controller.signal);
			assert.strictEqual(result, 'aborted-before-start');
		} finally {
			dispose();
		}
	});

	// The graph webview's services are NESTED supertalk proxies (`proxyServices` wraps each service in
	// `proxy()` on a root object), so its calls take the nested-proxy marshaling path, not the root
	// path the tests above exercise. This mirrors the production wiring exactly: nestedProxies +
	// batching on both connections, the service reached through a proxied property.
	test('an in-flight abort reaches a service called through a nested proxy (the graph wiring)', async () => {
		const [clientEndpoint, hostEndpoint] = createEndpointPair();

		const received: { signal?: AbortSignal } = {};
		const service: TestService = {
			slowOp: (_arg: string, signal: AbortSignal) => {
				received.signal = signal;
				return new Promise<string>(resolve => {
					if (signal.aborted) {
						resolve('aborted-before-start');
						return;
					}

					signal.addEventListener('abort', () => resolve('aborted'), { once: true });
				});
			},
		};

		const hostConnection = new Connection(hostEndpoint, {
			handlers: [new GlAbortSignalHandler()],
			nestedProxies: true,
			batching: true,
		});
		const clientConnection = new Connection(clientEndpoint, {
			handlers: [new GlAbortSignalHandler()],
			nestedProxies: true,
			batching: true,
		});

		try {
			const ready = clientConnection.waitForReady();
			hostConnection.expose({ search: proxy(service) });
			const root = (await ready) as { search: Promise<TestService> };
			// Production resolves the nested proxy the same way: `const search = await services.search;`
			const search = await root.search;

			const controller = new AbortController();
			const call = search.slowOp('work', controller.signal);

			await new Promise<void>(resolve => setTimeout(resolve, 10));
			assert.ok(received.signal != null, 'the nested-proxy call should deliver a marshaled AbortSignal');
			assert.strictEqual(received.signal.aborted, false, 'not aborted yet');

			controller.abort();

			const result = await call;
			assert.strictEqual(result, 'aborted', 'the abort must reach the nested-proxy service');
			assert.strictEqual(received.signal.aborted, true, 'the marshaled signal must be aborted');
		} finally {
			clientConnection.close();
			hostConnection.close();
		}
	});
});
