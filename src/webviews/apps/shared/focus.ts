import { debounce } from '@gitlens/utils/debounce.js';
import { WebviewFocusChangedCommand } from '../../protocol.js';
import { getHostIpcApi } from './ipc.js';

/**
 * Blurs the currently focused element, if any.
 *
 * Call this before requesting a host-side quick pick from a click handler. Opening a VS Code
 * quick pick races the click's focus delivery into the webview: if the webview (re)gains focus
 * after the quick pick shows, VS Code hides it — the picker flashes open then immediately closes.
 * Releasing focus up front removes the pending focus transfer so the quick pick keeps focus with
 * its normal dismiss-on-focus-out semantics intact.
 */
export function blurActiveElement(): void {
	const active = document.activeElement;
	if (active instanceof HTMLElement && active !== document.body) {
		active.blur();
	}
}

/**
 * Creates a focus tracker that sends focus state to the host via IPC.
 * The host uses this to update VS Code context keys for menus/keybindings.
 *
 * Usage:
 * ```typescript
 * const focus = createFocusTracker();
 * document.addEventListener('focusin', focus.onFocusIn);
 * document.addEventListener('focusout', focus.onFocusOut);
 * // On cleanup:
 * document.removeEventListener('focusin', focus.onFocusIn);
 * document.removeEventListener('focusout', focus.onFocusOut);
 * ```
 */
export function createFocusTracker(): { onFocusIn: (e: FocusEvent) => void; onFocusOut: (e: FocusEvent) => void } {
	let focused: boolean | undefined;
	let inputFocused: boolean | undefined;
	let ipcIdCounter = 0;

	const sendFocusChanged = debounce((params: { focused: boolean; inputFocused: boolean }) => {
		const id = `webview:${++ipcIdCounter}`;

		// Re-verify the actual focus state when the debouncer fires.
		// This prevents false "blurs" when clicking non-focusable internal elements,
		// where focusout fires but the document retains focus.
		const actualFocused = document.hasFocus();
		params.focused = actualFocused;
		if (!actualFocused) {
			params.inputFocused = false;
		}

		getHostIpcApi().postMessage({
			id: id,
			scope: WebviewFocusChangedCommand.scope,
			method: WebviewFocusChangedCommand.method,
			params: params,
			compressed: false,
			timestamp: Date.now(),
		});
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
