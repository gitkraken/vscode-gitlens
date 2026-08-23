import type { Connection, Remote, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import type { Signal } from '@lit-labs/signals';
import { signal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import { Logger } from '@gitlens/utils/logger.js';
import type { GraphCoachMarkType } from '../../../plus/graph/protocol.js';
import type { OnboardingRpcService } from '../../../rpc/services/onboarding.js';
import { isConnectionClosedError } from '../../shared/actions/rpc.js';

type OnboardingRemote = Awaited<Remote<{ onboarding: OnboardingRpcService }>['onboarding']>;

/** One aggregate key rather than per-mark state, so this costs a single round-trip. */
const seenStateKey = 'graph:coachMarks' as const;

/** Which coach marks have already had their one force-open, persisted so they don't re-open every
 *  session. The permanent "Got it" dismissal rides `OnboardingDismissals` instead. */
export interface CoachMarkSeenStore {
	/** Reactive read: `undefined` until the persisted set is known (callers must not force-open yet). */
	has(mark: GraphCoachMarkType): boolean | undefined;
	markSeen(mark: GraphCoachMarkType): void;
	/** Wire the remote. One-time: the library re-runs the subscription on every reconnect, refetching
	 *  each time. */
	connect(connection: Connection): void;
	dispose(): void;
}

export function createCoachMarkSeenStore(): CoachMarkSeenStore {
	const seen: Signal.State<Set<GraphCoachMarkType> | undefined> = signal(undefined);
	// Marks seen locally but not yet acknowledged by the host — replayed on (re)connect.
	const pending = new Set<GraphCoachMarkType>();

	let remote: OnboardingRemote | undefined;
	let storedConnection: Connection | undefined;
	let subscription: Subscription | undefined;
	// Bumped at subscriber start and in dispose() so a stale in-flight fetch() resolution no-ops.
	let generation = 0;

	function persist(): void {
		const r = remote;
		// Not connected yet — stays in `pending`; connect() replays it
		if (r == null) return;

		const current = seen.get();
		if (current == null) return;

		// Only clear what this write covers — `markSeen()` can queue more while it's in flight.
		const persisted = new Set(current);
		const state = { seen: Object.fromEntries(Array.from(persisted, m => [m, true as const])) };
		/* oxlint-disable typescript/await-thenable -- Supertalk proxy method calls are thenable at runtime */
		void (async () => {
			try {
				await r.setItemState(seenStateKey, state);
				for (const m of persisted) {
					pending.delete(m);
				}
			} catch (ex) {
				if (isConnectionClosedError(ex)) {
					Logger.debug('CoachMarkSeenStore: persist dropped by deliberate connection teardown');
					return;
				}

				// Stays queued; retried on the next (re)connect
				Logger.error(ex, 'CoachMarkSeenStore: failed to persist seen state');
			}
		})();
		/* oxlint-enable typescript/await-thenable */
	}

	function fetch(gen: number): void {
		const r = remote;
		if (r == null) return;

		/* oxlint-disable typescript/await-thenable -- Supertalk proxy method calls are thenable at runtime */
		void (async () => {
			try {
				const state = await r.getItemState(seenStateKey);
				// Superseded by a newer connect()/dispose()
				if (gen !== generation) return;

				const stored = (state as { seen?: Partial<Record<GraphCoachMarkType, true>> } | undefined)?.seen;
				// Union in everything already known locally, so a fetch can't resurrect one already shown.
				// `pending` alone isn't enough: a write that lands before this in-flight read resolves clears
				// its entry, and the read predates the write — so the mark would drop back out of the set.
				seen.set(
					new Set([
						...(Object.keys(stored ?? {}) as GraphCoachMarkType[]),
						...(seen.get() ?? []),
						...pending,
					]),
				);

				if (pending.size) {
					persist();
				}
			} catch (ex) {
				if (isConnectionClosedError(ex)) {
					Logger.debug('CoachMarkSeenStore: fetch dropped by deliberate connection teardown');
					return;
				}

				// Leave `undefined` — no mark force-opens rather than risk re-showing a seen one
				Logger.error(ex, 'CoachMarkSeenStore: failed to fetch seen state');
			}
		})();
		/* oxlint-enable typescript/await-thenable */
	}

	return {
		has: function (mark: GraphCoachMarkType): boolean | undefined {
			return seen.get()?.has(mark);
		},

		markSeen: function (mark: GraphCoachMarkType): void {
			pending.add(mark);
			const current = seen.get();
			// Seed a set before the first fetch lands, so the in-session guard holds immediately.
			seen.set(new Set([...(current ?? []), mark]));
			persist();
		},

		connect: function (conn: Connection): void {
			if (storedConnection === conn) return;

			subscription?.unsubscribe();
			storedConnection = conn;
			subscription = subscribe<{ onboarding: OnboardingRpcService }>(conn, async services => {
				const gen = ++generation;
				const resolved = await services.onboarding;
				// A dispose()/re-connect() while the resolution was in flight cleared this store's
				// state — writing `remote` now would resurrect it for a dead session.
				if (storedConnection !== conn) return;

				remote = resolved;
				fetch(gen);
			});
		},

		dispose: function (): void {
			generation++;
			subscription?.unsubscribe();
			subscription = undefined;
			storedConnection = undefined;
			remote = undefined;
		},
	};
}

export const coachMarkSeenContext = createContext<CoachMarkSeenStore | undefined>('graph-coachmark-seen');
