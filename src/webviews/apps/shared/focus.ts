import { debounce } from '@gitlens/utils/debounce.js';
import { WebviewFocusChangedCommand } from '../../protocol.js';
import { getHostIpcApi } from './ipc.js';

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
