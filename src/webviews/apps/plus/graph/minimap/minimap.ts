import { css, customElement, FASTElement, html, observable, ref } from '@microsoft/fast-element';
import type { Chart, DataItem, RegionOptions } from 'billboard.js';
import { groupByMap } from '../../../../../system/array';
import { debug } from '../../../../../system/decorators/log';
import { debounce } from '../../../../../system/function';
import { first, flatMap, map, some, union } from '../../../../../system/iterable';
import { pluralize } from '../../../../../system/string';
import { formatDate, formatNumeric, fromNow } from '../../../shared/date';

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

export type GraphMinimapMarker = BranchMarker | RemoteMarker | StashMarker | TagMarker;

export interface GraphMinimapSearchResultMarker {
	type: 'search-result';
	sha: string;
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

const template = html<GraphMinimap>`<template>
	<div id="chart" ${ref('chart')}></div>
</template>`;

const styles = css`
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
		width: 100%;
		overflow: hidden;
		position: initial !important;
	}

	.bb svg {
		font: 10px var(--font-family);
		-webkit-tap-highlight-color: rgba(0, 0, 0, 0);
		transform: translateX(2.5em) rotateY(180deg);
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
		transform: translateY(-4px);
	}
	.bb-region.visible-area > rect {
		height: 100%;
	}

	.bb-region.marker-result {
		fill: var(--color-graph-minimap-marker-highlights);
		transform: translate(-1px, -4px);
		z-index: 10;
	}
	.bb-region.marker-result > rect {
		width: 2px;
		height: 100%;
	}

	.bb-region.marker-head {
		fill: var(--color-graph-minimap-marker-head);
		stroke: var(--color-graph-minimap-marker-head);
		transform: translate(-1px, -4px);
	}
	.bb-region.marker-head > rect {
		width: 1px;
		height: 100%;
	}

	.bb-region.marker-head-arrow-left {
		fill: var(--color-graph-minimap-marker-head);
		stroke: var(--color-graph-minimap-marker-head);
		transform: translate(-5px, -5px) skewX(45deg);
	}
	.bb-region.marker-head-arrow-left > rect {
		width: 3px;
		height: 3px;
	}

	.bb-region.marker-head-arrow-right {
		fill: var(--color-graph-minimap-marker-head);
		stroke: var(--color-graph-minimap-marker-head);
		transform: translate(1px, -5px) skewX(-45deg);
	}
	.bb-region.marker-head-arrow-right > rect {
		width: 3px;
		height: 3px;
	}

	.bb-region.marker-upstream {
		fill: var(--color-graph-minimap-marker-upstream);
		stroke: var(--color-graph-minimap-marker-upstream);
		transform: translate(-1px, -4px);
	}
	.bb-region.marker-upstream > rect {
		width: 1px;
		height: 100%;
	}

	.bb-region.marker-branch {
		fill: var(--color-graph-minimap-marker-local-branches);
		stroke: var(--color-graph-minimap-marker-local-branches);
		transform: translate(-2px, 32px);
	}
	.bb-region.marker-branch > rect {
		width: 3px;
		height: 3px;
	}

	.bb-region.marker-remote {
		fill: var(--color-graph-minimap-marker-remote-branches);
		stroke: var(--color-graph-minimap-marker-remote-branches);
		transform: translate(-2px, 26px);
	}
	.bb-region.marker-remote > rect {
		width: 3px;
		height: 3px;
	}

	.bb-region.marker-stash {
		fill: var(--color-graph-minimap-marker-stashes);
		stroke: var(--color-graph-minimap-marker-stashes);
		transform: translate(-2px, 32px);
	}
	.bb-region.marker-stash > rect {
		width: 3px;
		height: 3px;
	}

	.bb-region.marker-tag {
		fill: var(--color-graph-minimap-marker-tags);
		stroke: var(--color-graph-minimap-marker-tags);
		transform: translate(-2px, 26px);
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

	.bb-tooltip .refs {
		display: flex;
		font-size: 12px;
		gap: 0.5rem;
		flex-direction: row;
		flex-wrap: wrap;
		margin: 0.5rem 0;
		max-width: fit-content;
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
	.bb-tooltip .refs .tag {
		border-radius: 3px;
		padding: 0 4px;
		background-color: var(--color-graph-minimap-tip-tagBackground);
		border: 1px solid var(--color-graph-minimap-tip-tagBorder);
		color: var(--color-graph-minimap-tip-tagForeground);
	}
`;

const markerZOrder = [
	'marker-result',
	'marker-head-arrow-left',
	'marker-head-arrow-right',
	'marker-head',
	'marker-upstream',
	'marker-branch',
	'marker-stash',
	'marker-remote',
	'marker-tag',
	'visible-area',
];

@customElement({ name: 'graph-minimap', template: template, styles: styles })
export class GraphMinimap extends FASTElement {
	chart!: HTMLDivElement;

	private _chart!: Chart;
	private _loadTimer: ReturnType<typeof setTimeout> | undefined;

	private _markerRegions: Iterable<RegionOptions> | undefined;
	private _regions: RegionOptions[] | undefined;

	@observable
	activeDay: number | undefined;
	@debug({ singleLine: true })
	protected activeDayChanged() {
		this.select(this.activeDay);
	}

