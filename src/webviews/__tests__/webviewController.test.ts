import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Disposable, Webview, WebviewView } from 'vscode';
import { EventEmitter } from 'vscode';
// Side-effect only: forces `container.ts` (and everything it pulls in, including every
// `@command()`-decorated command class) to finish loading BEFORE `webviewController.ts` below
// does its own real import of `system/-webview/command.js`. Without this, that module's first
// load is re-entered — via container.ts's dependency chain — before its own `registrableCommands`
// array is initialized, and the `@command()` decorator on `commands/copyShaToClipboard.ts` (a
// transitive dependency of webviewController.ts through annotations/commitFormatter) crashes.
// This ordering landmine is pre-existing and unrelated to RPC; it was never hit because no
// earlier test imported `webviewController.ts`.
import '../../container.js';
import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../rpc/eventVisibilityBuffer.js';
import { createRpcEventSubscription } from '../rpc/eventVisibilityBuffer.js';
import type { WebviewClientConnectParams } from '../rpc/webviewViewService.js';
import type { WebviewCommandRegistrar } from '../webviewCommandRegistrar.js';
import { WebviewController } from '../webviewController.js';
import type { WebviewViewDescriptor } from '../webviewDescriptors.js';
import type { WebviewProvider } from '../webviewProvider.js';

// ============================================================
// Test Helpers
// ============================================================

/**
 * Creates a bare mock Webview. No client ever connects over it in these tests — `connect()` and
 * the tracker are driven directly — so unlike `rpc/__tests__/rpcHost.test.ts`'s
 * `createMockBridge()` there is no RPC decode/encode side to simulate; `RpcHost` only needs a
 * `postMessage`/`onDidReceiveMessage` pair to construct successfully.
 */
function createMockWebview(): Webview {
	const webviewListeners = new Set<(message: unknown) => void>();

	const mockWebview: Pick<Webview, 'postMessage' | 'onDidReceiveMessage'> = {
		postMessage: function (): Thenable<boolean> {
			return Promise.resolve(true);
		},
		onDidReceiveMessage: function (listener: (message: unknown) => void): Disposable {
			webviewListeners.add(listener);
			return { dispose: () => webviewListeners.delete(listener) };
		},
	};

	return mockWebview as unknown as Webview;
}

function createFakeParent(webview: Webview): WebviewView {
	const onDidChangeVisibilityEmitter = new EventEmitter<void>();
	const onDidDisposeEmitter = new EventEmitter<void>();

	const parent = {
		webview: webview,
		visible: true,
		title: undefined as string | undefined,
		onDidChangeVisibility: onDidChangeVisibilityEmitter.event,
		onDidDispose: onDidDisposeEmitter.event,
	};

	return parent as unknown as WebviewView;
}

const testDescriptor: WebviewViewDescriptor<'gitlens.views.commitDetails'> = {
	id: 'gitlens.views.commitDetails',
	fileName: 'commitDetails.html',
	title: 'Inspect',
	contextKeyPrefix: 'gitlens:webviewView:commitDetails',
	trackingFeature: 'commitDetailsView',
	type: 'commitDetails',
	plusFeature: false,
};

function createTestProvider(
	getRpcServices: (buffer: EventVisibilityBuffer | undefined, tracker: SubscriptionTracker | undefined) => object,
): WebviewProvider<unknown> {
	return {
		dispose: function (): void {},
		getTelemetryContext: function (): Record<`context.${string}`, string | number | boolean | undefined> &
			WebviewTelemetryContext {
			return {
				'context.webview.id': testDescriptor.id,
				'context.webview.type': testDescriptor.type,
				'context.webview.instanceId': 'test-instance',
				'context.webview.host': 'view',
			};
		},
		getRpcServices: getRpcServices,
	};
}

/**
 * Builds a real `WebviewController` through the same `create()` entry point production uses.
 * `container`/`commandRegistrar` are narrow stubs — neither collaborator is touched on the
 * `connect()` path (container.telemetry.enabled is read by `dispose()`'s telemetry event, which
 * these tests trigger via cleanup).
 */
async function createTestController(
	getRpcServices: (buffer: EventVisibilityBuffer | undefined, tracker: SubscriptionTracker | undefined) => object,
): Promise<WebviewController<'gitlens.views.commitDetails', unknown>> {
	const container = { telemetry: { enabled: false } } as unknown as Container;
	const commandRegistrar = {} as unknown as WebviewCommandRegistrar;
	const parent = createFakeParent(createMockWebview());
	const provider = createTestProvider(getRpcServices);

	return WebviewController.create(
		container,
		commandRegistrar,
		testDescriptor,
		'test-instance',
		parent,
		async () => provider,
	);
}

