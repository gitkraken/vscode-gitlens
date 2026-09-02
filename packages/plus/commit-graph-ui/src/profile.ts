import type { RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import type { Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { TemplateResult } from 'lit';
import type { GraphWipRowContextResolver } from './contracts/contributions.js';
import type { GraphRefFinderRenderer } from './contracts/refFinder.js';
import type { CommitGraphRowAdapter, CommitGraphSourceRow } from './contracts/rows.js';
import { defaultCommitGraphRowAdapter } from './contracts/rows.js';
import type { CommitGraphScrollMarkersControllerFactory } from './contracts/scrollMarkers.js';
import type {
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
	IssueMetadata,
	PullRequestMetadata,
} from './contracts/state.js';
import type { CommitGraphStickyTimelineControllerFactory } from './contracts/stickyTimeline.js';
import type {
	LaneCollapseAdornmentOptions,
	LaneCollapseChipContext,
} from './extensions/laneCollapse/adornmentProvider.js';
import type { ParsedRef, RefPillHooks, RefPillRowMarker } from './extensions/refs/adornmentProvider.js';
import type { WipStats, WipStatsAdornmentOptions } from './extensions/wipStats/adornmentProvider.js';
import type { GraphCommitView, RowRefOrder } from './rows/commit.js';

export interface CommitGraphRefsExtension {
	createProvider(
		getRefOrder: (() => RowRefOrder | undefined) | undefined,
		hooks: RefPillHooks | undefined,
		getExcludeState:
			| (() =>
					| {
							excludeTypes?: GraphExcludeTypes;
							excludeRefs?: GraphExcludeRefs;
							downstreams?: GraphDownstreams;
					  }
					| undefined)
			| undefined,
		getCommit: (sha: Sha) => GraphCommitView | undefined,
	): RowAdornmentProvider<TemplateResult, ParsedRef[]>;
	toParsedRefs(refs: readonly GraphCommitView['commitRefs'][number][], order?: RowRefOrder): ParsedRef[];
	renderPill(
		parsed: ParsedRef[],
		color: string,
		fromSha?: Sha,
		hooks?: RefPillHooks,
		rowMarker?: RefPillRowMarker,
		cap?: number,
	): TemplateResult;
	renderPullRequestTooltip(pullRequest: PullRequestMetadata): TemplateResult;
	renderIssueTooltip(issue: IssueMetadata): TemplateResult;
}

export interface CommitGraphWipStatsExtension {
	createProvider(options: WipStatsAdornmentOptions): RowAdornmentProvider<TemplateResult, WipStats>;
}

export interface CommitGraphLaneCollapseExtension {
	createProvider(
		options: LaneCollapseAdornmentOptions,
	): RowAdornmentProvider<TemplateResult, LaneCollapseChipContext>;
	branchHintFor(rowBySha: ReadonlyMap<Sha, CommitGraphSourceRow> | undefined, tipSha: Sha): string | undefined;
}

export interface CommitGraphStickyTimelineExtension {
	readonly createController: CommitGraphStickyTimelineControllerFactory;
	readonly groupKey: (dateMs: number, nowMs: number) => number;
}

export interface CommitGraphScrollMarkersExtension {
	readonly createController: CommitGraphScrollMarkersControllerFactory;
}

/**
 * Hosts build this as a frozen object literal (see `minimalCommitGraphProfile`) — there is no builder
 * or discovery step. Each optional slot is a static opt-in: an unset slot is `undefined` at the import
 * site, so bundlers drop the extension module it would have pulled in. `renderRefFinder` needs `refs`
 * (the surface won't render or reserve space for a finder without a `refs` extension).
 */
export interface CommitGraphProfile {
	readonly rowAdapter: CommitGraphRowAdapter;
	readonly refs?: CommitGraphRefsExtension;
	readonly wipStats?: CommitGraphWipStatsExtension;
	readonly laneCollapse?: CommitGraphLaneCollapseExtension;
	readonly stickyTimeline?: CommitGraphStickyTimelineExtension;
	readonly scrollMarkers?: CommitGraphScrollMarkersExtension;
	readonly renderRefFinder?: GraphRefFinderRenderer;
	readonly resolveWipRowContext?: GraphWipRowContextResolver;
}

// Keep the built-in surface default as a literal. In full-profile consumers this lets bundlers discard
// profile validation entirely; paying the composition cost in every graph bundle would defeat static opt-in.
export const minimalCommitGraphProfile: CommitGraphProfile = Object.freeze({
	rowAdapter: defaultCommitGraphRowAdapter,
});
