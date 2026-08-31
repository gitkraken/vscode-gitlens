import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { ReactiveControllerHost, TemplateResult } from 'lit';
import type { GraphCommitView } from '../commit.js';
import type { WipRowInfo } from '../wip.js';
import type {
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphRefsMetadata,
	GraphScrollMarkerTypes,
	GraphSearchMode,
} from './state.js';

/** One-time-bound view of graph state and host actions used by the scroll-marker rail. */
export type ScrollMarkersHost = {
	markerTypes(): readonly GraphScrollMarkerTypes[] | undefined;
	displayRows(): readonly ProcessedGraphRow[];
	getCommit(sha: Sha): GraphCommitView | undefined;
	searchMode(): GraphSearchMode | undefined;
	searchMatchedShas(): ReadonlySet<string> | undefined;
	excludeTypes(): GraphExcludeTypes | undefined;
	excludeRefs(): GraphExcludeRefs | undefined;
	downstreams(): GraphDownstreams | undefined;
	refsMetadata(): GraphRefsMetadata | null | undefined;
	repoPath(): string | undefined;
	wipRowInfoByRowSha(): ReadonlyMap<string, WipRowInfo> | undefined;
	selectedShas(): ReadonlySet<string> | undefined;
	indexBySha(): ReadonlyMap<string, number>;
	mergeTargetShas(): ReadonlySet<string> | undefined;
	mergeTargetName(): string | undefined;
	pinnedSha(): Sha | undefined;
	pinnedName(): string | undefined;
	totalRows(): number;
	rowHeight(): number;
	dataUnitOf(index: number): number;
	unitPositionOf(index: number): number;
	viewportHeight(): number;
	scroller(): HTMLElement | undefined;
	hostContextAttribute(): string | undefined;
	context(): string | undefined;
	isDraggingColumn(): boolean;
	endRowHover(container: HTMLElement): void;
	revealPosition(index: number): void;
	jumpToRow(sha: Sha): void;
};

export type CommitGraphScrollMarkersController = {
	dispose(): void;
	recompute(patchOnly?: boolean): void;
	render(): TemplateResult | null;
};

export type CommitGraphScrollMarkersControllerFactory = (
	controllerHost: ReactiveControllerHost,
	host: ScrollMarkersHost,
) => CommitGraphScrollMarkersController;
