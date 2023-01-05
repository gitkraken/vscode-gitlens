import { attr, css, customElement, FASTElement, html, ref } from '@microsoft/fast-element';
import type { Chart } from 'billboard.js';
import { areaSpline, bar, bb, selection, zoom } from 'billboard.js';
import { first, flatMap, last } from '../../../../system/iterable';
import { pluralize } from '../../../../system/string';
import { formatDate, formatNumeric, fromNow } from '../../shared/date';

export interface ActivityStats {
	commits: number;

	activity?: { additions: number; deletions: number };
	files?: number;
	sha?: string;
}

export interface ActivityMarker {
	type: 'branch' | 'remote' | 'tag';
	name: string;
	current?: boolean;
	upstream?: boolean;
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
		/* height: 27px; */
	}

	#chart {
		/* cursor: crosshair !important; */
		height: 100%;
		width: 100%;
		overflow: hidden;
		position: initial !important;
	}

	.bb svg {
		font: 10px var(--font-family);
		-webkit-tap-highlight-color: rgba(0, 0, 0, 0);
	}

	.bb path,
	.bb line {
		fill: none;
		/* stroke: #000; */
	}

	:host-context(.vscode-dark) .bb path.domain {
		stroke: var(--color-background--lighten-15);
	}

	:host-context(.vscode-light) .bb path.domain {
		stroke: var(--color-background--darken-15);
	}

	.bb text,
	.bb .bb-button {
		-webkit-user-select: none;
		-moz-user-select: none;
		user-select: none;
		fill: var(--color-view-foreground);
		font-size: 11px;
	}

	.bb-legend-item-tile,
	.bb-xgrid-focus,
	.bb-ygrid-focus,
	.bb-ygrid,
	.bb-event-rect,
	.bb-bars path {
		shape-rendering: crispEdges;
	}

	.bb-chart {
		width: 100%;
		height: 100%;
	}

	.bb-chart-arc .bb-gauge-value {
		fill: #000;
	}

	.bb-chart-arc path {
		stroke: #fff;
	}

	.bb-chart-arc rect {
		stroke: #fff;
		stroke-width: 1;
	}

	.bb-chart-arc text {
		fill: #fff;
		font-size: 13px;
	}

	/*-- Axis --*/
	.bb-axis {
		shape-rendering: crispEdges;
		visibility: hidden;
	}

	/*-- Grid --*/
	.bb-grid {
		pointer-events: none;
		clip-path: none;
	}

	:host-context(.vscode-dark) .bb-grid line,
	:host-context(.vscode-light) .bb-grid line.bb-ygrid {
		stroke: var(--color-background--darken-05);
	}

	:host-context(.vscode-dark) .bb-grid line,
	:host-context(.vscode-light) .bb-grid line.bb-ygrid {
		stroke: var(--color-background--lighten-05);
	}

	.bb-grid text {
		fill: var(--color-view-foreground);
	}

	/* .bb-xgrid,
	.bb-ygrid {
		stroke-dasharray: 3 3;
	} */

	:host-context(.vscode-dark) .bb-xgrid-focus line {
		stroke: var(--color-background--lighten-30);
	}
	:host-context(.vscode-light) .bb-xgrid-focus line {
		stroke: var(--color-background--darken-30);
	}

	/*-- Text on Chart --*/
	.bb-text.bb-empty {
		fill: #808080;
		font-size: 2em;
	}

	/*-- Line --*/
	.bb-line {
		stroke-width: 1px;
	}

	/*-- Point --*/
	.bb-circle._expanded_ {
		/* stroke-width: 1px;
		stroke: white; */
		opacity: 1 !important;
		fill-opacity: 1 !important;
		stroke-opacity: 1 !important;
		stroke-width: 1px;
	}

	.bb-selected-circle {
		/* fill: white;
		stroke-width: 2px; */
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

	/*-- Candlestick --*/
	.bb-candlestick {
		stroke-width: 1px;
	}
	.bb-candlestick._expanded_ {
		fill-opacity: 0.75;
	}

	/*-- Focus --*/
	.bb-target.bb-focused,
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
	}

	/*-- Region --*/
	.bb-region {
		fill: steelblue;
		fill-opacity: 0.1;
	}

	/*-- Zoom region --*/
	:host-context(.vscode-dark) .bb-zoom-brush {
		fill: white;
		fill-opacity: 0.2;
	}
	:host-context(.vscode-light) .bb-zoom-brush {
		fill: black;
		fill-opacity: 0.1;
	}

	/*-- Brush --*/
	.bb-brush .extent {
		fill-opacity: 0.1;
	}

	/*-- Legend --*/
	.bb-legend-item {
		font-size: 12px;
		user-select: none;
	}

	.bb-legend-item-hidden {
		opacity: 0.15;
	}

	.bb-legend-background {
		opacity: 0.75;
		fill: white;
		stroke: lightgray;
		stroke-width: 1;
	}

	/*-- Title --*/
	.bb-title {
		/* font: 14px sans-serif; */
		font: 13px var(--font-family);
	}

	/*-- Tooltip --*/
	.bb-tooltip-container {
		top: unset !important;
		z-index: 10;
		user-select: none;
	}

	.bb-tooltip {
		border-collapse: collapse;
		border-spacing: 0;
		background-color: var(--color-hover-background);
		color: var(--color-hover-foreground);
		/* empty-cells: show; */
		opacity: 1;
		-webkit-box-shadow: 7px 7px 12px -9px var(--color-hover-border);
		-moz-box-shadow: 7px 7px 12px -9px var(--color-hover-border);
		box-shadow: 7px 7px 12px -9px var(--color-hover-border);
		white-space: nowrap;
	}
	/* .bb-tooltip tr {
		border: 1px solid #ccc;
	} */
	/* .bb-tooltip tr.bb-tooltip-name-activity {
		display: none;
	} */
	.bb-tooltip tbody {
		border: 1px solid var(--color-hover-border);
	}
	.bb-tooltip th {
		font-size: 13px;
		font-weight: normal;
		padding: 2px 5px;
		text-align: left;
		/* color: #fff; */
	}
	.bb-tooltip td {
		font-size: 13px;
		padding: 3px 6px;
		/* background-color: #fff;
		border-left: 1px dotted #999; */
	}
	.bb-tooltip td > span,
	.bb-tooltip td > svg {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 6px;
	}
	.bb-tooltip.value {
		text-align: right;
	}

	/*-- Area --*/
	.bb-area {
		stroke-width: 0;
		opacity: 0.2;
	}

	/*-- Arc --*/
	.bb-chart-arcs-title {
		dominant-baseline: middle;
		font-size: 1.3em;
	}

	text.bb-chart-arcs-gauge-title {
		dominant-baseline: middle;
		font-size: 2.7em;
	}

	.bb-chart-arcs {
		/*-- Polar --*/
	}
	.bb-chart-arcs .bb-chart-arcs-background {
		fill: #e0e0e0;
		stroke: #fff;
	}
	.bb-chart-arcs .bb-chart-arcs-gauge-unit {
		fill: #000;
		font-size: 16px;
	}
	.bb-chart-arcs .bb-chart-arcs-gauge-max {
		fill: #777;
	}
	.bb-chart-arcs .bb-chart-arcs-gauge-min {
		fill: #777;
	}
	.bb-chart-arcs .bb-levels circle {
		fill: none;
		stroke: #848282;
		stroke-width: 0.5px;
	}
	.bb-chart-arcs .bb-levels text {
		fill: #848282;
	}

	/*-- Radar --*/
	.bb-chart-radars .bb-levels polygon {
		fill: none;
		stroke: #848282;
		stroke-width: 0.5px;
	}

	.bb-chart-radars .bb-levels text {
		fill: #848282;
	}

	.bb-chart-radars .bb-axis line {
		stroke: #848282;
		stroke-width: 0.5px;
	}

	.bb-chart-radars .bb-axis text {
		font-size: 1.15em;
		cursor: default;
	}

	.bb-chart-radars .bb-shapes polygon {
		fill-opacity: 0.2;
		stroke-width: 1px;
	}

	/*-- Button --*/
	.bb-button {
		position: absolute;
		/* top: 10px;
		right: 10px; */
		top: 0;
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

		/* font-size: 11px;
		border: solid 1px #ccc;
		background-color: #fff;
		padding: 5px;
		border-radius: 5px;
		cursor: pointer; */
	}

	.marker-head text,
	.marker-branch text,
	.marker-remote text {
		visibility: hidden;
	}

	.marker-head line {
		stroke: rgb(255, 255, 255) !important;
		stroke-width: 2px;
		transform: translateY(32px);
	}
	.marker-branch line {
		stroke: rgb(255, 255, 255, 0.8) !important;
		transform: translateY(32px);
	}
	.marker-remote line {
		stroke: rgb(255, 255, 255, 0.5) !important;
		transform: translateY(32px);
	}
