import * as assert from 'node:assert';
import { MessageChannel } from 'node:worker_threads';
import type { Endpoint } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import type { OnboardingKeys } from '../../../../../constants.onboarding.js';
import { createOnboardingDismissals } from '../onboardingDismissals.js';

/** Node's MessagePort is an EventTarget, so it satisfies Supertalk's Endpoint directly. */
function asEndpoint(port: import('node:worker_threads').MessagePort): Endpoint {
	return port as unknown as Endpoint;
}

type Deferred = { resolve: (dismissed: boolean) => void };

/** Fake onboarding remote whose isDismissed replies are manually resolved, to exercise reply ordering */
function createFakeRemote() {
	const pending: Deferred[] = [];

	const remote = {
		isDismissed: (_key: OnboardingKeys) =>
			new Promise<boolean>(resolve => {
				pending.push({ resolve: resolve });
			}),
		dismiss: (_key: OnboardingKeys) => Promise.resolve(),
		onDidChange: (_handler: unknown) => Promise.resolve(() => {}),
	};

	return { remote: remote, pending: pending };
}

/**
 * Real supertalk `Connection` pair over a `MessageChannel`, host-side exposing `{ onboarding: remote }`.
 * `connect()` takes the client-side connection directly; the host is left unexposed until the caller
 * chooses, so a test can exercise wiring that happens before the handshake completes.
 */
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

/** Enough time for a same-process MessageChannel round trip to complete. */
const tick = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms));

suite('OnboardingDismissals Test Suite', () => {
	test('a fetch in flight across markStale() cannot restore the stale value', async () => {
		const { remote, pending } = createFakeRemote();
		const { host, client, close } = createConnectionPair();
		host.expose({ onboarding: remote });

		const dismissals = createOnboardingDismissals();
		dismissals.connect(client);
		void client.waitForReady();
		await tick();

		// Initial fetch resolves false — welcome-style consumers would render on this
		assert.strictEqual(dismissals.get('graph:intro'), undefined);
		await tick(); // let the isDismissed call reach the host
		assert.strictEqual(pending.length, 1);
		pending[0].resolve(false);
		await tick();
		assert.strictEqual(dismissals.get('graph:intro'), false);

		// A forced refresh goes in flight, then the webview hides before the reply lands
		dismissals.refresh();
		await tick();
		assert.strictEqual(pending.length, 2);
		dismissals.markStale();
		assert.strictEqual(dismissals.get('graph:intro'), undefined);

		// The stale reply lands after markStale — it must NOT restore the cleared value
		pending[1].resolve(false);
		await tick();
		assert.strictEqual(dismissals.get('graph:intro'), undefined, 'stale in-flight reply must be fenced');

		// The visibility-restore refresh still repopulates normally
		dismissals.refresh();
		await tick();
		assert.strictEqual(pending.length, 3);
		pending[2].resolve(true);
		await tick();
		assert.strictEqual(dismissals.get('graph:intro'), true);

		dismissals.dispose();
		close();
	});

	test('a hide before the connection handshake completes does not discard the connection', async () => {
		const { remote, pending } = createFakeRemote();
		const { host, client, close } = createConnectionPair();

		const dismissals = createOnboardingDismissals();
		dismissals.connect(client);

		// Register a key, then hide while the connection's handshake is still in flight (host not
		// exposed yet — `subscribe()` buffers until it completes)
		assert.strictEqual(dismissals.get('graph:intro'), undefined);
		dismissals.markStale();

		host.expose({ onboarding: remote });
		void client.waitForReady();
		await tick();

		// The connection must still be wired — its refresh fetches the known key
		assert.ok(pending.length >= 1, 'the connection must survive a hide that precedes its handshake');
		pending.at(-1)!.resolve(true);
		await tick();
		assert.strictEqual(dismissals.get('graph:intro'), true);

		dismissals.dispose();
		close();
	});

	test('markStale() preserves unacknowledged local dismissals', async () => {
		const { remote } = createFakeRemote();
		const { host, client, close } = createConnectionPair();
		host.expose({ onboarding: remote });

		const dismissals = createOnboardingDismissals();
		dismissals.connect(client);
		void client.waitForReady();
		await tick();

		// markStale runs synchronously after dismiss, before the persist ack's microtask lands, so the
		// key is still pending — the exact hide-right-after-click ordering
		dismissals.dismiss('graph:layoutPrompt');
		dismissals.markStale();
		assert.strictEqual(
			dismissals.get('graph:layoutPrompt'),
			true,
			'a pending local dismissal must survive markStale',
		);

		dismissals.dispose();
		close();
	});
});
