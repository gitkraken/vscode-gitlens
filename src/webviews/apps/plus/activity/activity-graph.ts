import { attr, css, customElement, FASTElement, html, ref } from '@microsoft/fast-element';
import type { Chart } from 'billboard.js';
import { areaSpline, bb, selection, zoom } from 'billboard.js';
import { first, last } from '../../../../system/iterable';
import { pluralize } from '../../../../system/string';
import { formatDate, formatNumeric, fromNow } from '../../shared/date';

export interface ActivityStats {
	commits: number;

	activity?: number;
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
		height: 27px;
	}

	#chart {
		cursor: crosshair;
		height: 100%;
		width: 100%;
		overflow: hidden;
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
	}

	/*-- Grid --*/
	.bb-grid {
		pointer-events: none;
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
	.bb-tooltip tr.bb-tooltip-name-activity {
		display: none;
	}
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
`;

@customElement({ name: 'activity-graph', template: template, styles: styles })
export class ActivityGraph extends FASTElement {
	chart!: HTMLDivElement;
	_chart!: Chart;

	@attr(/*{ attribute: 'data', mode: 'fromView' }*/)
	data: Map<string, ActivityStats | null> | undefined;

	private _timer: ReturnType<typeof setTimeout> | undefined;

	override attributeChangedCallback(attrName: string, oldVal: string, newVal: string) {
		super.attributeChangedCallback(attrName, oldVal, newVal);

		if (attrName === 'data') {
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
		return this._chart.data('activity')[0]?.values.find(v => (v.x as any as Date).getTime() === date)?.index;
	}

	private loadChart() {
		if (!this.data?.size) {
			this._chart?.destroy();
			return;
		}

		// Convert the map to an array dates and an array of stats
		const dates: string[] = [];
		const activity: number[] = [];

		// const regions: RegionOptions[] = [];

		const keys = this.data.keys();
		const startDay = first(keys)!;
		const endDay = last(keys)!;

		const startDate = new Date(startDay);
		const endDate = new Date(endDay);

		let day;
		let stat;
		// let region: RegionOptions | undefined;

		// eslint-disable-next-line no-unmodified-loop-condition -- currentDate is modified via .setDate
		while (startDate >= endDate) {
			day = getDay(startDate);

			stat = this.data.get(day);
			// if (stat != null) {
			dates.push(day);
			// activity.push(stat?.commits ?? 0);
			activity.push(stat?.activity ?? 0);
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

		if (this._chart == null) {
			this._chart = bb.generate({
				bindto: this.chart,
				size: {
					height: 34,
				},
				data: {
					x: 'date',
					type: areaSpline(),
					columns: [
						['date', ...dates],
						['activity', ...activity],
					],
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
					},
				},
				area: {
					linearGradient: true,
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
						show: false,
					},
				},
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
				tooltip: {
					position: function (data, width, height, element, pos) {
						const { x } = pos;
						// const rect = (element as HTMLElement).getBoundingClientRect();
						const edge = x - width - 10;
						return {
							top: -2,
							// left: x < rect.right / 2 ? rect.right - (width + 10) : 0,
							left: edge < 0 ? x + 10 : edge,
						};
					},
					format: {
						title: (x: string) => {
							const date = new Date(x);

							const stat = this.data?.get(getDay(date));
							const commits = stat?.commits ?? 0;
							return `${pluralize('commit', commits, {
								format: c => formatNumeric(c),
								zero: 'No',
							})}${
								commits > 0 && stat?.activity != null
									? ` (${pluralize('change', stat.activity, {
											format: c => formatNumeric(c),
											zero: 'No',
									  })})`
									: ''
							} \u2022 ${formatDate(date, 'MMMM Do, YYYY')} (${capitalize(fromNow(date))})`;
						},
					},
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
					['activity', ...activity],
				],
				// regions: regions,
			});
		}
	}
}

function getDay(date: Date): string {
	return formatDate(date, 'YYYY-MM-DD');
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
