import type { GraphDisplayMode, GraphSidebarPanel } from '../../../../plus/graph/protocol.js';
import type { GlFileTreePane } from '../../../shared/components/tree/gl-file-tree-pane.js';
import type { GlTreeView } from '../../../shared/components/tree/tree-view.js';
import { isTextEntryTarget } from '../../../shared/dom.js';
import type { KeymapDispatcher } from '../../../shared/keymap/keymapDispatcher.js';
import type { OverviewBarItem, OverviewBarSelectDetail } from '../components/gl-graph-overview-bar.js';
import type { GlGraphHeader } from '../graph-header.js';
import type { GlGraphWrapper } from '../graph-wrapper/graph-wrapper.js';
import type { GlGraphSidebarPanel } from '../sidebar/sidebar-panel.js';
import { visibleSidebarPanels } from '../sidebar/sidebarPanels.js';
import type { GraphKeymapScope } from './graphKeymap.js';

/** Maps a numeric-row `KeyboardEvent.code` (`Digit0`-`Digit9`) to the shortcut index it represents:
 *  `Digit1`-`Digit9` → 0-8, `Digit0` → 9 (the 10th item). `undefined` for anything else, including the
 *  numpad's own `Numpad0`-`Numpad9` codes — only the numeric row keys these shortcuts. */
function digitIndexFromCode(code: string): number | undefined {
	if (!code.startsWith('Digit')) return undefined;

	const digit = Number(code.slice('Digit'.length));
	if (!Number.isInteger(digit) || digit < 0 || digit > 9) return undefined;

	return digit === 0 ? 9 : digit - 1;
}

/** `.open` matters: after a dialog closes, focus can remain on a control still slotted INSIDE the closed
 *  <dialog> (native close doesn't move it), and a tag-only test would keep treating that dialog as a
 *  modal that owns the keyboard. */
function noOpenDialogGuard(e: KeyboardEvent): boolean {
	return !e.composedPath().some(el => (el as HTMLElement).tagName === 'DIALOG' && (el as HTMLDialogElement).open);
}

/** `keys` chord list for the sidebar-panel digit shortcut — `Alt+1`-`8` (code-token chords, so the
 *  physical numeric-row keys, regardless of the digit's shifted symbol). Eight because that's the
 *  panel count in `sidebarPanelOrder`; the display-mode toggles have their own letter chords.
 *  Alt+digit shadows VS Code's `workbench.action.openEditorAtIndex`, but this webview's keydown handler
 *  calls `preventDefault` on a matched chord, which suppresses that at the OS/host layer too (verified
 *  live against a running instance). */
const sidebarAltDigitKeys = [
	'alt+Digit1',
	'alt+Digit2',
	'alt+Digit3',
	'alt+Digit4',
	'alt+Digit5',
	'alt+Digit6',
	'alt+Digit7',
	'alt+Digit8',
];

/** One-time-bound view of the host state/actions the graph webview's shortcuts dispatch to. Built ONCE
 *  by `<gl-graph-app>` as closures over itself; none of these run on a hot path. */
export type GraphKeymapActions = {
	isGraphModeShortcut(): boolean;
	graph(): GlGraphWrapper | undefined;
	graphHeader(): GlGraphHeader | undefined;
	sidebarPanelEl(): GlGraphSidebarPanel | undefined;
	shouldAutoCollapseOverlay(): boolean;
	overviewBarItems(): readonly OverviewBarItem[];
	selectOverviewBarItem(detail: OverviewBarSelectDetail, options?: { returnFocusToGraph?: boolean }): Promise<void>;
	isVirtualRepo(): boolean;
	activateSidebarPanel(panel: GraphSidebarPanel): void;
	sidebarEnabled(): boolean;
	kanbanEnabled(): boolean;
	toggleDisplayMode(mode: Exclude<GraphDisplayMode, 'graph'>): void;
	toggleMinimap(): void;
	toggleSidebar(): void;
	toggleDetails(e: CustomEvent<{ altKey?: boolean } | void>): void;
	showShortcuts(): void;
};

/** Registers the graph webview's keymap scopes and bindings on `keymap`, then attaches it. Called by
 *  `<gl-graph-app>` from `connectedCallback`; `keymap.dispose()` (on disconnect) tears everything down
 *  in one call. */
