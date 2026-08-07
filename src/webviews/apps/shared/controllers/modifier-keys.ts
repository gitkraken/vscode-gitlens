import type { ReactiveController, ReactiveControllerHost } from 'lit';

class ModifierKeysTracker {
	private _altKey = false;
	private _shiftKey = false;
	private _ctrlKey = false;
	private _metaKey = false;
	private _hosts = new Set<ReactiveControllerHost>();
	private _listening = false;
	private _focusOutCheckTimer: ReturnType<typeof setTimeout> | undefined;

	get altKey(): boolean {
		return this._altKey;
	}
	get shiftKey(): boolean {
		return this._shiftKey;
	}
	get ctrlKey(): boolean {
		return this._ctrlKey;
	}
	get metaKey(): boolean {
		return this._metaKey;
	}

	subscribe(host: ReactiveControllerHost): () => void {
		this._hosts.add(host);
		if (!this._listening) {
			this._start();
		}
		return () => {
			this._hosts.delete(host);
			if (this._hosts.size === 0) {
				this._stop();
			}
		};
	}

	private _start(): void {
		this._listening = true;
		window.addEventListener('keydown', this._onKey, { capture: true });
		window.addEventListener('keyup', this._onKey, { capture: true });
		// `keydown`/`keyup` only fire when the webview iframe has keyboard focus — mouse hover
		// alone doesn't grant focus, so hover-triggered tooltips can't react to modifier presses
		// through the keyboard path. `mousemove` always carries the live modifier state, so
		// listening to it lets the tracker pick up a held modifier the moment the user moves the
		// mouse (no focus required). `mousemove` ONLY — deliberately not `mouseover`: after a
		// scroll moves content under a static cursor, Chromium fires a SYNTHESIZED boundary
		// `mouseover` (no accompanying mousemove) whose modifier flags don't reliably reflect the
		// held keys — it reported the hold modifier as up mid-hold, momentarily killing the graph's
		// lane dim and letting the hover card through until the next genuine move corrected it.
		// Genuine motion always produces `mousemove`; the synthesized-after-scroll case is the only
		// signal `mouseover` uniquely added, and it lies.
		window.addEventListener('mousemove', this._onPointer, { capture: true });
		// Reset on genuine backgrounding (tab/window hidden) — NOT on plain `blur`. Tapping Alt
		// activates the OS/VS Code menu bar on Windows/Linux, which fires `blur` on the webview a
		// frame after the alt `keydown`; resetting there would instantly revert an alt-driven
		// tooltip swap (the "tooltip won't change on Alt" bug).
		document.addEventListener('visibilitychange', this._onVisibilityChange);
		// Also reset once focus genuinely LEAVES the webview (a click into an editor or another view,
		// a quick pick). None of the paths above catch that: the webview stays visible, the keyup
		// lands wherever focus went, and the pointer is outside so nothing re-syncs — the state
		// sticks, visibly so as the graph's Ctrl-hold row dim. The menu-bar steal above does fire a
		// focusout of its own, but only once the alt TAP completes — keydown, keyup, then
		// blur/focusout — so it lands after the keyup has already cleared the modifiers and `_reset()`
		// no-ops on its `changed` guard; a hold keeps focus for its whole duration. `_onFocusOut`
		// filters the in-webview churn.
		document.addEventListener('focusout', this._onFocusOut);
	}

	private _stop(): void {
		this._listening = false;
		window.removeEventListener('keydown', this._onKey, { capture: true });
		window.removeEventListener('keyup', this._onKey, { capture: true });
		window.removeEventListener('mousemove', this._onPointer, { capture: true });
		document.removeEventListener('visibilitychange', this._onVisibilityChange);
		document.removeEventListener('focusout', this._onFocusOut);
		if (this._focusOutCheckTimer != null) {
			clearTimeout(this._focusOutCheckTimer);
			this._focusOutCheckTimer = undefined;
		}
		this._reset();
	}

	private _reset(): void {
		const changed = this._altKey || this._shiftKey || this._ctrlKey || this._metaKey;
		this._altKey = this._shiftKey = this._ctrlKey = this._metaKey = false;
		if (changed) {
			this._notify();
		}
	}

	private _onKey = (e: KeyboardEvent): void => {
		// On keydown, also flip the matching modifier when the key itself is the modifier — at
		// that moment `e.altKey` is still false for the very keydown that caused alt to engage.
		const altDown = e.altKey || (e.type === 'keydown' && e.key === 'Alt');
		const shiftDown = e.shiftKey || (e.type === 'keydown' && e.key === 'Shift');
		const ctrlDown = e.ctrlKey || (e.type === 'keydown' && e.key === 'Control');
		const metaDown = e.metaKey || (e.type === 'keydown' && e.key === 'Meta');
		const alt = e.type === 'keyup' && e.key === 'Alt' ? false : altDown;
		const shift = e.type === 'keyup' && e.key === 'Shift' ? false : shiftDown;
		const ctrl = e.type === 'keyup' && e.key === 'Control' ? false : ctrlDown;
		const meta = e.type === 'keyup' && e.key === 'Meta' ? false : metaDown;
		if (this._altKey === alt && this._shiftKey === shift && this._ctrlKey === ctrl && this._metaKey === meta) {
			return;
		}

		this._altKey = alt;
		this._shiftKey = shift;
		this._ctrlKey = ctrl;
		this._metaKey = meta;
		this._notify();
	};

	private _onPointer = (e: MouseEvent): void => {
		if (
			this._altKey === e.altKey &&
			this._shiftKey === e.shiftKey &&
			this._ctrlKey === e.ctrlKey &&
			this._metaKey === e.metaKey
		) {
			return;
		}

		this._altKey = e.altKey;
		this._shiftKey = e.shiftKey;
		this._ctrlKey = e.ctrlKey;
		this._metaKey = e.metaKey;
		this._notify();
	};

	// `focusout` fires for focus moves WITHIN the webview too — including with a null `relatedTarget`
	// when a non-focusable element is clicked — so it can't be trusted on its own. Re-check one task
	// later, once focus has settled: `document.hasFocus()` stays true for any in-webview move and
	// goes false only when the document really lost focus. `setTimeout`, not `requestAnimationFrame`,
	// which is throttled while the document is backgrounded — the check still has to land.
	private _onFocusOut = (): void => {
		if (this._focusOutCheckTimer != null) return;

		this._focusOutCheckTimer = setTimeout(() => {
			this._focusOutCheckTimer = undefined;
			if (!document.hasFocus()) {
				this._reset();
			}
		}, 0);
	};

	private _onVisibilityChange = (): void => {
		// Only clear when the document is actually hidden (tab switch, window minimized). A reset
		// here can't fight the menu-bar blur because that doesn't change visibility.
		if (document.visibilityState === 'hidden') {
			this._reset();
		}
	};

	private _notify(): void {
		for (const host of this._hosts) {
			host.requestUpdate();
		}
	}
}

const tracker = new ModifierKeysTracker();

export class ModifierKeysController implements ReactiveController {
	private _unsubscribe: (() => void) | undefined;

	constructor(private readonly host: ReactiveControllerHost) {
		host.addController(this);
	}

	get altKey(): boolean {
		return tracker.altKey;
	}
	get shiftKey(): boolean {
		return tracker.shiftKey;
	}
	get ctrlKey(): boolean {
		return tracker.ctrlKey;
	}
	get metaKey(): boolean {
		return tracker.metaKey;
	}

	hostConnected(): void {
		this._unsubscribe = tracker.subscribe(this.host);
	}

	hostDisconnected(): void {
		this._unsubscribe?.();
		this._unsubscribe = undefined;
	}
}
