import type { Chart, ChartOptions, ChartTypes, Data, DataItem } from 'billboard.js';
import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { ChartInternal, ChartWithInternal } from '../../../../../@types/bb';
import { shortenRevision } from '../../../../../git/utils/revision.utils';
import { log } from '../../../../../system/decorators/log';
import { debounce } from '../../../../../system/function/debounce';
import { defer } from '../../../../../system/promise';
import { pluralize, truncateMiddle } from '../../../../../system/string';
import type { State, TimelineDatum, TimelineSliceBy } from '../../../../plus/timeline/protocol';
import { GlElement } from '../../../shared/components/element';
import { createFromDateDelta, formatDate, fromNow } from '../../../shared/date';
import { timelineChartStyles } from './chart.css';
import type { SliderChangeEventDetail } from './slider';
import { GlChartSlider } from './slider';
import '@shoelace-style/shoelace/dist/components/resize-observer/resize-observer.js';
import './scroller';
import '../../../shared/components/commit-sha';
import '../../../shared/components/indicators/watermark-loader';

export const tagName = 'gl-timeline-chart';

const maxZoomExtent = 40;

@customElement(tagName)
export class GlTimelineChart extends GlElement {
	static readonly tagName = tagName;

	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [timelineChartStyles];

	@query('#chart')
	private chartContainer!: HTMLDivElement;
	private _chart?: Chart;

	@query(GlChartSlider.tagName)
	private slider?: GlChartSlider;

	private _chartAborter?: AbortController;

	private readonly _slices = new Map<
		string,
		{
			x: string[];
			y: number;
			z: Map<string, number>;
		}
	>();
	private readonly _slicesByIndex = new Map<number, string>();
	private readonly _commitsByTimestamp = new Map<number, TimelineDatum>();

	@state()
	private _loading?: ReturnType<typeof defer<void>>;

	private get compact(): boolean {
		return this.placement !== 'editor';
	}

	@property()
	placement: 'editor' | 'view' = 'editor';

	@property()
	dateFormat!: string;

	@property({ type: String })
	head?: string;

	@property({ type: Object })
	scope?: State['scope'];

	@property()
	shortDateFormat!: string;

	@property()
	sliceBy: TimelineSliceBy = 'author';

	@state()
	private _data: Awaited<State['dataset']> | null = null;
	private _dataReversed: Awaited<State['dataset']> | undefined;
	get data(): Awaited<State['dataset']> | null {
		return this._data;
	}

	private _dataPromise: State['dataset'];
	@property({ type: Object })
	get dataPromise(): State['dataset'] {
		return this._dataPromise;
	}
	set dataPromise(value: State['dataset']) {
		if (this._dataPromise === value) return;

		this._dataPromise = value;
		void this._dataPromise?.then(
			r => {
				this._data = r;
				this._dataReversed = r.toReversed();
			},
			() => (this._data = undefined),
		);
	}

	@state()
	private _shaHovered: string | undefined;
	@state()
	private _shaSelected: string | undefined;

	@state()
	private _shiftKeyPressed = false;

	private _range!: [oldest: Date, newest: Date];
	private _rangeScrollable!: [oldest: number, newest: number];
	private get range(): [oldest: Date, newest: Date] {
		return this._range;
	}
	private set range(range: [oldest: Date, newest: Date]) {
		this._range = range;
		this._rangeScrollable = [range[0].getTime() - 1000 * 60 * 60 * 4, range[1].getTime() + 1000 * 60 * 60 * 12];
		this.resetZoom();
	}

	@state()
	private _zoomedRange: [oldest: Date, newest: Date] | undefined;
	private _zoomedRangeScrollable: [oldest: number, newest: number] | undefined;
	private get zoomedRange(): [oldest: Date, newest: Date] | undefined {
		return this._zoomedRange;
	}
	private set zoomedRange(range: [oldest: Date, newest: Date] | undefined) {
		this._zoomedRange = range;
		this._zoomedRangeScrollable = range ? [range[0].getTime(), range[1].getTime()] : undefined;
	}

