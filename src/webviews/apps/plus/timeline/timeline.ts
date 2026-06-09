import './timeline.scss';
import type { Remote } from '@eamodio/supertalk';
import { html, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { isSubscriptionPaid } from '../../../../plus/gk/utils/subscription.utils.js';
import type {
	TimelineDatasetResult,
	TimelinePeriod,
	TimelineScopeType,
	TimelineServices,
	TimelineSliceBy,
} from '../../../plus/timeline/protocol.js';
import { periodToMs } from '../../../plus/timeline/utils/period.js';
import { SignalWatcherWebviewApp } from '../../shared/appBase.js';
import { compactBreadcrumbsConsumerStyles } from '../../shared/components/breadcrumbs.js';
import { featureGateContentStyles } from '../../shared/components/feature-gate.css.js';
import { getHost } from '../../shared/host/context.js';
import { RpcController } from '../../shared/rpc/rpcController.js';
import type { Resource } from '../../shared/state/resource.js';
import { createResource } from '../../shared/state/resource.js';
import { linkStyles, ruleStyles } from '../shared/components/vscode.css.js';
import { TimelineActions } from './actions.js';
import type { CommitEventDetail, GlTimelineChart } from './components/chart.js';
import type { SubscriptionActions } from './events.js';
import { setupSubscriptions } from './events.js';
import type { TimelineState } from './state.js';
import { createTimelineState } from './state.js';
import { timelineBaseStyles, timelineStyles } from './timeline.css.js';
import './components/chart.js';
import './components/header.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/feature-gate.js';
import '../../shared/components/file-icon/file-icon.js';
import '../../shared/components/gl-error-banner.js';
import '../../shared/components/progress.js';

@customElement('gl-timeline-app')
export class GlTimelineApp extends SignalWatcherWebviewApp {
	static override styles = [
		linkStyles,
		ruleStyles,
		featureGateContentStyles,
		timelineBaseStyles,
		timelineStyles,
		compactBreadcrumbsConsumerStyles,
	];

	@property({ type: String, noAccessor: true })
	private context!: string;

	@query('#chart')
	private _chart?: GlTimelineChart;

	private _host = getHost();

	/**
	 * Instance-owned state — created here with persistence support, passed to actions as a parameter.
	 */
	private _state: TimelineState = createTimelineState(this._host.storage);

	private _actions?: TimelineActions;
	private _datasetResource?: Resource<TimelineDatasetResult | undefined>;
	private _unsubscribeEvents?: () => void;
	private _stopAutoPersist?: () => void;
	private _chartDataset?: TimelineDatasetResult['dataset'];
	private _chartDataPromise?: Promise<TimelineDatasetResult['dataset']>;

	private _rpc = new RpcController<TimelineServices>(this, {
		rpcOptions: {
			webviewId: () => this._webview?.webviewId,
			webviewInstanceId: () => this._webview?.webviewInstanceId,
			endpoint: () => this._host.createEndpoint(),
		},
		onReady: services => this._onRpcReady(services),
		onError: error => this._state.error.set(error.message),
	});

	override connectedCallback(): void {
		super.connectedCallback?.();

		const context = this.context;
		this.context = undefined!;
		this.initWebviewContext(context);
	}

	override disconnectedCallback(): void {
		this._unsubscribeEvents?.();
		this._unsubscribeEvents = undefined;

		this._stopAutoPersist?.();
		this._stopAutoPersist = undefined;

		this._datasetResource?.dispose();
		this._datasetResource = undefined;
		this._chartDataset = undefined;
		this._chartDataPromise = undefined;

		this._actions?.dispose();
		this._actions = undefined;

		this._state.resetAll();
		this._state.dispose();

		super.disconnectedCallback?.();
	}

	private async _onRpcReady(services: Remote<TimelineServices>): Promise<void> {
		const s = this._state;

		// Resolve the timeline sub-service and domain sub-services
		const [timeline, repositories, repository, subscription, config] = await Promise.all([
			services.timeline,
			services.repositories,
			services.repository,
			services.subscription,
			services.config,
		]);

		// Create dataset resource — fetcher reads current state signals via closure. `loadedSpanMs`
		// is what powers progressive load-more: when the user zooms past the loaded oldest, the
		// chart fires `gl-load-more`, the action bumps `loadedSpanMs` by a chunk, and this fetcher
		// re-runs with the wider span. `loadedSpanMs == null` means "use period-derived span" —
		// the initial state and after period changes.
		const datasetResource = createResource<TimelineDatasetResult | undefined>(async signal => {
			const currentScope = s.scope.get();
			if (currentScope == null) return undefined;

			return timeline.getDataset(
				currentScope,
				{
					period: s.period.get(),
					showAllBranches: s.showAllBranches.get(),
					sliceBy: s.sliceBy.get(),
					loadedSpanMs: s.loadedSpanMs.get() ?? undefined,
				},
				signal,
			);
		});
		this._datasetResource = datasetResource;

		const actions = new TimelineActions(s, services, timeline, repository, datasetResource);
		this._actions = actions;

		// Start auto-persistence before any state changes from host
		this._stopAutoPersist = s.startAutoPersist();

		// Subscribe to events FIRST (so we don't miss events during initial fetch).
		const subActions: SubscriptionActions = {
			onScopeChanged: event => actions.onScopeChanged(event),
			onRepoChanged: e => actions.onRepoChanged(e),
			onDataChanged: () => void actions.fetchTimeline(),
			onConfigChanged: () => void actions.fetchDisplayConfig(),
			onRepoCountChanged: () => void actions.fetchRepoCount(),
		};
		this._unsubscribeEvents = await setupSubscriptions(
			{ timeline: timeline, repositories: repositories, subscription: subscription, config: config },
			subActions,
		);

		// Cancel pending RPC requests on hide (responses would be silently dropped
		// by VS Code); re-fetch data on visibility restore
		const onVisibilityChange = (): void => {
			if (document.visibilityState !== 'visible') {
				actions.cancelPendingRequests();
				return;
			}

			// Visibility restored — re-fetch if we have a scope
			if (s.scope.get() != null) {
				void actions.fetchTimeline();
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);
		this.disposables.push({ dispose: () => document.removeEventListener('visibilitychange', onVisibilityChange) });

		await actions.populateInitialState();
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated?.(changedProperties);
		this._actions?.pushTelemetryContext();
	}

	private onChartCommitSelected(e: CustomEvent<CommitEventDetail>) {
		if (e.detail.id == null) return;

		this._actions?.selectDataPoint(e.detail);
	}

	private onChartLoadMore = (): void => {
		this._actions?.extendTimeline();
	};

	private onChartVisibleRangeChanged = (e: CustomEvent<{ oldest: number; newest: number }>): void => {
		this._state.visibleSpanMs.set(e.detail.newest - e.detail.oldest);
	};

	override render(): unknown {
		const s = this._state;
		const datasetLoading = this._datasetResource?.loading.get() ?? false;
		const scope = s.scope.get();
		const repo = s.repository.get();
		const access = s.access.get();
		const subscription = access?.subscription?.current;
		return html`${this.renderGate()}
			<div class="container">
				<gl-error-banner .error=${s.error}></gl-error-banner>
				<progress-indicator ?active=${datasetLoading}></progress-indicator>
				<gl-timeline-header
					?hidden=${!scope}
					placement=${this.placement}
					host="timeline"
					.repository=${repo}
					.repositoryCount=${s.repositories.get().openCount}
					.headRef=${s.head.get()}
					.scopeType=${scope?.type ?? 'repo'}
					.relativePath=${scope?.relativePath ?? ''}
					.period=${s.period.get()}
					.visibleSpanMs=${s.visibleSpanMs.get()}
					.sliceBy=${s.effectiveSliceBy.get()}
					.showAllBranches=${s.showAllBranches.get()}
					.showAllBranchesSupported=${!repo?.virtual}
					.sliceBySupported=${s.isSliceBySupported.get()}
					@gl-timeline-header-period-change=${this.onHeaderPeriodChange}
					@gl-timeline-header-slice-by-change=${this.onHeaderSliceByChange}
					@gl-timeline-header-show-all-branches-change=${this.onHeaderShowAllBranchesChange}
					@gl-timeline-header-choose-head-ref=${this.onHeaderChooseHeadRef}
					@gl-timeline-header-choose-path=${this.onHeaderChoosePath}
					@gl-timeline-header-clear-scope=${this.onHeaderClearScope}
					@gl-timeline-header-change-scope=${this.onHeaderChangeScope}
				>
					${this.placement === 'view'
						? html`<gl-button
								slot="toolbox"
								appearance="toolbar"
								href="command:gitlens.views.timeline.openInTab"
								tooltip="Open in Editor"
								aria-label="Open in Editor"
							>
								<code-icon icon="link-external"></code-icon>
							</gl-button>`
						: nothing}
					${subscription == null || !isSubscriptionPaid(subscription)
						? html`<gl-feature-badge
								slot="toolbox"
								placement="bottom"
								.source=${{ source: 'timeline' as const, detail: 'badge' }}
								.subscription=${subscription}
							></gl-feature-badge>`
						: nothing}
				</gl-timeline-header>

				<main class="timeline">${this.renderChart()}</main>
			</div> `;
	}

	private onHeaderPeriodChange = (e: CustomEvent<{ period: TimelinePeriod }>): void => {
		this._actions?.changePeriod(e.detail.period);
	};

	private onHeaderSliceByChange = (e: CustomEvent<{ sliceBy: TimelineSliceBy }>): void => {
		this._actions?.changeSliceBy(e.detail.sliceBy);
	};

	private onHeaderShowAllBranchesChange = (e: CustomEvent<{ showAllBranches: boolean }>): void => {
		this._actions?.changeShowAllBranches(e.detail.showAllBranches);
	};

	private onHeaderChooseHeadRef = (e: CustomEvent<{ location?: string }>): void => {
		void this._actions?.chooseHeadRef(e.detail.location ?? null);
	};

	private onHeaderChoosePath = (e: CustomEvent<{ detached: boolean }>): void => {
		void this._actions?.choosePath(e.detail.detached);
	};

	private onHeaderClearScope = (): void => {
		this._actions?.changeScope('repo', null, false);
	};

	private onHeaderChangeScope = (
		e: CustomEvent<{ type: TimelineScopeType; value: string | undefined; detached: boolean }>,
	): void => {
		this._actions?.changeScope(e.detail.type, e.detail.value ?? null, e.detail.detached);
	};

	private onSwitchRepos = (): void => {
		void this._actions?.pickAndNavigateRepo();
	};

	private renderGate() {
		const s = this._state;
		// Mount the gate only while access is denied — mount/unmount drives the modal's open/teardown,
		// the same way the Commit Graph gate is conditionally rendered.
		if (s.allowed.get() !== false) return nothing;

		const sub = s.access.get()?.subscription?.current;
		if (this.placement === 'editor') {
			return html`<gl-feature-gate
				?allowRepoSwitch=${s.allowRepoSwitch.get()}
				featureRestriction="private-repos"
				.source=${{ source: 'timeline' as const, detail: 'gate' }}
				.state=${sub?.state}
				@gl-switch-repos=${this.onSwitchRepos}
				><section slot="feature" class="feature">
					<header class="feature__header">
						<div class="icon-cube feature__feature-icon"><code-icon icon="gl-gitlens"></code-icon></div>
						<hgroup>
							<h2 class="feature__title">
								<span>Visual History</span>
								<gl-feature-badge></gl-feature-badge>
							</h2>
							<p class="feature__lede">See how any file, folder, or branch evolved &mdash; at a glance</p>
						</hgroup>
					</header>
					<p>
						Visualize the evolution of a repository, branch, folder, or file and identify when the most
						impactful changes were made and by whom. Quickly see unmerged changes in files or folders, when
						slicing by branch.
						<a href="https://help.gitkraken.com/gitlens/gitlens-features/#visual-file-history-pro"
							>Learn More</a
						>
					</p>
				</section>
			</gl-feature-gate>`;
		}

		return html`<gl-feature-gate
			?allowRepoSwitch=${s.allowRepoSwitch.get()}
			?hidden=${s.allowed.get() !== false}
			featureRestriction="private-repos"
			.source=${{ source: 'timeline' as const, detail: 'gate' }}
			.state=${sub?.state}
			@gl-switch-repos=${this.onSwitchRepos}
			><section slot="feature" class="feature">
				<header class="feature__header">
					<div class="icon-cube feature__feature-icon"><code-icon icon="gl-gitlens"></code-icon></div>
					<hgroup>
						<h2 class="feature__title">
							<span>Visual History</span>
							<gl-feature-badge></gl-feature-badge>
						</h2>
						<p class="feature__lede">See how any file, folder, or branch evolved &mdash; at a glance</p>
					</hgroup>
				</header>
				<p>
					Visualize the evolution of a repository, branch, folder, or file and identify when the most
					impactful changes were made and by whom. Quickly see unmerged changes in files or folders, when
					slicing by branch.
					<a href="https://help.gitkraken.com/gitlens/gitlens-features/#visual-file-history-pro"
						>Learn More</a
					>
				</p>
			</section></gl-feature-gate
		>`;
	}

	private renderChart() {
		const s = this._state;
		if (!s.scope.get() && this.placement === 'view') {
			return html`<div class="timeline__empty">
				<p>There are no editors open that can provide file history information.</p>
			</div>`;
		}

		const datasetResult = this._datasetResource?.value.get();
		const dataPromise = this.getChartDataPromise(datasetResult?.dataset);

		const emptySlot = html`<div slot="empty">
			${s.scope.get() == null
				? html`<p>Something went wrong</p>
						<p>Please close this tab and try again</p>`
				: html`<p>No commits found for the specified time period</p>`}
		</div>`;

		const datasetLoading = this._datasetResource?.loading.get() ?? false;
		const isLoadingMore = s.loadingMore.get();
		// `loading` (full-canvas) only applies to the initial fetch; once we're extending the
		// dataset via `gl-load-more` the chart switches to its edge-gradient affordance and
		// keeps existing rows interactive. `windowSpanMs` makes the period the initial viewport
		// (matching the embedded Graph timeline) so the user can zoom out past it to fire
		// load-more, paging in older history without re-loading what's already on screen.
		return html`<gl-timeline-chart
			id="chart"
			placement="${this.placement}"
			currentUserNameStyle="${s.displayConfig.get().currentUserNameStyle}"
			dateFormat="${s.displayConfig.get().dateFormat}"
			.dataPromise=${dataPromise}
			?loading=${datasetLoading && !isLoadingMore}
			?loadingMore=${isLoadingMore}
			?hasMore=${s.hasMore.get()}
			head="${s.head.get()?.ref ?? 'HEAD'}"
			.scope=${s.scope.get()}
			shortDateFormat="${s.displayConfig.get().shortDateFormat}"
			sliceBy="${s.effectiveSliceBy.get()}"
			.windowSpanMs=${periodToMs(s.period.get())}
			@gl-commit-select=${this.onChartCommitSelected}
			@gl-load-more=${this.onChartLoadMore}
			@gl-visible-range-changed=${this.onChartVisibleRangeChanged}
			@gl-loading=${(e: CustomEvent<Promise<void>>) => {
				void e.detail;
			}}
		>
			${emptySlot}
		</gl-timeline-chart>`;
	}

	private getChartDataPromise(
		dataset: TimelineDatasetResult['dataset'] | undefined,
	): Promise<TimelineDatasetResult['dataset']> | undefined {
		if (dataset == null) {
			this._chartDataset = undefined;
			this._chartDataPromise = undefined;
			return undefined;
		}

		if (this._chartDataset !== dataset || this._chartDataPromise == null) {
			this._chartDataset = dataset;
			this._chartDataPromise = Promise.resolve(dataset);
		}

		return this._chartDataPromise;
	}
}
