import type { EventEmitter as VSCodeEventEmitter } from 'vscode';

export interface Disposable {
	dispose(): void;
}

export type Event<T> = (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => Disposable;

export class Emitter<T> implements VSCodeEventEmitter<T> {
	private static readonly _type = 'fire';
	private static readonly _noop = function (this: void) {
		/* noop */
	};

	private _target?: EventTarget;
	private _disposed = false;
	private _event?: Event<T>;

	/**
	 * For the public to allow to subscribe
	 * to events from this Emitter
	 */
	get event(): Event<T> {
		this._event ??= (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => {
			if (this._disposed) return { dispose: Emitter._noop };

			this._target ??= new EventTarget();

			const handler: EventListener = e => {
				try {
					listener.call(thisArgs, (e as CustomEvent<T>).detail);
				} catch (ex) {
					console.error('Error in event listener:', ex);
				}
			};
			this._target.addEventListener(Emitter._type, handler);

			const result: Disposable = {
				dispose: () => {
					result.dispose = Emitter._noop;
					this._target?.removeEventListener(Emitter._type, handler);
				},
			};

			disposables?.push(result);
			return result;
		};
		return this._event;
	}

	/**
	 * To be kept private to fire an event to
	 * subscribers
	 */
	fire(data: T): void {
		if (this._disposed) return;

		this._target?.dispatchEvent(new CustomEvent(Emitter._type, { detail: data }));
	}

	dispose(): void {
		this._disposed = true;
		this._target = undefined; // orphans all listeners for GC
	}
}
