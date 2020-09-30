'use strict';
/*global*/
import { bar, bb, Chart, ChartOptions, DataItem, scatter, selection, zoom } from 'billboard.js';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import { TimelineData, TimelineDatum } from '../../protocol';
import { Emitter, Event } from '../shared/events';
import { DOM } from '../shared/dom';

dayjs.extend(advancedFormat);
dayjs.extend(relativeTime);

export interface ClickedEvent {
	data: {
		id: string;
	};
}

export class TimelineChart {
	private _onDidClick = new Emitter<ClickedEvent>();
	get onDidClick(): Event<ClickedEvent> {
		return this._onDidClick.event;
	}

	private readonly _chart: Chart;
	private _commitsByDate: Map<Date, TimelineDatum> | undefined;
	private _authorsByIndex: { [key: number]: string } | undefined;
	private _indexByAuthors: { [key: string]: number } | undefined;

	constructor(selector: string) {
		const config: ChartOptions = {
			bindto: selector,
			data: {
				columns: [],
				types: { time: scatter(), adds: bar(), changes: bar(), deletes: bar() },
				xFormat: '%m-%d-%Y %H:%M:%S',
				selection: {
					enabled: selection(),
					draggable: false,
					grouped: true,
					multiple: true,
				},
				onclick: this.onChartDataClick.bind(this),
			},
			axis: {
				x: {
					type: 'timeseries',
					tick: {
						show: false,
						fit: false,
						format: '%Y-%m-%d',
					},
				},
				y: {
					max: 0,
					padding: {
						top: 50,
						bottom: 100,
					},
					show: true,
					tick: {
						culling: false,
						format: (y: number) => this._authorsByIndex?.[y] ?? '',
						outer: false,
					},
				},
				y2: {
					show: true,
					label: {
						text: 'Changed Lines',
						position: 'outer-middle',
					},
					tick: {
						outer: false,
						// culling: true,
						// stepSize: 1,
					},
				},
			},
			bar: {
				width: 2,
				sensitivity: 4,
				space: 2,
			},
			grid: {
				front: false,
				lines: {
					front: false,
				},
				x: {
					show: true,
				},
				y: {
					show: true,
				},
			},
			legend: {
				show: true,
				// equally: true,
				padding: 10,
			},
			padding: {
				top: 10,
				right: 60,
				bottom: 10,
			},
			point: {
				r: 6,
				focus: {
					expand: {
						enabled: true,
						r: 9,
					},
				},
				select: {
					r: 12,
				},
			},
			subchart: {
				show: false, //subchart(),
				// 	axis: {
				// 		x: {
				// 			show: true,
				// 			tick: {
				// 				show: true,
				// 			},
				// 		},
				// 	},
				// 	size: {
				// 		height: 20,
				// 	},
			},
			title: {
				position: 'center',
			},
			tooltip: {
				grouped: true,
				linked: true,
				format: {
					title: this.onChartTooltipTitle.bind(this),
					name: this.onChartTooltipName.bind(this),
					value: this.onChartTooltipValue.bind(this),
				},
			},
			zoom: {
				enabled: zoom(),
				type: 'wheel',
				rescale: true,
				resetButton: true,
				extent: [1, 0.01],
				// onzoomstart: function(...args: any[]) {
				//     console.log('onzoomstart', args);
				// },
				// onzoom: function(...args: any[]) {
				//     console.log('onzoom', args);
				// },
				// onzoomend: function(...args: any[]) {
				//     console.log('onzoomend', args);
				// }
			},
		};

		this._chart = bb.generate(config);

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const me = this;
		DOM.on(selector, 'keydown', function (this: HTMLDivElement, e: KeyboardEvent) {
			return me.onChartKeyDown(this, e);
		});
	}

	private onChartDataClick(d: DataItem, _element: SVGElement) {
		const commit = this._commitsByDate!.get(d.x as any);
		if (commit == null) return;

		this._onDidClick.fire({
			data: {
				id: commit.commit,
			},
		});
	}

