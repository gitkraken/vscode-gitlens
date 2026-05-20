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
		window.addEventListener('blur', this._onBlur);
	}

	private _stop(): void {
		this._listening = false;
		window.removeEventListener('keydown', this._onKey, { capture: true });
		window.removeEventListener('keyup', this._onKey, { capture: true });
		window.removeEventListener('mousemove', this._onPointer, { capture: true });
		window.removeEventListener('mouseover', this._onPointer, { capture: true });
		window.removeEventListener('blur', this._onBlur);
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

	private _onBlur = (): void => {
		this._reset();
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
