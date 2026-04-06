import { signal as litSignal } from '@lit-labs/signals';
import type { GraphSidebarService } from '../../../../plus/graph/graphService.js';
import type { DidGetSidebarDataParams, GraphSidebarPanel } from '../../../../plus/graph/protocol.js';
import type { Resource } from '../../../shared/state/resource.js';
import { createResource } from '../../../shared/state/resource.js';

export type Counts = Record<'branches' | 'remotes' | 'stashes' | 'tags' | 'worktrees', number | undefined>;

export interface SidebarState {
	readonly counts: { get(): Counts | undefined };
	readonly countsLoading: { get(): boolean };
	readonly countsError: { get(): boolean };
	readonly panels: Record<GraphSidebarPanel, Resource<DidGetSidebarDataParams | undefined>>;
}

export interface SidebarActions {
	readonly state: SidebarState;

	/** The currently visible panel — set by the sidebar-panel component so invalidateAll can refetch it. */
	activePanel: GraphSidebarPanel | undefined;

	initialize(service: GraphSidebarService): void;
	fetchPanel(panel: GraphSidebarPanel): void;
	fetchCounts(): void;
	invalidateAll(): void;
	refresh(panel: GraphSidebarPanel): void;
	toggleLayout(panel: GraphSidebarPanel): void;
	executeAction(command: string, context?: string): void;
	applyWorktreeChanges(changes: Record<string, boolean | undefined>): void;
	dispose(): void;
}

export function createSidebarActions(): SidebarActions {
	const counts = litSignal<Counts | undefined>(undefined);
	const countsLoading = litSignal(false);
	const countsError = litSignal(false);

	let service: GraphSidebarService | undefined;
	let unsubscribeConfig: (() => void) | undefined;
	let unsubscribeWorktree: (() => void) | undefined;
	let fetchCountsPromise: Promise<void> | undefined;

	function createPanelResource(panel: GraphSidebarPanel) {
		return createResource<DidGetSidebarDataParams | undefined>(
			async (_signal: AbortSignal) => {
				if (service == null) return undefined;
				return service.getSidebarData(panel);
			},
			{ initialValue: undefined },
		);
	}

	const panels: Record<GraphSidebarPanel, Resource<DidGetSidebarDataParams | undefined>> = {
		branches: createPanelResource('branches'),
		remotes: createPanelResource('remotes'),
		stashes: createPanelResource('stashes'),
		tags: createPanelResource('tags'),
		worktrees: createPanelResource('worktrees'),
	};

	const state: SidebarState = {
		counts: counts,
		countsLoading: countsLoading,
		countsError: countsError,
		panels: panels,
	};

	async function doFetchCounts(): Promise<void> {
		if (service == null) return;

		countsLoading.set(true);
		countsError.set(false);
		try {
			counts.set((await service.getSidebarCounts()) as Counts | undefined);
		} catch {
			countsError.set(true);
		} finally {
			countsLoading.set(false);
		}
	}

	const actions: SidebarActions = {
		state: state,
		activePanel: undefined,

		initialize: function (svc: GraphSidebarService) {
			service = svc;

			unsubscribeConfig = service.onSidebarInvalidated(() => {
				actions.invalidateAll();
			});

			unsubscribeWorktree = service.onWorktreeStateChanged(({ changes }) => {
				actions.applyWorktreeChanges(changes);
			});

			actions.fetchCounts();
		},

		fetchPanel: function (panel: GraphSidebarPanel) {
			void panels[panel].fetch();
		},

		fetchCounts: function () {
			if (service == null) return;
			fetchCountsPromise ??= doFetchCounts().finally(() => {
				fetchCountsPromise = undefined;
			});
		},

		invalidateAll: function () {
			// Cancel any in-flight fetches and reset panel values so they refetch
			for (const r of Object.values(panels)) {
				r.cancel();
				r.mutate(undefined);
			}
			actions.fetchCounts();

			// Refetch the active panel so it doesn't get stuck in skeleton state
			if (actions.activePanel != null) {
				actions.fetchPanel(actions.activePanel);
			}
		},

		refresh: function (panel: GraphSidebarPanel) {
			actions.invalidateAll();
			service?.refresh(panel);
		},

		toggleLayout: function (panel: GraphSidebarPanel) {
			service?.toggleLayout(panel);
		},

		executeAction: function (command: string, context?: string) {
			service?.executeAction(command, context);
		},

		applyWorktreeChanges: function (changes: Record<string, boolean | undefined>) {
			const data = panels.worktrees.value.get();
			if (data == null) return;

			const worktrees = data.items as Array<{ uri: string; hasChanges?: boolean }>;
			let changed = false;
			for (const w of worktrees) {
				const hasChanges = changes[w.uri];
				if (hasChanges != null && w.hasChanges !== hasChanges) {
					w.hasChanges = hasChanges;
					changed = true;
				}
			}

			if (changed) {
				// Trigger re-render by mutating with the same reference
				// (Resource's signal will notify watchers)
				panels.worktrees.mutate({ ...data });
			}
		},

		dispose: function () {
			unsubscribeConfig?.();
			unsubscribeWorktree?.();
			for (const r of Object.values(panels)) {
				r.dispose();
			}
		},
	};

	return actions;
}
