/**
 * Visibility-aware event buffering for RPC webviews.
 *
 * For `retainContextWhenHidden: true` webviews, VS Code silently drops
 * `postMessage` while hidden. The EventVisibilityBuffer intercepts event
 * handlers and stores pending replays keyed by buffered subscription. On visibility
 * restore, all pending replays fire through the normal RPC handler path.
 *
 * Key properties:
 * - Same buffered subscription firing N times while hidden → 1 pending entry (latest overwrites)
 * - Pending count bounded by distinct buffered subscriptions
 * - Zero work on restore if nothing fired while hidden
 */

import { notify } from '@eamodio/supertalk';
import type { Disposable } from 'vscode';
import type { RpcEventSubscription, Unsubscribe } from './services/types.js';

export type EventVisibilityKey = string | symbol;

/**
 * Wraps a remote callback proxy for one-way emission — the host fires events without acking or
 * awaiting a discarded promise that would otherwise reject unhandled on teardown. `notify()` only
 * accepts remote proxies, so a local function (unit tests, in-process callers) falls back to a
 * plain synchronous invocation.
 */
export function toEventNotifier<T>(handler: (data: T) => unknown): (data: T) => void {
	try {
		return notify(handler);
	} catch {
		return data => void handler(data);
	}
}

/**
 * Tracks outstanding RPC event subscriptions so they can be cleaned up on
 * reconnection (`reset`) or controller teardown (`dispose`).
 *
 * Without this, VS Code event listeners created by `createRpcEventSubscription`
 * leak when a webview refreshes — the old Supertalk Connection closes but
 * nobody calls the `Unsubscribe` functions that hold the VS Code Disposables.
 */
export class SubscriptionTracker implements Disposable {
	private _unsubscribes = new Set<Unsubscribe>();
	private _disposed = false;
	private _epoch = 0;
	/** Every event's own `Set<EventRegistration>`, watched so {@link releaseAllExcept}/{@link releaseSession}
	 *  can scan across all of them — see {@link watchRegistrations}. */
	private readonly _registrationSets = new Set<Set<EventRegistration>>();
	/** Sessions an async subscription method has made visible via {@link reserveSession} while it has
	 *  nothing tracked yet — see that method. Refcounted (session → outstanding acquisition count)
	 *  rather than a plain set, so CONCURRENT acquisitions from the same session don't collapse into
	 *  one entry: each holds its own one-shot release handle, and the session stays visible to
	 *  validation until the LAST one resolves. */
	private readonly _reservedSessions = new Map<number, number>();
	/** The session {@link releaseAllExcept} last validated as keeper — remembered so the NEXT
	 *  validation can tombstone it even when it's idle at that moment (nothing tracked, nothing
	 *  reserved — e.g. it validated but never registered), leaving nothing for the release scans to
	 *  find. Only ever set by a validation, never by a registration, so tombstoning it can never
	 *  condemn a fresh remount session that hasn't validated yet. */
	private _activeSession: number | undefined;
	/** Every session known to be released: explicitly, via {@link releaseSession} (a rejected
	 *  straggler); or because {@link releaseAllExcept} superseded it — it released a registration or
	 *  a {@link reserveSession} reservation of its, or it was the previously validated keeper
	 *  ({@link _activeSession}). Deliberately NOT "every session that isn't the
	 *  current keeper" — a session that has never yet validated (e.g. a same-connection remount's
	 *  brand-new post-reset session, registering before its OWN `connect()` runs) has had no
	 *  registration or reservation for {@link releaseAllExcept} to find, so it has had no chance
	 *  to be superseded and must NOT read as released, or its retained subscription would be torn
	 *  down before it ever gets to validate. See {@link isSessionReleased}. Cleared on every
	 *  {@link reset} — a pre-reset session id can never be legitimately referenced again, so nothing
	 *  needs its tombstone past that generation; without this a long-lived webview that reconnects
	 *  repeatedly would grow this set forever. */
	private readonly _releasedSessions = new Set<number>();
	/** Reads the RPC caller session currently being dispatched — bound once by `RpcHost`, closed
	 *  over its own (possibly swapped) `Connection` so it always reflects whichever one is live.
	 *  See {@link callerSession}. */
	private _sessionResolver: (() => number | undefined) | undefined;

