import type { GraphKeymapScope } from '@gitkraken/commit-graph-ui/contracts/keyboard.js';
import { KeymapDispatcher } from '@gitlens/utils/keys/keymapDispatcher.js';

/** Creates the graph webview's key dispatcher. Scopes and bindings are registered by consumers
 *  (`graph-app.ts` and friends), not here. */
export function createGraphKeymapDispatcher(isMac: boolean): KeymapDispatcher<GraphKeymapScope> {
	return new KeymapDispatcher<GraphKeymapScope>({ isMac: isMac });
}
