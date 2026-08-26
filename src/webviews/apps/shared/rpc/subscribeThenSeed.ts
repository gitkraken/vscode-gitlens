import type { Connection, Remote, Subscription, Unsubscribe } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import { SeedBuffer } from '../actions/seedBuffer.js';

type Subscriber<TServices> = (remote: Remote<TServices>) => Unsubscribe | void | Promise<Unsubscribe | void>;

/** Options for {@link SubscribeThenSeed.run}. */
export type SubscribeThenSeedOptions<TServices extends object, TSeed> = {
	/** The connection (or root proxy) to subscribe on — same as `subscribe()`'s first argument. */
	connection: Connection | Remote<TServices> | Promise<Remote<TServices>>;
	/** Arms the host event subscription(s); typically wraps `subscribeAll`. */
	subscriber: Subscriber<TServices>;
	/** Fetches the authoritative snapshot once the subscription is armed. */
	seed: () => Promise<TSeed>;
	/** Applies the snapshot directly (bypassing the buffer — it's the seed, not a push). */
	applySeed: (seed: TSeed) => void;
};

/**
 * Owns the "subscribe-then-seed" choreography shared by webview root components that arm host
 * event subscriptions before fetching an initial snapshot: `allowedSigners`, `patchDetails`,
 * `rebase`, `welcome`.
 *
 * Subscribing before querying means a push racing the initial fetch isn't missed —
 * `subscribe()` buffers the wire subscribe synchronously until the connection's handshake
 * completes. But the fetch itself can take a while to resolve host-side, and a push landing
 * while it's pending isn't necessarily older than the response: applying pushes as they arrive
 * would let a stale response clobber them, and discarding them would lose them. A {@link
 * SeedBuffer} closes that gap — buffer push applications from the moment the fetch starts, apply
 * the fetch's response directly, then drain the buffer so every event that arrived during the
 * wait replays afterward, in order, on top of the seed.
 *
 * `run()` also replaces the manual "did this mount tear down while the fetch was pending"
 * identity check every one of those apps used to hand-roll (each against its own resolved
 * service, e.g. `this._rebase !== rebase`) with an internal generation counter: each `run()` call
 * bumps it, and a `reset()` (or a newer `run()`) bumps it again, so a fetch that resolves after
 * its `run()` was superseded applies nothing and leaves the buffer to whichever run (or reset)
 * superseded it.
 *
 * One instance is created per app root and reused across mounts: call `run()` from `_onRpcReady`
 * (once per mount — a fresh call per session, not a reused subscription, since the subscriber
 * closes over that mount's state), `during()` to wrap every push-event application, and `reset()`
 * from `disconnectedCallback`.
 */
export class SubscribeThenSeed<TServices extends object> {
	private readonly buffer = new SeedBuffer();
	private subscription: Subscription | undefined;
	private generation = 0;

	/**
	 * Subscribes, then fetches and applies the seed, replaying any pushes buffered while the fetch
	 * was pending.
	 *
	 * Unsubscribes any previous subscription first — the subscriber closes over this call's
	 * mount/session state, so a stale one must not keep dispatching into it. Bumps the generation
	 * before subscribing so a `reset()` (or another `run()`) racing this one is detected even before
	 * the fetch starts.
	 */
	async run<TSeed>(opts: SubscribeThenSeedOptions<TServices, TSeed>): Promise<void> {
		const generation = ++this.generation;

		this.subscription?.unsubscribe();
		this.subscription = subscribe<TServices>(opts.connection, opts.subscriber);

		this.buffer.start();
		try {
			await this.subscription.ready;

			const seed = await opts.seed();
			// This run may have been superseded (a newer `run()`, or a `reset()`) while the fetch was
			// pending — a stale seed must not apply anything into whatever replaced it. And it must
			// not touch the buffer either: a newer run's `start()` already took it over, and a
			// `reset()` already cleared it — a stale `reset()` here would tear down the CURRENT run's
			// in-flight buffering.
			if (generation !== this.generation) return;

			opts.applySeed(seed);
		} finally {
			// Drain only when this run is still current: on success this replays the pushes buffered
			// behind the seed; on a rejected fetch it releases them anyway — they're newer truth than
			// the seed that never arrived, and leaving the buffer started would queue every future
			// push forever. A superseded run leaves the buffer alone (see above).
			if (generation === this.generation) {
				this.buffer.drain();
			}
		}
	}

	/**
	 * Runs `fn` immediately if a seed isn't currently in flight; otherwise queues it to run once the
	 * in-flight {@link run} drains its buffer. Wrap every push-event application in this.
	 */
	during(fn: () => void): void {
		this.buffer.during(fn);
	}

	/** Unsubscribes and discards any in-flight seed. Call from `disconnectedCallback`. */
	reset(): void {
		this.generation++;
		this.subscription?.unsubscribe();
		this.subscription = undefined;
		this.buffer.reset();
	}
}
