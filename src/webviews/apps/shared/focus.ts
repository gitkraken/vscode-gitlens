import { debounce } from '../../../system/function/debounce.js';
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
			if (focused !== false || inputFocused !== false) {
				focused = false;
				inputFocused = false;
				sendFocusChanged({ focused: false, inputFocused: false });
			}
		},
	};
}
