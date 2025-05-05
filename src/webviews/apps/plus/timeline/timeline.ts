import './timeline.scss';
import { html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GitReference } from '../../../../git/models/reference';
import { setAbbreviatedShaLength } from '../../../../git/utils/revision.utils';
import { isSubscriptionPaid } from '../../../../plus/gk/utils/subscription.utils';
import type { Deferrable } from '../../../../system/function/debounce';
import { debounce } from '../../../../system/function/debounce';
import type { State } from '../../../plus/timeline/protocol';
import {
	ChooseRefRequest,
	SelectDataPointCommand,
	UpdateConfigCommand,
	UpdateUriCommand,
} from '../../../plus/timeline/protocol';
import { GlApp } from '../../shared/app';
import type { Checkbox } from '../../shared/components/checkbox/checkbox';
import type { GlRefButton } from '../../shared/components/ref-button';
import type { HostIpc } from '../../shared/ipc';
import type { CommitEventDetail, GlTimelineChart } from './components/chart';
import { TimelineStateProvider } from './stateProvider';
import { timelineBaseStyles, timelineStyles } from './timeline.css';
import './components/chart';
import '../../shared/components/breadcrumbs';
import '../../shared/components/button';
import '../../shared/components/checkbox/checkbox';
import '../../shared/components/code-icon';
import '../../shared/components/feature-badge';
import '../../shared/components/feature-gate';
import '../../shared/components/menu/menu-label';
import '../../shared/components/ref-button';
import '../../shared/components/progress';
import '../../shared/components/overlays/popover';

@customElement('gl-timeline-app')
export class GlTimelineApp extends GlApp<State> {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [timelineBaseStyles, timelineStyles];

	@query('#chart')
	private _chart?: GlTimelineChart;

	protected override createStateProvider(state: State, ipc: HostIpc): TimelineStateProvider {
		return new TimelineStateProvider(this, state, ipc);
	}
	protected override onPersistState(state: State): void {
		this._ipc.setPersistedState({ config: state.config, uri: state.uri });
	}

	override connectedCallback(): void {
		super.connectedCallback();

		setAbbreviatedShaLength(this.state.config.abbreviatedShaLength);
	}

	@state()
	private _loading = false;

	get allowed() {
		return this.state.access?.allowed ?? false;
	}

	get base() {
		return this.config.base ?? this.repository?.ref;
	}

	get config() {
		return this.state.config;
	}

	get itemType() {
		return this.state.item.type;
	}

	get sliceBy() {
		return this.config.showAllBranches ? this.config.sliceBy : 'author';
	}

	get repository() {
		return this.state.repository;
	}

	get subscription() {
		return this.state.access?.subscription?.current;
	}

	get uri() {
		return this.state.uri;
	}

	override render(): unknown {
		return html`
			${this.allowed
				? html`<gl-feature-gate
						.source=${{ source: 'timeline' as const, detail: 'gate' }}
						.state=${this.subscription?.state}
				  ></gl-feature-gate>`
				: nothing}
			<div class="container">
				<progress-indicator ?active=${this._loading}></progress-indicator>
				<header class="header" ?hidden=${!this.uri}>
					<span class="details"
						>${this.renderBreadcrumbs()}
						<span class="details__ref" tabindex="0"
							>${this.config.showAllBranches
								? 'All Branches'
								: html`<gl-ref-name icon .ref=${this.base}></gl-ref-name>`}</span
						>
						${this.renderTimeframe()}</span
					>
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
						${this.subscription == null || !isSubscriptionPaid(this.subscription)
							? html`<gl-feature-badge
									placement="bottom"
									.source=${{ source: 'timeline' as const, detail: 'badge' }}
									.subscription=${this.subscription}
							  ></gl-feature-badge>`
							: nothing}
					</span>
				</header>

				<main class="timeline">${this.renderChart()}</main>
			</div>
		`;
	}

