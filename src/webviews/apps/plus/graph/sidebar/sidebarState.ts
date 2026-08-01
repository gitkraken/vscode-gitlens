import { signal as litSignal } from '@lit-labs/signals';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { GlCommands } from '../../../../../constants.commands.js';
import type { GraphSidebarService } from '../../../../plus/graph/graphService.js';
import type {
	DidGetSidebarDataParams,
	GraphSidebarPanel,
	GraphSidebarPullRequest,
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

	/** True while the sidebar is actually on screen. The panel component is NEVER unmounted — it's slotted
	 *  into the split panel with `inert` when collapsed — so it has to report this itself. Sent to the host
	 *  as `displayed` on each panel request, where it suppresses the per-worktree git fan-out; it does NOT
	 *  gate any client-side fetch, so a wrong value can never stale or blank the panel's own data. */
	sidebarShowing: boolean;

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
	refreshOnReveal(): void;
	/**
	 * Last known per-worktree working-tree breakdown, requested when a row's tooltip opens. A render cache
	 * only — freshness belongs to the host, whose status cache is TTL'd and evicted by the FS watcher. Every
	 * tooltip open re-asks; a warm host cache answers without running `git status`.
	 *
	 * Panel-scoped rather than held on the tooltip element: `gl-tree-view` destroys the tooltip on every
	 * close (including the suspend/resume the row's own sub-controls trigger), so an element-level cache
	 * would survive only a continuous A→B→A hover.
	 *
	 * `undefined` = no answer yet. `null` = settled with no data (git failure / nothing to report).
	 */
	readonly worktreeWipStats: { get(): ReadonlyMap<string, GitDiffFileStats | null> };
	/**
	 * Requests stats for `path`, joining any request already in flight for it. Safe to call on every
	 * tooltip open.
	 *
	 * Always resolves — a failure logs and leaves the entry absent so the next open retries. Callers await
	 * it to know an attempt finished: that, not the presence of an entry, is what separates "still coming"
	 * from "came back with nothing", and a caller that infers the former from a missing entry spins forever.
	 */
	requestWorktreeWipStats(path: string): Promise<void>;
	invalidateAll(): void;
	refresh(panel: GraphSidebarPanel): void;
	toggleLayout(panel: GraphSidebarPanel): void;
	toggleShowRemoteBranches(): void;
	executeAction(command: GlCommands, context?: string, args?: unknown[]): void;
	/** Looks up one pull request by number, for the search fallback in the pull requests panel and the
	 *  scope popover's Focus pane. Resolves `undefined` when the service isn't wired yet or the
	 *  provider has no such pull request. */
	findPullRequest(number: string): Promise<GraphSidebarPullRequest | undefined>;
	applyWorktreeChanges(changes: Record<string, SidebarWorktreeChange | undefined>): void;
	dispose(): void;
}

