/*global document*/

export interface Disposable {
	dispose: () => void;
}

// oxlint-disable-next-line typescript/no-namespace
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
	export function on<T extends HTMLElement, K>(
		element: T,
		name: string,
		listener: (e: CustomEvent<K> & { target: HTMLElement | null }, target: T) => void,
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
			listener(e, this);
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

/**
 * Opens the host context menu for `target` as if it had been right-clicked at its bottom-left corner
 * — the affordance behind "kebab" buttons that surface a row's normal context menu.
 *
 * `composed` is required so the event escapes the component's shadow root and reaches the document
 * listener that VS Code's menu is wired to.
 */
export function dispatchContextMenuAt(target: HTMLElement): void {
	const rect = target.getBoundingClientRect();
	target.dispatchEvent(
		new MouseEvent('contextmenu', {
			bubbles: true,
			composed: true,
			cancelable: true,
			clientX: rect.left,
			clientY: rect.bottom,
			button: 2,
		}),
	);
}

/** `<input>` types that take no typed text, so a bare-key shortcut may still claim the keystroke. */
const nonTextInputTypes = new Set([
	'button',
	'checkbox',
	'color',
	'file',
	'image',
	'radio',
	'range',
	'reset',
	'submit',
]);

/**
 * Whether an event originated in a text-entry surface — the guard an app-level single-key shortcut
 * (e.g. the Commit Graph's `/`) needs so it never swallows a keystroke meant for typing.
 *
 * Walks the COMPOSED path rather than reading `event.target`, because a `document`-level listener sees
 * the target retargeted to the outermost shadow host — for the commit search box that's
 * `<gl-search-box>`, two shadow roots above the `<input>`.
 *
 * Checkbox and radio `<input>`s don't count: `gl-checkbox` / `gl-radio` delegate focus into a real
 * `<input>`, and a shortcut should still fire while one of those holds focus. Unrecognized input types
 * DO count, so a new text-ish type errs toward keeping the keystroke.
 */
export function isTextEntryTarget(event: Event): boolean {
	return event.composedPath().some(el => {
		const target = el as HTMLElement & { type?: string };
		switch (target.tagName) {
			case 'INPUT':
				return !nonTextInputTypes.has(target.type ?? 'text');
			case 'TEXTAREA':
			case 'SELECT':
				return true;
			default:
				return target.isContentEditable === true;
		}
	});
}

/** Parses a CSS duration and returns the number of milliseconds. */
export function parseDuration(delay: number | string): number {
	delay = delay.toString().toLowerCase();

	if (delay.includes('ms')) {
		return parseFloat(delay);
	}

	if (delay.includes('s')) {
		return parseFloat(delay) * 1000;
	}

	return parseFloat(delay);
}

/** Waits for a specific event to be emitted from an element. Ignores events that bubble up from child elements. */
export function waitForEvent(el: HTMLElement, eventName: string): Promise<void> {
	return new Promise<void>(resolve => {
		function done(event: Event) {
			if (event.target === el) {
				el.removeEventListener(eventName, done);
				resolve();
			}
		}

		el.addEventListener(eventName, done);
	});
}