	/**
	 * Monotonic generation counter, bumped by every {@link reset}/{@link dispose}. An ASYNC subscription
	 * method (one that awaits resource acquisition before `track()`) captures this before its await and
	 * compares after — a mismatch means a reconnect reset the tracker mid-acquisition, so the resource
	 * belongs to a superseded generation and must be disposed instead of tracked (tracking it would leak
	 * it until the NEXT reset and double-deliver alongside the new generation's subscription).
	 */
	get epoch(): number {
		return this._epoch;
	}

	/** Number of tracked registrations — for diagnostics and tests. */
	get size(): number {
		return this._unsubscribes.size;
	}

	/**
	 * Binds the resolver `RpcHost` uses to attribute a registration or a `connect()` call to the
	 * peer session synchronously dispatching it right now. Called once, from `RpcHost`'s
	 * constructor — see {@link callerSession}.
	 */
	bindCallerSession(resolver: () => number | undefined): void {
		this._sessionResolver = resolver;
	}

	/**
	 * The session id of the client whose RPC call is synchronously dispatching right now, or
	 * `undefined` (no resolver bound yet, or called outside a dispatch). Mirrors
	 * `Connection.callerSession`'s contract: reliable ONLY synchronously, before the caller's first
	 * `await` — capture it into a local before then. Attribution, not authentication: a peer can
	 * send any session it likes.
	 */
	get callerSession(): number | undefined {
		return this._sessionResolver?.();
	}

	/**
	 * Registers an event's own `Set<EventRegistration>` so {@link releaseAllExcept}/{@link releaseSession}
	 * can scan it later. Called by {@link trackRpcRegistration} on every registration — idempotent
	 * (`Set.add` of an already-present reference is a no-op), so no separate "first time" bookkeeping
	 * is needed.
	 */
	watchRegistrations(registrations: Set<EventRegistration>): void {
		this._registrationSets.add(registrations);
	}

	/**
	 * True once `session` is known to be released — see {@link _releasedSessions} for exactly which
	 * sessions that is (and, just as importantly, which it deliberately is NOT). `undefined` never
	 * counts as released — there's no identity to track. For when an ASYNC subscription method must
	 * check this (and the capture/reserve ordering that makes the answer reliable), see
	 * {@link reserveSession}.
	 */
	isSessionReleased(session: number | undefined): boolean {
		return session != null && this._releasedSessions.has(session);
	}

	/**
	 * Marks `session` as reserved — an async subscription method calls this synchronously, BEFORE
	 * its own first `await`, to make itself visible to {@link releaseAllExcept} even though it has
	 * nothing tracked yet. Without this, a session that captures its identity, awaits a resource,
	 * and only THEN registers is invisible to a validation landing in that gap: nothing in
	 * {@link _registrationSets} names it yet, so {@link releaseAllExcept}'s loop can't tombstone it,
	 * and its late registration lands as if it had never been superseded.
	 *
	 * Returns a ONE-SHOT release handle the caller MUST invoke on every exit path — attach, abandon,
	 * or throw — so a `try/finally` around the whole acquisition is the expected shape. Each call
	 * gets its own handle backed by a refcount, so two concurrent acquisitions from the same session
	 * don't collapse: releasing one leaves the session visible to validation until the other
	 * resolves, and releasing the same handle twice is a no-op. For `undefined` (no identity to
	 * track) the handle does nothing.
	 */
	reserveSession(session: number | undefined): () => void {
		if (session == null) return () => {};

		this._reservedSessions.set(session, (this._reservedSessions.get(session) ?? 0) + 1);
		let released = false;
		return () => {
			if (released) return;

			released = true;
			const count = this._reservedSessions.get(session);
			if (count == null) return;

			if (count > 1) {
				this._reservedSessions.set(session, count - 1);
			} else {
				this._reservedSessions.delete(session);
			}
		};
	}

