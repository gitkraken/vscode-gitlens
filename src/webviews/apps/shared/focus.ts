import { debounce } from '@gitlens/utils/debounce.js';

/**
 * Blurs the currently focused element, if any.
 *
 * Used by the search input to intentionally drop focus and close its autocomplete dropdown;
 * every exit path there refocuses afterwards. For opening a host-side quick pick, use
 * {@link waitForFocusSettled} instead — blurring first costs a cancelled picker its focus
 * return.
 */
export function blurActiveElement(): void {
	// No-op without a DOM — action-layer callers (e.g. `DetailsActions`) also run in headless
	// unit-test bundles, where a bare `document` dereference rejects the whole action.
	if (typeof document === 'undefined') return;

	const active = document.activeElement;
	if (active instanceof HTMLElement && active !== document.body) {
		active.blur();
	}
}

/** Fallback wait for a focus grant that never lands, in milliseconds. */
const focusSettleTimeoutMs = 250;

/**
 * Waits for a pending window focus grant to land before returning.
 *
 * Opening a VS Code quick pick from a click handler races the click's focus delivery into the
 * webview: if the webview (re)gains focus after the quick pick shows, VS Code dismisses it — the
 * picker flashes open then immediately closes. The race only exists when the webview did not
 * already have focus at click time, since the grant is what's in flight; once it lands, opening
 * the picker is safe. Waiting (rather than blurring first) keeps focus on the activated element
 * throughout, so a cancelled picker returns the user exactly where they were — pointer and
 * keyboard alike.
 *
 * No-ops (resolves immediately) without a DOM, or when the document already has focus — the
 * common case, where there's no pending grant to wait for and callers in hot paths shouldn't pay
 * more than the `await` itself. Otherwise resolves on the window's next `focus` event, with a
 * timeout fallback so a grant that never arrives can't hang the caller.
 */
export function waitForFocusSettled(): Promise<void> {
	if (typeof document === 'undefined' || document.hasFocus()) return Promise.resolve();

	return new Promise<void>(resolve => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout>;

		const onFocus = () => {
			if (settled) return;

			settled = true;
			clearTimeout(timer);
			window.removeEventListener('focus', onFocus);
			resolve();
		};

		timer = setTimeout(onFocus, focusSettleTimeoutMs);
		window.addEventListener('focus', onFocus);
	});
}

/**
 * Creates a focus tracker that sends focus state to the host via the injected sender.
 * The host uses this to update VS Code context keys for menus/keybindings.
 *
 * Usage:
 * ```typescript
 * const focus = createFocusTracker(params => this._rpc?.sendFocusChanged(params));
 * document.addEventListener('focusin', focus.onFocusIn);
 * document.addEventListener('focusout', focus.onFocusOut);
 * // On cleanup:
 * document.removeEventListener('focusin', focus.onFocusIn);
 * document.removeEventListener('focusout', focus.onFocusOut);
 * ```
 */
export function createFocusTracker(sender: (params: { focused: boolean; inputFocused: boolean }) => void): {
	onFocusIn: (e: FocusEvent) => void;
	onFocusOut: (e: FocusEvent) => void;
} {
	let focused: boolean | undefined;
	let inputFocused: boolean | undefined;

	const sendFocusChanged = debounce((params: { focused: boolean; inputFocused: boolean }) => {
		// Re-verify the actual focus state when the debouncer fires.
		// This prevents false "blurs" when clicking non-focusable internal elements,
		// where focusout fires but the document retains focus.
		const actualFocused = document.hasFocus();
		params.focused = actualFocused;
		if (!actualFocused) {
			params.inputFocused = false;
		}

		sender(params);
	}, 150);

	return {
		onFocusIn: (e: FocusEvent) => {
			const isInputFocused = e.composedPath().some(el => (el as HTMLElement).tagName === 'INPUT');
			if (focused !== true || inputFocused !== isInputFocused) {
				focused = true;
				inputFocused = isInputFocused;
				sendFocusChanged({ focused: true, inputFocused: isInputFocused });
			}
		},
		onFocusOut: (_e: FocusEvent) => {
			// Let the debouncer handle the final actual state determination
			sendFocusChanged({ focused: false, inputFocused: false });
		},
	};
}
