/** Single-flight async runner with one trailing rerun: `run()` while a run is in flight joins the
 *  SAME promise and marks it dirty; when the run settles (resolve OR reject), one trailing `refire`
 *  fires so state that changed mid-run is re-processed. `refire` should re-enter the owner's calling
 *  method (which applies its own gates) — fire-and-forget. `markDirty()` forces the trailing refire
 *  (e.g. on a repo swap mid-run) without joining. */
export class CoalescedRun<T> {
	private _dirty = false;
	private _inflight: Promise<T> | undefined;

	constructor(
		private readonly fn: () => Promise<T>,
		private readonly refire: () => void,
	) {}

	get running(): boolean {
		return this._inflight != null;
	}

	markDirty(): void {
		if (this._inflight != null) {
			this._dirty = true;
		}
	}

	run(): Promise<T> {
		if (this._inflight != null) {
			this._dirty = true;
			return this._inflight;
		}

		// Defer `fn` to a microtask so `_inflight` is assigned BEFORE any of fn's code runs — a
		// synchronous reentrant `run()` from fn's prologue then joins instead of double-running.
		const promise = Promise.resolve()
			.then(this.fn)
			.finally(() => {
				this._inflight = undefined;
				if (this._dirty) {
					this._dirty = false;
					this.refire();
				}
			});
		this._inflight = promise;
		return promise;
	}
}