	/**
	 * Releases every tracked registration NOT owned by `session`. Called by
	 * `WebviewController.connect()` once `session`'s identity is VALIDATED — everything else
	 * currently tracked is debris: a previous session this one supersedes, or a straggler that raced
	 * the validated client to registration (supertalk replays a client's retained subscriptions on
	 * every handshake and drops the superseded unsubscribe handle without calling it, so nothing
	 * else would ever clean these up).
	 *
	 * Tombstones (see {@link _releasedSessions}/{@link isSessionReleased}) every session this call
	 * ACTUALLY released a registration for, every {@link reserveSession}'d session not superseded,
	 * and the PREVIOUSLY validated keeper (see {@link _activeSession} — it may be idle right now,
	 * with nothing tracked or reserved for the scans below to find, yet must not be able to register
	 * after being superseded) — never a session merely for not being the new keeper. This is what
	 * stops a released interloper from re-registering: its earlier registration was tombstoned right
	 * here, so a synchronous re-registration is caught by {@link isSessionReleased} in
	 * {@link trackRpcRegistration}; an interloper caught mid-acquisition (nothing tracked yet) is
	 * caught the same way via its reservation instead.
	 */
	releaseAllExcept(session: number | undefined): void {
		const previous = this._activeSession;
		this._activeSession = session;
		if (previous != null && previous !== session) {
			this._releasedSessions.add(previous);
		}

		this.releaseMatching(registration => registration.session !== session);

		for (const reserved of this._reservedSessions.keys()) {
			if (reserved !== session) {
				this._releasedSessions.add(reserved);
			}
		}
	}

	/**
	 * Releases every tracked registration owned by `session`, and records it as released. Used to
	 * clean up a straggler that reached `connect()` and was rejected — without this its registrations
	 * would survive until the next validation or a served reconnect's {@link reset}. No-op for
	 * `undefined` (nothing to attribute it to).
	 */
	releaseSession(session: number | undefined): void {
		if (session == null) return;

		// Added up front, not just via the scan — the session may have nothing registered yet.
		this._releasedSessions.add(session);
		this.releaseMatching(registration => registration.session === session);
	}

	/** The shared release scan: releases — and tombstones — every registration matching `matches`,
	 *  across every watched registration set. See {@link releaseAllExcept}/{@link releaseSession}. */
	private releaseMatching(matches: (registration: EventRegistration) => boolean): void {
		for (const registrations of this._registrationSets) {
			for (const registration of registrations) {
				if (matches(registration)) {
					if (registration.session != null) {
						this._releasedSessions.add(registration.session);
					}
					registration.release();
				}
			}
		}
	}

	/**
	 * Register an unsubscribe function for tracking. Custom (non-factory) RPC event
	 * implementations must go through {@link trackRpcRegistration} instead of calling this
	 * directly — a bare `track()` skips session-attribution and stacks a duplicate listener
	 * on every remount.
	 * @returns A wrapped unsubscribe that also removes itself from the tracker.
	 */
	track(unsubscribe: Unsubscribe): () => void {
		// Already torn down — e.g. the webview was disposed while an async subscription method
		// (the only ones with an await between resource-acquisition and track) was in flight.
		// `dispose()` won't run again, so track-then-forget would leak; dispose the resource now.
		if (this._disposed) {
			(unsubscribe as () => void)();
			return () => {};
		}

		this._unsubscribes.add(unsubscribe);
		return () => {
			this._unsubscribes.delete(unsubscribe);
			// Cast is safe: `Unsubscribe` is `(() => void) | Promise<() => void>` because the webview-client side
			// receives it async over RPC, but host-side callers always produce a synchronous `() => void`.
			(unsubscribe as () => void)();
		};
	}

	/**
	 * Disposes tracked subscriptions but stays usable — used on RPC reconnection so the next
	 * session's `track()` calls register normally instead of being torn down immediately by
	 * a permanently-disposed tracker.
	 */
	reset(): void {
		this._epoch++;
		for (const unsub of this._unsubscribes) {
			// Cast is safe: `Unsubscribe` is `(() => void) | Promise<() => void>` because the webview-client side
			// receives it async over RPC, but host-side callers always produce a synchronous `() => void`.
			(unsub as () => void)();
		}
		this._unsubscribes.clear();
		// A pre-reset session id can never be legitimately referenced again — the epoch bump above
		// already rejects any cross-reset straggler that checks `epoch` itself (e.g. an async
		// subscription method), and every OTHER caller of `isSessionReleased` only ever needs a
		// tombstone to outlive the single generation it was recorded in. Without this, a long-lived
		// webview that reconnects many times would grow this set forever.
		this._releasedSessions.clear();
	}

