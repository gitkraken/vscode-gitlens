import './timeline.scss';
import type { Remote } from '@eamodio/supertalk';
import { html, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import { isSubscriptionPaid } from '../../../../plus/gk/utils/subscription.utils.js';
import type {
	TimelineDatasetResult,
	TimelinePeriod,
	TimelineScopeType,
	TimelineServices,
	TimelineSliceBy,
} from '../../../plus/timeline/protocol.js';
import { SignalWatcherWebviewApp } from '../../shared/appBase.js';
import type { Checkbox } from '../../shared/components/checkbox/checkbox.js';
import type { GlRefButton } from '../../shared/components/ref-button.js';
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
import '../../shared/components/breadcrumbs.js';
import '../../shared/components/button.js';
import '../../shared/components/checkbox/checkbox.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/copy-container.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/feature-gate.js';
import '../../shared/components/gl-error-banner.js';
import '../../shared/components/menu/menu-label.js';
import '../../shared/components/progress.js';
import '../../shared/components/overlays/popover.js';
import '../../shared/components/ref-button.js';
import '../../shared/components/ref-name.js';
import '../../shared/components/repo-button-group.js';

@customElement('gl-timeline-app')
export class GlTimelineApp extends SignalWatcherWebviewApp {
	static override styles = [linkStyles, ruleStyles, timelineBaseStyles, timelineStyles];

	@property({ type: String, noAccessor: true })
	private context!: string;

	@query('#chart')
	private _chart?: GlTimelineChart;

	// ── Host abstraction ──
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

		// Create dataset resource — fetcher reads current state signals via closure
		const datasetResource = createResource<TimelineDatasetResult | undefined>(async signal => {
			const currentScope = s.scope.get();
			if (currentScope == null) return undefined;

			return timeline.getDataset(
				currentScope,
				{
					period: s.period.get(),
					showAllBranches: s.showAllBranches.get(),
					sliceBy: s.sliceBy.get(),
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

	private onPeriodChanged(e: Event) {
		const element = e.target as HTMLSelectElement;
		const value = element.options[element.selectedIndex].value;
		assertPeriod(value);
		this._actions?.changePeriod(value);
	}

	private onSliceByChanged(e: Event) {
		const element = e.target as HTMLSelectElement;
		const value = element.options[element.selectedIndex].value;
		assertSliceBy(value);
		this._actions?.changeSliceBy(value);
	}

	private onShowAllBranchesChanged(e: CustomEvent<void>) {
		const checked = (e.target as Checkbox).checked;
		this._actions?.changeShowAllBranches(checked);
	}

	private onChooseBaseRef = (e: MouseEvent) => {
		if ((e.target as GlRefButton).disabled) return;
		void this._actions?.chooseBaseRef();
	};

	private onChooseHeadRef = (e: MouseEvent) => {
		if ((e.target as GlRefButton).disabled) return;
		const location = (e.target as GlRefButton).getAttribute('location');
		void this._actions?.chooseHeadRef(location);
	};

	private onChoosePath = (e: MouseEvent) => {
		e.stopImmediatePropagation();
		void this._actions?.choosePath(this.placement === 'view' || e.altKey || e.shiftKey);
	};

	private onChangeScope = (e: MouseEvent) => {
		const el =
			(e.target as HTMLElement)?.closest('gl-breadcrumb-item-child') ??
			(e.target as HTMLElement)?.closest('gl-breadcrumb-item');

		const type = el?.getAttribute('type') as TimelineScopeType;
		if (type == null) return;

		const value = el?.getAttribute('value') ?? undefined;
		this._actions?.changeScope(type, value, this.placement === 'view' || e.altKey || e.shiftKey);
	};

	private onChartCommitSelected(e: CustomEvent<CommitEventDetail>) {
		if (e.detail.id == null) return;
		this._actions?.selectDataPoint(e.detail);
	}

	override render(): unknown {
		const s = this._state;
		const datasetLoading = this._datasetResource?.loading.get() ?? false;
		return html`${this.renderGate()}
			<div class="container">
				<gl-error-banner .error=${s.error}></gl-error-banner>
				<progress-indicator ?active=${datasetLoading}></progress-indicator>
				<header class="header" ?hidden=${!s.scope.get()}>
					<span class="details">${this.renderBreadcrumbs()} ${this.renderTimeframe()}</span>
					<span class="toolbox">
						${this.renderConfigPopover()}
						${this.placement === 'view'
							? html`<gl-button
									appearance="toolbar"
									href="command:gitlens.views.timeline.openInTab"
									tooltip="Open in Editor"
									aria-label="Open in Editor"
								>
									<code-icon icon="link-external"></code-icon>
								</gl-button>`
							: nothing}
						${s.access.get()?.subscription?.current == null ||
						!isSubscriptionPaid(s.access.get()!.subscription.current)
							? html`<gl-feature-badge
									placement="bottom"
									.source=${{ source: 'timeline' as const, detail: 'badge' }}
									.subscription=${s.access.get()?.subscription?.current}
								></gl-feature-badge>`
							: nothing}
					</span>
				</header>

				<main class="timeline">${this.renderChart()}</main>
			</div> `;
	}

	private renderGate() {
		const s = this._state;
		const sub = s.access.get()?.subscription?.current;
		if (this.placement === 'editor') {
			return html`<gl-feature-gate
				?hidden=${s.allowed.get() !== false}
				featureRestriction="private-repos"
				.source=${{ source: 'timeline' as const, detail: 'gate' }}
				.state=${sub?.state}
				><p slot="feature">
					<a href="https://help.gitkraken.com/gitlens/gitlens-features/#visual-file-history-pro"
						>Visual History</a
					>
					<gl-feature-badge></gl-feature-badge>
					&mdash; visualize the evolution of a repository, branch, folder, or file and identify when the most
					impactful changes were made and by whom. Quickly see unmerged changes in files or folders, when
					slicing by branch.
				</p></gl-feature-gate
			>`;
		}

		return html`<gl-feature-gate
			?hidden=${s.allowed.get() !== false}
			featureRestriction="private-repos"
			.source=${{ source: 'timeline' as const, detail: 'gate' }}
			.state=${sub?.state}
			><p slot="feature">
				<a href="https://help.gitkraken.com/gitlens/gitlens-features/#visual-file-history-pro"
					>Visual File History</a
				>
				<gl-feature-badge></gl-feature-badge>
				&mdash; visualize the evolution of a file and quickly identify when the most impactful changes were made
				and by whom. Quickly see unmerged changes in files or folders, when slicing by branch.
			</p></gl-feature-gate
		>`;
	}

	private renderBreadcrumbs() {
		return html`<gl-breadcrumbs>
			${this.renderRepositoryBreadcrumbItem()}
			${this.renderBranchBreadcrumbItem()}${this.renderBreadcrumbPathItems()}
			${this.placement === 'editor'
				? html`<gl-button
						appearance="toolbar"
						density="compact"
						@click=${this.onChoosePath}
						tooltip="Choose File or Folder to Visualize..."
						aria-label="Choose File or Folder to Visualize..."
						><code-icon slot="prefix" icon="folder-opened"></code-icon>Choose File / Folder...</gl-button
					>`
				: nothing}
		</gl-breadcrumbs>`;
	}

	private renderRepositoryBreadcrumbItem() {
		const s = this._state;
		const repo = s.repository.get();
		if (repo == null) return nothing;

		return html`<gl-breadcrumb-item
			collapsibleState="${s.scope.get()?.relativePath ? 'collapsed' : 'expanded'}"
			icon="gl-repository"
			shrink="10000000"
			type="repo"
		>
			<gl-repo-button-group
				aria-label="Visualize Repository History"
				.connectIcon=${false}
				.hasMultipleRepositories=${s.repositories.get().openCount > 1}
				.icon=${false}
				.repository=${repo}
				.source=${{ source: 'timeline' } as const}
				@gl-click=${this.onChangeScope}
				><span slot="tooltip">
					Visualize Repository History
					<hr />
					${repo.name}
				</span></gl-repo-button-group
			>
		</gl-breadcrumb-item>`;
	}

	private renderBranchBreadcrumbItem() {
		const s = this._state;
		const headRef = s.head.get();
		const showAllBranches = s.showAllBranches.get();

		return html`<gl-breadcrumb-item
			collapsibleState="expanded"
			icon="${showAllBranches ? 'git-branch' : getRefIcon(headRef)}"
			shrink="100000"
			type="ref"
		>
			<gl-ref-button .ref=${showAllBranches ? undefined : headRef} @click=${this.onChooseHeadRef}
				><span slot="empty">All Branches</span
				><span slot="tooltip"
					>Change Reference...
					<hr />
					${showAllBranches
						? 'Showing All Branches'
						: html`<gl-ref-name icon .ref=${headRef}></gl-ref-name>`}</span
				></gl-ref-button
			>
		</gl-breadcrumb-item>`;
	}

	private renderBreadcrumbPathItems() {
		const s = this._state;
		const path = s.scope.get()?.relativePath;
		if (!path) return nothing;

		const breadcrumbs = [];

		const parts = path.split('/');
		const basePart = parts.pop() || '';
		const folders = parts.length;

		// Add folder parts if any
		if (folders) {
			const rootPart = parts.shift()!;
			let fullPath = rootPart;

			const folderItem = html`
				<gl-breadcrumb-item
					collapsibleState="expanded"
					icon="folder"
					type="${'folder' satisfies TimelineScopeType}"
					value="${rootPart}"
				>
					<gl-button
						appearance="toolbar"
						@click=${this.onChangeScope}
						aria-label="Visualize folder history of ${rootPart}"
						>${rootPart}<span slot="tooltip"
							>Visualize Folder History
							<hr />
							${rootPart}</span
						></gl-button
					>

					${parts.length
						? html`<span slot="children" class="breadcrumb-item-children">
								${parts.map(part => {
									fullPath = `${fullPath}/${part}`;
									return html`<gl-breadcrumb-item-child
										type="${'folder' satisfies TimelineScopeType}"
										value="${fullPath}"
									>
										<gl-button
											appearance="toolbar"
											@click=${this.onChangeScope}
											aria-label="Visualize folder history of ${fullPath}"
											>${part}<span slot="tooltip"
												>Visualize Folder History
												<hr />
												${fullPath}</span
											></gl-button
										>
									</gl-breadcrumb-item-child>`;
								})}
							</span>`
						: nothing}
				</gl-breadcrumb-item>
			`;

			breadcrumbs.push(folderItem);
		}

		// Add base item
		const scopeType = s.scope.get()?.type;
		breadcrumbs.push(html`
			<gl-breadcrumb-item
				collapsibleState="none"
				icon="${ifDefined(scopeType === 'folder' ? (folders ? undefined : 'folder') : 'file')}"
				shrink="0"
				tooltip="${path}"
				type="${(scopeType === 'folder' ? 'folder' : 'file') satisfies TimelineScopeType}"
				value="${path}"
			>
				<gl-copy-container
					tabindex="0"
					copyLabel="Copy Path&#10;&#10;${path}"
					.content=${path}
					placement="bottom"
				>
					<span>${basePart}</span>
				</gl-copy-container>
			</gl-breadcrumb-item>
		`);

		return breadcrumbs;
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

		return html`<gl-timeline-chart
			id="chart"
			placement="${this.placement}"
			dateFormat="${s.displayConfig.get().dateFormat}"
			.dataPromise=${dataPromise}
			head="${s.head.get()?.ref ?? 'HEAD'}"
			.scope=${s.scope.get()}
			shortDateFormat="${s.displayConfig.get().shortDateFormat}"
			sliceBy="${s.effectiveSliceBy.get()}"
			@gl-commit-select=${this.onChartCommitSelected}
			@gl-loading=${(e: CustomEvent<Promise<void>>) => {
				// Chart has its own internal loading state for rendering
				void e.detail;
			}}
		>
			<div slot="empty">
				${s.scope.get() == null
					? html`<p>Something went wrong</p>
							<p>Please close this tab and try again</p>`
					: html`<p>No commits found for the specified time period</p>
							${this.renderPeriodSelect(s.period.get())}`}
			</div>
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

	private renderConfigPopover() {
		const s = this._state;
		const period = s.period.get();

		return html`<gl-popover class="config" placement="bottom" trigger="hover focus click" hoist>
			<gl-button slot="anchor" appearance="toolbar">
				<code-icon icon="settings"></code-icon>
			</gl-button>
			<div slot="content" class="config__content">
				<menu-label>View Options</menu-label>
				${this.renderConfigHead()} ${this.renderConfigBase()} ${this.renderConfigShowAllBranches()}
				${this.renderPeriodSelect(period)} ${this.renderConfigSliceBy()}
			</div>
		</gl-popover>`;
	}

	private renderConfigHead() {
		const s = this._state;
		const headRef = s.head.get();
		const showAllBranches = s.showAllBranches.get();
		const disabled = showAllBranches && s.effectiveSliceBy.get() !== 'branch';

		return html`<section>
			<label for="head" ?disabled=${disabled}>Branch</label>
			<gl-ref-button
				name="head"
				?disabled=${disabled}
				icon
				.ref=${headRef}
				location="config"
				@click=${this.onChooseHeadRef}
				><span slot="tooltip"
					>Change Reference...
					<hr />
					${showAllBranches
						? 'Showing All Branches'
						: html`<gl-ref-name icon .ref=${headRef}></gl-ref-name>`}</span
				></gl-ref-button
			>
		</section>`;
	}

	private renderConfigBase() {
		// Commenting out for now, as its not yet ready
		return nothing;
	}

	private renderConfigShowAllBranches() {
		const s = this._state;
		if (s.repository.get()?.virtual) return nothing;
		const showAllBranches = s.showAllBranches.get();
		return html`<section>
			<gl-checkbox value="all" .checked=${showAllBranches} @gl-change-value=${this.onShowAllBranchesChanged}
				>View All Branches</gl-checkbox
			>
		</section>`;
	}

	private renderPeriodSelect(period: TimelinePeriod) {
		return html`<section>
			<span class="select-container">
				<label for="periods">Timeframe</label>
				<select class="select" name="periods" position="below" .value=${period} @change=${this.onPeriodChanged}>
					<option value="7|D" ?selected=${period === '7|D'}>1 week</option>
					<option value="1|M" ?selected=${period === '1|M'}>1 month</option>
					<option value="3|M" ?selected=${period === '3|M'}>3 months</option>
					<option value="6|M" ?selected=${period === '6|M'}>6 months</option>
					<option value="9|M" ?selected=${period === '9|M'}>9 months</option>
					<option value="1|Y" ?selected=${period === '1|Y'}>1 year</option>
					<option value="2|Y" ?selected=${period === '2|Y'}>2 years</option>
					<option value="4|Y" ?selected=${period === '4|Y'}>4 years</option>
					<option value="all" ?selected=${period === 'all'}>Full history</option>
				</select>
			</span>
		</section>`;
	}

	private renderConfigSliceBy() {
		const s = this._state;
		if (!s.isSliceBySupported.get()) return nothing;

		const sliceBy = s.effectiveSliceBy.get();

		return html`<section>
			<span class="select-container"
				><label for="sliceBy">Slice By</label>
				<select
					class="select"
					name="sliceBy"
					position="below"
					.value=${sliceBy}
					@change=${this.onSliceByChanged}
				>
					<option value="author" ?selected=${sliceBy === 'author'}>Author</option>
					<option value="branch" ?selected=${sliceBy === 'branch'}>Branch</option>
				</select></span
			>
		</section>`;
	}

	private renderTimeframe() {
		const s = this._state;
		let label;
		switch (s.period.get()) {
			case '7|D':
				label = 'Up to 1wk ago';
				break;
			case '1|M':
				label = 'Up to 1mo ago';
				break;
			case '3|M':
				label = 'Up to 3mo ago';
				break;
			case '6|M':
				label = 'Up to 6mo ago';
				break;
			case '9|M':
				label = 'Up to 9mo ago';
				break;
			case '1|Y':
				label = 'Up to 1yr ago';
				break;
			case '2|Y':
				label = 'Up to 2yr ago';
				break;
			case '4|Y':
				label = 'Up to 4yr ago';
				break;
			case 'all':
				label = 'All time';
				break;
			default:
				return nothing;
		}

		return html`<span class="details__timeframe" tabindex="0">${label}</span>`;
	}
}

function assertPeriod(period: string): asserts period is TimelinePeriod {
	if (period === 'all') return;

	const [value, unit] = period.split('|');
	if (isNaN(Number(value)) || (unit !== 'D' && unit !== 'M' && unit !== 'Y')) {
		throw new Error(`Invalid period: ${period}`);
	}
}

function assertSliceBy(sliceBy: string): asserts sliceBy is TimelineSliceBy {
	if (sliceBy !== 'author' && sliceBy !== 'branch') {
		throw new Error(`Invalid slice by: ${sliceBy}`);
	}
}

function getRefIcon(ref: GitReference | undefined): string {
	switch (ref?.refType) {
		case 'branch':
			return 'git-branch';
		case 'tag':
			return 'tag';
		default:
			return 'git-commit';
	}
}
