import type { Remote } from '@eamodio/supertalk';
import type { Signal } from '@lit-labs/signals';
import { signal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import { Logger } from '@gitlens/utils/logger.js';
import type { OnboardingKeys } from '../../../../constants.onboarding.js';
import type { OnboardingRpcService } from '../../../rpc/services/onboarding.js';
import type { Unsubscribe } from '../../../rpc/services/types.js';
import { subscribeAll } from '../events/subscriptions.js';

type OnboardingRemote = Awaited<Remote<{ onboarding: OnboardingRpcService }>['onboarding']>;

export interface OnboardingDismissals {
	/** Reactive read: undefined until known (dot hidden), else dismissed state. First read of a key lazily fetches isDismissed from the host. */
	get(key: OnboardingKeys): boolean | undefined;
	/** Optimistic local set-dismissed + persist via the host service (queued until the remote resolves). */
	dismiss(key: OnboardingKeys): void;
	/** Wire (or re-wire after an RPC reconnect) the remote; re-fetches all known keys on each call. */
	connect(onboarding: OnboardingRemote | PromiseLike<OnboardingRemote>): void;
	/** Re-fetch all known keys. Call on visibility restore: buffered change events collapse to the last one, so multi-key changes while hidden need a re-sync. */
	refresh(): void;
	dispose(): void;
}

export function createOnboardingDismissals(): OnboardingDismissals {
	const signals = new Map<OnboardingKeys, Signal.State<boolean | undefined>>();
	// Locally-dismissed keys not yet acknowledged by the host — replayed on (re)connect and shielded from refresh overwrites.
	const pendingDismissals = new Set<OnboardingKeys>();

	let remote: OnboardingRemote | undefined;
	// Bumped by connect()/dispose() so stale async resolutions no-op.
	let generation = 0;
	let unsubscribe: Promise<Unsubscribe> | undefined;

	function ensureSignal(key: OnboardingKeys): Signal.State<boolean | undefined> {
		let sig = signals.get(key);
		if (sig == null) {
			sig = signal<boolean | undefined>(undefined);
			signals.set(key, sig);
		}
		return sig;
	}

	function stopListening(): void {
		void unsubscribe?.then(unsub => {
			if (typeof unsub === 'function') {
				unsub();
			}
		});
		unsubscribe = undefined;
	}

	function fetchDismissed(key: OnboardingKeys, force?: boolean): void {
		const r = remote;
		// Not connected yet — the key is registered in `signals`, so connect() will fetch it
		if (r == null) return;

		const sig = ensureSignal(key);
		/* oxlint-disable typescript/await-thenable -- Supertalk proxy method calls are thenable at runtime */
		void (async () => {
			try {
				const dismissed = await r.isDismissed(key);
				// Initial fetch defers to whatever landed first (change event / optimistic dismiss); a forced
				// refresh overwrites, except keys with an unacknowledged local dismissal.
				if (force ? !pendingDismissals.has(key) : sig.get() === undefined) {
					sig.set(dismissed);
				}
			} catch (ex) {
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

		connect: function (onboarding: OnboardingRemote | PromiseLike<OnboardingRemote>): void {
			const gen = ++generation;
			void Promise.resolve(onboarding).then(
				resolved => {
					// Superseded by a newer connect() or dispose()
					if (gen !== generation) return;

					stopListening();
					remote = resolved;
					unsubscribe = subscribeAll([
						() =>
							resolved.onDidChange((e: { key: OnboardingKeys; dismissed: boolean }) =>
								ensureSignal(e.key).set(e.dismissed),
							),
					]);

					for (const key of pendingDismissals) {
						persistDismiss(key);
					}
					refresh();
				},
				(ex: unknown) => Logger.error(ex, 'OnboardingDismissals: failed to connect'),
			);
		},

		refresh: refresh,

		dispose: function (): void {
			generation++;
			stopListening();
			remote = undefined;
		},
	};
}

export const onboardingDismissalsContext = createContext<OnboardingDismissals | undefined>('onboarding-dismissals');
