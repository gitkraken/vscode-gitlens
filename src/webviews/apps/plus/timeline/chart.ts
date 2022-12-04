'use strict';
/*global*/
import type { Chart, ChartOptions, ChartTypes, DataItem } from 'billboard.js';
import { bar, bb, bubble, zoom } from 'billboard.js';
// import BubbleCompare from 'billboard.js/dist/plugin/billboardjs-plugin-bubblecompare';
// import { scaleSqrt } from 'd3-scale';
import type { Commit, State } from '../../../../plus/webviews/timeline/protocol';
import { formatDate, fromNow } from '../../shared/date';
import type { Event } from '../../shared/events';
import { Emitter } from '../../shared/events';

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

	private readonly $container: HTMLElement;
	private _chart: Chart | undefined;
	private _chartDimensions: { height: number; width: number };
	private readonly _resizeObserver: ResizeObserver;
	private readonly _selector: string;

	private readonly _commitsByTimestamp = new Map<string, Commit>();
	private readonly _authorsByIndex = new Map<number, string>();
	private readonly _indexByAuthors = new Map<string, number>();

	private _dateFormat: string = undefined!;
	private _shortDateFormat: string = undefined!;

	constructor(selector: string) {
		this._selector = selector;

		let idleRequest: number | undefined;

		const fn = () => {
			idleRequest = undefined;

			const dimensions = this._chartDimensions;
			this._chart?.resize({
				width: dimensions.width,
				height: dimensions.height - 10,
			});
		};

		this._resizeObserver = new ResizeObserver(entries => {
			const size = entries[0].borderBoxSize[0];
			const dimensions = {
				width: Math.floor(size.inlineSize),
				height: Math.floor(size.blockSize),
			};

			if (
				this._chartDimensions.height === dimensions.height &&
				this._chartDimensions.width === dimensions.width
			) {
				return;
			}

			this._chartDimensions = dimensions;
			if (idleRequest != null) {
				cancelIdleCallback(idleRequest);
				idleRequest = undefined;
			}
			idleRequest = requestIdleCallback(fn, { timeout: 1000 });
		});

		this.$container = document.querySelector(selector)!.parentElement!;
		const rect = this.$container.getBoundingClientRect();
		this._chartDimensions = { height: Math.floor(rect.height), width: Math.floor(rect.width) };

		this._resizeObserver.observe(this.$container);
	}

	reset() {
		this._chart?.unselect();
		this._chart?.unzoom();
	}

	updateChart(state: State) {
		this._dateFormat = state.dateFormat;
		this._shortDateFormat = state.shortDateFormat;

		this._commitsByTimestamp.clear();
		this._authorsByIndex.clear();
		this._indexByAuthors.clear();

		if (state?.dataset == null || state.dataset.length === 0) {
			this._chart?.destroy();
			this._chart = undefined;

			const $overlay = document.getElementById('chart-empty-overlay') as HTMLDivElement;
			$overlay?.classList.toggle('hidden', false);

			const $emptyMessage = $overlay.querySelector<HTMLHeadingElement>('[data-bind="empty"]')!;
			$emptyMessage.textContent = state.emptyMessage ?? '';

			return;
		}

		const $overlay = document.getElementById('chart-empty-overlay') as HTMLDivElement;
		$overlay?.classList.toggle('hidden', true);

		const xs: { [key: string]: string } = {};
		const colors: { [key: string]: string } = {};
		const names: { [key: string]: string } = {};
		const axes: { [key: string]: string } = {};
		const types: { [key: string]: ChartTypes } = {};
		const groups: string[][] = [];
		const series: { [key: string]: any } = {};
		const group = [];

		let index = 0;

		let commit: Commit;
		let author: string;
		let date: string;
		let additions: number | undefined;
		let deletions: number | undefined;

		// // Get the min and max additions and deletions from the dataset
		// let minChanges = Infinity;
		// let maxChanges = -Infinity;

		// for (const commit of state.dataset) {
		// 	const changes = commit.additions + commit.deletions;
		// 	if (changes < minChanges) {
		// 		minChanges = changes;
		// 	}
		// 	if (changes > maxChanges) {
		// 		maxChanges = changes;
		// 	}
		// }

		// const bubbleScale = scaleSqrt([minChanges, maxChanges], [6, 100]);

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

				group.push(authorX);
			}

			series[x].push(date);
			series['additions'].push(additions ?? 0);
			series['deletions'].push(deletions ?? 0);

			series[authorX].push(date);

			const z = additions == null && deletions == null ? 6 : (additions ?? 0) + (deletions ?? 0); //bubbleScale(additions + deletions);
			series[author].push({
				y: this._indexByAuthors.get(author),
				z: z,
			});

			this._commitsByTimestamp.set(date, commit);
		}

		groups.push(group);

		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		const columns = Object.entries(series).map(([key, value]) => [key, ...value]);

		if (this._chart == null) {
			const options = this.getChartOptions();

			if (options.axis == null) {
				options.axis = { y: { tick: {} } };
			}
			if (options.axis.y == null) {
				options.axis.y = { tick: {} };
			}
			if (options.axis.y.tick == null) {
				options.axis.y.tick = {};
			}

			options.axis.y.min = index - 2;
			options.axis.y.tick.values = [...this._authorsByIndex.keys()];

			options.data = {
				...options.data,
				axes: axes,
				colors: colors,
				columns: columns,
				groups: groups,
				names: names,
				types: types,
				xs: xs,
			};

			this._chart = bb.generate(options);
		} else {
			this._chart.config('axis.y.tick.values', [...this._authorsByIndex.keys()], false);
			this._chart.config('axis.y.min', index - 2, false);
			this._chart.groups(groups);

			this._chart.load({
				axes: axes,
				colors: colors,
				columns: columns,
				names: names,
				types: types,
				xs: xs,
				unload: true,
			});
		}
	}

	private getChartOptions() {
		const config: ChartOptions = {
			bindto: this._selector,
			data: {
				xFormat: '%Y-%m-%dT%H:%M:%S.%LZ',
				xLocaltime: false,
				// selection: {
				// 	enabled: selection(),
				// 	draggable: false,
				// 	grouped: false,
				// 	multiple: false,
				// },
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
						format: (x: number | Date) =>
							typeof x === 'number' ? x : formatDate(x, this._shortDateFormat ?? 'short'),
						multiline: false,
						// rotate: 15,
						show: false,
					},
				},
				y: {
					max: 0,
					padding: {
						top: 75,
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
						text: 'Lines changed',
						position: 'outer-middle',
					},
					// min: 0,
					show: true,
					// tick: {
					// 	outer: true,
					// 	// culling: true,
					// 	// stepSize: 1,
					// },
				},
			},
			bar: {
				width: 2,
				sensitivity: 4,
				padding: 2,
			},
			bubble: {
				maxR: 100,
				zerobased: true,
			},
			grid: {
				focus: {
					edge: true,
					show: true,
					y: true,
				},
				front: false,
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
			resize: {
				auto: false,
			},
			size: {
				height: this._chartDimensions.height - 10,
				width: this._chartDimensions.width,
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
			// 		minR: 6,
			// 		maxR: 100,
			// 		expandScale: 1.2,
			// 	}),
			// ],
		};

		return config;
	}

	private getTooltipName(name: string, ratio: number, id: string, index: number) {
		if (id === 'additions' || /*id === 'changes' ||*/ id === 'deletions') return name;

		const date = new Date(this._chart!.data(id)[0].values[index].x);
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

	private getTooltipValue(value: unknown, ratio: number, id: string, index: number): string {
		if (id === 'additions' || /*id === 'changes' ||*/ id === 'deletions') {
			return value === 0 ? undefined! : (value as string);
		}

		const date = new Date(this._chart!.data(id)[0].values[index].x);
		const commit = this._commitsByTimestamp.get(date.toISOString());
		return commit?.message ?? '???';
	}

	private onDataPointClicked(d: DataItem, _element: SVGElement) {
		const commit = this._commitsByTimestamp.get(new Date(d.x).toISOString());
		if (commit == null) return;

		// const selected = this._chart!.selected(d.id) as unknown as DataItem[];
		this._onDidClickDataPoint.fire({
			data: {
				id: commit.commit,
				selected: true, //selected?.[0]?.id === d.id,
			},
		});
	}
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
