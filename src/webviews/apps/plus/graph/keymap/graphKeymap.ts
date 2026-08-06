import { KeymapDispatcher } from '../../../shared/keymap/keymapDispatcher.js';

/** Scopes recognized by the graph webview's key dispatcher, innermost-first when they nest (e.g. a
 *  focused row control is inside the rows scope, which is inside the webview scope). Scope
 *  registration (roots/selectors/guards) lives in `graph-app.ts` since it owns the elements. */
export type GraphKeymapScope =
	| 'window'
	| 'webview'
	| 'webviewGlobal'
	| 'rows'
	| 'rowControl'
	| 'pillMenu'
	| 'searchBox'
	| 'sidebarFilter'
	| 'tree';

/** Creates the graph webview's key dispatcher. Scopes and bindings are registered by consumers
 *  (`graph-app.ts` and friends), not here. */
export function createGraphKeymapDispatcher(isMac: boolean): KeymapDispatcher<GraphKeymapScope> {
	return new KeymapDispatcher<GraphKeymapScope>({ isMac: isMac });
}