	@property({ type: Boolean, reflect: true })
	get zoomed(): boolean {
		return this._zoomedRange != null;
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		document.addEventListener('keydown', this.onDocumentKeyDown);
		document.addEventListener('keyup', this.onDocumentKeyUp);
	}

	override disconnectedCallback(): void {
		document.removeEventListener('keydown', this.onDocumentKeyDown);
		document.removeEventListener('keyup', this.onDocumentKeyUp);

		this._loading?.cancel();

		this._chart?.destroy();
		this._chart = undefined;

		super.disconnectedCallback?.();
	}

	override update(changedProperties: PropertyValues): void {
		if (changedProperties.has('dataPromise') || this.dataPromise == null) {
			this.updateChart();
		}
		super.update(changedProperties);
	}

	private updateChart() {
		if (!this._loading?.pending) {
			this._loading = defer<void>();
			void this._loading.promise.finally(() => (this._loading = undefined));

			this.emit('gl-loading', this._loading.promise);
		}

		if (this.dataPromise == null) return;

		this._chartAborter?.abort();
		this._chartAborter = new AbortController();
		void this.renderChart(this.dataPromise, this._loading, this._chartAborter.signal);
	}

	protected override render(): unknown {
		return html`${this.renderNotice()}
			<gl-chart-scroller
				.range=${this._rangeScrollable}
				.visibleRange=${this._zoomedRangeScrollable}
				@gl-scroll=${this.onScroll}
				@gl-scroll-start=${this.onScrollStart}
				@gl-scroll-end=${this.onScrollEnd}
			>
				<sl-resize-observer @sl-resize=${this.onResize}>
					<div id="chart" tabindex="-1"></div>
				</sl-resize-observer>
				${this.data?.length ? this.renderFooter() : nothing}
			</gl-chart-scroller>`;
	}

	private renderNotice() {
		if (this._loading?.pending || this.data == null) {
			return html`<div class="notice notice--blur">
				<gl-watermark-loader pulse><p>Loading...</p></gl-watermark-loader>
			</div>`;
		}

		if (!this.data.length) {
			return html`<div class="notice">
				<gl-watermark-loader><slot name="empty"></slot></gl-watermark-loader>
			</div>`;
		}

		return nothing;
	}

	private renderFooter() {
		const sha = this._shaHovered ?? this._shaSelected;

		return html`<footer>
			<gl-chart-slider
				.data=${this._dataReversed}
				?shift=${this._shiftKeyPressed}
				@gl-slider-change=${this.onSliderChanged}
				@mouseover=${this.onSliderMouseOver}
				@mouseout=${this.onSliderMouseOut}
			></gl-chart-slider>
			<span @mouseover=${this.onFooterShaMouseOver} @mouseout=${this.onFooterShaMouseOut}
				><gl-commit-sha-copy .sha=${sha} .size=${16}></gl-commit-sha-copy
			></span>
			${this.renderActions()}
		</footer>`;
	}

	private renderActions() {
		return html`<div class="actions">
			${this.zoomed
				? html`<gl-button
						appearance="toolbar"
						@click=${(e: MouseEvent) => (e.shiftKey || e.altKey ? this.resetZoom() : this.zoom(-1))}
						aria-label="Zoom Out"
					>
						<code-icon icon="zoom-out"></code-icon>
						<span slot="tooltip">Zoom Out<br />[Alt] Reset Zoom</span>
					</gl-button>`
				: nothing}
			<gl-button appearance="toolbar" @click=${() => this.zoom(0.5)} tooltip="Zoom In" aria-label="Zoom In">
				<code-icon icon="zoom-in"></code-icon>
			</gl-button>
		</div>`;
	}

	private readonly onDataPointClicked = debounce((d: DataItem, _element: SVGElement) => {
		const x = d.x as string | number | Date;
		const date = x instanceof Date ? x : new Date(x);

		const sha = this._commitsByTimestamp.get(date.getTime())?.sha;
		if (sha == null) return;

		this._shaHovered = undefined;
		this._shaSelected = sha;

		this.slider?.select(sha);

		this.emit('gl-commit-select', { id: sha, shift: this._shiftKeyPressed });
	}, 50);

