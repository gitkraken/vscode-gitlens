/*global document*/

export interface Disposable {
	dispose: () => void;
}

export namespace DOM {
	export function on<K extends keyof WindowEventMap>(
		window: Window,
		name: K,
		listener: (e: WindowEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<K extends keyof DocumentEventMap>(
		document: Document,
		name: K,
		listener: (e: DocumentEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<K extends keyof DocumentEventMap>(
		element: Element,
		name: K,
		listener: (e: DocumentEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<T extends Element, K extends keyof DocumentEventMap>(
		selector: string,
		name: K,
		listener: (e: DocumentEventMap[K], target: T) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<K extends keyof (DocumentEventMap | WindowEventMap), T extends Document | Element | Window>(
		sourceOrSelector: string | Window | Document | Element,
		name: K,
		listener: (e: (DocumentEventMap | WindowEventMap)[K], target: T) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable {
		let disposed = false;

		if (typeof sourceOrSelector === 'string') {
			const filteredListener = function (this: T, e: (DocumentEventMap | WindowEventMap)[K]) {
				const target = e?.target as HTMLElement;
				if (!target?.matches(sourceOrSelector)) return;

				listener(e, target as unknown as T);
			};
			document.addEventListener(name, filteredListener as EventListener, options ?? true);

			return {
				dispose: () => {
					if (disposed) return;
					disposed = true;

					document.removeEventListener(name, filteredListener as EventListener, options ?? true);
				},
			};
		}

		const newListener = function (this: T, e: (DocumentEventMap | WindowEventMap)[K]) {
			listener(e, this as unknown as T);
		};
		sourceOrSelector.addEventListener(name, newListener as EventListener, options ?? false);
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;

				sourceOrSelector.removeEventListener(name, newListener as EventListener, options ?? false);
			},
		};
	}
}