`;

@customElement({ name: 'activity-graph', template: template, styles: styles })
export class ActivityGraph extends FASTElement {
	chart!: HTMLDivElement;
	_chart!: Chart;

	@attr(/*{ attribute: 'data', mode: 'fromView' }*/)
	data: Map<string, ActivityStats | null> | undefined;
	@attr(/*{ attribute: 'data', mode: 'fromView' }*/)
	markers: Map<string, ActivityMarker[]> | undefined;

	private _timer: ReturnType<typeof setTimeout> | undefined;

	override attributeChangedCallback(attrName: string, oldVal: string, newVal: string) {
		super.attributeChangedCallback(attrName, oldVal, newVal);

		if (attrName === 'data' || attrName === 'markers') {
			if (this._timer) {
				clearTimeout(this._timer);
				this._timer = undefined;
			}
			this._timer = setTimeout(() => this.loadChart(), 150);
		}
	}

	override connectedCallback(): void {
		super.connectedCallback();

		// this.data = [];
		// const notifier = Observable.getNotifier(this.data);
		// const handler = {
		// 	handleChange: (source: any, splices: Splice[]) => {
		// };

		// notifier.subscribe(handler);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		this._chart?.destroy();
	}

	select(date: number | Date) {
		const index = this.getIndex(date);
		if (index == null) return;

		this._chart?.select(['activity'], [index], true);
		// setTimeout(() => this._chart?.select(['activity'], [index], true), 100);
	}

	unselect(date?: number | Date) {
		if (date != null) {
			const index = this.getIndex(date);
			if (index == null) return;

			this._chart?.unselect(['activity'], [index]);
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

	private loadChart() {
		if (!this.data?.size) {
			this._chart?.destroy();
			return;
		}

		// Convert the map to an array dates and an array of stats
		const dates: string[] = [];
		const activity: number[] = [];
		const commits: number[] = [];
		const additions: number[] = [];
		const deletions: number[] = [];

		// const regions: RegionOptions[] = [];

		const keys = this.data.keys();
		// const startDay = first(keys)!;
		const endDay = last(keys)!;

		const startDate = new Date();
		const endDate = new Date(endDay);

		let day;
		let stat;
		// let region: RegionOptions | undefined;

		let activityMax = 0;
		let commitsMax = 0;
		let adds;
		let changes;
		let deletes;
		// eslint-disable-next-line no-unmodified-loop-condition -- currentDate is modified via .setDate
		while (startDate >= endDate) {
			day = getDay(startDate);

			stat = this.data.get(day);
			// if (stat != null) {
			dates.push(day);

			commits.push(stat?.commits ?? 0);
			commitsMax = Math.max(stat?.commits ?? 0, commitsMax);

			adds = stat?.activity?.additions ?? 0;
			deletes = stat?.activity?.deletions ?? 0;
			changes = adds + deletes;
			activityMax = Math.max(changes, activityMax);

			activity.push(changes);
			additions.push(adds);
			deletions.push(deletes);
			// }

			// if (stat == null && region == null) {
			// 	region = { start: day, end: day };
			// } else if (stat == null && region != null) {
			// 	region.start = day;
			// } else if (stat != null && region != null) {
			// 	regions.push(region);
			// 	region = undefined;
			// }

			startDate.setDate(startDate.getDate() - 1);
		}

		// calculate the max value for the y-axis to avoid flattening the graph because of outlier changes
		// const median = [...activity].sort((a, b) => a - b)[Math.floor(activity.length / 2)];
		const p95 = [...activity].sort((a, b) => a - b)[Math.floor(activity.length * 0.95)];
		const max = p95 + Math.min(activityMax - p95, p95 * 2);

		if (this._chart == null) {
			this._chart = bb.generate({
				bindto: this.chart,
				size: {
					height: 44,
				},
				data: {
					x: 'date',
					type: areaSpline(),
					axes: {
						activity: 'y',
						// commits: 'y2',
						additions: 'y2',
						deletions: 'y2',
					},
					columns: [
						['date', ...dates],
						// ['commits', ...commits],
						['activity', ...activity],
						['additions', ...additions],
						['deletions', ...deletions],
					],
					names: {
						activity: 'Activity',
						// commits: 'Commits',
						additions: 'Additions',
						deletions: 'Deletions',
					},
					// hide: ['additions', 'deletions'],
					onclick: d => {
						const date = new Date(d.x);
						const stat = this.data?.get(getDay(date));
						this.$emit('selected', {
							date: date,
							sha: stat?.sha,
						} satisfies ActivityStatsSelectedEventDetail);
					},
					// onselected: d => {
					// 		const date = new Date(d.x);
					// 		const stat = this.data?.get(getDay(date));
					// 		this.$emit('selected', {
					// 			date: date,
					// 			sha: stat?.sha,
					// 		} satisfies ActivityStatsSelectedEventDetail);
					// },
					selection: {
						enabled: selection(),
						// draggable: true,
						multiple: false,
						// isselectable: d => {
						// 	const date = new Date((Array.isArray(d) ? d[0] : d).x);
						// 	const stat = this.data?.get(getDay(date));
						// 	return (stat?.commits ?? 0) > 0;
						// },
					},
					colors: {
						activity: 'var(--color-graph-activity)',
						// commits: 'rgb(255, 0, 255)',
						additions: 'rgba(73, 190, 71, 1)',
						deletions: 'rgba(195, 32, 45, 1)',
					},
					groups: [['additions', 'deletions']],
					types: {
						activity: areaSpline(),
						// commits: areaSpline(),
						additions: bar(),
						deletions: bar(),
					},
				},
				area: {
					// linearGradient: true,
				},
				axis: {
					x: {
						show: false,
						// tick: {
						// 	culling: {
						// 		lines: false,
						// 	},
						// 	format: '%Y-%m-%d',
						// 	show: false,
						// 	type: 'timeseries',
						// },
						type: 'timeseries',
					},
					y: {
						min: 0,
						max: max,
						show: true,
						padding: {
							bottom: 20,
						},
						// center: median,
					},
					y2: {
						min: 0,
						max: max,
						show: true,
						padding: {
							bottom: 10,
						},
						// center: median,
					},
				},
				bar: {
					radius: {
						ratio: 0.25,
					},
					width: 3,
				},
				clipPath: false,
				legend: {
					show: false,
				},
				point: {
					r: 0.1,
					show: true,
					select: {
						r: 4,
					},
					// focus: {
					// 	// only: true,
					// 	expand: {
					// 		enabled: true,
					// 		r: 1,
					// 	},
					// },
					sensitivity: 100,
				},
				// padding: false,
				// regions: regions,
				// resize: {
				// 	auto: true,
				// },
				spline: {
					interpolation: {
						type: 'catmull-rom',
					},
				},
				grid: {
					front: true,
					x: {
						show: true,
						lines: [
							...flatMap(this.markers!, ([k, v]) =>
								v.map(m => ({
									value: k,
									text: m.name,
									position: 'middle',
									class: m.current ? 'marker-head' : `marker-${m.type}`,
								})),
							),
						],
					},
				},
				tooltip: {
					position: (_data, width, _height, element, _pos) => {
						const rect = (element as HTMLElement).getBoundingClientRect();
						// const { x } = pos;
						// const edge = x - width;
						return {
							top: 0, //64,
							left: rect.right - (width + 10),
							// left: x < rect.right / 2 ? rect.right - (width + 10) : 0,
							// left: edge < 0 ? x + 10 : edge,
						};
					},
					order: null,
					format: {
						value: (value, _ratio, id, _index) => {
							switch (id) {
								case 'activity':
									return pluralize('change', value, {
										format: c => formatNumeric(c),
										zero: 'No',
									});
								case 'commits':
									return pluralize('commit', value, {
										format: c => formatNumeric(c),
										zero: 'No',
									});
								case 'additions':
								case 'deletions':
									return pluralize('line', value, {
										format: c => formatNumeric(c),
									});
								default:
									return formatNumeric(value);
							}
						},
						title: (x: string) => {
							const date = new Date(x);
							// return `${formatDate(date, 'MMMM Do, YYYY')} (${capitalize(fromNow(date))})`;

							const markers = this.markers?.get(getDay(date));
							return `${formatDate(date, 'MMMM Do, YYYY')} (${capitalize(fromNow(date))})${
								markers != null ? ` \u2022 ${markers.map(m => m.name).join(', ')}` : ''
							}`;
							// const stat = this.data?.get(getDay(date));
							// const commits = stat?.commits ?? 0;
							// return `${pluralize('commit', commits, {
							// 	format: c => formatNumeric(c),
							// 	zero: 'No',
							// })}${
							// 	commits > 0 && stat?.activity != null
							// 		? ` (${pluralize('change', stat.activity.additions + stat.activity.deletions, {
							// 				format: c => formatNumeric(c),
							// 				zero: 'No',
							// 		  })})`
							// 		: ''
							// } \u2022 ${formatDate(date, 'MMMM Do, YYYY')} (${capitalize(fromNow(date))})`;
						},
					},
					grouped: true,
					linked: true,
				},
				zoom: {
					enabled: zoom(),
					rescale: true,
					resetButton: {
						text: '',
					},
					type: 'drag',
				},
			});
		} else {
			this._chart.load({
				columns: [
					['date', ...dates],
					// ['commits', ...commits],
					['activity', ...activity],
					['additions', ...additions],
					['deletions', ...deletions],
				],
				// regions: regions,
			});
			this._chart.axis.max({ y: max, y2: max /*commitsMax*/ });
			this._chart.xgrids([
				...flatMap(this.markers!, ([k, v]) =>
					v.map(m => ({
						value: k,
						text: m.name,
						position: 'start',
						class: m.current ? 'marker-head' : `marker-${m.type}`,
					})),
				),
			]);
		}
	}
}

function getDay(date: Date): string {
	return formatDate(date, 'YYYY-MM-DD');
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
