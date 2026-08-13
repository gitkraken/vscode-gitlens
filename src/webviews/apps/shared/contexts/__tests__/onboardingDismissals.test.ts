import * as assert from 'node:assert';
import type { OnboardingKeys } from '../../../../../constants.onboarding.js';
import { createOnboardingDismissals } from '../onboardingDismissals.js';

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

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

suite('OnboardingDismissals Test Suite', () => {
	test('a fetch in flight across markStale() cannot restore the stale value', async () => {
		const { remote, pending } = createFakeRemote();
		const dismissals = createOnboardingDismissals();
		// The store accepts the remote shape structurally; the fake covers the members it uses
		dismissals.connect(remote as unknown as Parameters<typeof dismissals.connect>[0]);
		await settle();

		// Initial fetch resolves false — welcome-style consumers would render on this
		assert.strictEqual(dismissals.get('graph:intro'), undefined);
		assert.strictEqual(pending.length, 1);
		pending[0].resolve(false);
		await settle();
		assert.strictEqual(dismissals.get('graph:intro'), false);

		// A forced refresh goes in flight, then the webview hides before the reply lands
		dismissals.refresh();
		assert.strictEqual(pending.length, 2);
		dismissals.markStale();
		assert.strictEqual(dismissals.get('graph:intro'), undefined);

		// The stale reply lands after markStale — it must NOT restore the cleared value
		pending[1].resolve(false);
		await settle();
		assert.strictEqual(dismissals.get('graph:intro'), undefined, 'stale in-flight reply must be fenced');

		// The visibility-restore refresh still repopulates normally
		dismissals.refresh();
		assert.strictEqual(pending.length, 3);
		pending[2].resolve(true);
		await settle();
		assert.strictEqual(dismissals.get('graph:intro'), true);

		dismissals.dispose();
	});

	test('a hide before the connection resolves does not discard the connection', async () => {
		const { remote, pending } = createFakeRemote();
		const dismissals = createOnboardingDismissals();

		let resolveConnect!: (r: typeof remote) => void;
		const connectPromise = new Promise<typeof remote>(resolve => {
			resolveConnect = resolve;
		});
		dismissals.connect(connectPromise as unknown as Parameters<typeof dismissals.connect>[0]);

		// Register a key, then hide while the connection is still in flight
		assert.strictEqual(dismissals.get('graph:intro'), undefined);
		dismissals.markStale();

		resolveConnect(remote);
		await settle();

		// The resolved connection must still be wired — its refresh fetches the known key
		assert.ok(pending.length >= 1, 'the connection must survive a hide that precedes its resolution');
		pending.at(-1)!.resolve(true);
		await settle();
		assert.strictEqual(dismissals.get('graph:intro'), true);

		dismissals.dispose();
	});

	test('markStale() preserves unacknowledged local dismissals', async () => {
		const { remote } = createFakeRemote();
		const dismissals = createOnboardingDismissals();
		dismissals.connect(remote as unknown as Parameters<typeof dismissals.connect>[0]);
		await settle();

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
	});
});
