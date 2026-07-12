import { Uri } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/git/utils/branch.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { sortBranches, sortRemotes, sortTags, sortWorktrees } from '@gitlens/git/utils/sorting.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { areEqual } from '@gitlens/utils/object.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { Container } from '../../../container.js';
import * as BranchActions from '../../../git/actions/branch.js';
import * as RemoteActions from '../../../git/actions/remote.js';
import * as RepoActions from '../../../git/actions/repository.js';
import * as StashActions from '../../../git/actions/stash.js';
import * as TagActions from '../../../git/actions/tag.js';
import * as WorktreeActions from '../../../git/actions/worktree.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getRemoteIntegration, remoteSupportsIntegration } from '../../../git/utils/-webview/remote.utils.js';
import { getOpenedWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../plus/gk/utils/subscription.utils.js';
import { executeCommand } from '../../../system/-webview/command.js';
import type { ConfigPath } from '../../../system/-webview/configuration.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { IpcParams } from '../../ipc/handlerRegistry.js';
import type { IpcNotification } from '../../ipc/models/ipc.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewRecentThreshold,
} from '../../shared/overviewBranches.js';
import { getBranchOverviewType, toOverviewBranch } from '../../shared/overviewBranches.js';
import { getOverviewEnrichment, getOverviewWip } from '../../shared/overviewEnrichment.utils.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type {
	DidGetSidebarDataParams,
	GetOverviewEnrichmentRequest,
	GetOverviewRequest,
	GetOverviewWipDetailedRequest,
	GetOverviewWipRequest,
	GraphBranchContextValue,
	GraphItemRefContext,
	GraphItemTypedContext,
	GraphOverviewData,
	GraphRemoteContextValue,
	GraphSidebarPanel,
	GraphSidebarWorktree,
	GraphStashContextValue,
	GraphTagContextValue,
} from './protocol.js';
import { createWipSha, DidChangeOverviewNotification } from './protocol.js';

/** Collaborators the panels cluster reaches for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphPanelsContext()`. `getRepository`/`getSession`/`getLoading` read
 *  live provider state; `getPinnedRefId`/`fetchWipStatus`/`computeWorktreeChanges` forward into the
 *  WIP service's caches (kept there); `fireSidebarInvalidated` fires the provider's `sidebarInvalidated`
 *  RPC event (that transport stays wired in `getRpcServices`); the pending-notification callback routes
 *  through the provider's shared `_ipcNotificationMap`, which stays there. */
export type GraphPanelsServiceContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSession: () => GitGraphSession | undefined;
	getLoading: () => Promise<GitGraph> | undefined;
	getPinnedRefId: (repoPath: string | undefined) => string | undefined;
	fetchWipStatus: (path: string, signal?: AbortSignal) => Promise<GitStatus | undefined>;
	computeWorktreeChanges: (worktrees: GitWorktree[]) => void;
	fireSidebarInvalidated: () => void;
	addPendingNotification: (notification: IpcNotification<any>) => void;
};

/** Host-side panels cluster for the graph, split out of `GraphWebviewProvider` (R3). Owns the Overview
 *  panel (data production + the `_lastSentOverview` dedup gate + `_overviewRecentThreshold` timeframe +
 *  the WIP/enrichment fetch handlers) and the Sidebar panels (branches/remotes/stashes/tags/worktrees
 *  data production + toggle/refresh/action handlers). The provider keeps the IPC forwarders and the RPC
 *  wiring and injects the collaborators via {@link GraphPanelsServiceContext}. */
export class GraphPanelsService {
	constructor(private readonly context: GraphPanelsServiceContext) {}

	private get container(): Container {
		return this.context.container;
	}
	private get host(): WebviewHost<'gitlens.views.graph' | 'gitlens.graph'> {
		return this.context.host;
	}
	private get repository(): GlRepository | undefined {
		return this.context.getRepository();
	}
	private get _graphSession(): GitGraphSession | undefined {
		return this.context.getSession();
	}

