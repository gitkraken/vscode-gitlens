import type { Chart, DataItem, RegionOptions } from 'billboard.js';
import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { debug } from '../../../../../system/decorators/log';
import { debounce } from '../../../../../system/function';
import { first, flatMap, groupByMap, map, union } from '../../../../../system/iterable';
import { capitalize, pluralize } from '../../../../../system/string';
import { GlElement, observe } from '../../../shared/components/element';
import { formatDate, formatNumeric, fromNow } from '../../../shared/date';
import '../../../shared/components/overlays/tooltip';

export interface BranchMarker {
	type: 'branch';
	name: string;
	current?: boolean;
}

export interface RemoteMarker {
	type: 'remote';
	name: string;
	current?: boolean;
}

export interface StashMarker {
	type: 'stash';
	name: string;
	current?: undefined;
}

export interface TagMarker {
	type: 'tag';
	name: string;
	current?: undefined;
}

export interface PullRequestMarker {
	type: 'pull-request';
	name: string;
	current?: undefined;
}

export type GraphMinimapMarker = BranchMarker | RemoteMarker | StashMarker | TagMarker | PullRequestMarker;

export interface GraphMinimapSearchResultMarker {
	type: 'search-result';
	sha: string;
	count: number;
}

export interface GraphMinimapStats {
	commits: number;

	activity?: { additions: number; deletions: number };
	files?: number;
	sha?: string;
}

export type GraphMinimapDaySelectedEvent = CustomEvent<GraphMinimapDaySelectedEventDetail>;

export interface GraphMinimapDaySelectedEventDetail {
	date: Date;
	sha?: string;
}

const markerZOrder = [
	'marker-result',
	'marker-head-arrow-left',
	'marker-head-arrow-right',
	'marker-head',
	'marker-upstream',
	'marker-pull-request',
	'marker-branch',
	'marker-stash',
	'marker-remote',
	'marker-tag',
	'visible-area',
];

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-minimap': GlGraphMinimap;
	}

	interface GlobalEventHandlersEventMap {
		'gl-graph-minimap-selected': GraphMinimapDaySelectedEvent;
	}
}

