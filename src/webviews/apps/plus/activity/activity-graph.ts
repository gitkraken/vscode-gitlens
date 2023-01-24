import { css, customElement, FASTElement, html, observable, ref } from '@microsoft/fast-element';
import type { Chart /*RegionOptions*/ } from 'billboard.js';
import { bar, bb, selection, spline } from 'billboard.js';
import { groupByMap } from '../../../../system/array';
import { first, flatMap, map, union } from '../../../../system/iterable';
import { pluralize } from '../../../../system/string';
import { formatDate, formatNumeric, fromNow } from '../../shared/date';

interface RegionOptions {
	axis: 'x' | 'y' | 'y2';
	start?: number | Date;
	end?: number | Date;
	class?: string;
}

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

export interface TagMarker {
	type: 'tag';
	name: string;
	current?: undefined;
}

export type ActivityMarker = BranchMarker | RemoteMarker | TagMarker;

export interface ActivitySearchResultMarker {
	type: 'search-result';
	sha: string;
}

export interface ActivityStats {
	commits: number;

	activity?: { additions: number; deletions: number };
	files?: number;
	sha?: string;
}

export type ActivityStatsSelectedEvent = CustomEvent<ActivityStatsSelectedEventDetail>;

export interface ActivityStatsSelectedEventDetail {
	date: Date;
	sha?: string;
}

const template = html<ActivityGraph>`<template>
	<div id="chart" ${ref('chart')}></div>
</template>`;