	private renderBreadcrumbs() {
		const repo = this.state.repository;

		return html`<gl-breadcrumbs>
			${repo != null
				? html`<gl-breadcrumb-item
						type="repo"
						icon="repo"
						collapsibleState="collapsed"
						shrink="10000000"
						tooltip="${repo.name}"
						>${repo.name}</gl-breadcrumb-item
				  >`
				: nothing}
			<gl-breadcrumb-item
				type="ref"
				icon="${getRefIcon(this.base)}"
				collapsibleState="collapsed"
				shrink="100000"
				tooltip="${this.base?.name || 'HEAD'}"
				><gl-ref-button .ref=${this.base} @click=${this.onChooseRef}></gl-ref-button
			></gl-breadcrumb-item>
			${this.renderBreadcrumbPathItems()}</gl-breadcrumbs
		>`;
	}

	private renderBreadcrumbPathItems() {
		const path = this.state.item.path || '';
		if (!path) return nothing;

		const breadcrumbs = [];

		const parts = path.split('/');
		const basePart = parts.pop() || '';
		const valuePrefix = '../'.repeat(parts.length + (this.itemType === 'folder' ? 2 : 1));
		const folders = parts.length;

		// Add folder parts if any
		if (folders) {
			const rootPart = parts.shift()!;
			let fullPath = rootPart;

			const folderItem = html`
				<gl-breadcrumb-item
					type="folder"
					icon="folder"
					tooltip="${rootPart}&#10;&#10;Click to Show Folder History"
					collapsibleState="expanded"
				>
					<span class="breadcrumb-folder" value="${valuePrefix}${rootPart}" @click=${this.onUpdateUri}
						>${rootPart}</span
					>
					${parts.length
						? html`
								<span slot="children" class="breadcrumb-item-children">
									${parts.map(part => {
										fullPath = `${fullPath}/${part}`;
										return html`<gl-breadcrumb-item-child
											tooltip="${fullPath}&#10;&#10;Click to Show Folder History"
											><span
												class="breadcrumb-folder"
												value="${valuePrefix}${fullPath}"
												@click=${this.onUpdateUri}
												>${part}</span
											></gl-breadcrumb-item-child
										>`;
									})}
								</span>
						  `
						: nothing}
				</gl-breadcrumb-item>
			`;

			breadcrumbs.push(folderItem);
		}

		// Add base item
		breadcrumbs.push(html`
			<gl-breadcrumb-item
				type="${this.itemType === 'folder' ? 'folder' : 'file'}"
				icon="${ifDefined(this.itemType === 'folder' ? (folders ? undefined : 'folder') : 'file')}"
				collapsibleState="none"
				shrink="0"
				tooltip="${path}"
			>
				<span value="${valuePrefix}${path}" @click=${this.onUpdateUri}>${basePart}</span>
			</gl-breadcrumb-item>
		`);

		return breadcrumbs;
	}

	private renderChart() {
		if (!this.uri || !this.state.dataset) {
			return html`<div class="timeline__empty">
				<p>There are no editors open that can provide file history information.</p>
			</div>`;
		}

		return html`<gl-timeline-chart
			id="chart"
			placement="${this.placement}"
			dateFormat="${this.state.config.dateFormat}"
			head="${this.base?.ref ?? 'HEAD'}"
			shortDateFormat="${this.state.config.shortDateFormat}"
			sliceBy="${this.sliceBy}"
			.dataPromise=${this.state.dataset}
			@gl-commit-select=${this.onChartCommitSelected}
			@gl-loading=${(e: CustomEvent<Promise<void>>) => {
				this._loading = true;
				void e.detail.finally(() => (this._loading = false));
			}}
		>
		</gl-timeline-chart>`;
	}