export function registerGraphKeymap(keymap: KeymapDispatcher<GraphKeymapScope>, actions: GraphKeymapActions): void {
	// The sidebar's tree filter input — a text entry, so it can't ride the `webview` scope (that one
	// bails on text entry by design). Selector-matched against the input inside `gl-tree-view`'s shadow
	// root, with a guard pinning it to the SIDEBAR's tree: the details panel's file trees render the
	// same input and must keep their Esc.
	keymap.registerScope('sidebarFilter', { selector: '.filter-input' }, [
		e => {
			const panel = actions.sidebarPanelEl();
			return panel != null && e.composedPath().includes(panel);
		},
	]);
	// Any rendered `gl-tree-view` (sidebar file tree, details-panel file trees, the branch
	// sheet) — no guards, so `mod+KeyF` bindings scoped here apply wherever a tree is focused.
	keymap.registerScope('tree', { selector: 'gl-tree-view' }, []);
	keymap.registerScope('webview', 'always', [e => !isTextEntryTarget(e), noOpenDialogGuard]);
	// No `isTextEntryTarget` guard: chrome toggles bound here must work with the caret in a text box
	// (search box, sidebar filter, etc). Alt+letter/digit types nothing on Windows/Linux. On macOS
	// these bindings match `e.code` (physical key) and call `preventDefault`, which consumes the
	// Option special character that key would otherwise type (e.g. Option+S would type `ß`) — a
	// deliberate, accepted cost when a graph text input has focus.
	keymap.registerScope('webviewGlobal', 'always', [noOpenDialogGuard]);
	keymap.registerBindings([
		// Leaving the sidebar filter. An UNPINNED (overlay) sidebar closes instead — that's the existing
		// behavior and belongs to the overlay's `CloseWatcher`, so decline and let the key through to it.
		// Pinned, there's nothing to close, so land the keyboard on the rows. Query preserved either way.
		{
			keys: ['Escape'],
			scope: 'sidebarFilter',
			sheet: 'hidden',
			run: () => {
				if (actions.shouldAutoCollapseOverlay()) return false;

				actions.graph()?.focus();
				return true;
			},
		},
		{
			// Opens/focuses whichever tree owns the focused `gl-tree-view` — the details panel's
			// file tree pane, or a bare tree (e.g. the branch sheet) that supports its own filter.
			// Declines (falls through to the `webview`-scope binding below) for anything else.
			keys: ['mod+KeyF'],
			scope: 'tree',
			sheet: 'hidden',
			run: e => {
				actions.graph()?.suppressModifierChainUntilRelease?.();

				const path = e.composedPath();

				const filePane = path.find(el => (el as HTMLElement).tagName === 'GL-FILE-TREE-PANE') as
					| GlFileTreePane
					| undefined;
				if (filePane != null) {
					filePane.showAndFocusFilter();
					return true;
				}

				const treeView = path.find(el => (el as HTMLElement).tagName === 'GL-TREE-VIEW') as
					| GlTreeView
					| undefined;
				if (treeView?.filterable) {
					treeView.focus();
					return true;
				}

				return false;
			},
		},
		{
			keys: ['/'],
			scope: 'webview',
			when: [actions.isGraphModeShortcut],
			sheet: {
				group: 'search',
				label: 'Find a branch, tag, or worktree',
				order: 1,
				subline: ['ArrowUp', 'ArrowDown', 'text: matches · ', 'Enter', 'text: selects'],
			},
			run: e => {
				const graph = actions.graph();
				if (graph == null) return false;

				const from = e.composedPath()[0];
				graph.openRefFind(from instanceof HTMLElement && from !== document.body ? from : undefined);
				return true;
			},
		},
		{
			keys: ['mod+KeyF'],
			scope: 'webview',
			when: [actions.isGraphModeShortcut],
			sheet: {
				group: 'search',
				label: 'Search commits',
				order: 2,
				subline: ['Enter', 'text: steps · ', 'Escape', 'text: leaves'],
			},
			run: () => {
				actions.graph()?.suppressModifierChainUntilRelease?.();
				return actions.graphHeader()?.focusSearch() ?? false;
			},
		},
		{
			// `mod+/` (not `ctrl+/`): the chord exists for GitKraken Desktop parity, and GK's binding is
			// ⌘/ on macOS.
			keys: ['?', 'mod+/'],
			scope: 'webview',
			// Footer copy reads as a sentence after the chip ("? shows this reference"), and only the
			// primary chord is shown — the `mod+/` alias would double the footer's width.
			sheet: { group: 'footer', label: 'shows this reference', order: 2, keysOverride: ['?'] },
			run: () => {
				actions.graph()?.suppressModifierChainUntilRelease?.();
				actions.showShortcuts();
				return true;
			},
		},
		{
			keys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'],
			scope: 'webview',
			when: [actions.isGraphModeShortcut],
			sheet: {
				group: 'goto',
				label: 'Recent worktrees',
				order: 8,
				keysOverride: ['Digit1', 'sep:…', 'Digit0'],
			},
			run: e => {
				const digit = digitIndexFromCode(e.code);
				if (digit == null) return false;

				const item = actions.overviewBarItems()[digit];
				if (item == null) return false;

				const fromGraph = e.composedPath().some(el => el === actions.graph());
				void actions.selectOverviewBarItem(
					{ id: item.id, branch: item.branch, repoPath: item.repoPath },
					{ returnFocusToGraph: fromGraph },
				);
				return true;
			},
		},
		{
			keys: sidebarAltDigitKeys,
			scope: 'webviewGlobal',
			when: [actions.sidebarEnabled],
			sheet: {
				group: 'panels',
				label: 'Toggle a side bar panel',
				order: 1,
				keysOverride: ['alt+Digit1', 'sep:…', 'Digit8'],
			},
			run: e => {
				const digit = digitIndexFromCode(e.code);
				if (digit == null) return false;

				const panel = visibleSidebarPanels(actions.isVirtualRepo())[digit];
				if (panel == null) return false;

				actions.graph()?.suppressModifierChainUntilRelease?.();
				actions.activateSidebarPanel(panel);
				return true;
			},
		},
		// Alt+letter/digit (not Shift+letter): these chrome toggles must fire even while a text input
		// inside the graph (search box, sidebar filter, etc.) has focus, which the `webview` scope's
		// `isTextEntryTarget` guard blocks by design — so they're bound on `webviewGlobal` instead.
		// Alt+letter/digit types nothing on Windows/Linux and is safely reclaimable on macOS (see the
		// `webviewGlobal` scope's registration comment for the Option-character cost); Shift+letter
		// would type a real character into a focused input.
		// The two display-mode toggles route through `toggleDisplayMode`, the same path the rail's
		// bottom toggle click takes. Alt also drives the lane dim now, and none of these toggle actions
		// is lane navigation, so each calls `suppressModifierChainUntilRelease()` right before acting.
		{
			// `alt+KeyK`, not `alt+KeyA`: Option+A produces å on macOS, a real letter for Scandinavian
			// layouts, so K was chosen to avoid shadowing it.
			keys: ['alt+KeyK'],
			scope: 'webviewGlobal',
			sheet: { group: 'panels', label: 'Toggle Agent Kanban', order: 2, keysOverride: ['alt+KeyK'] },
			run: () => {
				if (!actions.kanbanEnabled()) return false;

				actions.graph()?.suppressModifierChainUntilRelease?.();
				actions.toggleDisplayMode('kanban');
				return true;
			},
		},
		{
			keys: ['alt+KeyV'],
			scope: 'webviewGlobal',
			sheet: { group: 'panels', label: 'Toggle visualizations', order: 3, keysOverride: ['alt+KeyV'] },
			run: () => {
				actions.graph()?.suppressModifierChainUntilRelease?.();
				actions.toggleDisplayMode('visualizations');
				return true;
			},
		},
		{
			keys: ['alt+KeyM'],
			scope: 'webviewGlobal',
			when: [actions.isGraphModeShortcut],
			sheet: { group: 'panels', label: 'Toggle minimap', order: 4, keysOverride: ['alt+KeyM'] },
			run: () => {
				actions.graph()?.suppressModifierChainUntilRelease?.();
				actions.toggleMinimap();
				return true;
			},
		},
		{
			keys: ['alt+KeyS'],
			scope: 'webviewGlobal',
			when: [actions.isGraphModeShortcut, actions.sidebarEnabled],
			sheet: { group: 'panels', label: 'Toggle side bar', order: 5, keysOverride: ['alt+KeyS'] },
			run: () => {
				actions.graph()?.suppressModifierChainUntilRelease?.();
				actions.toggleSidebar();
				return true;
			},
		},
		{
			keys: ['alt+KeyD'],
			scope: 'webviewGlobal',
			when: [actions.isGraphModeShortcut],
			sheet: { group: 'panels', label: 'Toggle details panel', order: 6, keysOverride: ['alt+KeyD'] },
			run: () => {
				actions.graph()?.suppressModifierChainUntilRelease?.();
				actions.toggleDetails(new CustomEvent('toggle-details'));
				return true;
			},
		},
		{
			// Alt layers "alternate" on the Shift+D primary — matches GitLens's alt-action convention.
			// Code-token (`KeyD`), not a bare `D` — Alt remaps `event.key` on Mac/intl layouts (e.g.
			// Option+Shift+D isn't 'D'), so an Alt-carrying chord must match on the physical key.
			keys: ['shift+alt+KeyD'],
			scope: 'webviewGlobal',
			when: [actions.isGraphModeShortcut],
			sheet: { group: 'panels', label: 'Dock details elsewhere', order: 7 },
			run: () => {
				actions.graph()?.suppressModifierChainUntilRelease?.();
				actions.toggleDetails(new CustomEvent('toggle-details', { detail: { altKey: true } }));
				return true;
			},
		},
	]);
	keymap.attach();
}