@customElement('gl-graph-minimap')
export class GlGraphMinimap extends GlElement {
	static override styles = css`
		:host {
			display: flex;
			position: relative;
			width: 100%;
			min-height: 24px;
			height: 40px;
			background: var(--color-background);
		}

		#chart {
			height: 100%;
			width: calc(100% - 1rem);
			overflow: hidden;
			position: initial !important;
		}

		#spinner {
			position: absolute;
			inset: 0;
			display: flex;
			justify-content: center;
			align-items: center;
			z-index: 1;
		}

		#spinner[aria-hidden='true'] {
			display: none;
		}

		.legend {
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			display: flex;
			align-items: center;
			z-index: 1;
			opacity: 0.7;
			cursor: help;
		}

		.bb svg {
			font: 10px var(--font-family);
			-webkit-tap-highlight-color: rgba(0, 0, 0, 0);
		}

		.bb-chart {
			width: 100%;
			height: 100%;
		}

		.bb-event-rect {
			height: calc(100% + 2px);
			transform: translateY(-5px);
		}

		/*-- Grid --*/
		.bb-grid {
			pointer-events: none;
		}

		.bb-xgrid-focus line {
			stroke: var(--color-graph-minimap-focusLine);
		}

		/*-- Line --*/
		.bb path,
		.bb line {
			fill: none;
		}

		/*-- Point --*/
		.bb-circle._expanded_ {
			fill: var(--color-background);
			opacity: 1 !important;
			fill-opacity: 1 !important;
			stroke-opacity: 1 !important;
			stroke-width: 1px;
		}

		.bb-selected-circle {
			fill: var(--color-background);
			opacity: 1 !important;
			fill-opacity: 1 !important;
			stroke-opacity: 1 !important;
			stroke-width: 2px;
		}

		/*-- Bar --*/
		.bb-bar {
			stroke-width: 0;
		}
		.bb-bar._expanded_ {
			fill-opacity: 0.75;
		}

		/*-- Regions --*/

		.bb-regions {
			pointer-events: none;
		}

		.bb-region > rect:not([x]) {
			display: none;
		}

		.bb-region.visible-area {
			fill: var(--color-graph-minimap-visibleAreaBackground);
			/* transform: translateY(-4px); */
		}
		.bb-region.visible-area > rect {
			height: 100%;
		}

		.bb-region.marker-result {
			fill: var(--color-graph-minimap-marker-highlights);
			transform: translateX(-1px);
			z-index: 10;
		}
		.bb-region.marker-result > rect {
			width: 2px;
			height: 100%;
		}

		.bb-region.marker-head {
			fill: var(--color-graph-minimap-marker-head);
			stroke: var(--color-graph-minimap-marker-head);
			transform: translateX(-1px);
		}
		.bb-region.marker-head > rect {
			width: 1px;
			height: 100%;
		}

		.bb-region.marker-head-arrow-left {
			fill: var(--color-graph-minimap-marker-head);
			stroke: var(--color-graph-minimap-marker-head);
			transform: translate(-5px, -1px) skewX(45deg);
		}
		.bb-region.marker-head-arrow-left > rect {
			width: 3px;
			height: 3px;
		}

		.bb-region.marker-head-arrow-right {
			fill: var(--color-graph-minimap-marker-head);
			stroke: var(--color-graph-minimap-marker-head);
			transform: translate(1px, -1px) skewX(-45deg);
		}
		.bb-region.marker-head-arrow-right > rect {
			width: 3px;
			height: 3px;
		}

		.bb-region.marker-upstream {
			fill: var(--color-graph-minimap-marker-upstream);
			stroke: var(--color-graph-minimap-marker-upstream);
			transform: translateX(-1px);
		}
		.bb-region.marker-upstream > rect {
			width: 1px;
			height: 100%;
		}

		.bb-region.marker-pull-request {
			fill: var(--color-graph-minimap-marker-pull-requests);
			stroke: var(--color-graph-minimap-marker-pull-requests);
			transform: translate(-2px, 29px);
		}
		.bb-region.marker-pull-request > rect {
			width: 3px;
			height: 3px;
		}

		.bb-region.marker-branch {
			fill: var(--color-graph-minimap-marker-local-branches);
			stroke: var(--color-graph-minimap-marker-local-branches);
			transform: translate(-2px, 35px);
		}
		.bb-region.marker-branch > rect {
			width: 3px;
			height: 3px;
		}

		.bb-region.marker-remote {
			fill: var(--color-graph-minimap-marker-remote-branches);
			stroke: var(--color-graph-minimap-marker-remote-branches);
			transform: translate(-2px, 29px);
		}
		.bb-region.marker-remote > rect {
			width: 3px;
			height: 3px;
		}

		.bb-region.marker-stash {
			fill: var(--color-graph-minimap-marker-stashes);
			stroke: var(--color-graph-minimap-marker-stashes);
			transform: translate(-2px, 35px);
		}
		.bb-region.marker-stash > rect {
			width: 3px;
			height: 3px;
		}

		.bb-region.marker-tag {
			fill: var(--color-graph-minimap-marker-tags);
			stroke: var(--color-graph-minimap-marker-tags);
			transform: translate(-2px, 29px);
		}
		.bb-region.marker-tag > rect {
			width: 3px;
			height: 3px;
		}

		/*-- Zoom region --*/
		/*
	:host-context(.vscode-dark) .bb-zoom-brush {
		fill: white;
		fill-opacity: 0.2;
	}
	:host-context(.vscode-light) .bb-zoom-brush {
		fill: black;
		fill-opacity: 0.1;
	}
	*/

		/*-- Brush --*/
		/*
	.bb-brush .extent {
		fill-opacity: 0.1;
	}
	*/

		/*-- Button --*/
		/*
	.bb-button {
		position: absolute;
		top: 2px;
		right: 0;

		color: var(--color-button-foreground);

		font-size: var(--font-size);
		font-family: var(--font-family);
	}
	.bb-button .bb-zoom-reset {
		display: inline-block;
		padding: 0.1rem 0.3rem;
		cursor: pointer;
		font-family: 'codicon';
		font-display: block;

		background-color: var(--color-button-background);

		border: 1px solid var(--color-button-background);
		border-radius: 3px;
	}
	*/

		/*-- Tooltip --*/
		.bb-tooltip-container {
			top: unset !important;
			z-index: 10;
			user-select: none;
			min-width: 300px;
		}

		.bb-tooltip {
			display: flex;
			flex-direction: column;
			padding: 0.5rem 1rem;
			background-color: var(--color-hover-background);
			color: var(--color-hover-foreground);
			border: 1px solid var(--color-hover-border);
			box-shadow: 0 2px 8px var(--vscode-widget-shadow);
			font-size: var(--font-size);
			opacity: 1;
			white-space: nowrap;
		}

		.bb-tooltip .header {
			display: flex;
			flex-direction: row;
			justify-content: space-between;
			gap: 1rem;
		}

		.bb-tooltip .header--title {
			font-weight: 600;
		}

		.bb-tooltip .header--description {
			font-weight: normal;
			font-style: italic;
		}

		.bb-tooltip .changes {
			margin: 0.5rem 0;
		}

		.bb-tooltip .results {
			display: flex;
			font-size: 12px;
			gap: 0.5rem;
			flex-direction: row;
			flex-wrap: wrap;
			margin: 0.5rem 0;
			max-width: fit-content;
		}

		.bb-tooltip .results .result {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-highlightBackground);
			border: 1px solid var(--color-graph-minimap-tip-highlightBorder);
			color: var(--color-graph-minimap-tip-highlightForeground);
		}

		.bb-tooltip .refs {
			display: flex;
			font-size: 12px;
			gap: 0.5rem;
			flex-direction: row;
			flex-wrap: wrap;
			margin: 0.5rem 0;
			max-width: fit-content;
		}
		.bb-tooltip .refs:empty {
			margin: 0;
		}

		.bb-tooltip .refs .branch {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-branchBackground);
			border: 1px solid var(--color-graph-minimap-tip-branchBorder);
			color: var(--color-graph-minimap-tip-branchForeground);
		}
		.bb-tooltip .refs .branch.current {
			background-color: var(--color-graph-minimap-tip-headBackground);
			border: 1px solid var(--color-graph-minimap-tip-headBorder);
			color: var(--color-graph-minimap-tip-headForeground);
		}
		.bb-tooltip .refs .remote {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-remoteBackground);
			border: 1px solid var(--color-graph-minimap-tip-remoteBorder);
			color: var(--color-graph-minimap-tip-remoteForeground);
		}
		.bb-tooltip .refs .remote.current {
			background-color: var(--color-graph-minimap-tip-upstreamBackground);
			border: 1px solid var(--color-graph-minimap-tip-upstreamBorder);
			color: var(--color-graph-minimap-tip-upstreamForeground);
		}
		.bb-tooltip .refs .stash {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-stashBackground);
			border: 1px solid var(--color-graph-minimap-tip-stashBorder);
			color: var(--color-graph-minimap-tip-stashForeground);
		}
		.bb-tooltip .refs .pull-request {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-pullRequestBackground);
			border: 1px solid var(--color-graph-minimap-pullRequestBorder);
			color: var(--color-graph-minimap-pullRequestForeground);
		}
		.bb-tooltip .refs .tag {
			border-radius: 3px;
			padding: 0 4px;
			background-color: var(--color-graph-minimap-tip-tagBackground);
			border: 1px solid var(--color-graph-minimap-tip-tagBorder);
			color: var(--color-graph-minimap-tip-tagForeground);
		}

		.bb-event-rects {
			cursor: pointer !important;
		}
	`;

