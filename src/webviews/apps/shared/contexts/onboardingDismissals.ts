import type { Connection, Remote, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import type { Signal } from '@lit-labs/signals';
import { signal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import { Logger } from '@gitlens/utils/logger.js';
import type { OnboardingKeys } from '../../../../constants.onboarding.js';
import type { OnboardingRpcService } from '../../../rpc/services/onboarding.js';
import { isConnectionClosedError } from '../actions/rpc.js';
import { subscribeAll } from '../events/subscriptions.js';

type OnboardingRemote = Awaited<Remote<{ onboarding: OnboardingRpcService }>['onboarding']>;

export interface OnboardingDismissals {
	/** Reactive read: undefined until known (dot hidden), else dismissed state. First read of a key lazily fetches isDismissed from the host. */
	get(key: OnboardingKeys): boolean | undefined;
	/** Optimistic local set-dismissed + persist via the host service (queued until the remote resolves). */
	dismiss(key: OnboardingKeys): void;
	/** Wire the remote. One-time: the library re-runs the subscription on every reconnect, replaying
	 *  pending dismissals and re-fetching all known keys each time, same as before. */
	connect(connection: Connection): void;
	/** Re-fetch all known keys. Call on visibility restore: buffered change events collapse to the last one, so multi-key changes while hidden need a re-sync. */
	refresh(): void;
	/** Clear unacknowledged signals to unknown. Call on webview hide so a change made elsewhere while hidden can't paint from a stale value on restore — consumers treat undefined as "unknown, don't show", and the visibility-restore `refresh()` repopulates. */
	markStale(): void;
	dispose(): void;
}

export function createOnboardingDismissals(): OnboardingDismissals {
	const signals = new Map<OnboardingKeys, Signal.State<boolean | undefined>>();
	// Locally-dismissed keys not yet acknowledged by the host — replayed on (re)connect and shielded from refresh overwrites.
	const pendingDismissals = new Set<OnboardingKeys>();

	let remote: OnboardingRemote | undefined;
	let connection: Connection | undefined;
	let subscription: Subscription | undefined;
	// Reply fence — bumped by markStale()/connect()/dispose() so stale in-flight fetch replies no-op.
	let fetchEpoch = 0;

	function ensureSignal(key: OnboardingKeys): Signal.State<boolean | undefined> {
		let sig = signals.get(key);
		if (sig == null) {
			sig = signal<boolean | undefined>(undefined);
			signals.set(key, sig);
		}
		return sig;
	}

	function fetchDismissed(key: OnboardingKeys, force?: boolean): void {
		const r = remote;
		// Not connected yet — the key is registered in `signals`, so connect() will fetch it
		if (r == null) return;

		const sig = ensureSignal(key);
		// Fence the reply: a fetch that was in flight when the webview hid (markStale), reconnected, or
		// disposed must not land its stale answer over the newer state
		const epoch = fetchEpoch;
		/* oxlint-disable typescript/await-thenable -- Supertalk proxy method calls are thenable at runtime */
		void (async () => {
			try {
				const dismissed = await r.isDismissed(key);
				if (epoch !== fetchEpoch) return;

				// Initial fetch defers to whatever landed first (change event / optimistic dismiss); a forced
				// refresh overwrites, except keys with an unacknowledged local dismissal.
				if (force ? !pendingDismissals.has(key) : sig.get() === undefined) {
					sig.set(dismissed);
				}
			} catch (ex) {
				if (isConnectionClosedError(ex)) {
					Logger.debug(`OnboardingDismissals: fetch '${key}' dropped by deliberate connection teardown`);
					return;
				}

				// Healed by the next refresh (reconnect or visibility restore)
				Logger.error(ex, `OnboardingDismissals: failed to fetch '${key}'`);
			}
		})();
		/* oxlint-enable typescript/await-thenable */
	}

	function persistDismiss(key: OnboardingKeys): void {
		const r = remote;
		// Not connected yet — stays queued in `pendingDismissals`; connect() will replay it
		if (r == null) return;

		/* oxlint-disable typescript/await-thenable -- Supertalk proxy method calls are thenable at runtime */
		void (async () => {
			try {
				await r.dismiss(key);
				pendingDismissals.delete(key);
			} catch (ex) {
				if (isConnectionClosedError(ex)) {
					Logger.debug(`OnboardingDismissals: dismiss '${key}' dropped by deliberate connection teardown`);
					return;
				}

				// Stays queued; retried on the next (re)connect
				Logger.error(ex, `OnboardingDismissals: failed to dismiss '${key}'`);
			}
		})();
		/* oxlint-enable typescript/await-thenable */
	}

	function refresh(): void {
		for (const key of signals.keys()) {
			fetchDismissed(key, true);
		}
	}

	return {
		get: function (key: OnboardingKeys): boolean | undefined {
			const existing = signals.get(key);
			if (existing != null) return existing.get();

			const sig = ensureSignal(key);
			fetchDismissed(key);
			return sig.get();
		},

		dismiss: function (key: OnboardingKeys): void {
			ensureSignal(key).set(true);
			pendingDismissals.add(key);
			persistDismiss(key);
		},

		connect: function (conn: Connection): void {
			if (connection === conn) return;

			subscription?.unsubscribe();
			connection = conn;
			subscription = subscribe<{ onboarding: OnboardingRpcService }>(conn, async services => {
				// Fence stale in-flight fetch replies from the previous session
				fetchEpoch++;
				const resolved = await services.onboarding;
				// A dispose()/re-connect() while the resolution was in flight cleared this store's
				// state — writing `remote` (or replaying) now would resurrect it for a dead session.
				if (connection !== conn) return;

				remote = resolved;
				const unsub = await subscribeAll([
					() =>
						resolved.onDidChange((e: { key: OnboardingKeys; dismissed: boolean }) =>
							ensureSignal(e.key).set(e.dismissed),
						),
				]);
				// Same fence after the second await — a dispose landing while the subscriptions were
				// registering must not replay dismissals or refetch into a dead session.
				if (connection !== conn) return unsub;

				for (const key of pendingDismissals) {
					persistDismiss(key);
				}
				refresh();

				return unsub;
			});
		},

		refresh: refresh,

		markStale: function (): void {
			// Invalidate in-flight fetch replies too — one resolving after this would otherwise restore
			// the very stale value being cleared
			fetchEpoch++;

			for (const [key, sig] of signals) {
				if (!pendingDismissals.has(key)) {
					sig.set(undefined);
				}
			}
		},

		dispose: function (): void {
			subscription?.unsubscribe();
			subscription = undefined;
			connection = undefined;
			fetchEpoch++;
			remote = undefined;
		},
	};
}

export const onboardingDismissalsContext = createContext<OnboardingDismissals | undefined>('onboarding-dismissals');
