'use strict';
/*global document*/

export interface Disposable {
	dispose: () => void;
}

export namespace DOM {
	export function on<K extends keyof DocumentEventMap, T extends Element>(
		selector: string,
		name: K,
		listener: (this: T, ev: DocumentEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions,
		el?: Element,
	): Disposable;
	export function on<K extends keyof DocumentEventMap, T extends Element>(
		el: Document | Element,
		name: K,
		listener: (this: T, ev: DocumentEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<K extends keyof WindowEventMap, T extends Element>(
		el: Window,
		name: K,
		listener: (this: T, ev: WindowEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<K extends keyof (DocumentEventMap | WindowEventMap), T extends Element>(
		selectorOrElement: string | Window | Document | Element,
		name: K,
		listener: (this: T, ev: (DocumentEventMap | WindowEventMap)[K]) => any,
		options?: boolean | AddEventListenerOptions,
		el?: Element,
	): Disposable {
		let disposed = false;

		if (typeof selectorOrElement === 'string') {
			const $els = (el ?? document).querySelectorAll(selectorOrElement);
			for (const $el of $els) {
				$el.addEventListener(name, listener as EventListener, options ?? false);
			}

			return {
				dispose: () => {
					if (disposed) return;
					disposed = true;

					for (const $el of $els) {
						$el.removeEventListener(name, listener as EventListener, options ?? false);
					}
				},
			};
		}

		selectorOrElement.addEventListener(name, listener as EventListener, options ?? false);
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;

				selectorOrElement.removeEventListener(name, listener as EventListener, options ?? false);
			},
		};
	}
}