	private renderConfigPopover() {
		const { period, showAllBranches } = this.config;
		const sliceBy = this.sliceBy;

		return html`<gl-popover class="config" placement="bottom" trigger="hover focus click" hoist>
			<gl-button slot="anchor" appearance="toolbar">
				<code-icon icon="settings"></code-icon>
			</gl-button>
			<div slot="content" class="config__content">
				<menu-label>View Options</menu-label>
				<section>
					<label for="base">Base</label>
					<gl-ref-button
						name="base"
						tooltip="Change Base Reference"
						icon
						.ref=${this.base}
						@click=${this.onChooseRef}
					></gl-ref-button>
				</section>
				<section>
					<gl-checkbox
						value="all"
						.checked=${showAllBranches}
						@gl-change-value=${(e: CustomEvent<void>) => {
							this._ipc.sendCommand(UpdateConfigCommand, {
								showAllBranches: (e.target as Checkbox).checked,
							});
						}}
						>View All Branches</gl-checkbox
					>
				</section>
				<section>
					<span class="select-container">
						<label for="periods">Timeframe</label>
						<select
							class="select"
							name="periods"
							position="below"
							.value=${period}
							@change=${this.onPeriodChanged}
						>
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
				</section>
				<section>
					<span class="select-container">
						<label for="sliceBy" ?disabled=${!showAllBranches}>Slice By</label>
						<select
							class="select"
							name="sliceBy"
							position="below"
							.value=${sliceBy}
							?disabled=${!showAllBranches}
							@change=${this.onSliceByChanged}
						>
							<option value="author" ?selected=${sliceBy === 'author'}>Author</option>
							<option value="branch" ?selected=${sliceBy === 'branch'}>Branch</option>
						</select>
					</span>
				</section>
			</div>
		</gl-popover>`;
	}

	private renderTimeframe() {
		switch (this.config.period) {
			case '7|D':
				return html`<span class="details__timeframe">Up to 1wk ago</span>`;
			case '1|M':
				return html`<span class="details__timeframe">Up to 1mo ago</span>`;
			case '3|M':
				return html`<span class="details__timeframe">Up to 3mo ago</span>`;
			case '6|M':
				return html`<span class="details__timeframe">Up to 6mo ago</span>`;
			case '9|M':
				return html`<span class="details__timeframe">Up to 9mo ago</span>`;
			case '1|Y':
				return html`<span class="details__timeframe">Up to 1yr ago</span>`;
			case '2|Y':
				return html`<span class="details__timeframe">Up to 2yr ago</span>`;
			case '4|Y':
				return html`<span class="details__timeframe">Up to 4yr ago</span>`;
			case 'all':
				return html`<span class="details__timeframe">All time</span>`;
			default:
				return nothing;
		}
	}

	private onChooseRef = (e: Event) => {
		if ((e.target as GlRefButton).disabled) return;

		void this._ipc.sendRequest(ChooseRefRequest, undefined);
	};

	private onUpdateUri = (e: Event) => {
		const element = e.target as HTMLSpanElement;
		const value = element.getAttribute('value');
		if (value == null) return;

		this._ipc.sendCommand(UpdateUriCommand, { path: value });
	};

	private onChartCommitSelected(e: CustomEvent<CommitEventDetail>) {
		if (e.detail.id == null) return;

		this.fireSelectDataPoint(e.detail);
	}

	private onPeriodChanged(e: Event) {
		const element = e.target as HTMLSelectElement;
		const value = element.options[element.selectedIndex].value;
		assertPeriod(value);

		this._ipc.sendCommand(UpdateConfigCommand, { period: value });
	}

	private onSliceByChanged(e: Event) {
		const element = e.target as HTMLSelectElement;
		const value = element.options[element.selectedIndex].value;
		assertSliceBy(value);

		this._ipc.sendCommand(UpdateConfigCommand, { sliceBy: value });
	}

	private _fireSelectDataPointDebounced: Deferrable<(e: CommitEventDetail) => void> | undefined;
	private fireSelectDataPoint(e: CommitEventDetail) {
		this._fireSelectDataPointDebounced ??= debounce(
			(e: CommitEventDetail) => this._ipc.sendCommand(SelectDataPointCommand, e),
			150,
			{ maxWait: 250 },
		);
		this._fireSelectDataPointDebounced(e);
	}
}

function assertPeriod(period: string): asserts period is State['config']['period'] {
	if (period === 'all') return;

	const [value, unit] = period.split('|');
	if (isNaN(Number(value)) || (unit !== 'D' && unit !== 'M' && unit !== 'Y')) {
		throw new Error(`Invalid period: ${period}`);
	}
}

function assertSliceBy(sliceBy: string): asserts sliceBy is State['config']['sliceBy'] {
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