	/** Disposes tracked subscriptions and permanently disables the tracker. Called on final teardown. */
	dispose(): void {
		this._disposed = true;
		this.reset();
	}
}

/**
 * Manages visibility state and a pending replay map for buffered events.
 *
 * Usage:
 * - Controller creates an EventVisibilityBuffer for `retainContextWhenHidden: true` webviews
 * - Factory wraps each event subscription using `bufferEventHandler`
 * - Controller calls `setVisible(visible)` in `onParentVisibilityChanged`
 */
export class EventVisibilityBuffer {
	private _visible = true;
	private readonly _pending = new Map<EventVisibilityKey, () => void>();

	get visible(): boolean {
		return this._visible;
	}

	setVisible(visible: boolean): void {
		this._visible = visible;
		if (visible) {
			this.flush();
		}
	}

	addPending(key: EventVisibilityKey, fn: () => void): void {
		this._pending.set(key, fn); // overwrites previous — only latest survives
	}

	removePending(key: EventVisibilityKey): void {
		this._pending.delete(key);
	}

	private flush(): void {
		if (this._pending.size === 0) return;

		// Snapshot and clear before invoking — handlers could re-add pending entries
		const fns = [...this._pending.values()];
		this._pending.clear();
		for (const fn of fns) {
			fn();
		}
	}
}

/**
 * Wraps an event handler with visibility buffering.
 *
 * - `save-last`: When hidden, stores a closure that replays the latest event data.
 *   Each call overwrites the previous — only the most recent data survives.
 * - `signal`: When hidden, stores a closure that fires with `signalValue` (typically
 *   `undefined`). The webview handler re-fetches current state as needed.
 *
 * When `buffer` is `undefined` (retainContextWhenHidden: false), returns the handler
 * unchanged — no buffering overhead.
 */
export function bufferEventHandler<T>(
	buffer: EventVisibilityBuffer | undefined,
	key: EventVisibilityKey,
	handler: (data: T) => void,
	mode: 'save-last' | 'signal',
	signalValue?: T,
): (data: T) => void {
	const notifier = toEventNotifier(handler);
	if (buffer == null) return notifier;
	return (data: T) => {
		if (buffer.visible) {
			notifier(data);
		} else {
			buffer.addPending(key, () => notifier(mode === 'save-last' ? data : (signalValue as T)));
		}
	};
}

/**
 * One live registration for an event source, tagged with the {@link SubscriptionTracker.callerSession}
 * that made it.
 */
export interface EventRegistration {
	readonly session: number | undefined;
	readonly release: () => void;
}