	@query('#chart')
	chartContainer!: HTMLDivElement;
	private _chart!: Chart;

	@query('#spinner')
	spinner!: HTMLDivElement;

	private _loadTimer: ReturnType<typeof setTimeout> | undefined;

	private _markerRegions: Iterable<RegionOptions> | undefined;
	private _regions: RegionOptions[] | undefined;

	@property({ type: Number })
	activeDay: number | undefined;

	@observe('activeDay')
	private onActiveDayChanged() {
		this.select(this.activeDay);
	}

	@property({ type: Map })
	data: Map<number, GraphMinimapStats | null> | undefined;

	@property({ type: String })
	dataType: 'commits' | 'lines' = 'commits';

	@observe(['data', 'dataType'])
	private onDataChanged() {
		this.handleDataChanged(false);
	}

	@property({ type: Map })
	markers: Map<number, GraphMinimapMarker[]> | undefined;

	@observe('markers')
	private onMarkersChanged() {
		this.handleDataChanged(true);
	}

	@property({ type: Map })
	searchResults: Map<number, GraphMinimapSearchResultMarker> | undefined;

	@observe('searchResults')
	private onSearchResultsChanged() {
		this._chart?.regions.remove({ classes: ['marker-result'] });
		if (this.searchResults == null) return;
		this._chart?.regions.add([...this.getSearchResultsRegions(this.searchResults)]);
	}

