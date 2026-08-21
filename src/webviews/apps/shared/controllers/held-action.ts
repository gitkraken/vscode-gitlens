import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Holds an action for a grace window before running it — the click half of a click/double-click
 * vocabulary. A `dblclick` can only be recognized AFTER its two clicks have fired, so a
 * single-click action with side effects must wait out the window and let the double-click's
 * handler {@link cancel} it. Re-holding restarts the window and discards the previously held
 * action (latest wins). Cleans itself up on host disconnect — no manual `clearTimeout` in
 * `disconnectedCallback`.
 */
export class HeldActionController implements ReactiveController {
	private _timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		host: ReactiveControllerHost,
		private readonly delayMs: number,
	) {
		host.addController(this);
	}

	hostDisconnected(): void {
		this.cancel();
	}

	/** Whether an action is currently held (armed but not yet run). */
	get pending(): boolean {
		return this._timer != null;
	}

	/** (Re)arms the window with `action`, discarding any previously held one. */
	hold(action: () => void): void {
		this.cancel();
		this._timer = setTimeout(() => {
			this._timer = undefined;
			action();
		}, this.delayMs);
	}

	/** Drops the held action without running it. */
	cancel(): void {
		if (this._timer == null) return;

		clearTimeout(this._timer);
		this._timer = undefined;
	}
}
