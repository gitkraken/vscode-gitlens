import './timeline.scss';
import { html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GitReference } from '../../../../git/models/reference';
import { setAbbreviatedShaLength } from '../../../../git/utils/revision.utils';
import { isSubscriptionPaid } from '../../../../plus/gk/utils/subscription.utils';
import type { Deferrable } from '../../../../system/function/debounce';
import { debounce } from '../../../../system/function/debounce';
import { dirname } from '../../../../system/path';
import type { State, TimelinePeriod, TimelineScopeType } from '../../../plus/timeline/protocol';
import {
	ChoosePathRequest,
	ChooseRefRequest,
	SelectDataPointCommand,
	UpdateConfigCommand,
	UpdateScopeCommand,
} from '../../../plus/timeline/protocol';
import { GlAppHost } from '../../shared/appHost';
import type { Checkbox } from '../../shared/components/checkbox/checkbox';
import type { GlRefButton } from '../../shared/components/ref-button';
import type { LoggerContext } from '../../shared/contexts/logger';
import type { HostIpc } from '../../shared/ipc';
import { linkStyles, ruleStyles } from '../shared/components/vscode.css';
import type { CommitEventDetail, GlTimelineChart } from './components/chart';
import { TimelineStateProvider } from './stateProvider';
import { timelineBaseStyles, timelineStyles } from './timeline.css';
import './components/chart';
import '../../shared/components/breadcrumbs';
import '../../shared/components/button';
import '../../shared/components/checkbox/checkbox';
import '../../shared/components/code-icon';
import '../../shared/components/copy-container';
import '../../shared/components/feature-badge';
import '../../shared/components/feature-gate';
import '../../shared/components/menu/menu-label';
import '../../shared/components/progress';
import '../../shared/components/overlays/popover';
import '../../shared/components/ref-button';
import '../../shared/components/ref-name';
import '../../shared/components/repo-button-group';

@customElement('gl-timeline-app')
export class GlTimelineApp extends GlAppHost<State> {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [linkStyles, ruleStyles, timelineBaseStyles, timelineStyles];