	private readonly onDataPointHovered = (d: DataItem, _element: SVGElement) => {
		const x = d.x as string | number | Date;
		const date = x instanceof Date ? x : new Date(x);

		const sha = this._commitsByTimestamp.get(date.getTime())?.sha;
		this._shaHovered = sha;
	};

	private readonly onDataPointUnhovered = (_d: DataItem, _element: SVGElement) => {
		this._shaHovered = undefined;

		// Refocus the selected commit
		if (this._shaSelected) {
			const date = this._data?.find(c => c.sha === this._shaSelected)?.date;
			if (date == null) return;

			this.selectDataPoint(new Date(date));
		}
	};

	private readonly onDocumentKeyDown = (e: KeyboardEvent) => {
		this._shiftKeyPressed = e.shiftKey;

		if (e.key === 'Escape' || e.key === 'Esc') {
			this.resetZoom();
		}
	};

	private readonly onDocumentKeyUp = (e: KeyboardEvent) => {
		this._shiftKeyPressed = e.shiftKey;
	};

	private onFooterShaMouseOver() {
		if (!this._shaSelected) return;

		this.showTooltip(this._data?.find(c => c.sha === this._shaSelected));
	}

	private onFooterShaMouseOut() {
		this.hideTooltip();
	}

	private readonly onResize = (e: CustomEvent<{ entries: ResizeObserverEntry[] }>) => {
		if (!this._chart) return;

		this.updateChartSize(e.detail.entries[0].contentRect);
	};

	private _transitionDuration: number | undefined;
	private onScrollStart() {
		if (!this._chart || !this.zoomed) return;

		this._transitionDuration = this._chart?.config('transition.duration');
		this._chart?.config('transition.duration', 0);
	}

	private onScrollEnd() {
		if (!this._chart || !this.zoomed) return;

		this._chart?.config('transition.duration', this._transitionDuration);
	}

	private onScroll(e: CustomEvent<{ range: [number, number] }>) {
		if (!this._chart || !this.zoomed) return;

		const zoomedRange = [new Date(e.detail.range[0]), new Date(e.detail.range[1])];
		this._chart.zoom(zoomedRange);
	}

	private onSliderChanged(e: CustomEvent<SliderChangeEventDetail>) {
		this.revealDate(e.detail.date, { focus: true, select: true });

		const commit = this._commitsByTimestamp.get(e.detail.date.getTime());
		const sha = commit?.sha;
		this._shaHovered = undefined;
		this._shaSelected = sha;

		this.showTooltip(commit);

		if (sha == null) return;
		this.emit('gl-commit-select', { id: sha, shift: e.detail.shift });
	}

	private onSliderMouseOver(_e: MouseEvent) {
		this.showTooltip(this.slider?.value);
	}

	private onSliderMouseOut(_e: MouseEvent) {
		this.hideTooltip();
	}

	private readonly onZoom = (domain: [Date, Date]) => {
		this.zoomedRange = domain[0] <= this.range[0] && domain[1] >= this.range[1] ? undefined : domain;
	};

	resetZoom(): void {
		this.zoomedRange = undefined;
		this._chart?.unzoom();
	}

	revealDate(date: Date, options?: { focus?: boolean; select?: boolean }): void {
		if (!this._chart) return;

		// Select the commit point in the chart
		this.selectDataPoint(date, options);

		if (!this.zoomedRange) return;

		const padding = 0.2;

		const domain = this.zoomedRange;
		const range = domain[1].getTime() - domain[0].getTime();

		let newStart;
		let newEnd;

		if (date < domain[0]) {
			// If the date is earlier than our current window, slide earlier
			newStart = new Date(date.getTime() - range * padding);
			newEnd = new Date(newStart.getTime() + range);

			// If sliding would go beyond the start, adjust to show the full start of the range
			if (newStart <= this.range[0]) {
				newStart = createFromDateDelta(this.range[0], { hours: -12 });
				newEnd = new Date(newStart.getTime() + range);
			}
		} else if (date > domain[1]) {
			// If the date is later than our current window, slide later
			newEnd = new Date(date.getTime() + range * padding);
			newStart = new Date(newEnd.getTime() - range);

			// If sliding would go beyond the end, adjust to show the full end of the range
			if (newEnd >= this.range[1]) {
				newEnd = createFromDateDelta(this.range[1], { hours: 12 });
				newStart = new Date(newEnd.getTime() - range);
			}
		} else {
			// If the date is within the current window, no need to slide
			return;
		}

		this._chart.zoom([newStart, newEnd]);
	}

