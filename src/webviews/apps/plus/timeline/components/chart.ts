import type { Chart, ChartOptions, ChartTypes, Data, DataItem } from 'billboard.js';
import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { log } from '../../../../../system/decorators/log';
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

	private readonly _authors = new Map<
		string,
		{
			x: string[];
			y: number;
			z: Map<string, number>;
		}
	>();
	private readonly _authorsByIndex = new Map<number, string>();
	private readonly _commitsByTimestamp = new Map<string, Commit>();

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
	get data(): Awaited<State['dataset']> | null {
		return this._data;
	}

	@property({ type: Boolean, reflect: true })
	zoomed = false;

	private _dataPromise!: NonNullable<State['dataset']>;
	@property({ type: Object })
	get dataPromise(): NonNullable<State['dataset']> {
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

	protected override render(): unknown {
		// Don't render anything if the data is still loading
		if (this.data === null) return nothing;

		if (!this.data?.length) {
			return html`<div class="empty"><p>No commits found for the specified time period.</p></div>`;
		}

		return html`<div id="chart"></div>`;
	}

	reset(): void {
		// this._chart?.unselect();
		this._chart?.unzoom();
		this.zoomed = false;
	}

	zoom(factor: number): void {
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

	private _originalDomain!: [oldestDate: Date, latestDate: Date];
	private _zoomedDomain: [string, string] | undefined;

	@log({ args: false })
	async updateChart(dataPromise: State['dataset']): Promise<void> {
		if (this._loading?.pending) return;

		const abortController = this._abortController;

		const loading = defer<void>();
		this._loading = loading;
		void loading.promise.then(
			() => this.emit('gl-load'),
			() => {},
		);

		const dataset = await dataPromise;

		if (abortController?.signal.aborted) {
			loading?.cancel();
			return;
		}

		if (!dataset?.length) {
			this._chart?.destroy();
			this._chart = undefined;

			loading?.fulfill();
			return;
		}

		// Clear previous state
		this._authors.clear();
		this._authorsByIndex.clear();
		this._commitsByTimestamp.clear();

		// Calculate quartiles for better distribution
		const metrics = {
			minRadius: 6,
			maxRadius: 50,
			...this.calculateChangeMetrics(dataset),
		};

		const { bb, bar, scatter, selection, zoom } = await import(
			/* webpackChunkName: "lib-billboard" */ 'billboard.js'
		);
		if (abortController?.signal.aborted) {
			loading?.cancel();
			return;
		}

		this._originalDomain = [new Date(dataset[dataset.length - 1].date), new Date(dataset[0].date)];

		// Initialize plugins
		bar();
		scatter();

		const chartData = this.prepareChartData(dataset, metrics);

		try {
			const minY = -(this._authors.size + 1); // The +1 is to leave space at the bottom of the chart for the additions/deletions bars
			const yTickValues = [...this._authorsByIndex.keys()];
			if (this._chart == null) {
				const options: ChartOptions = {
					bindto: this.chartContainer,

					onafterinit: () => setTimeout(() => loading?.fulfill(), 250),
					onrendered: this.compact ? this.getOnRenderedCallback(this) : undefined,
					// Restore the zoomed domain when the chart is resized, because it gets lost
					onresized: () => {
						if (this._chart == null || this._zoomedDomain == null) return;

						this._chart.zoom(this._zoomedDomain);
					},

					clipPath: true,
					data: {
						...chartData,
						colors: { additions: 'rgba(73, 190, 71, 1)', deletions: 'rgba(195, 32, 45, 1)' },
						groups: [['additions', 'deletions']],
						// xFormat: '%Y-%m-%dT%H:%M:%S.%LZ',
						// xLocaltime: false,
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
							height: this.compact ? 28 : undefined,
							forceAsSingle: true,
							tick: {
								fit: false,
								format: (x: number | Date) =>
									typeof x === 'number' ? x : formatDate(x, this.shortDateFormat ?? 'short'),
								outer: true,
							},
						},
						y: {
							max: 0,
							min: minY,
							padding: { top: 75, bottom: 75 },
							tick: {
								format: (y: number) => (this.compact ? '\u{EB99}' : this._authorsByIndex.get(y) ?? ''), // `${this._authorsByIndex.get(y) ?? ''}\u00a0\u00a0⬤`,
								outer: true,
								values: yTickValues,
							},
						},
						y2: {
							padding: this.compact ? { top: 0, bottom: 0 } : undefined,
							label: this.compact ? undefined : { text: 'Lines changed', position: 'outer-middle' },
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
						r: (
							d:
								| (DataItem & { r?: number; data?: never })
								| { data: () => (DataItem & { r?: number })[] },
						) => {
							if (d == null) return 0;

							if (typeof d.data === 'function') {
								d = d.data()[0];
								if (d == null) return 0;
							}
							if (d.r != null) return d.r;

							const result = Math.max(
								6,
								this._authors.get(d.id)?.z.get((d.x as unknown as Date).toISOString()) ?? 6,
							);
							return result;
						},
						focus: {
							expand: {
								enabled: true,
							},
						},
						select: { r: 6 },
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
						extent: [1, 0.01],
						onzoom: (domain: [string, string]) => {
							if (
								new Date(domain[0]) <= this._originalDomain[0] &&
								new Date(domain[1]) >= this._originalDomain[1]
							) {
								this._zoomedDomain = undefined;
								this.zoomed = false;
							} else {
								this._zoomedDomain = domain;
								this.zoomed = true;
							}
						},
						onzoomend: (domain: [string, string]) => {
							if (
								new Date(domain[0]) <= this._originalDomain[0] &&
								new Date(domain[1]) >= this._originalDomain[1]
							) {
								this._zoomedDomain = undefined;
								this.zoomed = false;
							} else {
								this._zoomedDomain = domain;
								this.zoomed = true;
							}
						},
					},
				};

				this._chart = bb.generate(options);
			} else {
				this._chart.config('axis.y.tick.values', yTickValues, false);
				this._chart.config('axis.y.min', minY, false);

				this._chart.load({
					...chartData,
					resizeAfter: true,
					unload: true,
					done: () => setTimeout(() => loading?.fulfill(), 250),
				});
			}

			// eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator
			return void (await loading.promise.catch(() => {}));
		} catch (_ex) {
			debugger;

			loading?.cancel();
		}
	}

	@log<GlTimelineChart['prepareChartData']>({ args: { 0: d => d?.length } })
	private prepareChartData(
		dataset: Commit[],
		metrics: { minRadius: number; maxRadius: number; q1: number; q3: number; maxChanges: number },
	): {
		axes: Data['axes'];
		columns: Data['columns'];
		names: { [key: string]: string };
		types: Data['types'];
		xs: Data['xs'];
	} {
		const commits = dataset.length + 1;

		const timeSeries = new Array(commits);
		timeSeries[0] = 'time';
		const additionsSeries = new Array(commits);
		additionsSeries[0] = 'additions';
		const deletionsSeries = new Array(commits);
		deletionsSeries[0] = 'deletions';

		const axes: Record<string, string> = { time: 'x', additions: 'y2', deletions: 'y2' };
		const names: Record<string, string> = { additions: 'Additions', deletions: 'Deletions' };
		const types: Record<string, ChartTypes> = { additions: 'bar', deletions: 'bar' };
		const xs: Record<string, string> = { additions: 'time', deletions: 'time' };

		let nextAuthorIndex = 0;

		let index = 0;
		for (const commit of dataset) {
			const { author, date, additions = 0, deletions = 0 } = commit;

			this._commitsByTimestamp.set(date, commit);
			index++;

			timeSeries[index] = date;
			additionsSeries[index] = additions;
			deletionsSeries[index] = deletions;

			const z = this.calculateBubbleSize(additions + deletions, metrics);

			let authorInfo = this._authors.get(author);
			if (authorInfo == null) {
				authorInfo = {
					x: [`time.${author}`, date],
					y: nextAuthorIndex,
					z: new Map([[date, z]]),
				};
				this._authors.set(author, authorInfo);
				this._authorsByIndex.set(nextAuthorIndex, author);

				axes[author] = 'y';
				types[author] = 'scatter';
				xs[author] = `time.${author}`;

				nextAuthorIndex--;
			} else {
				authorInfo.x.push(date);
				authorInfo.z.set(date, z);
			}
		}

		const columns = [timeSeries, additionsSeries, deletionsSeries];
		for (const [key, value] of this._authors) {
			columns.push(value.x);

			const y = Array(value.x.length).fill(value.y);
			y[0] = key;
			columns.push(y);
		}

		return { axes: axes, columns: columns, names: names, types: types, xs: xs };
	}

	private calculateChangeMetrics(dataset: Commit[]): { q1: number; q3: number; maxChanges: number } {
		const sortedChanges = dataset.map(c => (c.additions ?? 0) + (c.deletions ?? 0)).sort((a, b) => a - b);
		return {
			maxChanges: sortedChanges[sortedChanges.length - 1],
			q1: sortedChanges[Math.floor(sortedChanges.length * 0.25)],
			q3: sortedChanges[Math.floor(sortedChanges.length * 0.75)],
		};
	}

	private calculateBubbleSize(
		changes: number,
		{
			minRadius,
			maxRadius,
			q1,
			q3,
			maxChanges,
		}: { minRadius: number; maxRadius: number; q1: number; q3: number; maxChanges: number },
	): number {
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
	}

	private getOnRenderedCallback(host: GlTimelineChart) {
		return function (this: Chart) {
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