function connectParams(clientId: string, clientLoadedAt: number): WebviewClientConnectParams {
	return { clientId: clientId, clientLoadedAt: clientLoadedAt };
}

/**
 * Simulates `RpcHost.onClientSession` having just served an announcement — `connect()`'s identity
 * gate rejects unconditionally while `_sessionState` is `none` (see `WebviewController.connect()`),
 * and nothing in this bare-webview harness (no real client ever announces — see `createMockWebview`)
 * drives that transition otherwise. Every test whose first `connect()` call is meant to validate
 * must call this first; a test specifically about the `none`-always-rejects gate must NOT.
 */
function markServed(controller: WebviewController<'gitlens.views.commitDetails', unknown>): void {
	(controller as unknown as { _sessionState: 'none' | 'served-awaiting-validation' | 'healthy' })._sessionState =
		'served-awaiting-validation';
}

// ============================================================
// Tests
// ============================================================

suite('WebviewController Validation Test Suite', () => {
	suite("connect() releases sessions it doesn't own", () => {
		test('validation releases every other session', async () => {
			const disposeSpy = sinon.spy();
			const emitter = new EventEmitter<number>();
			let onThing: ((handler: (data: number) => void) => unknown) | undefined;
			let tracker: SubscriptionTracker | undefined;

			const controller = await createTestController((buffer, t) => {
				tracker = t;
				onThing = createRpcEventSubscription<number>(
					buffer,
					'thing',
					'save-last',
					bufferedHandler => {
						const inner = emitter.event(bufferedHandler);
						return {
							dispose: () => {
								disposeSpy();
								inner.dispose();
							},
						};
					},
					undefined,
					t,
				);
				return { onThing: onThing };
			});
			try {
				assert.ok(tracker, 'expected the controller to hand getRpcServices a tracker');
				assert.ok(onThing, 'expected getRpcServices to have run');

				// First registration and connect() both land with no client session attributed yet
				// (the real `RpcHost` created by `createTestController` never has a client announce
				// on it — see `createMockWebview` — so its bound resolver always reports `undefined`).
				onThing(() => {});
				assert.strictEqual(tracker.size, 1);

				markServed(controller);
				await controller.connect(connectParams('client-a', 1000));
				assert.strictEqual(disposeSpy.callCount, 0, 'nothing stale yet at the first validation');

				// A same-connection remount: a NEW caller session (`reset()` mints one), same clientId.
				// `connect()` is already healthy, so this bypasses the served-session gate on identity
				// and is accepted via the clientId match instead — exactly like production.
				tracker.bindCallerSession(() => 7);
				onThing(() => {});
				assert.strictEqual(tracker.size, 2, 'both sessions are live until validation');
				assert.strictEqual(disposeSpy.callCount, 0, 'nothing released before validation');

				await controller.connect(connectParams('client-a', 1000));

				assert.strictEqual(
					disposeSpy.callCount,
					1,
					"the superseded session's source disposable must be released",
				);
				assert.strictEqual(tracker.size, 1, 'only the validating session registration should remain tracked');
			} finally {
				controller.dispose();
				emitter.dispose();
			}
		});

		test('a rejected straggler connect releases only its own session, leaving the live client intact', async () => {
			const disposeSpy = sinon.spy();
			const emitter = new EventEmitter<number>();
			let onThing: ((handler: (data: number) => void) => unknown) | undefined;
			let tracker: SubscriptionTracker | undefined;

			const controller = await createTestController((buffer, t) => {
				tracker = t;
				onThing = createRpcEventSubscription<number>(
					buffer,
					'thing',
					'save-last',
					bufferedHandler => {
						const inner = emitter.event(bufferedHandler);
						return {
							dispose: () => {
								disposeSpy();
								inner.dispose();
							},
						};
					},
					undefined,
					t,
				);
				return { onThing: onThing };
			});
			try {
				assert.ok(tracker, 'expected the controller to hand getRpcServices a tracker');
				assert.ok(onThing, 'expected getRpcServices to have run');

				onThing(() => {});

				// Establish an active client identity.
				markServed(controller);
				await controller.connect(connectParams('client-a', 1000));
				assert.strictEqual(disposeSpy.callCount, 0, 'nothing stale yet at the first validation');

				// A second, still-live registration under a different session (e.g. a remount whose
				// own connect() hasn't landed yet).
				tracker.bindCallerSession(() => 7);
				onThing(() => {});
				assert.strictEqual(tracker.size, 2);

				// A straggler: a different clientId whose clientLoadedAt is <= the active one — the
				// superseded-generation guard in connect() must reject it before touching anything
				// except its OWN session's registrations (it has none here, so nothing changes).
				tracker.bindCallerSession(() => 99);
				await controller.connect(connectParams('client-b', 1000));

				assert.strictEqual(disposeSpy.callCount, 0, "the straggler's own (empty) session releases nothing");
				assert.strictEqual(tracker.size, 2, 'both live registrations must remain tracked');
				assert.strictEqual(
					tracker.isSessionReleased(99),
					true,
					"the straggler's session is still marked released",
				);
			} finally {
				controller.dispose();
				emitter.dispose();
			}
		});

		test('the first connect() on a fresh controller releases nothing and does not throw', async () => {
			const controller = await createTestController(() => ({}));
			try {
				markServed(controller);
				await assert.doesNotReject(async () => controller.connect(connectParams('client-a', Date.now())));
				assert.strictEqual(controller.ready, true);
			} finally {
				controller.dispose();
			}
		});

		test('a late connect() after invalidation is rejected even though its (undefined) session still matches', async () => {
			const controller = await createTestController(() => ({}));
			try {
				markServed(controller);
				await controller.connect(connectParams('client-a', Date.now()));
				assert.strictEqual(controller.ready, true, 'the served session validates normally');

				// dispose() invalidates: `_sessionState` returns to `none` and `RpcHost.pendingServedSession`
				// is cleared. A late connect() call — its caller session is still `undefined` in this
				// harness, which trivially "matches" a never-cleared `pendingServedSession` (also always
				// `undefined` here) — must still be rejected, because `none` rejects unconditionally
				// regardless of session match (see `connect()`'s identity gate).
				controller.dispose();
				await controller.connect(connectParams('client-a', Date.now()));

				assert.strictEqual(controller.ready, false, 'a late connect() after invalidation must not re-validate');
			} finally {
				controller.dispose();
			}
		});

		test('connect() from a session RpcHost never served is rejected, not accepted merely for arriving first', async () => {
			let tracker: SubscriptionTracker | undefined;
			const controller = await createTestController((_buffer, t) => {
				tracker = t;
				return {};
			});
			try {
				assert.ok(tracker, 'expected the controller to hand getRpcServices a tracker');

				// No real client ever announces on this controller's `RpcHost` (see `createMockWebview`),
				// so `RpcHost.pendingServedSession` stays `undefined` — nothing was ever actually served.
				// A caller session attributed here doesn't match that, so it must be rejected rather than
				// accepted merely for calling connect() first (this is what stops an interloper from
				// winning the very first handshake).
				tracker.bindCallerSession(() => 5);

				await controller.connect(connectParams('client-a', Date.now()));

				assert.strictEqual(controller.ready, false, 'an unvalidated session must not become the active client');
			} finally {
				controller.dispose();
			}
		});

		test("a provider's onReconnect must not see a not-yet-released interloper", async () => {
			const disposeSpy = sinon.spy();
			const emitter = new EventEmitter<number>();
			let onThing: ((handler: (data: number) => void) => unknown) | undefined;
			let tracker: SubscriptionTracker | undefined;

			// Drives the REAL `WebviewController.connect()` ordering — unlike the `RpcHost` test's mock
			// `connect()`, which releases directly inside itself and so can't catch a controller-level
			// ordering bug. Built manually (not via `createTestController`) so the provider can supply
			// `onReconnect`, mirroring a provider (e.g. AllowedSignersWebview) that reseeds
			// synchronously off a cached result on reconnect.
			const provider: WebviewProvider<unknown> = {
				dispose: function (): void {},
				getTelemetryContext: function (): Record<`context.${string}`, string | number | boolean | undefined> &
					WebviewTelemetryContext {
					return {
						'context.webview.id': testDescriptor.id,
						'context.webview.type': testDescriptor.type,
						'context.webview.instanceId': 'test-instance',
						'context.webview.host': 'view',
					};
				},
				getRpcServices: function (buffer, t) {
					tracker = t;
					onThing = createRpcEventSubscription<number>(
						buffer,
						'thing',
						'save-last',
						bufferedHandler => {
							const inner = emitter.event(bufferedHandler);
							return {
								dispose: () => {
									disposeSpy();
									inner.dispose();
								},
							};
						},
						undefined,
						t,
					);
					return { onThing: onThing };
				},
				onReady: function (): void {},
				onReconnect: function (): void {
					emitter.fire(42);
				},
			};

			const container = { telemetry: { enabled: false } } as unknown as Container;
			const commandRegistrar = {} as unknown as WebviewCommandRegistrar;
			const parent = createFakeParent(createMockWebview());
			const controller = await WebviewController.create(
				container,
				commandRegistrar,
				testDescriptor,
				'test-instance',
				parent,
				async () => provider,
			);
			try {
				assert.ok(tracker, 'expected the controller to hand getRpcServices a tracker');
				assert.ok(onThing, 'expected getRpcServices to have run');

				markServed(controller);
				await controller.connect(connectParams('client-a', 1000));

				// An interloper registers under a different session — it must be released by the NEXT
				// validation, BEFORE that validation's onReconnect callback fires.
				tracker.bindCallerSession(() => 7);
				const received: number[] = [];
				onThing(data => received.push(data));

				// The original session reconnects (same clientId → a genuine reconnect, not a
				// superseded generation) and supersedes the interloper.
				tracker.bindCallerSession(() => undefined);
				await controller.connect(connectParams('client-a', 1000));

				assert.strictEqual(
					disposeSpy.callCount,
					1,
					"the interloper's registration must be released by this connect()",
				);
				assert.deepStrictEqual(
					received,
					[],
					"the interloper must not receive the provider's synchronous onReconnect reseed",
				);
			} finally {
				controller.dispose();
				emitter.dispose();
			}
		});

		test('a late connect() from a released session with the SAME client identity cannot evict the live session', async () => {
			const disposeSpy = sinon.spy();
			const onReconnectSpy = sinon.spy();
			const emitter = new EventEmitter<number>();
			let onThing: ((handler: (data: number) => void) => unknown) | undefined;
			let tracker: SubscriptionTracker | undefined;

			// Built manually (not via `createTestController`) so the provider can supply `onReconnect`.
			const provider: WebviewProvider<unknown> = {
				dispose: function (): void {},
				getTelemetryContext: function (): Record<`context.${string}`, string | number | boolean | undefined> &
					WebviewTelemetryContext {
					return {
						'context.webview.id': testDescriptor.id,
						'context.webview.type': testDescriptor.type,
						'context.webview.instanceId': 'test-instance',
						'context.webview.host': 'view',
					};
				},
				getRpcServices: function (buffer, t) {
					tracker = t;
					onThing = createRpcEventSubscription<number>(
						buffer,
						'thing',
						'save-last',
						bufferedHandler => {
							const inner = emitter.event(bufferedHandler);
							return {
								dispose: () => {
									disposeSpy();
									inner.dispose();
								},
							};
						},
						undefined,
						t,
					);
					return { onThing: onThing };
				},
				onReady: function (): void {},
				onReconnect: onReconnectSpy,
			};

			const container = { telemetry: { enabled: false } } as unknown as Container;
			const commandRegistrar = {} as unknown as WebviewCommandRegistrar;
			const parent = createFakeParent(createMockWebview());
			const controller = await WebviewController.create(
				container,
				commandRegistrar,
				testDescriptor,
				'test-instance',
				parent,
				async () => provider,
			);
			try {
				assert.ok(tracker, 'expected the controller to hand getRpcServices a tracker');
				assert.ok(onThing, 'expected getRpcServices to have run');

				markServed(controller);
				await controller.connect(connectParams('client-a', 1000));

				// Session 1 (A) validates via the healthy path — it becomes the tracked keeper.
				tracker.bindCallerSession(() => 1);
				await controller.connect(connectParams('client-a', 1000));

				// A same-connection remount: session 7 (B) registers and validates with the SAME
				// client identity, superseding — tombstoning — A.
				tracker.bindCallerSession(() => 7);
				const received: number[] = [];
				onThing(data => received.push(data));
				await controller.connect(connectParams('client-a', 1000));
				assert.strictEqual(tracker.isSessionReleased(1), true, 'precondition: A is tombstoned');
				assert.strictEqual(onReconnectSpy.callCount, 2, "precondition: A's and B's reconnects both ran");

				// A's LATE connect() — sent before B validated, dispatching after. Same client
				// identity, controller healthy: only the released-session gate can catch it. It
				// must not evict B, must not re-run provider callbacks, and must not change state.
				tracker.bindCallerSession(() => 1);
				await controller.connect(connectParams('client-a', 1000));

				assert.strictEqual(disposeSpy.callCount, 0, "B's registration must survive A's late connect()");
				assert.strictEqual(tracker.size, 1, "B's registration must remain tracked");
				assert.strictEqual(
					onReconnectSpy.callCount,
					2,
					"a released session's late connect() must not fire onReconnect",
				);
				emitter.fire(42);
				assert.deepStrictEqual(received, [42], 'B must still be live and receiving events');
			} finally {
				controller.dispose();
				emitter.dispose();
			}
		});
	});
});