/**
 * Registers a teardown for tracker/session-scoped cleanup outside the two factory functions above.
 * Gives custom RPC event implementations (ones that build their own VS Code Disposable / listener
 * instead of going through {@link createRpcEvent} or {@link createRpcEventSubscription}) identical
 * remount semantics: a new registration in `registrations` is tagged with the CALLER SESSION making
 * it right now (see {@link SubscriptionTracker.callerSession}), and `registrations` itself is handed
 * to the tracker (see {@link SubscriptionTracker.watchRegistrations}) so a later validated session
 * can supersede every registration NOT its own there (see {@link SubscriptionTracker.releaseAllExcept}
 * — NOT done here; see that method for why). The resulting unsubscribe is also tracker-registered so
 * a reconnect's wholesale `reset()` still disposes it. Every custom RPC event MUST register through
 * this helper instead of calling `tracker.track()` directly — a bare `track()` never attributes a
 * session and stacks a duplicate listener on every remount.
 *
 * The helper owns the attach/track ordering: run `attach()` to build the source and get back its
 * teardown, then hand that teardown to the tracker. `attach()` runs BEFORE `tracker.track()`
 * because `track()` disposes SYNCHRONOUSLY when the tracker is already disposed (e.g. the webview
 * tore down while an async subscription method was mid-flight) — the teardown it calls must
 * already be fully formed, or it dereferences a not-yet-assigned source. If `attach()` throws,
 * nothing was registered or tracked, so there's nothing to roll back.
 *
 * A SYNCHRONOUS subscription method (the common case: this call is itself the RPC dispatch target,
 * with no `await` before it) omits `session` — the helper reads {@link SubscriptionTracker.callerSession}
 * itself, still reliably the live caller's at this point. An ASYNC subscription method MUST instead
 * capture the session before its own first `await`, reserve it, and pass the capture explicitly —
 * the full contract (why, and the `try/finally` handle ownership) lives on
 * {@link SubscriptionTracker.reserveSession}; `RepositoryService.onRepositoryOrWorktreeChanged` is
 * the reference implementation.
 *
 * Either way, the resolved session is checked immediately before attaching: if it's already
 * released (superseded at validation, or rejected as a straggler — see
 * {@link SubscriptionTracker.isSessionReleased}), `attach()` still runs — its resource needs a
 * teardown to call, not to leak — but the result is torn down immediately instead of installed.
 * This helper never touches reservations: the async caller releases its own handle AFTER this call
 * returns, since a synchronous same-session registration clearing an unrelated in-flight
 * acquisition's reservation would reopen exactly the gap the reservation exists to close.
 *
 * ```ts
 * const tracked = trackRpcRegistration(registrations, tracker, () => {
 *   const disposable = someSource.onDidChange(...);
 *   return () => disposable.dispose();
 * });
 * return tracked;
 * ```
 *
 * @param registrations - The event's own registration set — must NOT be shared across events
 * @param tracker - Optional subscription tracker: session source and reconnect-disposal target
 * @param attach - Builds and attaches the caller's source, returning its teardown (called at most once)
 * @param explicitSession - Omit for a synchronous caller; an async caller MUST pass the session it
 * captured before its own first `await` (see above) — pass it even if that capture was `undefined`
 * @returns Unsubscribe wired through the tracker (if present) so both paths release exactly once
 */
export function trackRpcRegistration(
	registrations: Set<EventRegistration>,
	tracker: SubscriptionTracker | undefined,
	attach: () => () => void,
	...explicitSession: [] | [number | undefined]
): Unsubscribe {
	const session = explicitSession.length > 0 ? explicitSession[0] : tracker?.callerSession;
	tracker?.watchRegistrations(registrations);

	// Re-checked here, immediately before attaching — see the doc comment above.
	if (tracker?.isSessionReleased(session) === true) {
		attach()();
		return () => {};
	}

	const teardown = attach();

	let disposed = false;
	let registration!: EventRegistration;
	const raw = function () {
		if (disposed) return;

		disposed = true;
		// `registration` may still be unassigned here if the tracker was already disposed —
		// `Set.delete(undefined)` is a harmless no-op in that case.
		registrations.delete(registration);
		teardown();
	};
	const tracked = tracker != null ? tracker.track(raw) : raw;
	// An already-disposed tracker runs `raw` synchronously above; registering now would re-add
	// something already released, so only register if it survived.
	if (!disposed) {
		registration = { session: session, release: tracked };
		registrations.add(registration);
	}

	return tracked;
}

/**
 * Result of {@link createRpcEvent} — bundles a subscriber factory
 * and a fire function backed by the same internal handler map.
 */
export interface RpcEvent<T> {
	readonly subscribe: (
		buffer?: EventVisibilityBuffer,
		tracker?: SubscriptionTracker,
		replay?: () => T | undefined,
	) => RpcEventSubscription<T>;
	readonly fire: (data: T) => void;
}