	@property({ type: Object })
	visibleDays: { top: number; bottom: number } | undefined;

	@observe('visibleDays')
	private onVisibleDaysChanged() {
		this._chart?.regions.remove({ classes: ['visible-area'] });
		if (this.visibleDays == null) return;

		this._chart?.regions.add(this.getVisibleAreaRegion(this.visibleDays));
	}

	override connectedCallback(): void {
		super.connectedCallback();

		this.handleDataChanged(false);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		this._chart?.destroy();
		this._chart = undefined!;
	}

	@debug({ singleLine: true })
	private handleDataChanged(markerChanged: boolean) {
		if (this._loadTimer) {
			clearTimeout(this._loadTimer);
			this._loadTimer = undefined;
		}

		if (markerChanged) {
			this._regions = undefined;
			this._markerRegions = undefined;
		}

		this._loadTimer = setTimeout(() => this.loadChart(), 150);
	}

	private getInternalChart(): any {
		try {
			return (this._chart as any)?.internal;
		} catch {
			return undefined;
		}
	}

	select(date: number | Date | undefined, trackOnly: boolean = false) {
		if (date == null) {
			this.unselect();

			return;
		}

		const d = this.getData(date);
		if (d == null) return;

		const internal = this.getInternalChart();
		if (internal == null) return;

		internal.showGridFocus([d]);

		if (!trackOnly) {
			const { index } = d;
			this._chart.$.main.selectAll(`.bb-shape-${index}`).each(function (d2) {
				internal.toggleShape?.(this, d2, index);
			});
		}
	}

	unselect(date?: number | Date, focus: boolean = false) {
		if (focus) {
			this.getInternalChart()?.hideGridFocus();

			return;
		}

		if (date != null) {
			const index = this.getIndex(date);
			if (index == null) return;

			this._chart?.unselect(undefined, [index]);
		} else {
			this._chart?.unselect();
		}
	}

	private getData(date: number | Date): DataItem | undefined {
		date = new Date(date).setHours(0, 0, 0, 0);
		return this._chart
			?.data()[0]
			?.values.find(v => (typeof v.x === 'number' ? v.x : (v.x as any as Date).getTime()) === date);
	}

	private getIndex(date: number | Date): number | undefined {
		return this.getData(date)?.index;
	}

