/** Closed scope vocabulary compiled into the graph's key dispatcher at startup, innermost-first when they
 *  nest (e.g. a focused row control is inside the rows scope, which is inside the webview scope). Scope
 *  registration (roots/selectors/guards) is the host's — in GitLens, `keymap/registerKeymap.ts`. */
export type GraphKeymapScope =
	| 'webview'
	| 'webviewGlobal'
	| 'rows'
	| 'rowControl'
	| 'pillMenu'
	| 'sidebarFilter'
	| 'tree';
