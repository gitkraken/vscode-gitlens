/**
 * A selection the graph has been asked to make but can't yet, because the row isn't renderable.
 *
 * Reveal already had this: `scrollToSha` holds a pending scroll until its row appears. Selection had
 * no equivalent, so a row that materialized late — a WIP row the next decoration synthesizes, or a
 * commit the host pages in — was scrolled to but never selected. Callers that set the details anchor
 * first masked it; the scope, overview and jump paths don't all do that.
 *
 * Modeled as an INTENT rather than a retry loop, so the rules are explicit and testable:
 * - the newest ask supersedes any older one still waiting;
 * - user intent (a click, a keyboard select) cancels a queued ask outright — landing it afterwards
 *   would move the user off what they just picked;
 * - an ask whose row is already renderable never becomes pending at all;
 * - an ask waits only so long — see {@link retention}.
 */
export class GraphSelectIntent {
	private _sha: string | undefined;
	private _deferredAt = 0;
	private _generation = 0;

	/**
	 * @param retention How long, in ms, a deferred ask stays live. Bounded because a row can stay
	 * unrenderable FOREVER — filtered out by branch visibility, an active scope, a search filter — and an
	 * unbounded ask would land minutes later, on whatever unrelated toggle finally reveals its row.
	 * Wall-clock rather than a render/frame budget: a row nothing is rendering produces no renders to
	 * count down against, so a budget would never expire in exactly the case that needs the bound.
	 */
	constructor(private readonly retention: number = 10_000) {}

	/** The sha awaiting selection, or `undefined` when nothing is queued (or the queued ask has expired). */
	get pending(): string | undefined {
		return this.expired ? undefined : this._sha;
	}

	private get expired(): boolean {
		return this._sha != null && Date.now() - this._deferredAt >= this.retention;
	}

	/** Whether an async continuation still owns the current intent. */
	isCurrent(generation: number): boolean {
		return generation === this._generation;
	}

	/**
	 * Opens a new ask and returns its generation token. Supersedes whatever was queued — call this on
	 * EVERY entry to the select path, before deciding whether the row is renderable, so a superseded
	 * ask can't resurrect itself from an async continuation.
	 */
	begin(): number {
		this._sha = undefined;
		return ++this._generation;
	}

	/**
	 * Queues `sha` for selection once its row appears — ignored when `generation` is stale, which is how
	 * an async caller (a host round-trip) declines to overwrite a newer ask that landed while it waited.
	 */
	defer(sha: string, generation: number): void {
		if (generation !== this._generation) return;

		this._sha = sha;
		this._deferredAt = Date.now();
	}

	/**
	 * Close an ask that failed to materialize. Returns true only when `generation` still owns the
	 * current intent, so a late failure from an older load cannot cancel a newer selection.
	 */
	reject(generation: number): boolean {
		if (generation !== this._generation) return false;

		this._generation++;
		this._sha = undefined;
		return true;
	}

	/** Cancels any queued ask. Used for user-originated selection, which always outranks a queued jump. */
	cancel(): void {
		this._generation++;
		this._sha = undefined;
	}

	/**
	 * Returns the queued sha and clears it when `isRenderable` says its row has arrived; returns
	 * `undefined` otherwise, leaving the ask queued for a later attempt — until it outlives `retention`,
	 * at which point it is dropped instead of firing out of context.
	 */
	take(isRenderable: (sha: string) => boolean): string | undefined {
		const sha = this._sha;
		if (sha == null) return undefined;

		if (this.expired) {
			this._sha = undefined;
			return undefined;
		}

		if (!isRenderable(sha)) return undefined;

		this._sha = undefined;
		return sha;
	}
}
