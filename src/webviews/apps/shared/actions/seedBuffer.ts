/**
 * Buffers host-pushed event applications while a "subscribe-then-query" seed fetch is in flight,
 * then replays them once the seed's response has been applied.
 *
 * Several webview root components (allowedSigners, rebase, patchDetails) subscribe to host events
 * before issuing an initial query for the current snapshot, so a push racing the query can't be
 * missed — `subscribe()` arms the wire subscription synchronously. But the query itself can still
 * take a while to resolve host-side (parsing a document, awaiting repository work, etc.), and a
 * push that lands while it's pending isn't necessarily older than the response: applying pushes
 * as they arrive would let the (possibly stale) query response clobber them; discarding pushes
 * until the query resolves would lose them entirely.
 *
 * The fix is to buffer push applications from the moment the query starts, apply the query's
 * response directly (bypassing the buffer — it's the seed, not a push), then drain the buffer so
 * every event that arrived during the wait is replayed afterward, in order, on top of the seed.
 */
export class SeedBuffer {
	private buffer: (() => void)[] | undefined;

	/** Begins buffering — call right before awaiting the seed query. */
	start(): void {
		this.buffer = [];
	}

	/**
	 * Runs `fn` immediately if a seed isn't currently in flight; otherwise queues it to run when
	 * {@link drain} is called. Use this to wrap every push-event application.
	 */
	during(fn: () => void): void {
		const buffer = this.buffer;
		if (buffer != null) {
			buffer.push(fn);
			return;
		}

		fn();
	}

	/**
	 * Stops buffering and runs every queued application, in the order they arrived. The queue is
	 * cleared before any of them run, so a push that re-enters {@link during} from inside a queued
	 * fn runs immediately instead of being appended to (and lost from) the queue being drained.
	 *
	 * Call after the seed query's response has been applied.
	 */
	drain(): void {
		const buffer = this.buffer ?? [];
		this.buffer = undefined;
		for (const apply of buffer) {
			apply();
		}
	}

	/**
	 * Stops buffering without running anything queued. Use when the mount that started the seed
	 * tears down before the seed completes — the queued applications belong to state that's being
	 * discarded and must not run against whatever replaces it.
	 */
	reset(): void {
		this.buffer = undefined;
	}
}