	@query('#chart')
	private _chart?: GlTimelineChart;

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): TimelineStateProvider {
		return new TimelineStateProvider(this, bootstrap, ipc, logger);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		setAbbreviatedShaLength(this.state.config.abbreviatedShaLength);
	}

	@state()
	private _loading = false;

	get allowed() {
		return this.state.access?.allowed ?? false;
	}

	get base() {
		return this.scope?.base ?? this.repository?.ref;
	}

	get config() {
		return this.state.config;
	}

	get head() {
		return this.scope?.head ?? this.repository?.ref;
	}

	get repository() {
		return this.state.repository;
	}

	get scope() {
		return this.state.scope;
	}

	get isShowAllBranchesSupported() {
		return !this.repository?.virtual;
	}

	get isSliceBySupported() {
		return !this.repository?.virtual && (this.scope?.type === 'file' || this.scope?.type === 'folder');
	}

	get sliceBy() {
		return this.isSliceBySupported && this.config.showAllBranches ? this.config.sliceBy : 'author';
	}

	get subscription() {
		return this.state.access?.subscription?.current;
	}

	private renderGate() {
		if (this.placement === 'editor') {
			return html`<gl-feature-gate
				?hidden=${this.allowed !== false}
				featureRestriction="private-repos"
				.source=${{ source: 'timeline' as const, detail: 'gate' }}
				.state=${this.subscription?.state}
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
			?hidden=${this.allowed !== false}
			featureRestriction="private-repos"
			.source=${{ source: 'timeline' as const, detail: 'gate' }}
			.state=${this.subscription?.state}
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
	override render(): unknown {
		return html`${this.renderGate()}
			<div class="container">
				<progress-indicator ?active=${this._loading}></progress-indicator>
				<header class="header" ?hidden=${!this.scope}>
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
			</div> `;
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
		const repo = this.state.repository;
		if (repo == null) return nothing;

		return html`<gl-breadcrumb-item
			collapsibleState="${this.state.scope?.relativePath ? 'collapsed' : 'expanded'}"
			icon="gl-repository"
			shrink="10000000"
			type="repo"
		>
			<gl-repo-button-group
				aria-label="Visualize Repository History"
				.connectIcon=${false}
				.hasMultipleRepositories=${this.state.repositories.openCount > 1}
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
		const {
			head,
			config: { showAllBranches },
		} = this;

		return html`<gl-breadcrumb-item
			collapsibleState="expanded"
			icon="${showAllBranches ? 'git-branch' : getRefIcon(head)}"
			shrink="100000"
			type="ref"
		>
			<gl-ref-button .ref=${showAllBranches ? undefined : head} @click=${this.onChooseHeadRef}
				><span slot="empty">All Branches</span
				><span slot="tooltip"
					>Change Reference...
					<hr />
					${showAllBranches
						? 'Showing All Branches'
						: html`<gl-ref-name icon .ref=${head}></gl-ref-name>`}</span
				></gl-ref-button
			>
		</gl-breadcrumb-item>`;
	}

	private renderBreadcrumbPathItems() {
		const path = this.state.scope?.relativePath;
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
		breadcrumbs.push(html`
			<gl-breadcrumb-item
				collapsibleState="none"
				icon="${ifDefined(this.scope?.type === 'folder' ? (folders ? undefined : 'folder') : 'file')}"
				shrink="0"
				tooltip="${path}"
				type="${(this.scope?.type === 'folder' ? 'folder' : 'file') satisfies TimelineScopeType}"
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
		if (!this.scope && this.placement === 'view') {
			return html`<div class="timeline__empty">
				<p>There are no editors open that can provide file history information.</p>
			</div>`;
		}

		return html`<gl-timeline-chart
			id="chart"
			placement="${this.placement}"
			dateFormat="${this.state.config.dateFormat}"
			.dataPromise=${this.state.dataset}
			head="${this.head?.ref ?? 'HEAD'}"
			.scope=${this.scope}
			shortDateFormat="${this.state.config.shortDateFormat}"
			sliceBy="${this.sliceBy}"
			@gl-commit-select=${this.onChartCommitSelected}
			@gl-loading=${(e: CustomEvent<Promise<void>>) => {
				this._loading = true;
				void e.detail.finally(() => (this._loading = false));
			}}
		>
			<div slot="empty">
				${this.scope == null
					? html`<p>Something went wrong</p>
							<p>Please close this tab and try again</p>`
					: html`<p>No commits found for the specified time period</p>
							${this.renderPeriodSelect(this.state.config.period)}`}
			</div>
		</gl-timeline-chart>`;
	}

	private renderConfigPopover() {
		const {
			config: { period },
		} = this;

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
		const { head } = this;
		const disabled = this.config.showAllBranches && this.sliceBy !== 'branch';

		return html`<section>
			<label for="head" ?disabled=${disabled}>Branch</label>
			<gl-ref-button
				name="head"
				?disabled=${disabled}
				icon
				.ref=${head}
				location="config"
				@click=${this.onChooseHeadRef}
				><span slot="tooltip"
					>Change Reference...
					<hr />
					${this.config.showAllBranches
						? 'Showing All Branches'
						: html`<gl-ref-name icon .ref=${head}></gl-ref-name>`}</span
				></gl-ref-button
			>
		</section>`;

		// Commenting out for now, until base is ready

		// const {
		// 	head,
		// 	config: { showAllBranches },
		// } = this;
		// return html`<section>
		// 	<label for="head" ?disabled=${showAllBranches}>Head</label>
		// 	<gl-ref-button
		// 		name="head"
		// 		?disabled=${showAllBranches}
		// 		icon
		// 		tooltip="Change Head Reference"
		// 		.ref=${head}
		// 		location="config"
		// 		@click=${this.onChooseHeadRef}
		// 	></gl-ref-button>
		// </section>`;
	}

	private renderConfigBase() {
		// Commenting out for now, as its not yet ready
		return nothing;
		// if (this.repository?.virtual) return nothing;

		// const {
		// 	head,
		// 	base,
		// 	config: { showAllBranches },
		// } = this;
		// return html`<section>
		// 	<label for="base" ?disabled=${showAllBranches}>Base</label>
		// 	<gl-ref-button
		// 		name="base"
		// 		?disabled=${showAllBranches}
		// 		icon
		// 		tooltip="Change Base Reference"
		// 		.ref=${base?.ref === head?.ref ? undefined : base}
		// 		location="config"
		// 		@click=${this.onChooseBaseRef}
		// 		><span slot="empty">&lt;choose base&gt;</span></gl-ref-button
		// 	>
		// </section>`;
	}

	private renderConfigShowAllBranches() {
		if (this.repository?.virtual) return nothing;
		const {
			config: { showAllBranches },
		} = this;
		return html`<section>
			<gl-checkbox
				value="all"
				.checked=${showAllBranches}
				@gl-change-value=${(e: CustomEvent<void>) => {
					this._ipc.sendCommand(UpdateConfigCommand, {
						changes: { showAllBranches: (e.target as Checkbox).checked },
					});
				}}
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
		if (!this.isSliceBySupported) return nothing;

		const { sliceBy } = this;

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
		let label;
		switch (this.config.period) {
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

	private onChooseBaseRef = async (e: MouseEvent) => {
		if ((e.target as GlRefButton).disabled) return;

		const result = await this._ipc.sendRequest(ChooseRefRequest, { scope: this.scope!, type: 'base' });
		if (result?.ref == null) return;

		this._ipc.sendCommand(UpdateScopeCommand, { scope: this.scope!, changes: { base: result.ref } });
	};

	private onChooseHeadRef = async (e: MouseEvent) => {
		if ((e.target as GlRefButton).disabled) return;

		const location = (e.target as GlRefButton).getAttribute('location');

		const result = await this._ipc.sendRequest(ChooseRefRequest, { scope: this.scope!, type: 'head' });
		if (result?.ref === null) {
			if (!this.config.showAllBranches) {
				this._ipc.sendCommand(UpdateConfigCommand, { changes: { showAllBranches: true } });
			}

			return;
		}
		if (result?.ref == null) return;

		if (location === 'config') {
			this._ipc.sendCommand(UpdateScopeCommand, {
				scope: this.scope!,
				changes: { head: result.ref, base: this.config.showAllBranches ? null : undefined },
			});

			return;
		}

		this._ipc.sendCommand(UpdateScopeCommand, {
			scope: this.scope!,
			changes: { head: result.ref, base: null },
		});
		if (this.config.showAllBranches) {
			this._ipc.sendCommand(UpdateConfigCommand, { changes: { showAllBranches: false } });
		}
	};

	private onChoosePath = async (e: MouseEvent) => {
		e.stopImmediatePropagation();
		if (this.repository == null || this.scope == null) return;

		const result = await this._ipc.sendRequest(ChoosePathRequest, {
			repoUri: this.repository.uri,
			ref: this.head,
			title: 'Select a File or Folder to Visualize',
			initialPath: this.scope.type === 'file' ? dirname(this.scope.relativePath) : this.scope.relativePath,
		});
		if (result?.picked == null) return;

		this._ipc.sendCommand(UpdateScopeCommand, {
			scope: this.scope,
			changes: { type: result.picked.type, relativePath: result.picked.relativePath },
			altOrShift: e.altKey || e.shiftKey,
		});
	};

	private onChangeScope = (e: MouseEvent) => {
		const el =
			(e.target as HTMLElement)?.closest('gl-breadcrumb-item-child') ??
			(e.target as HTMLElement)?.closest('gl-breadcrumb-item');

		const type = el?.getAttribute('type') as TimelineScopeType;
		if (type == null) return;

		if (type === 'repo') {
			this._ipc.sendCommand(UpdateScopeCommand, {
				scope: this.scope!,
				changes: { type: 'repo' },
				altOrShift: e.altKey || e.shiftKey,
			});
			return;
		}

		const value = el?.getAttribute('value');
		if (value == null) return;

		this._ipc.sendCommand(UpdateScopeCommand, {
			scope: this.scope!,
			changes: { type: type, relativePath: value },
			altOrShift: e.altKey || e.shiftKey,
		});
	};

	private onChartCommitSelected(e: CustomEvent<CommitEventDetail>) {
		if (e.detail.id == null) return;

		this.fireSelectDataPoint(e.detail);
	}

	private onPeriodChanged(e: Event) {
		const element = e.target as HTMLSelectElement;
		const value = element.options[element.selectedIndex].value;
		assertPeriod(value);

		this._ipc.sendCommand(UpdateConfigCommand, { changes: { period: value } });
	}

	private onSliceByChanged(e: Event) {
		const element = e.target as HTMLSelectElement;
		const value = element.options[element.selectedIndex].value;
		assertSliceBy(value);

		this._ipc.sendCommand(UpdateConfigCommand, { changes: { sliceBy: value } });
	}

	private _fireSelectDataPointDebounced: Deferrable<(e: CommitEventDetail) => void> | undefined;
	private fireSelectDataPoint(e: CommitEventDetail) {
		const { scope } = this;
		if (scope == null) return;

		this._fireSelectDataPointDebounced ??= debounce(
			(e: CommitEventDetail) => this._ipc.sendCommand(SelectDataPointCommand, { scope: scope, ...e }),
			250,
			{ maxWait: scope.type === 'file' ? 500 : undefined },
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