/**
 * Creates a self-contained handler-map event.
 *
 * The handler map is created and managed internally. Use `.subscribe(buffer, tracker)`
 * inside `getRpcServices` to produce an `RpcEventSubscription<T>`, and `.fire(data)` anywhere
 * to invoke all registered handlers.
 *
 * `fire` reaches only handlers registered at fire time — an event fired before the webview app
 * subscribes is lost ('save-last' covers hidden-visibility buffering, not late subscribers). For
 * events that represent standing state (a failure flag, a latched condition), pass `replay` to
 * `.subscribe`: each new handler is immediately invoked with the current truth (when defined),
 * through the same visibility-buffered path a live fire takes.
 *
 * Registrations are session-scoped — a validated session supersedes every other session's
 * registration, while concurrent same-session subscribers stay live; see
 * {@link SubscriptionTracker.releaseAllExcept} for the full contract. The `registrations` set lives
 * at this level rather than inside `subscribe`, so registrations made via different
 * `.subscribe(buffer, tracker)` bags still supersede each other.
 *
 * @param key - Logical event key for visibility buffering pending entries
 * @param mode - `'save-last'` replays latest data; `'signal'` replays `signalValue`
 * @param signalValue - Value to replay in `'signal'` mode (typically `undefined`)
 */
export function createRpcEvent<T>(key: string, mode: 'save-last' | 'signal', signalValue?: T): RpcEvent<T> {
	const handlers = new Map<symbol, (data: T) => void>();
	const registrations = new Set<EventRegistration>();
	return {
		subscribe: function (
			buffer?: EventVisibilityBuffer,
			tracker?: SubscriptionTracker,
			replay?: () => T | undefined,
		): RpcEventSubscription<T> {
			return function (handler: (data: T) => void): Unsubscribe {
				const pendingKey = Symbol(key);
				const buffered = bufferEventHandler(buffer, pendingKey, handler, mode, signalValue);
				const sym = Symbol();
				return trackRpcRegistration(registrations, tracker, () => {
					handlers.set(sym, buffered);

					const current = replay?.();
					if (current !== undefined) {
						buffered(current);
					}
					return () => {
						buffer?.removePending(pendingKey);
						handlers.delete(sym);
					};
				});
			};
		},
		fire: function (data: T): void {
			for (const handler of [...handlers.values()]) {
				handler(data);
			}
		},
	};
}

/**
 * Creates an `RpcEventSubscription` backed by a VS Code `Disposable` event source.
 *
 * Standard pattern for the common case: Container event emitter → buffered handler → cleanup.
 * The `subscribe` function receives the already-buffered handler and returns a `Disposable`.
 *
 * The `subscribe` callback runs LAZILY — only when a client registers a handler, and once per
 * registration. It must never be the sole updater of a bridged `Signal.State`: a webview that
 * reads the signal without subscribing gets a permanently frozen value (#5513). Keep signals
 * fresh with an eagerly-registered listener instead — see `SubscriptionService`'s constructor.
 *
 * For custom patterns (aggregation, handler maps, replay-on-subscribe), use `bufferEventHandler` directly.
 *
 * Registrations are session-scoped — see {@link SubscriptionTracker.releaseAllExcept} for the full
 * contract. One consequence specific to this factory: superseding is deferred past the new
 * `subscribe(...)` call, so a source that only supports one live listener briefly sees two attached
 * at once — the safer trade (see that method for why).
 *
 * @param buffer - Optional visibility buffer (undefined = no buffering)
 * @param key - Logical event key used to create a per-subscription pending entry
 * @param mode - `'save-last'` replays latest data; `'signal'` replays `signalValue`
 * @param subscribe - Receives buffered handler, returns Disposable to clean up
 * @param signalValue - Value to replay in `'signal'` mode (typically `undefined`)
 * @param tracker - Optional subscription tracker for disposal on reconnection
 */
export function createRpcEventSubscription<T>(
	buffer: EventVisibilityBuffer | undefined,
	key: string,
	mode: 'save-last' | 'signal',
	subscribe: (bufferedHandler: (data: T) => void) => Disposable,
	signalValue?: T,
	tracker?: SubscriptionTracker,
): RpcEventSubscription<T> {
	const registrations = new Set<EventRegistration>();

	return (handler: (data: T) => void): Unsubscribe => {
		const pendingKey = Symbol(key);
		const buffered = bufferEventHandler(buffer, pendingKey, handler, mode, signalValue);
		return trackRpcRegistration(registrations, tracker, () => {
			const disposable = subscribe(buffered);
			return () => {
				buffer?.removePending(pendingKey);
				disposable.dispose();
			};
		});
	};
}
