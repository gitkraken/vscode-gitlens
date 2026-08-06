import type { GraphDisplayMode, GraphSidebarPanel } from '../../../../plus/graph/protocol.js';

/** Canonical rail order — the single source of truth for both the rail's icon layout
 *  (`sidebar.ts`) and the Shift+1-8 keyboard-shortcut numbering (`graph-app.ts`). */
export const sidebarPanelOrder: readonly GraphSidebarPanel[] = [
	'overview',
	'agents',
	'pullRequests',
	'worktrees',
	'branches',
	'remotes',
	'stashes',
	'tags',
];

/** Panels visible for the current repo kind, in rail order. Virtual repos have no local git, so
 *  `worktrees` and `stashes` (worktree- and local-object-backed) drop out. */
export function visibleSidebarPanels(virtual: boolean): readonly GraphSidebarPanel[] {
	if (!virtual) return sidebarPanelOrder;

	return sidebarPanelOrder.filter(p => p !== 'worktrees' && p !== 'stashes');
}

/** One entry in the sidebar rail: either a panel icon or a bottom display-mode toggle. */
export type SidebarRailEntry =
	| { kind: 'panel'; panel: GraphSidebarPanel }
	| { kind: 'displayMode'; mode: Exclude<GraphDisplayMode, 'graph'> };

/** Full rail order for the current repo kind and kanban gate, in render order: panels, then the
 *  kanban toggle (when enabled), then the visualizations toggle. Drives the rail's rendering
 *  (`sidebar.ts`); the keyboard indexes `visibleSidebarPanels` instead, since the display-mode
 *  toggles have their own letter chords. */
export function visibleSidebarRailEntries(virtual: boolean, kanbanEnabled: boolean): readonly SidebarRailEntry[] {
	const entries: SidebarRailEntry[] = visibleSidebarPanels(virtual).map(panel => ({ kind: 'panel', panel: panel }));
	if (kanbanEnabled) {
		entries.push({ kind: 'displayMode', mode: 'kanban' });
	}

	entries.push({ kind: 'displayMode', mode: 'visualizations' });
	return entries;
}