	private getMarkerRegions() {
		if (this._markerRegions == null) {
			if (this.markers != null) {
				const regions = flatMap(this.markers, ([day, markers]) =>
					flatMap<GraphMinimapMarker, RegionOptions>(markers, m =>
						m.current && m.type === 'branch'
							? [
									{
										axis: 'x',
										start: day,
										end: day,
										class: 'marker-head',
									} satisfies RegionOptions,
									{
										axis: 'x',
										start: day,
										end: day,
										class: 'marker-head-arrow-left',
									} satisfies RegionOptions,
									{
										axis: 'x',
										start: day,
										end: day,
										class: 'marker-head-arrow-right',
									} satisfies RegionOptions,
							  ]
							: [
									{
										axis: 'x',
										start: day,
										end: day,
										class:
											m.current && m.type === 'remote' ? 'marker-upstream' : `marker-${m.type}`,
									} satisfies RegionOptions,
							  ],
					),
				);
				this._markerRegions = regions;
			} else {
				this._markerRegions = [];
			}
		}
		return this._markerRegions;
	}

	private getAllRegions() {
		if (this._regions == null) {
			let regions: Iterable<RegionOptions> = this.getMarkerRegions();

			if (this.visibleDays != null) {
				regions = union([this.getVisibleAreaRegion(this.visibleDays)], regions);
			}

			if (this.searchResults != null) {
				regions = union(regions, this.getSearchResultsRegions(this.searchResults));
			}

			this._regions = [...regions].sort(
				(a, b) => markerZOrder.indexOf(b.class ?? '') - markerZOrder.indexOf(a.class ?? ''),
			);
		}
		return this._regions;
	}

	private getSearchResultsRegions(searchResults: NonNullable<typeof this.searchResults>): Iterable<RegionOptions> {
		return map(
			searchResults.keys(),
			day =>
				({
					axis: 'x',
					start: day,
					end: day,
					class: 'marker-result',
				}) satisfies RegionOptions,
		);
	}

	private getVisibleAreaRegion(visibleDays: NonNullable<typeof this.visibleDays>): RegionOptions {
		return {
			axis: 'x',
			start: visibleDays.top,
			end: visibleDays.bottom,
			class: 'visible-area',
		} satisfies RegionOptions;
	}

	private _loading: Promise<void> | undefined;
	private loadChart() {
		if (this._loading == null) {
			this._loading = this.loadChartCore().then(() => (this._loading = undefined));
		}
	}