	private onChartKeyDown(element: HTMLDivElement, e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Esc') {
			this._chart.unzoom();
			this._chart.unselect();
		}
	}

	private onChartTooltipTitle(x: Date) {
		if (this._commitsByDate == null) return undefined!;

		const formattedDate = `${dayjs(x).fromNow()}   (${dayjs(x).format('MMMM Do, YYYY h:mma')})`;

		const commit = this._commitsByDate.get(x);
		if (commit == null) return formattedDate;
		return `${commit.author}, ${formattedDate}`;
	}

	private onChartTooltipName(name: string, ratio: number, id: string, index: number) {
		if (this._commitsByDate == null) return undefined!;

		if (id === 'adds' || id === 'changes' || id === 'deletes') return name;

		const x = (this._chart.data(id) as any)[0].values[index].x;
		const commit = this._commitsByDate.get(x);
		return commit?.commit.substr(0, 8) ?? '00000000';
	}

	private onChartTooltipValue(value: any, ratio: number, id: string, index: number) {
		if (this._commitsByDate == null) return undefined!;

		if (id === 'adds' || id === 'changes' || id === 'deletes') {
			return value === 0 ? undefined! : value;
		}

		const x = (this._chart.data(id) as any)[0].values[index].x;
		const commit = this._commitsByDate.get(x);
		return commit?.message ?? '???';
	}

	updateChart(data: TimelineData | undefined) {
		if (data == null) {
			this._chart.config('title.text', '', false);
			this._chart.unload();

			return;
		}

		const xs: { [key: string]: string } = {};
		const colors: { [key: string]: string } = {};
		const names: { [key: string]: string } = {};
		const axes: { [key: string]: string } = {};
		const types: { [key: string]: string } = {};
		const groups: string[][] = [];
		const series: { [key: string]: any } = {};

		this._authorsByIndex = {};
		this._indexByAuthors = {};
		this._commitsByDate = new Map();
		let index = 0;

		let datum: TimelineDatum;
		let author;
		let date;
		let added;
		let changed;
		let deleted;

		const repo = !data.uri;

		for (datum of data.dataset.reverse()) {
			({ author, date, added, changed, deleted } = datum);

			date = new Date(date);

			if (this._indexByAuthors[author] == null) {
				this._indexByAuthors[author] = index;
				this._authorsByIndex[index] = author;
				index--;
			}

			const x = 'time';
			if (series[x] == null) {
				series[x] = [];

				if (repo) {
					series['adds'] = [];
					series['changes'] = [];
					series['deletes'] = [];

					xs['adds'] = x;
					xs['changes'] = x;
					xs['deletes'] = x;

					axes['adds'] = 'y2';
					axes['changes'] = 'y2';
					axes['deletes'] = 'y2';

					names['adds'] = 'Added Files';
					names['changes'] = 'Changed Files';
					names['deletes'] = 'Deleted Files';

					colors['adds'] = 'rgba(73, 190, 71, 1)';
					colors['changes'] = '#0496FF';
					colors['deletes'] = 'rgba(195, 32, 45, 1)';

					types['adds'] = bar();
					types['changes'] = bar();
					types['deletes'] = bar();

					groups.push(['adds', 'changes', 'deletes']);
				} else {
					series['adds'] = [];
					series['deletes'] = [];

					xs['adds'] = x;
					xs['deletes'] = x;

					axes['adds'] = 'y2';
					axes['deletes'] = 'y2';

					names['adds'] = 'Added Lines';
					names['deletes'] = 'Deleted Lines';

					colors['adds'] = 'rgba(73, 190, 71, 1)';
					colors['deletes'] = 'rgba(195, 32, 45, 1)';

					types['adds'] = bar();
					types['deletes'] = bar();

					groups.push(['adds', 'deletes']);
				}
			}

			const authorX = `${x}.${author}`;
			if (series[authorX] == null) {
				series[authorX] = [];
				series[author] = [];

				xs[author] = authorX;

				axes[author] = 'y';

				names[author] = author;

				types[author] = scatter();
			}

			series[x].push(date);
			series['adds'].push(added);
			if (repo) {
				series['changes'].push(changed);
			}
			series['deletes'].push(deleted);

			series[authorX].push(date);
			series[author].push(this._indexByAuthors[author]);

			this._commitsByDate.set(date, datum);
		}

		this._chart.config('title.text', data.title, true);
		this._chart.config(
			'axis.y.tick.values',
			Object.keys(this._authorsByIndex).map(i => Number(i)),
			false,
		);
		this._chart.config('axis.y.min', index - 2, false);
		this._chart.groups(groups);

		const columns = Object.entries(series).map(([key, value]) => [key, ...value]);

		this._chart.load({
			columns: columns,
			xs: xs,
			axes: axes,
			names: names,
			colors: colors,
			types: types,
			unload: true,
		});
	}
}
