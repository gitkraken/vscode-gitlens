import type {
	GraphKeymapScope as GraphElementKeymapScope,
	GraphKeymap,
} from '@gitkraken/commit-graph-ui/contracts/keyboard.js';
import { KeymapDispatcher } from '@gitlens/utils/keys/keymapDispatcher.js';
import { Logger } from '@gitlens/utils/logger.js';

export type GraphKeymapScope = GraphElementKeymapScope | 'webview' | 'webviewGlobal' | 'sidebarFilter' | 'tree';

/** Creates the graph webview's key dispatcher. Scopes and bindings are registered by consumers
 *  (`graph-app.ts` and friends), not here. */
export function createGraphKeymapDispatcher(isMac: boolean): KeymapDispatcher<GraphKeymapScope> {
	return new KeymapDispatcher<GraphKeymapScope>({
		isMac: isMac,
		onWarn: message => Logger.warn(`[graph keymap] ${message}`),
	});
}

export function toGraphElementKeymap(dispatcher: KeymapDispatcher<GraphKeymapScope>): GraphKeymap {
	return { attach: () => dispatcher.createRegistrar() };
}