export function createSidebarActions(): SidebarActions {
	const counts = litSignal<Counts | undefined>(undefined);
	const countsLoading = litSignal(false);
	const countsError = litSignal(false);

	// Signal-backed so an open tooltip re-renders when its stats land — the tree-view snapshots the tooltip
	// template at hover time and never re-reads it, so the element has to pull this itself.
	const worktreeWipStats = litSignal<ReadonlyMap<string, GitDiffFileStats | null>>(new Map());
	// Keyed by path so a second tooltip opening on the same worktree joins the outstanding request rather
	// than spawning a second one — and, by awaiting the same promise, learns when it failed.
	const worktreeWipStatsInFlight = new Map<string, Promise<void>>();

	// Held as a local (not read off `actions`) so the panel-resource factories below can capture it without
	// referencing `actions` before it's defined.
	let sidebarShowing = true;

	let service: GraphSidebarService | undefined;
	let unsubscribeConfig: (() => void) | undefined;
	let unsubscribeWorktree: (() => void) | undefined;
	let fetchCountsPromise: Promise<void> | undefined;

	function createPanelResource(panel: GraphSidebarPanel) {
		return createResource<DidGetSidebarDataParams | undefined>(
			async (signal: AbortSignal) => {
				if (service == null) return undefined;
				// Read at fetch time, not capture time, so a fetch issued as the sidebar opens reports the
				// current visibility rather than whatever it was when the resource was created.
				return service.getSidebarData(panel, { displayed: sidebarShowing }, signal);
			},
			{ initialValue: undefined },
		);
	}

	const panels: Record<GraphSidebarPanel, Resource<DidGetSidebarDataParams | undefined>> = {
		overview: createPanelResource('overview'),
		agents: createPanelResource('agents'),
		branches: createPanelResource('branches'),
		pullRequests: createPanelResource('pullRequests'),
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
		pullRequests: new Set(),
		remotes: new Set(),
		stashes: new Set(),
		tags: new Set(),
		worktrees: new Set(),
	};

	const selectedPath: Record<GraphSidebarPanel, string | undefined> = {
		overview: undefined,
		agents: undefined,
		branches: undefined,
		pullRequests: undefined,
		remotes: undefined,
		stashes: undefined,
		tags: undefined,
		worktrees: undefined,
	};

	const agentsLayout = litSignal<'list' | 'tree'>('tree');

	const actions: SidebarActions = {
		state: state,
		activePanel: undefined,
		// Delegates to the closure local the panel-resource factories read, so a write from the component
		// actually reaches the value sent as `displayed`. Starts true — fail-open, matching the host's
		// treatment of an absent flag: the worst case is one bounded fan-out, never a missing panel.
		get sidebarShowing() {
			return sidebarShowing;
		},
		set sidebarShowing(value: boolean) {
			sidebarShowing = value;
		},
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
			// Requests outstanding against the old service may never settle, which would strand their paths
			// as permanently in flight. Drop both; the next tooltip open re-asks the new service.
			worktreeWipStats.set(new Map());
			worktreeWipStatsInFlight.clear();

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

		/** Called by the sidebar-panel component when the sidebar becomes visible. Unconditional and cheap —
		 *  it exists to warm the per-worktree enrichment that was suppressed host-side while hidden, since
		 *  the panel data itself never went stale. */
		refreshOnReveal: function () {
			if (actions.activePanel != null) {
				actions.fetchPanel(actions.activePanel);
			}
		},

		worktreeWipStats: worktreeWipStats,

		requestWorktreeWipStats: function (path: string) {
			if (service == null) return Promise.resolve();

			// Deduped against concurrent asks only. A settled entry is deliberately NOT a reason to skip:
			// the working tree changes under us, and the client has no invalidation signal for it. The host
			// does — its status cache is TTL'd and hard-evicted by the FS watcher — so re-asking on every
			// open costs an in-process round-trip and nothing more while that cache is warm.
			const inFlight = worktreeWipStatsInFlight.get(path);
			if (inFlight != null) return inFlight;

			const promise = service
				.getWorktreeWipStats(path)
				.then(stats => {
					// Replace, never mutate — the signal compares by reference to decide whether to notify.
					const next = new Map(worktreeWipStats.get());
					next.set(path, stats);
					worktreeWipStats.set(next);
				})
				.catch((ex: unknown) => {
					// Leave the entry ABSENT so the next open retries — recording `null` would make a one-off
					// failure permanent. Resolving (not rethrowing) is what unsticks the tooltip: it waits on
					// this promise, not on the missing entry, to decide whether anything is still coming.
					Logger.warn(`Unable to get worktree WIP stats for '${path}': ${String(ex)}`);
				})
				.finally(() => {
					if (worktreeWipStatsInFlight.get(path) === promise) {
						worktreeWipStatsInFlight.delete(path);
					}
				});
			worktreeWipStatsInFlight.set(path, promise);
			return promise;
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
			// Deliberately NOT gated on sidebar visibility. Fetching panel data while hidden is ~7ms of
			// in-memory assembly; the expensive part was the per-worktree git fan-out, and that is now
			// suppressed host-side via the `displayed` flag on the request itself. Gating here instead would
			// mean the client's data freshness depended on a visibility bit staying in sync across every
			// lifecycle edge — and a wrong bit could leave a visible panel stale, or blank via `refresh()`'s
			// own reset. Keeping one code path means panel data is always correct; only the enrichment is
			// conditional, and its worst case is a missing dirty-pill until the next displayed fetch.
			for (const [panel, r] of Object.entries(panels)) {
				if (panel === actions.activePanel) continue;

				// reset(), not mutate(undefined) — mutate marks the resource as resolved, so it
				// reports status 'success' while holding no data. Consumers that gate on a settled
				// status (e.g. the branches shown telemetry) would read that as "fetch landed,
				// legitimately empty" instead of "nothing fetched yet".
				r.reset();
			}
			actions.fetchCounts();

			// Always refetch the active panel — Resource's cancelPrevious
			// handles dedup, and this ensures recovery if a prior fetch got stuck
			if (actions.activePanel != null) {
				actions.fetchPanel(actions.activePanel);
			}
		},

		refresh: function (panel: GraphSidebarPanel) {
			// reset() (status → 'idle'), not mutate(undefined) (status → 'success') — see
			// invalidateAll. The refetch arrives via the host round-trip: service.refresh →
			// onSidebarRefresh → notifySidebarInvalidated → invalidateAll → fetchPanel.
			panels[panel].reset();
			service?.refresh(panel);
		},

		findPullRequest: async function (number: string) {
			return service?.findPullRequest(number);
		},
		toggleLayout: function (panel: GraphSidebarPanel) {
			if (panel === 'agents') {
				agentsLayout.set(agentsLayout.get() === 'tree' ? 'list' : 'tree');
				return;
			}

			service?.toggleLayout(panel);
		},

		toggleShowRemoteBranches: function () {
			service?.toggleShowRemoteBranches();
		},

		executeAction: function (command: GlCommands, context?: string, args?: unknown[]) {
			service?.executeAction(command, context, args);
		},

		applyWorktreeChanges: function (changes: Record<string, SidebarWorktreeChange | undefined>) {
			const data = panels.worktrees.value.get();
			if (data == null) return;

			const worktrees = data.items as Array<{ uri: string; hasChanges?: boolean }>;
			let changed = false;
			for (const w of worktrees) {
				const next = changes[w.uri];
				if (next == null) continue;

				// Compare before assigning: pushes land on every FS tick, and republishing an unchanged
				// value would re-render the whole panel each time.
				if (w.hasChanges !== next.hasChanges) {
					w.hasChanges = next.hasChanges;
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
