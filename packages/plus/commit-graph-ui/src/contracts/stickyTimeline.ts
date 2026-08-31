import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import type { ReactiveControllerHost, TemplateResult } from 'lit';

/** One-time-bound view of the graph state read by the sticky-timeline controller. */
export type StickyTimelineHost = {
	stickyTimelineEnabled(): boolean;
	nowMs(): number;
	displayRows(): readonly ProcessedGraphRow[];
	rowHeight(): number;
	rowIndexAt(scrollTop: number): number;
	indexBySha(): ReadonlyMap<string, number>;
	liveScrollTop(): number | undefined;
	lastScrollTop(): number;
	selectedShas(): ReadonlySet<string>;
	focusIndex(): number;
	pointerRowSha(): string | undefined;
	hasPersistentActions(row: ProcessedGraphRow): boolean;
};

/** Direct controller slot used by the surface after one-time profile preparation. */
export type CommitGraphStickyTimelineController = {
	readonly hasBucket: boolean;
	clear(): void;
	dispose(): void;
	update(topMs: number): void;
	updateFromScrollTop(scrollTop: number): void;
	recompute(): void;
	markScrolling(): void;
	updateYield(scrollTop?: number): void;
	render(): TemplateResult | null;
};

export type CommitGraphStickyTimelineControllerFactory = (
	controllerHost: ReactiveControllerHost,
	host: StickyTimelineHost,
) => CommitGraphStickyTimelineController;
