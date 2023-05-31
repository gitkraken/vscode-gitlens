/*global*/
import type { Chart, ChartOptions, ChartTypes, DataItem } from 'billboard.js';
import { bar, bb, bubble, zoom } from 'billboard.js';
// import BubbleCompare from 'billboard.js/dist/plugin/billboardjs-plugin-bubblecompare';
// import { scaleSqrt } from 'd3-scale';
import type { Commit, State } from '../../../../plus/webviews/timeline/protocol';
import { formatDate, fromNow } from '../../shared/date';
import type { Disposable, Event } from '../../shared/events';
import { Emitter } from '../../shared/events';

export interface DataPointClickEvent {
	data: {
		id: string;
		selected: boolean;
	};
}

export class TimelineChart implements Disposable {
	private _onDidClickDataPoint = new Emitter<DataPointClickEvent>();
	get onDidClickDataPoint(): Event<DataPointClickEvent> {
		return this._onDidClickDataPoint.event;
	}

	private readonly $container: HTMLElement;
	private _chart: Chart | undefined;
	private readonly _resizeObserver: ResizeObserver;
	private readonly _selector: string;
	private _size: { height: number; width: number };

	private readonly _commitsByTimestamp = new Map<string, Commit>();
	private readonly _authorsByIndex = new Map<number, string>();
	private readonly _indexByAuthors = new Map<string, number>();

	private _dateFormat: string = undefined!;
	private _shortDateFormat: string = undefined!;

	private get compact(): boolean {
		return this.placement !== 'editor';
	}

	constructor(selector: string, private readonly placement: 'editor' | 'view') {
		this._selector = selector;

		const fn = () => {
			const size = this._size;
			this._chart?.resize({
				width: size.width,
				height: size.height,
			});
		};

		const widthOffset = this.compact ? 32 : 0;
		const heightOffset = this.compact ? 16 : 0;

		this.$container = document.querySelector(selector)!.parentElement!;
		this._resizeObserver = new ResizeObserver(entries => {
			const boxSize = entries[0].borderBoxSize[0];
			const size = {
				width: Math.floor(boxSize.inlineSize) + widthOffset,
				height: Math.floor(boxSize.blockSize) + heightOffset,
			};

			this._size = size;
			requestAnimationFrame(fn);
		});

		const rect = this.$container.getBoundingClientRect();
		this._size = {
			height: Math.floor(rect.height) + widthOffset,
			width: Math.floor(rect.width) + heightOffset,
		};

		this._resizeObserver.observe(this.$container, { box: 'border-box' });
	}

	dispose(): void {
		this._resizeObserver.disconnect();
		this._chart?.destroy();
	}

	reset() {
		this._chart?.unselect();
		this._chart?.unzoom();
	}

	private setEmptyState(dataset: Commit[] | undefined, state: State) {
		const $empty = document.getElementById('empty')!;
		const $header = document.getElementById('header')!;

		if (state.uri != null) {
			if (dataset?.length === 0) {
				$empty.innerHTML = '<p>No commits found for the specified time period.</p>';
				$empty.removeAttribute('hidden');
			} else {
				$empty.setAttribute('hidden', '');
			}
			$header.removeAttribute('hidden');
		} else if (dataset == null) {
			$empty.innerHTML = '<p>There are no editors open that can provide file history information.</p>';
			$empty.removeAttribute('hidden');
			$header.setAttribute('hidden', '');
		} else {
			$empty.setAttribute('hidden', '');
			$header.removeAttribute('hidden');
		}
	}

	updateChart(state: State) {
		this._dateFormat = state.dateFormat;
		this._shortDateFormat = state.shortDateFormat;

		this._commitsByTimestamp.clear();
		this._authorsByIndex.clear();
		this._indexByAuthors.clear();

		let dataset = state?.dataset;
		if (dataset == null && !state.access.allowed && this.placement === 'editor') {
			dataset = generateRandomTimelineDataset();
		}

		this.setEmptyState(dataset, state);
		if (dataset == null || dataset.length === 0) {
			this._chart?.destroy();
			this._chart = undefined;

			return;
		}

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

		// for (const commit of dataset) {
		// 	const changes = commit.additions + commit.deletions;
		// 	if (changes < minChanges) {
		// 		minChanges = changes;
		// 	}
		// 	if (changes > maxChanges) {
		// 		maxChanges = changes;
		// 	}
		// }

		// const bubbleScale = scaleSqrt([minChanges, maxChanges], [6, 100]);

		for (commit of dataset) {
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

		try {
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
		} catch (ex) {
			debugger;
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
					show: true,
					tick: {
						centered: true,
						culling: false,
						fit: false,
						format: (x: number | Date) =>
							this.compact
								? ''
								: typeof x === 'number'
								? x
								: formatDate(x, this._shortDateFormat ?? 'short'),
						multiline: false,
						show: false,
						outer: !this.compact,
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
						format: (y: number) => (this.compact ? '' : this._authorsByIndex.get(y) ?? ''),
						outer: !this.compact,
						show: this.compact,
					},
				},
				y2: {
					padding: this.compact
						? {
								top: 0,
								bottom: 0,
						  }
						: undefined,
					label: this.compact
						? undefined
						: {
								text: 'Lines changed',
								position: 'outer-middle',
						  },
					// min: 0,
					show: true,
					tick: {
						format: (y: number) => (this.compact ? '' : y),
						outer: !this.compact,
					},
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
				show: !this.compact,
				// hide: this.compact ? [...this._authorsByIndex.values()] : undefined,
				padding: 10,
			},
			resize: {
				auto: false,
			},
			size: this._size,
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

function generateRandomTimelineDataset(): Commit[] {
	const dataset: Commit[] = [];
	const authors = ['Eric Amodio', 'Justin Roberts', 'Keith Daulton', 'Ramin Tadayon', 'Ada Lovelace', 'Grace Hopper'];

	const count = 10;
	for (let i = 0; i < count; i++) {
		// Generate a random date between now and 3 months ago
		const date = new Date(new Date().getTime() - Math.floor(Math.random() * (3 * 30 * 24 * 60 * 60 * 1000)));

		dataset.push({
			commit: String(i),
			author: authors[Math.floor(Math.random() * authors.length)],
			date: date.toISOString(),
			message: '',
			// Generate random additions/deletions between 1 and 20, but ensure we have a tiny and large commit
			additions: i === 0 ? 2 : i === count - 1 ? 50 : Math.floor(Math.random() * 20) + 1,
			deletions: i === 0 ? 1 : i === count - 1 ? 25 : Math.floor(Math.random() * 20) + 1,
			sort: date.getTime(),
		});
	}

	return dataset.sort((a, b) => b.sort - a.sort);
}
