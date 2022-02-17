'use strict';
/*global*/
import { bar, bb, bubble, Chart, ChartOptions, DataItem, selection, zoom } from 'billboard.js';
// import BubbleCompare from 'billboard.js/dist/plugin/billboardjs-plugin-bubblecompare';
import { Commit, State } from '../../../../premium/webviews/timeline/protocol';
import { formatDate, fromNow } from '../../shared/date';
import { Emitter, Event } from '../../shared/events';

export interface DataPointClickEvent {
	data: {
		id: string;
		selected: boolean;
	};
}

export class TimelineChart {
	private _onDidClickDataPoint = new Emitter<DataPointClickEvent>();
	get onDidClickDataPoint(): Event<DataPointClickEvent> {
		return this._onDidClickDataPoint.event;
	}

	private readonly _chart: Chart;
	private _commitsByTimestamp = new Map<string, Commit>();
	private _authorsByIndex = new Map<number, string>();
	private _indexByAuthors = new Map<string, number>();

	private _dateFormat: string = undefined!;

	constructor(selector: string) {
		const config: ChartOptions = {
			bindto: selector,
			data: {
				columns: [],
				types: { time: bubble(), additions: bar(), deletions: bar() },
				xFormat: '%Y-%m-%dT%H:%M:%S.%LZ',
				xLocaltime: false,
				selection: {
					enabled: selection(),
					draggable: false,
					grouped: false,
					multiple: false,
				},
				onclick: this.onDataPointClicked.bind(this),
			},
			axis: {
				x: {
					type: 'timeseries',
					clipPath: false,
					localtime: true,
					tick: {
						// autorotate: true,
						centered: true,
						culling: false,
						fit: false,
						format: '%-m/%-d/%Y',
						multiline: false,
						// rotate: 15,
						show: false,
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
						format: (y: number) => this._authorsByIndex.get(y) ?? '',
						outer: false,
					},
				},
				y2: {
					label: {
						text: 'Number of Lines Changed',
						position: 'outer-middle',
					},
					// min: 0,
					show: true,
					tick: {
						outer: true,
						// culling: true,
						// stepSize: 1,
					},
				},
			},
			bar: {
				width: 2,
				sensitivity: 4,
				padding: 2,
			},
			bubble: {
				maxR: 50,
			},
			grid: {
				focus: {
					edge: true,
					show: true,
					y: true,
				},
				front: true,
				lines: {
					front: false,
				},
				x: {
					show: false,
				},
				y: {
					show: true,
				},
			},
			legend: {
				show: true,
				padding: 10,
			},
			// point: {
			// 	r: 6,
			// 	focus: {
			// 		expand: {
			// 			enabled: true,
			// 			r: 9,
			// 		},
			// 	},
			// 	select: {
			// 		r: 12,
			// 	},
			// },
			resize: {
				auto: true,
			},
			tooltip: {
				grouped: true,
				format: {
					title: this.getTooltipTitle.bind(this),
					name: this.getTooltipName.bind(this),
					value: this.getTooltipValue.bind(this),
				},
				// linked: true, //{ name: 'time' },
				show: true,
				order: 'desc',
			},
			zoom: {
				enabled: zoom(),
				type: 'drag',
				rescale: true,
				resetButton: true,
				extent: [1, 0.01],
				x: {
					min: 100,
				},
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
			// plugins: [
			// 	new BubbleCompare({
			// 		minR: 3,
			// 		maxR: 30,
			// 		expandScale: 1.2,
			// 	}),
			// ],
		};

		this._chart = bb.generate(config);
	}

	private onDataPointClicked(d: DataItem, _element: SVGElement) {
		const commit = this._commitsByTimestamp.get(new Date(d.x).toISOString());
		if (commit == null) return;

		const selected = this._chart.selected(d.id) as unknown as DataItem[];
		this._onDidClickDataPoint.fire({
			data: {
				id: commit.commit,
				selected: selected?.[0]?.id === d.id,
			},
		});
	}

	reset() {
		this._chart.unselect();
		this._chart.unzoom();
	}

	updateChart(state: State) {
		this._dateFormat = state.dateFormat;

		this._commitsByTimestamp.clear();
		this._authorsByIndex.clear();
		this._indexByAuthors.clear();

		if (state?.dataset == null) {
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
		const group = [];

		let index = 0;

		let commit: Commit;
		let author: string;
		let date: string;
		let additions: number;
		let deletions: number;

		for (commit of state.dataset) {
			({ author, date, additions, deletions } = commit);

			if (!this._indexByAuthors.has(author)) {
				this._indexByAuthors.set(author, index);
				this._authorsByIndex.set(index, author);
				index--;
			}

			const x = 'time';
			if (series[x] == null) {
				series[x] = [];

				series['additions'] = [];
				series['deletions'] = [];

				xs['additions'] = x;
				xs['deletions'] = x;

				axes['additions'] = 'y2';
				axes['deletions'] = 'y2';

				names['additions'] = 'Additions';
				names['deletions'] = 'Deletions';

				colors['additions'] = 'rgba(73, 190, 71, 1)';
				colors['deletions'] = 'rgba(195, 32, 45, 1)';

				types['additions'] = bar();
				types['deletions'] = bar();

				group.push(x);
				groups.push(['additions', 'deletions']);
			}

			const authorX = `${x}.${author}`;
			if (series[authorX] == null) {
				series[authorX] = [];
				series[author] = [];

				xs[author] = authorX;

				axes[author] = 'y';

				names[author] = author;

				types[author] = bubble();

				group.push(author, authorX);
			}

			series[x].push(date);
			series['additions'].push(additions);
			series['deletions'].push(deletions);

			series[authorX].push(date);
			series[author].push({ /*x: date,*/ y: this._indexByAuthors.get(author), z: additions + deletions });

			this._commitsByTimestamp.set(date, commit);
		}

		this._chart.config('axis.y.tick.values', [...this._authorsByIndex.keys()], false);
		this._chart.config('axis.y.min', index - 2, false);

		groups.push(group);
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

	private getTooltipName(name: string, ratio: number, id: string, index: number) {
		if (id === 'additions' || /*id === 'changes' ||*/ id === 'deletions') return name;

		const date = new Date(this._chart.data(id)[0].values[index].x);
		const commit = this._commitsByTimestamp.get(date.toISOString());
		return commit?.commit.slice(0, 8) ?? '00000000';
	}

	private getTooltipTitle(x: string) {
		const date = new Date(x);
		const formattedDate = `${capitalize(fromNow(date))}   (${formatDate(date, this._dateFormat)})`;

		const commit = this._commitsByTimestamp.get(date.toISOString());
		if (commit == null) return formattedDate;
		return `${commit.author}, ${formattedDate}`;
	}

	private getTooltipValue(value: any, ratio: number, id: string, index: number) {
		if (id === 'additions' || /*id === 'changes' ||*/ id === 'deletions') {
			return value === 0 ? undefined! : value;
		}

		const date = new Date(this._chart.data(id)[0].values[index].x);
		const commit = this._commitsByTimestamp.get(date.toISOString());
		return commit?.message ?? '???';
	}
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