	private selectDataPoint(date: Date, options?: { focus?: boolean; select?: boolean }) {
		const internal = this.getInternalChart();
		if (internal == null) return;

		const d = this.getDataPoint(date);
		if (d == null) return;

		if (options?.focus) {
			internal.showGridFocus([d]);
		}

		const { index } = d;
		if (index == null) return;

		this._chart?.$.main
			.selectAll(`.bb-chart-circles .bb-shape-${index}`)
			.each(() => internal.setExpand?.(index, null, true));

		if (options?.select) {
			const sha = this._commitsByTimestamp.get(date.getTime())?.sha;
			this._shaHovered = undefined;
			this._shaSelected = sha;

			if (sha != null) {
				this.slider?.select(sha);
			}
		}
	}

	private showTooltip(datum: TimelineDatum | undefined) {
		if (datum == null) return;

		this._chart?.tooltip.show({ x: new Date(datum.date) });
	}

	private hideTooltip() {
		this._chart?.tooltip.hide();
	}

	zoom(factor: number): void {
		if (factor === 0) {
			this.resetZoom();
			return;
		}

		if (!this._chart) return;

		const domain = this._chart.zoom() as [Date, Date];
		const timeDomain = [domain[0].getTime(), domain[1].getTime()];

		const range = timeDomain[1] - timeDomain[0];
		const mid = new Date((timeDomain[1] + timeDomain[0]) / 2);

		const start = mid.getTime() - (range * (1 - factor)) / 2;
		const end = mid.getTime() + (range * (1 - factor)) / 2;

		// Don't allow the zoom to go past the set extent
		const dataRange = this.range[1].getTime() - this.range[0].getTime();
		const newRange = end - start;
		if (newRange < dataRange / maxZoomExtent) return;

		const updated = this._chart.zoom([new Date(start), new Date(end)]) as [Date, Date];
		if (factor < 0 && updated[0].getTime() === timeDomain[0] && updated[1].getTime() === timeDomain[1]) {
			this.resetZoom();
		}
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

	private calculateChangeMetrics(dataset: TimelineDatum[]): { q1: number; q3: number; maxChanges: number } {
		const sortedChanges = dataset.map(c => (c.additions ?? 0) + (c.deletions ?? 0)).sort((a, b) => a - b);
		return {
			maxChanges: sortedChanges[sortedChanges.length - 1],
			q1: sortedChanges[Math.floor(sortedChanges.length * 0.25)],
			q3: sortedChanges[Math.floor(sortedChanges.length * 0.75)],
		};
	}

	private getDataPoint(date: string | number | Date): DataItem | undefined {
		const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
		return this._chart
			?.data()[0]
			?.values.find(v => (typeof v.x === 'number' ? v.x : (v.x as unknown as Date).getTime()) === timestamp);
	}

	private getInternalChart(): ChartInternal | undefined {
		try {
			const internal = (this._chart as unknown as ChartWithInternal)?.internal;
			if (this._chart != null && internal == null) {
				debugger;
			}

			return internal;
		} catch {
			debugger;
			return undefined;
		}
	}

	private getOnRenderedCallback(host: GlTimelineChart) {
		return function (this: Chart) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			const chart = this;
			if (chart == null) return;

			chart.$.main.selectAll('.bb-axis-y .tick text tspan').each(function (this, d) {
				if (this == null) return;

				const slice = host._slicesByIndex.get(-(d as { index: number }).index)!;
				const color = chart.color(slice);

				const el = this as SVGTSpanElement;
				if (host.compact) {
					el.setAttribute('fill', color);
				}

				const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
				title.textContent = slice;
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

	@log<GlTimelineChart['prepareChartData']>({ args: { 0: d => d?.length } })
	private prepareChartData(
		dataset: TimelineDatum[],
		metrics: { minRadius: number; maxRadius: number; q1: number; q3: number; maxChanges: number },
	): PreparedChartData {
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

		// Clear previous data
		this._slices.clear();
		this._slicesByIndex.clear();

		let nextIndex = 0;

		const addSlice = (slice: string, date: string, z: number) => {
			let sliceInfo = this._slices.get(slice);
			if (sliceInfo == null) {
				sliceInfo = {
					x: [`time.${slice}`, date],
					y: nextIndex,
					z: new Map([[date, z]]),
				};
				this._slices.set(slice, sliceInfo);
				this._slicesByIndex.set(nextIndex, slice);

				axes[slice] = 'y';
				types[slice] = 'scatter';
				xs[slice] = `time.${slice}`;

				nextIndex--;
			} else {
				sliceInfo.x.push(date);
				sliceInfo.z.set(date, z);
			}
		};

		let index = 0;
		for (const commit of dataset) {
			const { author, date, additions = 0, deletions = 0, branches } = commit;

			this._commitsByTimestamp.set(new Date(date).getTime(), commit);
			index++;

			timeSeries[index] = date;
			additionsSeries[index] = additions;
			deletionsSeries[index] = deletions;

			const z = this.calculateBubbleSize(additions + deletions, metrics);

			if (this.sliceBy === 'branch') {
				// Slice by branches
				const commitBranches = branches?.length ? branches : [this.head ?? 'HEAD'];
				for (const branch of commitBranches) {
					addSlice(branch, date, z);
				}
			} else {
				// Slice by author
				addSlice(author, date, z);
			}
		}

		const columns = [timeSeries, additionsSeries, deletionsSeries];

		for (const [key, value] of this._slices) {
			columns.push(value.x);

			const y = Array(value.x.length).fill(value.y);
			y[0] = key;
			columns.push(y);
		}

		return { axes: axes, columns: columns, names: names, types: types, xs: xs };
	}

	@log({ args: false })
	private async renderChart(
		dataPromise: NonNullable<State['dataset']>,
		loading: ReturnType<typeof defer<void>>,
		signal: AbortSignal,
	): Promise<void> {
		const data = await dataPromise;

		if (signal.aborted) {
			loading?.cancel();
			return;
		}

		// Clear previous state
		this._slices.clear();
		this._slicesByIndex.clear();
		this._commitsByTimestamp.clear();

		// Calculate quartiles for better distribution
		const metrics = {
			minRadius: 6,
			maxRadius: 50,
			...this.calculateChangeMetrics(data),
		};

		const { bb, bar, scatter, selection, zoom } = await import(
			/* webpackChunkName: "lib-billboard" */ 'billboard.js'
		);
		if (signal.aborted) {
			loading?.cancel();
			return;
		}

		this.range = data.length
			? [new Date(data[data.length - 1].date), new Date(data[0].date)]
			: [new Date(), new Date()];

		// Initialize plugins
		bar();
		scatter();

		const chartData = this.prepareChartData(data, metrics);

		try {
			const minY = -(this._slices.size + 1); // The +1 is to leave space at the bottom of the chart for the additions/deletions bars
			const yTickValues = [...this._slicesByIndex.keys()];

			if (this._chart == null) {
				const options: ChartOptions = {
					bindto: this.chartContainer,

					onafterinit: () => {
						this.updateChartSize();
						setTimeout(() => loading?.fulfill(), 0);
					},
					onrendered: this.getOnRenderedCallback(this),

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
						onover: this.onDataPointHovered,
						onout: this.onDataPointUnhovered,
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
								format: (y: number) => {
									if (this.compact) {
										return this.sliceBy === 'branch'
											? '\u{EA68}' /* git-branch codicon */
											: '\u{EB99}' /* account codicon */;
									}
									return truncateMiddle(this._slicesByIndex.get(y) ?? '', 30);
								},
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
							tile: { type: 'circle', r: 5 },
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
								this._slices.get(d.id)?.z.get((d.x as unknown as Date).toISOString()) ?? 6,
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
							const commit = this._commitsByTimestamp.get(date.getTime());
							if (commit == null) return '';

							if (commit.sha === '') {
								return /*html*/ `<div class="bb-tooltip">
									<section class="author">Working Tree</section>
									<section class="message"><span class="message__content">No uncommitted changes</span></section>
								</div>`;
							}

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

							const branchesSection = commit.branches?.length
								? /*html*/ `<section class="branches"><code-icon icon="git-branch"></code-icon> ${commit.branches.join(
										', ',
									)}</section>`
								: '';

							return /*html*/ `<div class="bb-tooltip">
									<section class="author">${commit.author}</section>
									<section>
										<span class="sha"><code-icon icon="git-commit"></code-icon> ${shortenRevision(commit.sha)}</span>
										<span class="changes">${additionsLabel}${deletionsLabel}</span>
									</section>
									<section class="date">
										<code-icon icon="history"></code-icon><span class="date--relative">${capitalize(
											fromNow(date),
										)}</span><span class="date--absolute">(${formatDate(
											date,
											this.dateFormat,
										)})</span>
									</section>
									${branchesSection}
									<section class="message"><span class="message__content">${commit.message}</span></section>
								</div>`;
						},
						show: true,
					},
					zoom: {
						enabled: zoom(),
						type: 'wheel',
						extent: [1, maxZoomExtent],
						onzoom: this.onZoom,
						onzoomend: this.onZoom,
					},
				};

				this._chart = bb.generate(options);

				const commit = data[0];
				this._shaHovered = undefined;
				this._shaSelected = commit?.sha;

				if (commit != null) {
					this.selectDataPoint(new Date(commit.date), { select: true });
				}
			} else {
				this._chart.config('axis.y.tick.values', yTickValues, false);
				this._chart.config('axis.y.min', minY, false);

				this._chart.load({
					...chartData,
					resizeAfter: true,
					unload: true,
					done: () => {
						let commit;
						if (this._shaSelected != null) {
							commit = data.find(c => c.sha === this._shaSelected);
						}
						if (commit == null) {
							commit = data[0];
							this._shaHovered = undefined;
							this._shaSelected = commit?.sha;
						}

						if (commit != null) {
							this.selectDataPoint(new Date(commit.date), { select: true });
						}

						setTimeout(() => loading?.fulfill(), 0);
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

	private updateChartSize(rect?: DOMRect) {
		rect ??= this.chartContainer.getBoundingClientRect();

		// Only resize if we have valid dimensions
		if (rect.width > 0 && rect.height > 0) {
			requestAnimationFrame(() => {
				this._chart!.resize({
					width: rect.width,
					height: rect.height,
				});

				this.updateScrollerTrackPosition();
			});
		}
	}

	private updateScrollerTrackPosition() {
		const xAxis = this.shadowRoot?.querySelector('.bb-axis.bb-axis-x');
		if (xAxis == null) return;

		const xAxisRect = xAxis.getBoundingClientRect();
		const containerRect = this.chartContainer.getBoundingClientRect();

		this.style.setProperty('--scroller-track-top', `${xAxisRect.top - (containerRect.top - 1)}px`);
		this.style.setProperty('--scroller-track-left', `${xAxisRect.left + 2}px`);
		this.style.setProperty('--scroller-track-width', `${xAxisRect.width - 2}px`);
		// this.style.setProperty('--scroller-track-height', `${rect.height + 2}px`);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-timeline-chart': GlTimelineChart;
	}

	interface GlobalEventHandlersEventMap {
		'gl-commit-select': CustomEvent<CommitEventDetail>;
		'gl-loading': CustomEvent<Promise<void>>;
	}
}

export interface CommitEventDetail {
	id: string | undefined;
	shift: boolean;
}

interface PreparedChartData {
	axes: Data['axes'];
	columns: Data['columns'];
	names: { [key: string]: string };
	types: Data['types'];
	xs: Data['xs'];
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
