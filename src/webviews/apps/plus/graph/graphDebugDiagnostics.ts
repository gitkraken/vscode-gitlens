import type { CommitGraphSessionTransition } from '@gitkraken/commit-graph/engine/session.js';
import type { LaneSegment, ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';

export type GraphDebugDetail = Readonly<Record<string, unknown>>;

export type GraphDebugRecord = {
	kind: 'mark' | 'measure' | 'longtask';
	name: string;
	startTime: number;
	duration: number;
	detail?: unknown;
};

export type GraphDebugApi = {
	records(): readonly GraphDebugRecord[];
	snapshot(): unknown;
	clear(): void;
};

export type GraphDebugSnapshotInput = {
	repoPath?: string;
	sourceRows: number;
	transition: CommitGraphSessionTransition;
	rows: readonly ProcessedGraphRow[];
	segments: readonly LaneSegment[];
	displayRows: readonly ProcessedGraphRow[];
	collapsed: ReadonlySet<string>;
	maxColumn: number;
	scoped: boolean;
	selected: ReadonlySet<string>;
	focusSha?: string;
	viewport: {
		topSha?: string;
		topIndex: number;
		scrollTop: number;
	};
};

declare global {
	interface Window {
		/**
		 * Development-build-only Commit Graph diagnostics. The production build replaces `DEBUG` with
		 * `false`, removes every caller, and tree-shakes this side-effect-free module.
		 */
		__gitlensGraphDebug?: GraphDebugApi;
	}
}

type StoredGraphDebugRecord = GraphDebugRecord & {
	performanceName?: string;
};

const graphDebugPrefix = 'gitlens.graph.';
const maxRecords = 500;

class GraphDebugDiagnostics {
	private _activeRowsMark?: string;
	private _activeUpdateMark?: string;
	private _connectedMark?: string;
	private _firstRowsMark?: string;
	private _firstRowsMeasured = false;
	private _lastRenderMark?: string;
	private _pageMark?: string;
	private _pageRendered = false;
	private _observer?: PerformanceObserver;
	private _records: StoredGraphDebugRecord[] = [];
	private _rowsMarks = new WeakMap<object, string>();
	private _sequence = 0;
	private _snapshotOwner?: object;
	private _snapshotProvider?: () => unknown;

	constructor() {
		window.__gitlensGraphDebug = {
			records: () => this._records.map(({ performanceName: _, ...record }) => record),
			snapshot: () => this._snapshotProvider?.(),
			clear: () => this.clear(),
		};
	}

	connect(owner: object, snapshotProvider: () => unknown): void {
		this._snapshotOwner = owner;
		this._snapshotProvider = snapshotProvider;
		this._connectedMark = this.mark('connected');
		this.startLongTaskObserver();
	}

	disconnect(owner: object): void {
		if (this._snapshotOwner !== owner) return;

		this._snapshotOwner = undefined;
		this._snapshotProvider = undefined;
		this._observer?.disconnect();
		this._observer = undefined;
		this.resetActiveMeasurements();
	}

	markRowsApplied(rows: object | undefined, detail: GraphDebugDetail): void {
		const mark = this.mark('rows-applied', detail);
		if (rows != null) {
			this._rowsMarks.set(rows, mark);
		}
		if (
			!this._firstRowsMeasured &&
			this._firstRowsMark == null &&
			typeof detail.rows === 'number' &&
			detail.rows > 0
		) {
			this._firstRowsMark = mark;
		}
	}

	transferRowsApplied(sourceRows: object | undefined, renderedRows: object | undefined): void {
		if (sourceRows == null || renderedRows == null) return;

		const mark = this._rowsMarks.get(sourceRows);
		if (mark == null) return;

		this._rowsMarks.delete(sourceRows);
		this._rowsMarks.set(renderedRows, mark);
	}

	markPageRequested(detail: GraphDebugDetail): void {
		if (this._pageMark != null) return;

		this._pageMark = this.mark('page-requested', detail);
		this._pageRendered = false;
	}

	cancelPage(): void {
		this._pageMark = undefined;
		this._pageRendered = false;
	}

	beginUpdate(rows: object | undefined, rowsChanged: boolean, detail: GraphDebugDetail): void {
		this._activeUpdateMark = this.mark('update-start', detail);
		this._activeRowsMark = rowsChanged && rows != null ? this._rowsMarks.get(rows) : undefined;
		if (this._activeRowsMark != null && rows != null) {
			// A rows-plane mark describes one applied array becoming one rendered array. Consume it so
			// unrelated Lit updates that retain the same rows identity cannot measure it again.
			this._rowsMarks.delete(rows);
		}
	}

	measureStage(name: string, startedAt: number, detail?: GraphDebugDetail): void {
		this.measure(name, startedAt, detail);
	}

	endUpdate(detail: GraphDebugDetail): void {
		const updateMark = this._activeUpdateMark;
		const rowsChanged = this._activeRowsMark != null;
		this._activeUpdateMark = undefined;
		if (updateMark != null) {
			this.measure('update-to-render', updateMark, detail);
		}
		if (this._activeRowsMark != null) {
			this.measure('rows-to-render', this._activeRowsMark, detail);
			this._activeRowsMark = undefined;
		}
		if (this._pageMark != null && detail.transition === 'append') {
			this.measure('page-to-render', this._pageMark, detail);
			this._pageRendered = true;
		}
		if (rowsChanged) {
			this._lastRenderMark = this.mark('rendered', detail);
		}
	}

	markVirtualized(detail: GraphDebugDetail): void {
		if (this._lastRenderMark != null) {
			this.measure('render-to-virtualized', this._lastRenderMark, detail);
			this._lastRenderMark = undefined;
		}
		if (this._pageMark != null && this._pageRendered) {
			this.measure('page-to-virtualized', this._pageMark, detail);
			this._pageMark = undefined;
			this._pageRendered = false;
		}
		if (this._firstRowsMark != null) {
			this.measure('first-rows-to-visible', this._firstRowsMark, detail);
			this._firstRowsMark = undefined;
			this._firstRowsMeasured = true;
		}
		if (this._connectedMark != null) {
			this.measure('connected-to-first-visible', this._connectedMark, detail);
			this._connectedMark = undefined;
		}
	}

	beginNavigation(detail: GraphDebugDetail): string {
		return this.mark('navigation-start', detail);
	}

	endNavigation(mark: string, detail: GraphDebugDetail): void {
		const status = detail.status;
		this.measure(
			status === 'selected'
				? 'navigation-to-rendered-selection'
				: status === 'cancelled'
					? 'navigation-to-cancelled'
					: 'navigation-to-not-found',
			mark,
			detail,
		);
	}

	private mark(name: string, detail?: GraphDebugDetail): string {
		const performanceName = this.performanceName(name);
		try {
			const entry = performance.mark(performanceName, { detail: detail });
			this.add({
				kind: 'mark',
				name: name,
				startTime: entry.startTime,
				duration: 0,
				detail: detail,
				performanceName: performanceName,
			});
		} catch {
			// Diagnostics must never become load-bearing for the graph.
		}
		return performanceName;
	}

	private measure(name: string, start: string | number, detail?: GraphDebugDetail): void {
		const performanceName = this.performanceName(name);
		try {
			const entry = performance.measure(performanceName, {
				start: start,
				end: performance.now(),
				detail: detail,
			});
			this.add({
				kind: 'measure',
				name: name,
				startTime: entry.startTime,
				duration: entry.duration,
				detail: detail,
				performanceName: performanceName,
			});
		} catch {
			// A cleared/superseded mark is expected during inspector-driven resets.
		}
	}

	private add(record: StoredGraphDebugRecord): void {
		this._records.push(record);
		if (this._records.length <= maxRecords) return;

		const dropped = this._records.shift();
		if (dropped?.performanceName != null) {
			performance.clearMarks(dropped.performanceName);
			performance.clearMeasures(dropped.performanceName);
		}
	}

	private performanceName(name: string): string {
		return `${graphDebugPrefix}${name}:${++this._sequence}`;
	}

	private startLongTaskObserver(): void {
		if (this._observer != null || typeof PerformanceObserver === 'undefined') return;

		try {
			if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return;

			const observer = new PerformanceObserver(list => {
				for (const entry of list.getEntries()) {
					this.add({
						kind: 'longtask',
						name: 'longtask',
						startTime: entry.startTime,
						duration: entry.duration,
					});
				}
			});
			observer.observe({ entryTypes: ['longtask'] });
			this._observer = observer;
		} catch {
			// Diagnostics must never become load-bearing for the graph, even in partial browser implementations.
			this._observer = undefined;
		}
	}

	private clear(): void {
		for (const record of this._records) {
			if (record.performanceName == null) continue;

			performance.clearMarks(record.performanceName);
			performance.clearMeasures(record.performanceName);
		}
		this._records = [];
		this.resetActiveMeasurements();
	}

	private resetActiveMeasurements(): void {
		this._activeRowsMark = undefined;
		this._activeUpdateMark = undefined;
		this._connectedMark = undefined;
		this._firstRowsMark = undefined;
		this._firstRowsMeasured = false;
		this._lastRenderMark = undefined;
		this._pageMark = undefined;
		this._pageRendered = false;
		this._rowsMarks = new WeakMap();
	}
}

let graphDebugDiagnostics: GraphDebugDiagnostics | undefined;

/**
 * Lazily creates the development diagnostics. Every call site must remain inside a literal
 * `if (DEBUG)` so production dead-code elimination removes both the call and this module.
 */
export function getGraphDebugDiagnostics(): GraphDebugDiagnostics {
	return (graphDebugDiagnostics ??= new GraphDebugDiagnostics());
}

/** Builds the expensive normalized differential snapshot only when the inspector explicitly asks for it. */
export function createGraphDebugSnapshot(input: GraphDebugSnapshotInput): unknown {
	return {
		repoPath: input.repoPath,
		sourceRows: input.sourceRows,
		engine: {
			transition: input.transition,
			rows: input.rows.map(row => ({
				sha: row.sha,
				parents: [...row.parents],
				kind: row.kind,
				date: row.date,
				column: row.column,
				edgeColumnMax: row.edgeColumnMax,
				edges: Object.entries(row.edges)
					.map(([column, edge]) => ({
						column: Number(column),
						starting: edge.starting,
						passThrough: edge.passThrough,
						ending: edge.ending,
					}))
					.sort((a, b) => a.column - b.column),
			})),
			segments: input.segments.map(segment => ({
				id: segment.id,
				tipSha: segment.tipSha,
				forkSha: segment.forkSha,
				mergeSha: segment.mergeSha,
				column: segment.column,
				commitShas: [...segment.commitShas],
			})),
		},
		projection: {
			rows: input.displayRows.map(row => row.sha),
			collapsed: [...input.collapsed].sort(),
			maxColumn: input.maxColumn,
			scoped: input.scoped,
		},
		selection: [...input.selected].sort(),
		focusSha: input.focusSha,
		viewport: input.viewport,
	};
}