	// Timeframe for the Overview panel's "Recent" section. Seeded from the `graph:state` memento
	// in `getState`, updated in-place by `onGetOverview` when the webview changes it.
	private _overviewRecentThreshold: OverviewRecentThreshold = 'OneWeek';
	// Last overview shipped to the webview. `setGraph` fires `notifyDidChangeOverview` on every graph
	// reload (repo/visibility/filter change, refresh); most reloads reproduce the prior overview, so
	// a deep-equal gate skips the redundant serialize + webview re-render. Cleared in `setGraph` on
	// graph identity change.
	private _lastSentOverview: GraphOverviewData | undefined;

	get overviewRecentThreshold(): OverviewRecentThreshold {
		return this._overviewRecentThreshold;
	}

	/** Seeds the Overview "Recent" timeframe from the persisted memento (`getState`), before the first
	 *  `getOverviewData()` runs. */
	setOverviewRecentThreshold(value: OverviewRecentThreshold): void {
		this._overviewRecentThreshold = value;
	}

	/** Clear the overview dedup gate — the data controller calls this on graph identity change so the
	 *  next `notifyDidChangeOverview` always ships. */
	clearLastSentOverview(): void {
		this._lastSentOverview = undefined;
	}

	onGetOverview(params: IpcParams<typeof GetOverviewRequest>): GraphOverviewData {
		if (params.recentThreshold != null) {
			this._overviewRecentThreshold = params.recentThreshold;
		}
		try {
			return this.getOverviewData();
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverview');
			// Ship a structurally-valid shape so the frontend's `.length`/`.map` reads don't crash.
			return { active: [], recent: [], error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	async onGetOverviewWip(params: IpcParams<typeof GetOverviewWipRequest>): Promise<GetOverviewWipResponse> {
		if (params.branchIds.length === 0 || this._graphSession == null || this.repository == null) return {};

		// Visibility-refresh path: webview asks for current overview WIP on panel mount / focus.
		// Default mode routes through the shared `_wipStatusCache`, so when the per-event push has
		// just populated entries (within 10s TTL) this is essentially free — no extra `git status`.
		// Cold entries (off-screen worktree without active watcher) miss → fetched once →
		// populated for any subsequent reader (rich hover, worktrees panel, next event push).
		// `cheap` mode (Recent worktree-backed cards) probes `status.hasWorkingChanges()` per
		// worktree — `@gate`d at the sub-provider so concurrent identical calls dedup. It bypasses
		// the status cache entirely; the breakdown arrives later via the hover-triggered detailed
		// fetch which goes through the cache.
		try {
			return await this.computeOverviewWipFromCache(params.branchIds, params.cheap);
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverviewWip');
			// Record-shaped response — empty map is safe; frontend reads `response[sha]` and gets `undefined`.
			return {};
		}
	}

	async onGetOverviewWipDetailed(
		params: IpcParams<typeof GetOverviewWipDetailedRequest>,
	): Promise<GetOverviewWipResponse> {
		if (params.branchIds.length === 0 || this._graphSession == null || this.repository == null) return {};

		try {
			return await this.computeOverviewWipFromCache(params.branchIds);
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverviewWipDetailed');
			return {};
		}
	}

	private computeOverviewWipFromCache(branchIds: string[], cheap?: boolean): Promise<GetOverviewWipResponse> {
		const data = this._graphSession!.current;
		// Cheap mode probes `hasWorkingChanges()` directly (dirty bit only) and bypasses the
		// shared `_wipStatusCache`; the cheap probe's `@gate` dedups concurrent identical calls.
		// Full breakdown arrives on hover via the non-cheap path through the cache.
		const options = cheap
			? { cheap: true }
			: {
					fetchStatus: (path: string, signal?: AbortSignal) => this.context.fetchWipStatus(path, signal),
				};
		return getOverviewWip(
			this.container,
			data.branches.values(),
			data.worktreesByBranch ?? new Map(),
			branchIds,
			options,
		);
	}

	async onGetOverviewEnrichment(
		params: IpcParams<typeof GetOverviewEnrichmentRequest>,
	): Promise<GetOverviewEnrichmentResponse> {
		if (params.branchIds.length === 0 || this._graphSession == null || this.repository == null) return {};

		const subscription = await this.container.subscription.getSubscription();
		const isPro = isSubscriptionTrialOrPaidFromState(subscription.state);

		return getOverviewEnrichment(this.container, this._graphSession.current.branches.values(), params.branchIds, {
			isPro: isPro,
			resolveLaunchpad: true,
			// Merge-target is fetched lazily by the overview card on hover (and by the click-to-scope
			// path in `graph-app`) via `BranchesService.getMergeTargetStatus`, so initial enrichment
			// doesn't block on ~4 git/integration ops per branch. The resolved value is then merged
			// back into shared `overviewEnrichment` state via `mergeMergeTargetIntoEnrichment` so the
			// scope-anchor's `reconcileScopeMergeTarget` hook still backfills the tip SHA.
			skipMergeTarget: true,
		});
	}

	onGetAgentSessions(): AgentSessionState[] {
		return this.container.agentStatus?.getSerializedSessions() ?? [];
	}

	getOverviewData(): GraphOverviewData {
		const active: GraphOverviewData['active'] = [];
		const recent: GraphOverviewData['recent'] = [];

		if (this._graphSession == null || this.repository == null) {
			return { active: active, recent: recent };
		}

		const data = this._graphSession.current;
		const worktreesByBranch = data.worktreesByBranch ?? new Map();

		for (const branch of data.branches.values()) {
			if (branch.remote) continue;

			const branchType = getBranchOverviewType(
				branch,
				worktreesByBranch,
				this._overviewRecentThreshold,
				'OneYear',
			);
			switch (branchType) {
				case 'active':
					active.push(toOverviewBranch(branch, worktreesByBranch, true));
					break;
				case 'recent':
					recent.push(toOverviewBranch(branch, worktreesByBranch, false));
					break;
			}
		}

		recent.sort((a, b) => (b.timestamp ?? -1) - (a.timestamp ?? -1));

		return { active: active, recent: recent };
	}

	@trace()
	async notifyDidChangeOverview(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.context.addPendingNotification(DidChangeOverviewNotification);
			return false;
		}

		// Skip identical pushes — most graph reloads reproduce the prior overview verbatim. Advance
		// the last-sent snapshot only on confirmed delivery: a failed `notify` is requeued by type
		// and REPLACED by a later one, so a speculative advance could let the gate suppress the
		// replacement and leave the webview never receiving the overview.
		const overview = this.getOverviewData();
		if (this._lastSentOverview != null && areEqual(overview, this._lastSentOverview)) {
			return false;
		}

		const success = await this.host.notify(DidChangeOverviewNotification, { overview: overview });
		if (success) {
			this._lastSentOverview = overview;
		}
		return success;
	}

	async onGetSidebarData(
		params: { panel: GraphSidebarPanel },
		signal?: AbortSignal,
	): Promise<DidGetSidebarDataParams> {
		const graph = this._graphSession?.current ?? (await this.context.getLoading()?.catch(() => undefined));
		signal?.throwIfAborted();
		if (graph == null) return { panel: params.panel, items: [] };

		switch (params.panel) {
			case 'branches':
				return this.getSidebarBranches(graph);
			case 'remotes':
				return this.getSidebarRemotes(graph);
			case 'stashes':
				return this.getSidebarStashes(graph);
			case 'tags':
				return this.getSidebarTags(graph);
			case 'worktrees':
				return this.getSidebarWorktrees(graph);
			default:
				return { panel: params.panel, items: [] };
		}
	}

	private getProviderByRemote(graph: GitGraph): Map<string, string> {
		const providerByRemote = new Map<string, string>();
		for (const r of graph.remotes.values()) {
			if (r.provider?.name) {
				providerByRemote.set(r.name, r.provider.name);
			}
		}
		return providerByRemote;
	}

	private getSidebarBranches(graph: GitGraph) {
		const providerByRemote = this.getProviderByRemote(graph);
		const pinnedRefId = this.context.getPinnedRefId(graph.repoPath);

		const branchCfg = configuration.get('views.branches.branches');
		const sorted = sortBranches(
			[...graph.branches.values()].filter(b => !b.remote),
			{
				current: true,
				orderBy: configuration.get('sortBranchesBy'),
				openedWorktreesByBranch: getOpenedWorktreesByBranch(graph.worktreesByBranch),
			},
		);

		const items = sorted.map(b => {
			// Exclude the default worktree from the worktree indicator (matches view behavior)
			const isCheckedOut = b.worktree != null && b.worktree !== false;
			const hasWorktree = isCheckedOut && !b.worktree.isDefault;
			const worktree = graph.worktreesByBranch?.get(b.id);
			const remoteName = b.upstream ? getRemoteNameFromBranchName(b.upstream.name) : undefined;
			return {
				name: b.name,
				sha: b.sha,
				current: b.current,
				remote: false,
				status: b.status,
				upstream: b.upstream ? { name: b.upstream.name, missing: b.upstream.missing } : undefined,
				tracking: b.upstream?.state,
				worktree: hasWorktree,
				worktreeOpened: worktree?.opened || undefined,
				checkedOut: isCheckedOut || undefined,
				disposition: b.disposition || undefined,
				date: b.date?.getTime(),
				providerName: remoteName ? providerByRemote.get(remoteName) : undefined,
				starred: b.starred || undefined,
				context: {
					webview: this.host.id,
					webviewItem: `gitlens:branch${b.current ? '+current' : ''}${
						b.upstream != null && !b.upstream.missing ? '+tracking' : ''
					}${hasWorktree ? '+worktree' : ''}${
						b.current || isCheckedOut ? '+checkedout' : ''
					}${b.upstream?.state.ahead ? '+ahead' : ''}${b.upstream?.state.behind ? '+behind' : ''}${
						pinnedRefId != null && b.id === pinnedRefId ? '+pinned' : ''
					}`,
					webviewItemValue: {
						type: 'branch',
						ref: createReference(b.name, graph.repoPath, {
							id: b.id,
							refType: 'branch',
							name: b.name,
							remote: false,
							upstream: b.upstream,
						}),
					},
				} satisfies GraphItemRefContext<GraphBranchContextValue>,
			};
		});
		return { panel: 'branches' as const, items: items, layout: branchCfg.layout, compact: branchCfg.compact };
	}

	private async getSidebarRemotes(graph: GitGraph) {
		const sorted = sortRemotes([...graph.remotes.values()]);
		const branchOrderBy = configuration.get('sortBranchesBy');
		const pinnedRefId = this.context.getPinnedRefId(graph.repoPath);
		const branchesByRemote = new Map<string, GitBranch[]>();
		for (const b of graph.branches.values()) {
			if (!b.remote) continue;

			const remote = getRemoteNameFromBranchName(b.name);
			let arr = branchesByRemote.get(remote);
			if (arr == null) {
				arr = [];
				branchesByRemote.set(remote, arr);
			}
			arr.push(b);
		}
		const items = await Promise.all(
			sorted.map(async r => {
				const rBranches = sortBranches(branchesByRemote.get(r.name) ?? [], {
					current: false,
					orderBy: branchOrderBy,
				});
				const branches = rBranches.map(b => ({
					name: getBranchNameWithoutRemote(b.name),
					sha: b.sha,
					context: {
						webview: this.host.id,
						webviewItem: `gitlens:branch+remote${pinnedRefId != null && b.id === pinnedRefId ? '+pinned' : ''}`,
						webviewItemValue: {
							type: 'branch',
							ref: createReference(b.name, graph.repoPath, {
								id: b.id,
								refType: 'branch',
								name: b.name,
								remote: true,
							}),
						},
					} satisfies GraphItemRefContext<GraphBranchContextValue>,
				}));

				let connected: boolean | undefined;
				if (remoteSupportsIntegration(r)) {
					const integration = await getRemoteIntegration(r);
					connected = integration?.maybeConnected ?? (await integration?.isConnected()) ?? false;
				}

				let webviewItem = 'gitlens:remote';
				if (r.default) {
					webviewItem += '+default';
				}
				if (connected != null) {
					webviewItem += connected ? '+connected' : '+disconnected';
				}

				return {
					name: r.name,
					url: r.urls[0]?.url,
					isDefault: r.default,
					providerIcon: r.provider?.icon,
					providerName: r.provider?.name,
					connected: connected,
					branches: branches,
					context: {
						webview: this.host.id,
						webviewItem: webviewItem,
						webviewItemValue: {
							type: 'remote',
							name: r.name,
							repoPath: graph.repoPath,
						},
					} satisfies GraphItemTypedContext<GraphRemoteContextValue>,
				};
			}),
		);
		const remoteCfg = configuration.get('views.remotes.branches');
		return { panel: 'remotes' as const, items: items, layout: remoteCfg.layout, compact: remoteCfg.compact };
	}

	private getSidebarStashes(graph: GitGraph) {
		const items =
			graph.stashes != null
				? Array.from(graph.stashes.values(), s => ({
						name: s.stashName,
						sha: s.sha,
						message: s.message ?? '',
						date: s.author.date.getTime(),
						stashNumber: s.stashNumber ?? '',
						stashOnRef: s.stashOnRef,
						context: {
							webview: this.host.id,
							webviewItem: 'gitlens:stash',
							webviewItemValue: {
								type: 'stash',
								ref: createReference(s.sha, graph.repoPath, {
									refType: 'stash',
									name: s.stashName,
									message: s.message,
									number: s.stashNumber,
								}),
							},
						} satisfies GraphItemRefContext<GraphStashContextValue>,
					}))
				: [];
		return { panel: 'stashes' as const, items: items };
	}

	private async getSidebarTags(graph: GitGraph) {
		const tagCfg = configuration.get('views.tags.branches');
		const result = await this.container.git.getRepositoryService(graph.repoPath).tags.getTags({ sort: true });
		const sorted = sortTags(result.values, { orderBy: configuration.get('sortTagsBy') });
		const items = sorted.map(t => ({
			name: t.name,
			sha: t.sha,
			message: t.message || undefined,
			annotated: t.annotated,
			date: t.date?.getTime(),
			context: {
				webview: this.host.id,
				webviewItem: 'gitlens:tag',
				webviewItemValue: {
					type: 'tag',
					ref: createReference(t.name, graph.repoPath, {
						id: t.id,
						refType: 'tag',
						name: t.name,
					}),
				},
			} satisfies GraphItemRefContext<GraphTagContextValue>,
		}));
		return { panel: 'tags' as const, items: items, layout: tagCfg.layout, compact: tagCfg.compact };
	}

	private getSidebarWorktrees(graph: GitGraph) {
		const providerByRemote = this.getProviderByRemote(graph);

		const wtCfg = configuration.get('views.worktrees.branches');
		const worktrees =
			graph.worktrees != null
				? sortWorktrees([...graph.worktrees], { orderBy: configuration.get('sortWorktreesBy') })
				: [];

		const items = worktrees.map(w => {
			const upstreamName = w.branch?.upstream?.name;
			const remoteName = upstreamName ? getRemoteNameFromBranchName(upstreamName) : undefined;

			let webviewItem = `gitlens:worktree${w.isDefault ? '+default' : ''}${
				w.workspaceFolder != null ? '+active' : ''
			}`;
			if (w.branch != null) {
				webviewItem += '+branch';
				if (w.branch.starred) {
					webviewItem += '+starred';
				}
				if (w.branch.upstream != null && !w.branch.upstream.missing) {
					webviewItem += '+tracking';
				}
				switch (w.branch.status) {
					case 'ahead':
						webviewItem += '+ahead';
						break;
					case 'behind':
						webviewItem += '+behind';
						break;
					case 'diverged':
						webviewItem += '+ahead+behind';
						break;
				}
				if (w.branch.rebasing) {
					webviewItem += '+rebasing';
				}
			} else if (w.type === 'detached') {
				webviewItem += '+detached';
			}

			// The graph row this worktree's WIP anchors to — must mirror `getWipMetadataBySha`:
			// the worktree at the graph's repo path is the primary `uncommitted` row, others get a
			// secondary-wip sha (only when they actually have a row, i.e. non-bare with a sha).
			const wipSha = w.type === 'bare' ? undefined : createWipSha(w.path, graph.repoPath);

			// Base context — `+working` is appended in the webview when the async hasChanges resolves.
			const context: GraphSidebarWorktree['context'] =
				w.branch != null
					? {
							webview: this.host.id,
							webviewItem: webviewItem,
							webviewItemValue: {
								type: 'branch',
								ref: createReference(w.branch.name, graph.repoPath, {
									id: w.branch.id,
									refType: 'branch',
									name: w.branch.name,
									remote: false,
									upstream: w.branch.upstream,
								}),
								worktreePath: w.uri.fsPath,
							},
						}
					: w.sha != null
						? {
								webview: this.host.id,
								webviewItem: webviewItem,
								webviewItemValue: {
									type: 'commit',
									ref: createReference(w.sha, graph.repoPath, {
										refType: 'revision',
										name: w.sha,
										message: '',
									}),
									worktreePath: w.uri.fsPath,
								},
							}
						: undefined;

			return {
				name: w.name,
				uri: w.uri.fsPath,
				branch: w.branch?.name,
				sha: w.sha,
				isDefault: w.isDefault,
				locked: w.locked !== false,
				opened: w.workspaceFolder != null,
				wipSha: wipSha,
				status: w.branch?.status,
				upstream: w.branch?.upstream?.name,
				tracking: w.branch?.upstream?.state,
				providerName: remoteName ? providerByRemote.get(remoteName) : undefined,
				context: context,
			};
		});

		// Fire-and-forget: compute working changes per worktree and notify the webview
		if (worktrees.length > 0) {
			this.context.computeWorktreeChanges(worktrees);
		}

		return { panel: 'worktrees' as const, items: items, layout: wtCfg.layout, compact: wtCfg.compact };
	}

	onSidebarToggleLayout(params: { panel: GraphSidebarPanel }): void {
		const configKey = {
			branches: 'views.branches.branches.layout',
			remotes: 'views.remotes.branches.layout',
			tags: 'views.tags.branches.layout',
			worktrees: 'views.worktrees.branches.layout',
		} as const satisfies Partial<Record<GraphSidebarPanel, ConfigPath>>;

		const key = configKey[params.panel as keyof typeof configKey];
		if (key == null) return;

		const current = configuration.get(key);
		void configuration.updateEffective(key, current === 'tree' ? 'list' : 'tree');
	}

	onSidebarRefresh(_params: { panel: GraphSidebarPanel }): void {
		this.notifySidebarInvalidated();
	}

	onSidebarAction(params: { command: GlCommands; context?: string; args?: unknown[] }): void {
		const repoPath = this._graphSession?.repoPath;
		if (repoPath == null) return;

		// Typed-args path — used by panels (e.g. agents) where the action target is a structured
		// payload, not a serialized webview-item context. Args bypass the context+repoPath fallback
		// because the receiving command takes its own typed arguments.
		if (params.args != null) {
			void executeCommand(params.command, ...params.args);
			return;
		}

		if (params.context != null) {
			try {
				const ctx = JSON.parse(params.context);
				ctx.webview = this.host.id;
				ctx.webviewInstance = this.host.instanceId;
				void executeCommand(params.command, ctx);
				return;
			} catch {}
		}

		// Header actions — dispatch directly to action functions with repoPath,
		// since view commands expect view node context, not Uri
		switch (params.command) {
			case 'gitlens.views.title.createWorktree':
				void WorktreeActions.create(repoPath);
				return;
			case 'gitlens.views.title.createBranch':
				void BranchActions.create(repoPath);
				return;
			case 'gitlens.views.title.createTag':
				void TagActions.create(repoPath);
				return;
			case 'gitlens.views.addRemote':
				void RemoteActions.add(repoPath);
				return;
			case 'gitlens.switchToAnotherBranch:views':
				void RepoActions.switchTo(repoPath);
				return;
			case 'gitlens.stashSave:views':
				void StashActions.push(repoPath);
				return;
			case 'gitlens.stashesApply:views':
				void StashActions.apply(repoPath);
				return;
			case 'gitlens.graph.pull':
				void RepoActions.pull(repoPath);
				return;
			case 'gitlens.graph.push':
				void RepoActions.push(repoPath);
				return;
			case 'gitlens.fetch:graph':
				void RepoActions.fetch(repoPath);
				return;
			default:
				void executeCommand(params.command, Uri.file(repoPath));
		}
	}

	@trace()
	notifySidebarInvalidated(): void {
		this.context.fireSidebarInvalidated();
	}
}
