/*global document*/

export interface Disposable {
	dispose: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace DOM {
	export function on<K extends keyof WindowEventMap>(
		window: Window,
		name: K,
		listener: (e: WindowEventMap[K], target: Window) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<K extends keyof DocumentEventMap>(
		document: Document,
		name: K,
		listener: (e: DocumentEventMap[K], target: Document) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<T extends HTMLElement, K extends keyof DocumentEventMap>(
		element: T,
		name: K,
		listener: (e: DocumentEventMap[K] & { target: HTMLElement | null }, target: T) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<T extends Element, K extends keyof DocumentEventMap>(
		selector: string,
		name: K,
		listener: (e: DocumentEventMap[K] & { target: HTMLElement | null }, target: T) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<T extends HTMLElement, K>(
		selector: string,
		name: string,
		listener: (e: CustomEvent<K> & { target: HTMLElement | null }, target: T) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable;
	export function on<K extends keyof (DocumentEventMap | WindowEventMap), T extends Document | Element | Window>(
		sourceOrSelector: string | Window | Document | Element,
		name: K,
		listener: (e: (DocumentEventMap | WindowEventMap)[K] | CustomEvent<K>, target: T) => void,
		options?: boolean | AddEventListenerOptions,
	): Disposable {
		let disposed = false;

		if (typeof sourceOrSelector === 'string') {
			const filteredListener = function (this: T, e: (DocumentEventMap | WindowEventMap)[K]) {
				const target = (e?.target as HTMLElement)?.closest(sourceOrSelector) as unknown as T | null | undefined;
				if (target == null) return;

				listener(e, target);
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

	export function insertTemplate(
		id: string,
		$slot: HTMLElement,
		options?: { bindings?: Record<string, unknown>; visible?: Record<string, boolean> },
	): void {
		const $template = document.getElementById(id) as HTMLTemplateElement;
		$slot.replaceChildren($template?.content.cloneNode(true));
		$slot.className = $template.className;

		if (options?.visible != null) {
			const $els = $slot.querySelectorAll<HTMLElement>(`[data-visible]`);
			for (const $el of $els) {
				const key = $el.dataset.visible;
				if (!key) continue;

				if (options.visible[key]) {
					$el.style.display = 'initial';
				} else {
					$el.style.display = 'none';
				}
			}
		}

		if (options?.bindings != null) {
			const $els = $slot.querySelectorAll<HTMLElement>(`[data-bind]`);
			for (const $el of $els) {
				const key = $el.dataset.bind;
				if (!key) continue;

				const value = options.bindings[key];
				if (value == null) continue;

				$el.textContent = String(value);
			}
		}
	}

	export function resetSlot($slot: HTMLElement) {
		$slot.replaceChildren();
		$slot.className = '';
	}
}