	@observable
	data: Map<number, GraphMinimapStats | null> | undefined;
	@debug({ singleLine: true })
	protected dataChanged(
		_oldVal?: Map<number, GraphMinimapStats | null>,
		_newVal?: Map<number, GraphMinimapStats | null>,
		markerChanged?: boolean,
	) {
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

	@observable
	markers: Map<number, GraphMinimapMarker[]> | undefined;
	protected markersChanged() {
		this.dataChanged(undefined, undefined, true);
	}

	@observable
	searchResults: Map<number, GraphMinimapSearchResultMarker> | undefined;
	protected searchResultsChanged() {
		this._chart?.regions.remove({ classes: ['marker-result'] });
		if (this.searchResults == null) return;

		this._chart?.regions.add([...this.getSearchResultsRegions(this.searchResults)]);
	}

	@observable
	visibleDays: { top: number; bottom: number } | undefined;
	@debug({ singleLine: true })
	protected visibleDaysChanged() {
		this._chart?.regions.remove({ classes: ['visible-area'] });
		if (this.visibleDays == null) return;

		this._chart?.regions.add(this.getVisibleAreaRegion(this.visibleDays));
	}

	override connectedCallback(): void {
		super.connectedCallback();

		this.dataChanged(undefined, undefined, false);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		this._chart?.destroy();
		this._chart = undefined!;
	}

	private getInternalChart(): any {
		return (this._chart as any).internal;
	}

	@debug({ singleLine: true })
	select(date: number | Date | undefined, trackOnly: boolean = false) {
		if (date == null) {
			this.unselect();

			return;
		}

		const d = this.getData(date);
		if (d == null) return;

		const internal = this.getInternalChart();
		internal.showGridFocus([d]);

		if (!trackOnly) {
			const { index } = d;
			this._chart.$.main.selectAll(`.bb-shape-${index}`).each(function (d2) {
				internal.toggleShape?.(this, d2, index);
			});
		}
	}

	@debug({ singleLine: true })
	unselect(date?: number | Date, focus: boolean = false) {
		if (focus) {
			this.getInternalChart().hideGridFocus();

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

	private getData(date: number | Date): DataItem<number> | undefined {
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
				} satisfies RegionOptions),
		);
	}

	private getVisibleAreaRegion(visibleDays: NonNullable<typeof this.visibleDays>): RegionOptions {
		return {
			axis: 'x',
			start: visibleDays.bottom,
			end: visibleDays.top,
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
			this._chart?.destroy();
			this._chart = undefined!;

			return;
		}

		const hasActivity = some(this.data.values(), v => v?.activity != null);

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

			if (hasActivity) {
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
			const { bb, selection, spline, zoom } = await import(/* webpackChunkName: "billboard" */ 'billboard.js');
			this._chart = bb.generate({
				bindto: this.chart,
				data: {
					x: 'date',
					xSort: false,
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
							this.$emit('selected', {
								date: date,
								sha: sha,
							} satisfies GraphMinimapDaySelectedEventDetail);
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
						show: false,
						localtime: true,
						type: 'timeseries',
					},
					y: {
						min: 0,
						max: yMax,
						show: true,
						padding: {
							bottom: 8,
						},
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

						const stat = this.data?.get(getDay(date));
						const markers = this.markers?.get(getDay(date));
						let groups;
						if (markers?.length) {
							groups = groupByMap(markers, m => m.type);
						}

						const stashesCount = groups?.get('stash')?.length ?? 0;

						return /*html*/ `<div class="bb-tooltip">
							<div class="header">
								<span class="header--title">${formatDate(date, 'MMMM Do, YYYY')}</span>
								<span class="header--description">(${capitalize(fromNow(date))})</span>
							</div>
							<div class="changes">
								<span>${
									(stat?.commits ?? 0) === 0
										? 'No commits'
										: `${pluralize('commit', stat?.commits ?? 0, {
												format: c => formatNumeric(c),
												zero: 'No',
										  })}, ${pluralize('file', stat?.commits ?? 0, {
												format: c => formatNumeric(c),
												zero: 'No',
										  })}${
												hasActivity
													? `, ${pluralize(
															'line',
															(stat?.activity?.additions ?? 0) +
																(stat?.activity?.deletions ?? 0),
															{
																format: c => formatNumeric(c),
																zero: 'No',
															},
													  )}`
													: ''
										  } changed`
								}</span>
							</div>
							${
								groups != null
									? /*html*/ `
							<div class="refs">
								${
									groups
										?.get('branch')
										?.sort((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1))
										.map(
											m =>
												/*html*/ `<span class="branch${m.current ? ' current' : ''}">${
													m.name
												}</span>`,
										)
										.join('') ?? ''
								}
								${
									groups
										?.get('remote')
										?.sort((a, b) => (a.current ? -1 : 1) - (b.current ? -1 : 1))
										?.map(
											m =>
												/*html*/ `<span class="remote${m.current ? ' current' : ''}">${
													m.name
												}</span>`,
										)
										.join('') ?? ''
								}
								${stashesCount ? /*html*/ `<span class="stash">${pluralize('stash', stashesCount, { plural: 'stashes' })}</span>` : ''}
								${
									groups
										?.get('tag')
										?.map(m => /*html*/ `<span class="tag">${m.name}</span>`)
										.join('') ?? ''
								}
							</div>`
									: ''
							}
						</div>`;
					},
					grouped: true,
					position: (_data, width, _height, element, pos) => {
						const { x } = pos;
						const rect = (element as HTMLElement).getBoundingClientRect();
						let left = rect.right - x;
						if (left + width > rect.right) {
							left = rect.right - width;
						}
						return { top: 0, left: left };
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
					onzoom: debounce(() => this.activeDayChanged(), 250),
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

		this.activeDayChanged();
	}
}

function getDay(date: number | Date): number {
	return new Date(date).setHours(0, 0, 0, 0);
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