const styles = css`
	:host {
		display: flex;
		width: 100%;
		min-height: 24px;
		height: 40px;
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

		margin-left: 2rem;
		transform: rotateY(180deg);
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
	.bb-xgrid-focus line {
		stroke: var(--color-graph-activitybar-focusLine);
	}

	/*-- Line --*/
	.bb path,
	.bb line {
		fill: none;
	}

	/*-- Point --*/
	.bb-circle._expanded_ {
		fill: var(--vscode-sideBar-background);
		opacity: 1 !important;
		fill-opacity: 1 !important;
		stroke-opacity: 1 !important;
		stroke-width: 1px;
	}

	.bb-selected-circle {
		fill: var(--vscode-sideBar-background);
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

	/*-- Focus --*/
	/* .bb-target.bb-focused,
	.bb-circles.bb-focused {
		opacity: 1;
	}

	.bb-target.bb-focused path.bb-line,
	.bb-target.bb-focused path.bb-step,
	.bb-circles.bb-focused path.bb-line,
	.bb-circles.bb-focused path.bb-step {
		stroke-width: 2px;
	}

	.bb-target.bb-defocused,
	.bb-circles.bb-defocused {
		opacity: 0.3 !important;
	}
	.bb-target.bb-defocused .text-overlapping,
	.bb-circles.bb-defocused .text-overlapping {
		opacity: 0.05 !important;
	} */

	/*-- Regions --*/

	.bb-region.visible-area {
		fill: var(--color-graph-activitybar-visibleAreaBackground);
		transform: translateY(26px);
		z-index: 0;
	}
	.bb-region.visible-area > rect {
		height: 10px;
	}

	:host(:hover) .bb-region.visible-area {
		fill: var(--color-graph-activitybar-visibleAreaHoverBackground);
	}

	.bb-region.marker-selected {
		fill: var(--color-graph-activitybar-selectedMarker);
		transform: translate(-1px, -4px);
		z-index: 12;
	}
	.bb-region.marker-selected > rect {
		width: 2px;
		height: 100%;
	}

	.bb-region.marker-highlighted {
		fill: var(--color-graph-activitybar-highlightedMarker);
		transform: translate(-1px, -4px);
		z-index: 11;
	}
	.bb-region.marker-highlighted > rect {
		width: 2px;
		height: 100%;
	}

	.bb-region.marker-result {
		fill: var(--color-graph-activitybar-resultMarker);
		transform: translate(-1px, -4px);
		z-index: 10;
	}
	.bb-region.marker-result > rect {
		width: 2px;
		height: 100%;
	}

	.bb-region.marker-head {
		fill: var(--color-graph-activitybar-headMarker);
		transform: translate(0px, -4px);
		z-index: 5;
	}
	.bb-region.marker-head > rect {
		width: 3px;
		height: 100%;
	}

	.bb-region.marker-upstream {
		fill: var(--color-graph-activitybar-upstreamMarker);
		transform: translate(0px, -4px);
		z-index: 4;
	}
	.bb-region.marker-upstream > rect {
		width: 2px;
		height: 100%;
	}

	.bb-region.marker-branch {
		fill: var(--color-graph-activitybar-branchMarker);
		transform: translate(-2px, 26px);
		z-index: 3;
	}
	.bb-region.marker-branch > rect {
		width: 2px;
		height: 10px;
	}

	.bb-region.marker-remote {
		fill: var(--color-graph-activitybar-remoteMarker);
		transform: translate(-3px, 31px);
		z-index: 2;
	}
	.bb-region.marker-remote > rect {
		width: 2px;
		height: 4px;
	}

	.bb-region.marker-tag {
		fill: var(--color-graph-activitybar-tagMarker);
		transform: translate(1px, 31px);
		z-index: 1;
	}
	.bb-region.marker-tag > rect {
		width: 1px;
		height: 4px;
	}

	/*-- Zoom region --*/
	/* :host-context(.vscode-dark) .bb-zoom-brush {
		fill: white;
		fill-opacity: 0.2;
	}
	:host-context(.vscode-light) .bb-zoom-brush {
		fill: black;
		fill-opacity: 0.1;
	} */

	/*-- Brush --*/
	/* .bb-brush .extent {
		fill-opacity: 0.1;
	} */

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
		box-shadow: 7px 7px 12px -9px var(--color-hover-border);
		opacity: 1;
		white-space: nowrap;
	}

	.bb-tooltip .header {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		gap: 1rem;
		font-size: 13px;
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
		gap: 0.5rem;
		flex-direction: row;
		flex-wrap: wrap;
		margin: 0.5rem 0;
		max-width: fit-content;
	}
	.bb-tooltip .refs .branch {
		border-radius: 3px;
		padding: 0 4px;
		background-color: var(--color-graph-activitybar-branchBackground);
		border: 1px solid var(--color-graph-activitybar-branchBorder);
		color: var(--color-graph-activitybar-branchForeground);
	}
	.bb-tooltip .refs .branch.current {
		background-color: var(--color-graph-activitybar-headBackground);
		border: 1px solid var(--color-graph-activitybar-headBorder);
		color: var(--color-graph-activitybar-headForeground);
	}
	.bb-tooltip .refs .remote {
		border-radius: 3px;
		padding: 0 4px;
		background-color: var(--color-graph-activitybar-remoteBackground);
		border: 1px solid var(--color-graph-activitybar-remoteBorder);
		color: var(--color-graph-activitybar-remoteForeground);
	}
	.bb-tooltip .refs .remote.current {
		background-color: var(--color-graph-activitybar-upstreamBackground);
		border: 1px solid var(--color-graph-activitybar-upstreamBorder);
		color: var(--color-graph-activitybar-upstreamForeground);
	}
	.bb-tooltip .refs .tag {
		border-radius: 3px;
		padding: 0 4px;
		background-color: var(--color-graph-activitybar-tagBackground);
		border: 1px solid var(--color-graph-activitybar-tagBorder);
		color: var(--color-graph-activitybar-tagForeground);
	}
`;

@customElement({ name: 'activity-graph', template: template, styles: styles })
export class ActivityGraph extends FASTElement {
	chart!: HTMLDivElement;

	private _chart!: Chart;
	private _loadTimer: ReturnType<typeof setTimeout> | undefined;

	private _markerRegions: Iterable<RegionOptions> | undefined;
	private _regions: RegionOptions[] | undefined;

