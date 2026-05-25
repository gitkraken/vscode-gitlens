import { signal as litSignal } from '@lit-labs/signals';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type { GlCommands } from '../../../../../constants.commands.js';
import type { GraphSidebarService } from '../../../../plus/graph/graphService.js';
import type {
	DidGetSidebarDataParams,
	GraphSidebarPanel,
	SidebarWorktreeChange,
} from '../../../../plus/graph/protocol.js';
import type { Resource } from '../../../shared/state/resource.js';
import { createResource } from '../../../shared/state/resource.js';

export type Counts = Record<'agents' | 'branches' | 'remotes' | 'stashes' | 'tags' | 'worktrees', number | undefined>;

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

	/** Session filter text — survives sidebar-panel destruction/recreation, NOT webview reload. */
	filterText: string;

	/** Per-panel tree expansion state — survives panel switches */
	readonly expandedPaths: Record<GraphSidebarPanel, Set<string>>;
	/** Per-panel selected item path — survives panel switches */
	readonly selectedPath: Record<GraphSidebarPanel, string | undefined>;

	/** Layout for the agents panel — kept client-side because session data isn't fetched from the host
	 *  (it streams through reactive notifications). Other panels persist their layout via VS Code config. */
	readonly agentsLayout: { get(): 'list' | 'tree' };

	initialize(service: GraphSidebarService): void;
	fetchPanel(panel: GraphSidebarPanel): void;
	fetchCounts(): void;
	invalidateAll(): void;
	refresh(panel: GraphSidebarPanel): void;
	toggleLayout(panel: GraphSidebarPanel): void;
	executeAction(command: GlCommands, context?: string, args?: unknown[]): void;
	applyWorktreeChanges(changes: Record<string, SidebarWorktreeChange | undefined>): void;
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
			async (signal: AbortSignal) => {
				if (service == null) return undefined;
				return service.getSidebarData(panel, signal);
			},
			{ initialValue: undefined },
		);
	}

	const panels: Record<GraphSidebarPanel, Resource<DidGetSidebarDataParams | undefined>> = {
		overview: createPanelResource('overview'),
		agents: createPanelResource('agents'),
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

	async function doFetchCounts(svc: GraphSidebarService): Promise<void> {
		countsLoading.set(true);
		countsError.set(false);
		try {
			const result = (await svc.getSidebarCounts()) as Counts | undefined;
			if (service === svc) {
				counts.set(result);
			}
		} catch {
			if (service === svc) {
				countsError.set(true);
			}
		} finally {
			if (service === svc) {
				countsLoading.set(false);
			}
		}
	}

	const expandedPaths: Record<GraphSidebarPanel, Set<string>> = {
		overview: new Set(),
		agents: new Set(),
		branches: new Set(),
		remotes: new Set(),
		stashes: new Set(),
		tags: new Set(),
		worktrees: new Set(),
	};

	const selectedPath: Record<GraphSidebarPanel, string | undefined> = {
		overview: undefined,
		agents: undefined,
		branches: undefined,
		remotes: undefined,
		stashes: undefined,
		tags: undefined,
		worktrees: undefined,
	};

	const agentsLayout = litSignal<'list' | 'tree'>('tree');

	const actions: SidebarActions = {
		state: state,
		activePanel: undefined,
		filterText: '',
		expandedPaths: expandedPaths,
		selectedPath: selectedPath,
		agentsLayout: agentsLayout,

		initialize: function (svc: GraphSidebarService) {
			// Clean up previous subscriptions on re-initialization (e.g. RPC reconnection)
			unsubscribeConfig?.();
			unsubscribeWorktree?.();
			unsubscribeConfig = undefined;
			unsubscribeWorktree = undefined;

			service = svc;
			fetchCountsPromise = undefined;

			// Supertalk RPC marshals subscription methods as `Promise<Unsubscribe>`, so
			// the call must be awaited — synchronous assignment captures the Promise
			// (not callable) and breaks teardown with `is not a function`.
			const activeSvc = svc;
			void (async () => {
				const unsub = (await activeSvc.onSidebarInvalidated(() => {
					actions.invalidateAll();
				})) as unknown as (() => void) | undefined;
				if (typeof unsub !== 'function') return;
				if (service !== activeSvc) {
					unsub();
					return;
				}

				unsubscribeConfig = unsub;
			})();
			void (async () => {
				const unsub = (await activeSvc.onWorktreeStateChanged(({ changes }) => {
					actions.applyWorktreeChanges(changes);
				})) as unknown as (() => void) | undefined;
				if (typeof unsub !== 'function') return;
				if (service !== activeSvc) {
					unsub();
					return;
				}

				unsubscribeWorktree = unsub;
			})();

			actions.fetchCounts();

			if (actions.activePanel != null) {
				actions.fetchPanel(actions.activePanel);
			}
		},

		fetchPanel: function (panel: GraphSidebarPanel) {
			if (service == null) return;

			void panels[panel].fetch();
		},

		fetchCounts: function () {
			if (service == null || fetchCountsPromise != null) return;

			const promise = doFetchCounts(service).finally(() => {
				// Only clear the promise if it hasn't been replaced by a newer call
				if (fetchCountsPromise === promise) {
					fetchCountsPromise = undefined;
				}
			});
			fetchCountsPromise = promise;
		},

		invalidateAll: function () {
			for (const [panel, r] of Object.entries(panels)) {
				if (panel === actions.activePanel) continue;

				r.cancel();
				r.mutate(undefined);
			}
			actions.fetchCounts();

			// Always refetch the active panel — Resource's cancelPrevious
			// handles dedup, and this ensures recovery if a prior fetch got stuck
			if (actions.activePanel != null) {
				actions.fetchPanel(actions.activePanel);
			}
		},

		refresh: function (panel: GraphSidebarPanel) {
			panels[panel].cancel();
			panels[panel].mutate(undefined);
			service?.refresh(panel);
		},

		toggleLayout: function (panel: GraphSidebarPanel) {
			if (panel === 'agents') {
				agentsLayout.set(agentsLayout.get() === 'tree' ? 'list' : 'tree');
				return;
			}

			service?.toggleLayout(panel);
		},

		executeAction: function (command: GlCommands, context?: string, args?: unknown[]) {
			service?.executeAction(command, context, args);
		},

		applyWorktreeChanges: function (changes: Record<string, SidebarWorktreeChange | undefined>) {
			const data = panels.worktrees.value.get();
			if (data == null) return;

			const worktrees = data.items as Array<{
				uri: string;
				hasChanges?: boolean;
				workingTreeState?: GitDiffFileStats;
			}>;
			let changed = false;
			for (const w of worktrees) {
				const next = changes[w.uri];
				if (next == null) continue;

				// Value-compare the breakdown (fresh objects from each push always differ by
				// reference) — re-rendering on every FS tick with unchanged counts would otherwise
				// flash the panel during rapid edits/saves.
				const prevWts = w.workingTreeState;
				const nextWts = next.workingTreeState;
				const wtsChanged =
					prevWts?.added !== nextWts?.added ||
					prevWts?.changed !== nextWts?.changed ||
					prevWts?.deleted !== nextWts?.deleted;
				if (w.hasChanges !== next.hasChanges || wtsChanged) {
					w.hasChanges = next.hasChanges;
					w.workingTreeState = next.workingTreeState;
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
