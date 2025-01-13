import type { Chart, ChartOptions, ChartTypes, DataItem } from 'billboard.js';
import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { defer } from '../../../../../system/promise';
import { pluralize } from '../../../../../system/string';
import type { Commit, State } from '../../../../plus/timeline/protocol';
import { GlElement } from '../../../shared/components/element';
import { formatDate, fromNow } from '../../../shared/date';
import { timelineChartStyles } from './chart.css';

export interface DataPointClickEventDetail {
	data: {
		id: string;
		selected: boolean;
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-timeline-chart': GlTimelineChart;
	}

	interface GlobalEventHandlersEventMap {
		'gl-data-point-click': CustomEvent<DataPointClickEventDetail>;
		'gl-load': void;
		'gl-zoomed': CustomEvent<boolean>;
	}
}

@customElement('gl-timeline-chart')
export class GlTimelineChart extends GlElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [timelineChartStyles];

	private readonly _commitsByTimestamp = new Map<string, Commit>();
	private readonly _authorsByIndex = new Map<number, string>();
	private readonly _indexByAuthors = new Map<string, number>();
	private readonly _zByAuthorAndX = new Map<string, Map<number, number>>();

	private _abortController?: AbortController;
	private _loading?: ReturnType<typeof defer<void>>;

	@query('#chart')
	private chartContainer!: HTMLDivElement;
	private _chart?: Chart;

	private get compact(): boolean {
		return this.placement !== 'editor';
	}

	@property()
	placement: 'editor' | 'view' = 'editor';

	@property()
	dateFormat!: string;

	@property()
	shortDateFormat!: string;

	@state()
	private _data: Awaited<State['dataset']> | null = null;
	get data() {
		return this._data;
	}

	@property({ type: Boolean, reflect: true })
	zoomed = false;

	private _dataPromise!: NonNullable<State['dataset']>;
	@property({ type: Object })
	get dataPromise() {
		return this._dataPromise;
	}
	set dataPromise(value: NonNullable<State['dataset']>) {
		if (this._dataPromise === value) return;

		this._dataPromise = value;
		void this._dataPromise?.then(
			r => (this._data = r),
			() => (this._data = undefined),
		);
	}

	private _resizeObserver?: ResizeObserver;

	override connectedCallback(): void {
		super.connectedCallback();

		this._resizeObserver = new ResizeObserver(this.onResize);
		this._resizeObserver?.observe(this, { box: 'border-box' });
	}

	override disconnectedCallback(): void {
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;

		this._loading?.cancel();

		this._chart?.destroy();
		this._chart = undefined;

		super.disconnectedCallback();
	}

	override update(changedProperties: PropertyValues): void {
		if (changedProperties.has('zoomed')) {
			this.emit('gl-zoomed', this.zoomed);
		}

		if (changedProperties.has('dataPromise')) {
			this._abortController?.abort();
			this._abortController = new AbortController();
			this._loading?.cancel();

			void this.updateChart(this.dataPromise);
		}

		super.update(changedProperties);
	}

	protected override render() {
		// Don't render anything if the data is still loading
		if (this.data === null) return nothing;

		if (!this.data?.length) {
			return html`<div class="empty"><p>No commits found for the specified time period.</p></div>`;
		}

		return html`<div id="chart"></div>`;
	}

	reset() {
		// this._chart?.unselect();
		this._chart?.unzoom();
		this.zoomed = false;
	}

	zoom(factor: number) {
		if (!this._chart) return;

		const d = this._chart.zoom();
		const domain = [new Date(d[0]), new Date(d[1])];
		const range = domain[1].getTime() - domain[0].getTime();
		const mid = new Date((domain[1].getTime() + domain[0].getTime()) / 2);

		const start = new Date(mid.getTime() - (range * (1 - factor)) / 2);
		const end = new Date(mid.getTime() + (range * (1 - factor)) / 2);

		const updated = this._chart.zoom([start, end]);
		if (factor < 0 && updated[0] === d[0] && updated[1] === d[1]) {
			this._chart.unzoom();
			this.zoomed = false;
		}
	}

	private _domain!: [oldestDate: Date, latestDate: Date];

	async updateChart(dataPromise: State['dataset']) {
		if (this._loading?.pending) return;

		const abortSignal = this._abortController?.signal;

		const loading = defer<void>();
		this._loading = loading;
		void loading.promise.then(
			() => this.emit('gl-load'),
			() => {},
		);

		const dataset = await dataPromise;

		if (abortSignal?.aborted) {
			loading?.cancel();
			return;
		}

		if (!dataset?.length) {
			this._chart?.destroy();
			this._chart = undefined;

			loading?.fulfill();
			return;
		}

		this._commitsByTimestamp.clear();
		this._authorsByIndex.clear();
		this._indexByAuthors.clear();
		this._zByAuthorAndX.clear();

		const xs: Record<string, string> = {};
		const colors: Record<string, string> = {};
		const names: Record<string, string> = {};
		const axes: Record<string, string> = {};
		const types: Record<string, ChartTypes> = {};
		const groups: string[][] = [];
		const series: Record<string, any> = {};
		const group = [];

		let index = 0;

		let commit: Commit;
		let author: string;
		let date: string;
		let additions: number | undefined;
		let deletions: number | undefined;

		const minRadius = 6;
		const maxRadius = 50;

		// Calculate quartiles for better distribution
		const sortedChanges = dataset.map(c => (c.additions ?? 0) + (c.deletions ?? 0)).sort((a, b) => a - b);
		const maxChanges = sortedChanges[sortedChanges.length - 1];
		const q1 = sortedChanges[Math.floor(sortedChanges.length * 0.25)];
		const q3 = sortedChanges[Math.floor(sortedChanges.length * 0.75)];

		const bubbleScale = (changes: number): number => {
			if (changes === 0) return minRadius;

			// Progressive scaling based on quartiles
			let scaledSize;
			if (changes <= q1) {
				// Small changes: linear scale
				scaledSize = minRadius + (changes / q1) * 10;
			} else if (changes <= q3) {
				// Medium changes: moderate scaling
				const midScale = (changes - q1) / (q3 - q1);
				scaledSize = minRadius + 10 + midScale * 15;
			} else {
				// Large changes: logarithmic scale for outliers
				const logScale = Math.log(changes - q3 + 1) / Math.log(maxChanges - q3 + 1);
				scaledSize = minRadius + 25 + logScale * 15;
			}

			// Ensure result stays within bounds
			const result = Math.max(minRadius, Math.min(maxRadius, scaledSize));
			return result;
		};

		const { bb, bar, scatter, selection, zoom } = await import(
			/* webpackChunkName: "lib-billboard" */ 'billboard.js'
		);
		if (abortSignal?.aborted) {
			loading?.cancel();
			return;
		}

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

				types[author] = scatter();

				group.push(authorX);
			}

			series[x].push(date);
			series['additions'].push(additions ?? 0);
			series['deletions'].push(deletions ?? 0);

			series[authorX].push(date);

			series[author].push(this._indexByAuthors.get(author));

			let zAuthor = this._zByAuthorAndX.get(author);
			if (zAuthor == null) {
				zAuthor = new Map();
				this._zByAuthorAndX.set(author, zAuthor);
			}
			const z = additions == null && deletions == null ? 6 : bubbleScale((additions ?? 0) + (deletions ?? 0));
			zAuthor.set(new Date(date).getTime(), z);

			this._commitsByTimestamp.set(date, commit);
		}

		groups.push(group);

		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		const columns = Object.entries(series).map(([key, value]) => [key, ...value]);

		this._domain = [new Date(dataset[dataset.length - 1].date), new Date(dataset[0].date)];

		try {
			if (this._chart == null) {
				const options = this.getChartOptions(selection, zoom);

				options.axis ??= { y: { tick: {} } };
				options.axis.y ??= { tick: {} };
				options.axis.y.tick ??= {};

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

				options.onafterinit = function () {
					setTimeout(() => loading?.fulfill(), 250);
				};

				if (this.compact) {
					// eslint-disable-next-line @typescript-eslint/no-this-alias
					const host = this;
					options.onrendered = function () {
						// eslint-disable-next-line @typescript-eslint/no-this-alias
						const chart = this;
						if (chart == null) return;

						chart.$.main.selectAll('.bb-axis-y .tick text tspan').each(function (this, d) {
							if (this == null) return;

							const author = host._authorsByIndex.get(-(d as { index: number }).index)!;
							const color = chart.color(author);

							const el = this as SVGTSpanElement;
							// if (host.compact) {
							el.setAttribute('fill', color);

							const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
							title.textContent = author;
							el.appendChild(title);
							// } else {
							// 	const suffix = '\u00a0\u00a0⬤';
							// 	if (!el.textContent!.endsWith(suffix)) return;

							// 	const content = el.textContent!;
							// 	el.textContent = content.slice(0, content.length - suffix.length);

							// 	const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
							// 	tspan.textContent = suffix;
							// 	tspan.setAttribute('fill', color);

							// 	el.insertAdjacentElement('afterend', tspan);
							// }
						});
					};
				}

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
					resizeAfter: true,
					types: types,
					unload: true,
					xs: xs,
					done: () => {
						setTimeout(() => loading?.fulfill(), 250);
					},
				});
			}

			// eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator
			return void (await loading.promise.catch(() => {}));
		} catch (_ex) {
			debugger;

			loading?.cancel();
		}
	}

	private getChartOptions(
		selection: typeof import('billboard.js').selection,
		zoom: typeof import('billboard.js').zoom,
	) {
		const config: ChartOptions = {
			bindto: this.chartContainer,
			clipPath: true,
			data: {
				xFormat: '%Y-%m-%dT%H:%M:%S.%LZ',
				xLocaltime: false,
				selection: {
					enabled: selection(),
					draggable: false,
					grouped: true,
					multiple: false,
					isselectable: () => false,
				},
				onclick: this.onDataPointClicked,
			},
			axis: {
				x: {
					type: 'timeseries',
					localtime: true,
					show: true,
					height: this.compact ? 28 : undefined,
					forceAsSingle: true,
					tick: {
						centered: true,
						culling: false,
						fit: false,
						format: (x: number | Date) =>
							typeof x === 'number' ? x : formatDate(x, this.shortDateFormat ?? 'short'),
						show: true,
						outer: true,
					},
				},
				y: {
					max: 0,
					padding: { top: 75, bottom: 75 },
					show: true,
					tick: {
						format: (y: number) => (this.compact ? '\u{EB99}' : this._authorsByIndex.get(y) ?? ''), // `${this._authorsByIndex.get(y) ?? ''}\u00a0\u00a0⬤`,
						outer: true,
						show: true,
					},
				},
				y2: {
					padding: this.compact ? { top: 0, bottom: 0 } : undefined,
					label: this.compact ? undefined : { text: 'Lines changed', position: 'outer-middle' },
					// min: 0,
					show: true,
					tick: {
						format: (y: number) => (this.compact ? '' : y),
						outer: true,
					},
				},
			},
			bar: { width: 2, sensitivity: 4, padding: 2 },
			scatter: {
				zerobased: true,
			},
			grid: {
				focus: { edge: true, show: true, y: true },
				front: false,
				lines: { front: false },
				x: { show: false },
				y: { show: true },
			},
			legend: {
				show: true,
				hide: ['additions', 'deletions'],
				padding: 4,
				item: {
					tile: { type: 'circle', r: 4 },
					interaction: { dblclick: true },
				},
				tooltip: true,
			},
			point: {
				r: d => {
					if (d == null) return 0;

					if ('data' in d && typeof d.data === 'function') {
						d = d.data()[0];
						if (d == null) return 0;
					}

					const result = Math.max(
						6,
						this._zByAuthorAndX.get(d.id)?.get((d.x as unknown as Date).getTime()) ?? 6,
					);
					return result;
				},
				focus: {
					expand: {
						enabled: true,
					},
				},
				select: { r: 6 },
				// sensitivity: d => {
				// 	if (d == null) return 0;

				// 	if ('data' in d && typeof d.data === 'function') {
				// 		d = d.data()[0];
				// 		if (d == null) return 0;
				// 	}

				// 	const result = Math.max(
				// 		6,
				// 		(this._zByAuthorAndX.get(d.id)?.get((d.x as unknown as Date).getTime()) ?? 6) / 2,
				// 	);
				// 	return result;
				// },
			},
			resize: { auto: false },
			tooltip: {
				contents: (data, _defaultTitleFormat, _defaultValueFormat, _color) => {
					const d = data[0];
					const date = new Date(d.x);
					const commit = this._commitsByTimestamp.get(date.toISOString());
					if (commit == null) return '';

					const additions = commit.additions;
					const deletions = commit.deletions;
					const additionsLabel =
						additions == null
							? ''
							: /*html*/ `<span class="additions">+${pluralize('line', additions)}</span>`;
					let deletionsLabel =
						deletions == null
							? ''
							: /*html*/ `<span class="deletions">-${pluralize('line', deletions)}</span>`;
					if (additionsLabel) {
						deletionsLabel = `, ${deletionsLabel}`;
					}

					return /*html*/ `<div class="bb-tooltip">
						<section class="author">${commit.author}</section>
						<section>
							<span class="sha"><code-icon icon="git-commit"></code-icon> ${commit.commit.slice(0, 8)}</span>
							<span class="changes">${additionsLabel}${deletionsLabel}</span>
						</section>
						<section class="date">
							<code-icon icon="history"></code-icon><span class="date--relative">${capitalize(
								fromNow(date),
							)}</span><span class="date--absolute">(${formatDate(date, this.dateFormat)})</span>
						</section>
						<section class="message"><span class="message__content">${commit.message}</span></section>
					</div>`;
				},
				show: true,
			},
			zoom: {
				enabled: zoom(),
				type: 'wheel',
				// resetButton: true, // Doesn't work
				extent: [1, 0.01],
				onzoom: (domain: [string, string]) => {
					if (new Date(domain[0]) <= this._domain[0] && new Date(domain[1]) >= this._domain[1]) {
						this.zoomed = false;
					} else {
						this.zoomed = true;
					}
				},
				onzoomend: (domain: [string, string]) => {
					if (new Date(domain[0]) <= this._domain[0] && new Date(domain[1]) >= this._domain[1]) {
						this.zoomed = false;
					} else {
						this.zoomed = true;
					}
				},
			},
		};

		return config;
	}

	private onDataPointClicked = (d: DataItem, _element: SVGElement) => {
		const commit = this._commitsByTimestamp.get(new Date(d.x).toISOString());
		if (commit == null) return;

		// const selected = this._chart!.selected(d.id) as unknown as DataItem[];
		this.emit('gl-data-point-click', {
			data: {
				id: commit.commit,
				selected: true, //selected?.[0]?.id === d.id,
			},
		});
	};

	private onResize = (entries: ResizeObserverEntry[]) => {
		this._chart?.resize({
			width: entries[0].contentRect.width,
			height: entries[0].contentRect.height,
		});
	};
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