	@debug({ singleLine: true })
	private async loadChartCore() {
		if (!this.data?.size) {
			this.spinner.setAttribute('aria-hidden', 'false');

			this._chart?.destroy();
			this._chart = undefined!;

			return;
		}

		const showLinesChanged = this.dataType === 'lines';

		// Convert the map to an array dates and an array of stats
		const dates = [];
		const activity: number[] = [];
		// const commits: number[] = [];
		// const additions: number[] = [];
		// const deletions: number[] = [];

		const keys = this.data.keys();
		const endDay = first(keys)!;

		const startDate = new Date();
		const endDate = new Date(endDay);

		let day;
		let stat;

		let changesMax = 0;
		let adds;
		let changes;
		let deletes;

		const currentDate = startDate;
		// eslint-disable-next-line no-unmodified-loop-condition -- currentDate is modified via .setDate
		while (currentDate >= endDate) {
			day = getDay(currentDate);

			stat = this.data.get(day);
			dates.push(day);

			if (showLinesChanged) {
				adds = stat?.activity?.additions ?? 0;
				deletes = stat?.activity?.deletions ?? 0;
				changes = adds + deletes;

				// additions.push(adds);
				// deletions.push(-deletes);
			} else {
				changes = stat?.commits ?? 0;

				// additions.push(0);
				// deletions.push(0);
			}

			changesMax = Math.max(changesMax, changes);
			activity.push(changes);

			currentDate.setDate(currentDate.getDate() - 1);
		}

		const regions = this.getAllRegions();

		// Calculate the max value for the y-axis to avoid flattening the graph by calculating a z-score of the activity data to identify outliers

		const sortedStats = [];

		let sum = 0;
		let sumOfSquares = 0;
		for (const s of activity) {
			// Remove all the 0s
			if (s === 0) continue;

			sortedStats.push(s);
			sum += s;
			sumOfSquares += s ** 2;
		}

		sortedStats.sort((a, b) => a - b);

		const length = sortedStats.length;
		const mean = sum / length;
		const stdDev = Math.sqrt(sumOfSquares / length - mean ** 2);

		// Loop backwards through the sorted stats to find the first non-outlier
		let outlierBorderIndex = -1;
		for (let i = length - 1; i >= 0; i--) {
			// If the z-score ((p: number) => (p - mean) / stdDev) is less than or equal to 3, it's not an outlier
			if (Math.abs((sortedStats[i] - mean) / stdDev) <= 3) {
				outlierBorderIndex = i;
				break;
			}
		}

		const q1 = sortedStats[Math.floor(length * 0.25)];
		const q3 = sortedStats[Math.floor(length * 0.75)];
		const max = sortedStats[length - 1];

		const iqr = q3 - q1;
		const upperFence = q3 + 3 * iqr;
		const outlierBorderMax = sortedStats[outlierBorderIndex];

		// Use a mix of z-score vs IQR -- z-score seems to do better for smaller outliers, but IQR seems to do better for larger outliers
		const yMax = Math.floor(
			Math.min(
				max,
				upperFence > max - upperFence ? outlierBorderMax : upperFence + (outlierBorderMax - upperFence) / 2,
			) +
				upperFence * 0.1,
		);

		if (this._chart == null) {
			const { bb, selection, spline, zoom } = await import(
				/* webpackChunkName: "lib-billboard" */ 'billboard.js'
			);
			this._chart = bb.generate({
				bindto: this.chartContainer,
				data: {
					x: 'date',
					axes: {
						activity: 'y',
					},
					columns: [
						['date', ...dates],
						['activity', ...activity],
					],
					names: {
						activity: 'Activity',
					},
					onclick: d => {
						if (d.id !== 'activity') return;

						const date = new Date(d.x);
						const day = getDay(date);
						const sha = this.searchResults?.get(day)?.sha ?? this.data?.get(day)?.sha;

						queueMicrotask(() => {
							this.emit('gl-graph-minimap-selected', { date: date, sha: sha });
						});
					},
					selection: {
						enabled: selection(),
						grouped: true,
						multiple: false,
					},
					colors: {
						activity: 'var(--color-graph-minimap-line0)',
					},
					types: {
						activity: spline(),
					},
				},
				axis: {
					x: {
						inverted: true,
						localtime: true,
						type: 'timeseries',
					},
					y: {
						min: 0,
						max: yMax,
					},
				},
				clipPath: false,
				grid: {
					front: false,
					focus: {
						show: true,
					},
				},
				legend: {
					show: false,
				},
				line: {
					point: true,
					zerobased: true,
				},
				padding: {
					mode: 'fit',
					bottom: -8,
					left: 0,
					right: 0,
					top: 0,
				},
				point: {
					show: true,
					select: {
						r: 5,
					},
					focus: {
						only: true,
						expand: {
							enabled: true,
							r: 3,
						},
					},
					sensitivity: 100,
				},
				regions: regions,
				resize: {
					auto: true,
				},
				spline: {
					interpolation: {
						type: 'monotone-x',
					},
				},
				tooltip: {
					contents: (data, _defaultTitleFormat, _defaultValueFormat, _color) => {
						const date = new Date(data[0].x);

						const day = getDay(date);
						const stat = this.data?.get(day);
						const markers = this.markers?.get(day);
						const results = this.searchResults?.get(day);

						let groups;
						if (markers?.length) {
							groups = groupByMap(markers, m => m.type);
						}

						const stashesCount = groups?.get('stash')?.length ?? 0;
						const pullRequestsCount = groups?.get('pull-request')?.length ?? 0;

						let commits;
						let linesChanged;
						let resultsCount;
						if (stat?.commits) {
							commits = pluralize('commit', stat.commits, { format: c => formatNumeric(c) });
							if (results?.count) {
								resultsCount = pluralize('matching commit', results.count);
							}

							if (this.dataType === 'lines') {
								linesChanged = `${pluralize('file', stat?.files ?? 0, {
									format: c => formatNumeric(c),
									zero: 'No',
								})}, ${pluralize(
									'line',
									(stat?.activity?.additions ?? 0) + (stat?.activity?.deletions ?? 0),
									{
										format: c => formatNumeric(c),
										zero: 'No',
									},
								)} changed`;
							}
						} else {
							commits = 'No commits';
						}

						return /*html*/ `<div class="bb-tooltip">
						<div class="header">
							<span class="header--title">${formatDate(date, 'MMMM Do, YYYY')}</span>
							<span class="header--description">(${capitalize(fromNow(date))})</span>
						</div>
						<div class="changes">
							<span>${commits}${linesChanged ? `, ${linesChanged}` : ''}</span>
						</div>
						${resultsCount ? /*html*/ `<div class="results"><span class="result">${resultsCount}</span></div>` : ''}
						${
							groups != null
								? /*html*/ `
						<div class="refs">${
							stashesCount
								? /*html*/ `<span class="stash">${pluralize('stash', stashesCount, {
										plural: 'stashes',
								  })}</span>`
								: ''
						}${
							groups
								?.get('branch')
								?.sort((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1))
								.map(
									m => /*html*/ `<span class="branch${m.current ? ' current' : ''}">${m.name}</span>`,
								)
								.join('') ?? ''
						}</div>
						<div class="refs">${
							pullRequestsCount
								? /*html*/ `<span class="pull-request">${pluralize('pull request', pullRequestsCount, {
										plural: 'pull requests',
								  })}</span>`
								: ''
						}${
							groups
								?.get('remote')
								?.sort((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1))
								?.map(
									m => /*html*/ `<span class="remote${m.current ? ' current' : ''}">${m.name}</span>`,
								)
								.join('') ?? ''
						}${
							groups
								?.get('tag')
								?.map(m => /*html*/ `<span class="tag">${m.name}</span>`)
								.join('') ?? ''
						}</div>`
								: ''
						}
					</div>`;
					},
					grouped: true,
					position: (_data, width, _height, element, pos) => {
						let { x } = pos;
						const rect = (element as HTMLElement).getBoundingClientRect();
						if (x + width > rect.right) {
							x = rect.right - width;
						}
						return { top: 0, left: x };
					},
				},
				transition: {
					duration: 0,
				},
				zoom: {
					enabled: zoom(),
					rescale: false,
					type: 'wheel',
					// Reset the active day when zooming because it fails to update properly
					onzoom: debounce(() => this.onActiveDayChanged(), 250),
				},
				onafterinit: function () {
					const xAxis = this.$.main.selectAll<Element, any>('.bb-axis-x').node();
					xAxis?.remove();

					const yAxis = this.$.main.selectAll<Element, any>('.bb-axis-y').node();
					yAxis?.remove();

					const grid = this.$.main.selectAll<Element, any>('.bb-grid').node();
					try {
						grid?.removeAttribute('clip-path');
					} catch {}

					// Move the regions to be after (on top of) the chart
					const regions = this.$.main.selectAll<Element, any>('.bb-regions').node();
					const chart = this.$.main.selectAll<Element, any>('.bb-chart').node();
					if (regions != null && chart != null) {
						chart.insertAdjacentElement('afterend', regions);
					}
				},
			});
		} else {
			this._chart.load({
				columns: [
					['date', ...dates],
					['activity', ...activity],
				],
			});
			this._chart.axis.max({ y: yMax });

			this._chart.regions(regions);
		}

		this.spinner.setAttribute('aria-hidden', 'true');

		this.onActiveDayChanged();
	}

	override render() {
		return html`
			<div id="spinner"><code-icon icon="loading" modifier="spin"></code-icon></div>
			<div id="chart"></div>
			<gl-tooltip>
				<div class="legend">
					<code-icon icon="${this.dataType === 'lines' ? 'request-changes' : 'git-commit'}"></code-icon>
				</div>
				<div slot="content">
					${this.dataType === 'lines' ? 'Showing lines changed per day' : 'Showing commits per day'}
				</div>
			</gl-tooltip>
		`;
	}
}

function getDay(date: number | Date): number {
	return new Date(date).setHours(0, 0, 0, 0);
}
