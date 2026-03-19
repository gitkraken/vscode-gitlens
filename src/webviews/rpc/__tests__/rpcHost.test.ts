import * as assert from 'assert';
import type { Endpoint, Remote } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import * as sinon from 'sinon';
import type { Disposable, Event, Webview } from 'vscode';
import { decodeRpcPayload, encodeRpcPayload, isRpcMessage, RPC_NAMESPACE } from '../constants.js';
import { SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { RpcHost } from '../rpcHost.js';

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
					// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
					const event = { data: payload } as MessageEvent;
					for (const listener of clientListeners) {
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
				for (const listener of webviewListeners) {
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
 * Simulates the webview side: creates a Connection, calls expose() via
 * the deferred handshake, and returns the resolved services.
 */
async function connectClient<T extends object>(
	clientEndpoint: Endpoint,
	rpcHost: RpcHost<T>,
): Promise<{ services: Remote<T>; connection: Connection }> {
	const connection = new Connection(clientEndpoint, { nestedProxies: true });

	// Simulate the handshake: expose() on the host side
	rpcHost.expose();

	// Wait for the host's expose() ready signal
	const services = (await connection.waitForReady()) as Remote<T>;
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
				const { services: remote, connection } = await connectClient(clientEndpoint, host);

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
				const { services: remote, connection } = await connectClient(clientEndpoint, host);

				const git = await remote.git;
				// eslint-disable-next-line @typescript-eslint/await-thenable -- RPC proxy wraps all calls as promises at runtime despite sync static types
				const commit = await git.getCommit('abc123');
				assert.deepStrictEqual(commit, { sha: 'abc123', message: 'Commit abc123' });

				const config = await remote.config;
				// eslint-disable-next-line @typescript-eslint/await-thenable -- RPC proxy wraps all calls as promises at runtime despite sync static types
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
				const { services: remote, connection } = await connectClient(clientEndpoint, host);

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
				const { services: remote, connection } = await connectClient(clientEndpoint, host);

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
		test('should support reconnection via second expose() call', async () => {
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
				const first = await connectClient(clientEndpoint, host);
				const result1 = await first.services.ping();
				assert.strictEqual(result1, 'pong-1');
				first.connection.close();

				// Second connection (simulates webview refresh)
				const second = await connectClient(clientEndpoint, host);
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
				// First expose
				const first = await connectClient(clientEndpoint, host);
				first.connection.close();

				assert.strictEqual(disposeSpy.callCount, 0, 'should not dispose on first expose');

				// Second expose (reconnection) should dispose tracked subscriptions
				const second = await connectClient(clientEndpoint, host);
				assert.strictEqual(disposeSpy.callCount, 1, 'should dispose on reconnection');

				second.connection.close();
			} finally {
				host.dispose();
			}
		});
	});

	suite('Timeout Diagnostic', () => {
		test('should clear the 30s connect timer when expose() is called', async () => {
			const { mockWebview, clientEndpoint } = createMockBridge();
			const services = { ping: () => 'pong' };

			const host = new RpcHost(mockWebview, services);
			try {
				assert.notStrictEqual(
					(host as unknown as { _connectTimer?: ReturnType<typeof setTimeout> })._connectTimer,
					undefined,
					'expected connect timer to be scheduled before expose()',
				);

				const { connection } = await connectClient(clientEndpoint, host);

				assert.strictEqual(
					(host as unknown as { _connectTimer?: ReturnType<typeof setTimeout> })._connectTimer,
					undefined,
					'expected connect timer to be cleared after expose()',
				);

				connection.close();
			} finally {
				host.dispose();
			}
		});
	});

	suite('Dispose', () => {
		test('should dispose cleanly without prior expose()', () => {
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
