import type { ReactiveController, ReactiveControllerHost } from 'lit';

class ModifierKeysTracker {
	private _altKey = false;
	private _shiftKey = false;
	private _ctrlKey = false;
	private _metaKey = false;
	private _hosts = new Set<ReactiveControllerHost>();
	private _listening = false;

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
		// alone doesn't grant focus, so hover-triggered tooltips can't react to alt presses
		// through the keyboard path. Pointer events always carry the live modifier state in
		// their `MouseEvent`, so listening to them here lets the tracker pick up alt the moment
		// the user moves the mouse (no focus required).
		window.addEventListener('mousemove', this._onPointer, { capture: true });
		window.addEventListener('mouseover', this._onPointer, { capture: true });
		// Reset on genuine backgrounding (tab/window hidden) — NOT on plain `blur`. Tapping Alt
		// activates the OS/VS Code menu bar on Windows/Linux, which fires `blur` on the webview a
		// frame after the alt `keydown`; resetting there would instantly revert an alt-driven
		// tooltip swap (the "tooltip won't change on Alt" bug). Stuck modifiers from alt-tab are
		// self-correcting anyway — every pointer event re-syncs the exact modifier state — so a
		// visibility-gated reset is sufficient without clobbering the transient menu-bar blur.
		document.addEventListener('visibilitychange', this._onVisibilityChange);
	}

	private _stop(): void {
		this._listening = false;
		window.removeEventListener('keydown', this._onKey, { capture: true });
		window.removeEventListener('keyup', this._onKey, { capture: true });
		window.removeEventListener('mousemove', this._onPointer, { capture: true });
		window.removeEventListener('mouseover', this._onPointer, { capture: true });
		document.removeEventListener('visibilitychange', this._onVisibilityChange);
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
