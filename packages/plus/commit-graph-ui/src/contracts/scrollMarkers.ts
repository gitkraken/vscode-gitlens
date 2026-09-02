import type { ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { ReactiveControllerHost, TemplateResult } from 'lit';
import type { GraphCommitView } from '../rows/commit.js';
import type { WipRowInfo } from '../rows/wip.js';
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
	context(): string | undefined;
	isDraggingColumn(): boolean;
	endRowHover(container: HTMLElement): void;
	revealPosition(index: number): void;
	jumpToRow(sha: Sha): void;
	/** Closes the surface's shared delegated tooltip — the rail owns a SEPARATE popover, so without
	 *  this the two can co-show (rail hover + a keyboard-focused cell tooltip). */
	hideDelegatedTooltip(): void;
};

export type CommitGraphScrollMarkersController = {
	dispose(): void;
	recompute(patchOnly?: boolean): void;
	render(): TemplateResult | null;
	/** Closes the rail's own popover. The surface hides its delegated tooltip on scroll/navigation and
	 *  on showing one of its own; the rail's popover is a separate element, so it must be told. */
	hideTooltip(): void;
};

export type CommitGraphScrollMarkersControllerFactory = (
	controllerHost: ReactiveControllerHost,
	host: ScrollMarkersHost,
) => CommitGraphScrollMarkersController;