	@observable
	data: Map<number, ActivityStats | null> | undefined;
	protected dataChanged(
		_oldVal?: Map<number, ActivityStats | null>,
		_newVal?: Map<number, ActivityStats | null>,
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
	highlightedDay: number | undefined;
	protected highlightedDayChanged() {
		this._chart?.regions.remove({ classes: ['marker-highlighted'] });
		if (this.highlightedDay == null) return;

		this._chart?.regions.add(this.getHighlightedDayRegion(this.highlightedDay));
	}

	@observable
	markers: Map<number, ActivityMarker[]> | undefined;
	protected markersChanged() {
		this.dataChanged(undefined, undefined, true);
	}

	@observable
	searchResults: Map<number, ActivitySearchResultMarker> | undefined;
	protected searchResultsChanged() {
		this._chart?.regions.remove({ classes: ['marker-result'] });
		if (this.searchResults == null) return;

		this._chart?.regions.add([...this.getSearchResultsRegions(this.searchResults)]);
	}

	@observable
	selectedDay: number | undefined;
	protected selectedDayChanged() {
		this._chart?.regions.remove({ classes: ['marker-selected'] });
		if (this.selectedDay == null) return;

		this._chart?.regions.add(this.getSelectedDayRegion(this.selectedDay));
	}

	@observable
	visibleDays: { top: number; bottom: number } | undefined;
	protected visibleDaysChanged() {
		this._chart?.regions.remove({ classes: ['visible-area'] });
		if (this.visibleDays == null) return;

		this._chart?.regions.add(this.getVisibleAreaRegion(this.visibleDays));
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		this._chart?.destroy();
	}

	select(date: number | Date) {
		setTimeout(() => this.selectCore(date), 500);
	}

	private selectCore(date: number | Date) {
		const d = this._chart.selected('activity') as any as any[];
		if (d.find(o => o.x.getTime() === getDay(date))) return;

		const index = this.getIndex(date);
		if (index == null) return;

		this._chart?.select(['activity'], [index], true);
	}

	unselect(date?: number | Date) {
		if (date != null) {
			const index = this.getIndex(date);
			if (index == null) return;

			this._chart?.unselect(undefined, [index]);
		} else {
			this._chart?.unselect();
		}
	}

	private getIndex(date: number | Date): number | undefined {
		date = new Date(date).setHours(0, 0, 0, 0);
		return this._chart
			?.data()[0]
			?.values.find(v => (typeof v.x === 'number' ? v.x : (v.x as any as Date).getTime()) === date)?.index;
	}

	private getMarkerRegions() {
		if (this._markerRegions == null) {
			if (this.markers != null) {
				const regions = flatMap(this.markers, ([day, markers]) =>
					map<ActivityMarker, RegionOptions>(
						markers,
						m =>
							({
								axis: 'x',
								start: day,
								end: day,
								class: m.current
									? m.type === 'branch'
										? 'marker-head'
										: 'marker-upstream'
									: `marker-${m.type}`,
							} satisfies RegionOptions),
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
				regions = union(regions, [this.getVisibleAreaRegion(this.visibleDays)]);
			}

			if (this.searchResults != null) {
				regions = union(regions, this.getSearchResultsRegions(this.searchResults));
			}

			if (this.highlightedDay != null) {
				regions = union(regions, [this.getHighlightedDayRegion(this.highlightedDay)]);
			}

			if (this.selectedDay != null) {
				regions = union(regions, [this.getSelectedDayRegion(this.selectedDay)]);
			}

			this._regions = [...regions];
		}
		return this._regions;
	}

	private getHighlightedDayRegion(highlightedDay: NonNullable<typeof this.highlightedDay>): RegionOptions {
		return {
			axis: 'x',
			start: highlightedDay,
			end: highlightedDay,
			class: 'marker-highlighted',
		} satisfies RegionOptions;
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

	private getSelectedDayRegion(selectedDay: NonNullable<typeof this.selectedDay>): RegionOptions {
		return {
			axis: 'x',
			start: selectedDay,
			end: selectedDay,
			class: 'marker-selected',
		} satisfies RegionOptions;
	}

	private getVisibleAreaRegion(visibleDays: NonNullable<typeof this.visibleDays>): RegionOptions {
		return {
			axis: 'x',
			start: visibleDays.bottom,
			end: visibleDays.top,
			class: 'visible-area',
		} satisfies RegionOptions;
	}

	private loadChart() {
		if (!this.data?.size) {
			this._chart?.destroy();
			return;
		}

		// Convert the map to an array dates and an array of stats
		const dates = [];
		const activity: number[] = [];
		// const commits: number[] = [];
		const additions: number[] = [];
		const deletions: number[] = [];

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
			// if (stat != null) {
			dates.push(day);

			// commits.push(stat?.commits ?? 0);

			adds = stat?.activity?.additions ?? 0;
			deletes = stat?.activity?.deletions ?? 0;
			changes = adds + deletes;
			changesMax = Math.max(changesMax, changes);

			activity.push(changes);
			additions.push(adds);
			deletions.push(-deletes);
			// }

			currentDate.setDate(currentDate.getDate() - 1);
		}

		const regions = this.getAllRegions();

		// calculate the max value for the y-axis to avoid flattening the graph because of outlier changes
		const p98 = [...activity].sort((a, b) => a - b)[Math.floor(activity.length * 0.98)];
		const yMax = p98 + Math.min(changesMax - p98, p98 * 0.02) + 100;

		if (this._chart == null) {
			this._chart = bb.generate({
				bindto: this.chart,
				data: {
					x: 'date',
					xSort: false,
					axes: {
						activity: 'y',
						additions: 'y',
						deletions: 'y',
					},
					columns: [
						['date', ...dates],
						['activity', ...activity],
						['additions', ...additions],
						['deletions', ...deletions],
					],
					names: {
						activity: 'Activity',
						additions: 'Additions',
						deletions: 'Deletions',
					},
					hide: ['additions', 'deletions'],
					onclick: d => {
						if (d.id !== 'activity') return;

						const date = new Date(d.x);
						const day = getDay(date);
						const sha = this.searchResults?.get(day)?.sha ?? this.data?.get(day)?.sha;

						queueMicrotask(() => {
							this.$emit('selected', {
								date: date,
								sha: sha,
							} satisfies ActivityStatsSelectedEventDetail);
						});
					},
					selection: {
						enabled: selection(),
						grouped: true,
						multiple: false,
						// isselectable: d => {
						// 	if (d.id !== 'activity') return false;

						// 	return (this.data?.get(getDay(new Date(d.x)))?.commits ?? 0) > 0;
						// },
					},
					colors: {
						activity: 'var(--color-graph-activitybar-line0)',
						additions: 'rgba(73, 190, 71, 0.7)',
						deletions: 'rgba(195, 32, 45, 0.7)',
					},
					groups: [['additions', 'deletions']],
					types: {
						activity: spline(),
						additions: bar(),
						deletions: bar(),
					},
				},
				area: {
					linearGradient: true,
					front: true,
					below: true,
					zerobased: true,
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
							// 	top: 10,
							bottom: 8,
						},
					},
					// y2: {
					// 	min: y2Min,
					// 	max: yMax,
					// 	show: true,
					// 	// padding: {
					// 	// 	top: 10,
					// 	// 	bottom: 0,
					// 	// },
					// },
				},
				bar: {
					zerobased: false,
					width: { max: 3 },
				},
				clipPath: false,
				grid: {
					front: false,
					// x: {
					// 	show: false,
					// 	// lines: [
					// 	// 	...flatMap(this.markers!, ([k, v]) =>
					// 	// 		v.map(m => ({
					// 	// 			value: k,
					// 	// 			text: m.name,
					// 	// 			position: 'middle',
					// 	// 			class: m.current ? 'marker-head' : `marker-${m.type}`,
					// 	// 		})),
					// 	// 	),
					// 	// ],
					// },
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
						type: 'catmull-rom',
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
										  })}, ${pluralize(
												'line',
												(stat?.activity?.additions ?? 0) + (stat?.activity?.deletions ?? 0),
												{
													format: c => formatNumeric(c),
													zero: 'No',
												},
										  )} changed`
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
				// zoom: {
				// 	enabled: zoom(),
				// 	rescale: false,
				// 	resetButton: {
				// 		text: '',
				// 	},
				// 	type: 'drag',
				// },
				onafterinit: function () {
					const xAxis = this.$.main.selectAll<Element, any>('.bb-axis-x').node();
					xAxis?.remove();

					const yAxis = this.$.main.selectAll<Element, any>('.bb-axis-y').node();
					yAxis?.remove();

					const grid = this.$.main.selectAll<Element, any>('.bb-grid').node();
					grid?.removeAttribute('clip-path');

					// Move the regions to be on top of the bars
					const bars = this.$.main.selectAll<Element, any>('.bb-chart-bars').node();
					const regions = this.$.main.selectAll<Element, any>('.bb-regions').node();
					bars?.insertAdjacentElement('afterend', regions!);
				},
			});
		} else {
			this._chart.load({
				columns: [
					['date', ...dates],
					['activity', ...activity],
					['additions', ...additions],
					['deletions', ...deletions],
				],
			});
			// this._chart.axis.min({ y: 0, y2: y2Min });
			this._chart.axis.max({ y: yMax /*, y2: yMax*/ });

			this._chart.regions(regions);

			// this._chart.xgrids([
			// 	...flatMap(this.markers!, ([k, v]) =>
			// 		v.map(m => ({
			// 			value: k,
			// 			text: m.name,
			// 			position: 'start',
			// 			class: m.current ? 'marker-head' : `marker-${m.type}`,
			// 		})),
			// 	),
			// ]);
		}
	}
}

function getDay(date: number | Date): number {
	return new Date(date).setHours(0, 0, 0, 0);
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
