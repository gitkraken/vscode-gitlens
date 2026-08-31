import type { GraphKeymapScope } from '@gitkraken/commit-graph-ui/contracts/keyboard.js';
import { KeymapDispatcher } from '@gitlens/utils/keys/keymapDispatcher.js';

export type { GraphKeymapScope } from '@gitkraken/commit-graph-ui/contracts/keyboard.js';

/** Scopes recognized by the graph webview's key dispatcher, innermost-first when they nest (e.g. a
 *  focused row control is inside the rows scope, which is inside the webview scope). Scope
 *  registration (roots/selectors/guards) lives in `keymap/registerKeymap.ts`. */
/** Creates the graph webview's key dispatcher. Scopes and bindings are registered by consumers
 *  (`graph-app.ts` and friends), not here. */
export function createGraphKeymapDispatcher(isMac: boolean): KeymapDispatcher<GraphKeymapScope> {
	return new KeymapDispatcher<GraphKeymapScope>({ isMac: isMac });
}
