import type { RowAdornmentProvider } from '@gitkraken/commit-graph/engine/adornments.js';
import type { Sha } from '@gitkraken/commit-graph/engine/types.js';
import type { TemplateResult } from 'lit';
import type {
	LaneCollapseAdornmentOptions,
	LaneCollapseChipContext,
} from './adornments/laneCollapseAdornmentProvider.js';
import type { ParsedRef, RefPillHooks, RefPillRowMarker } from './adornments/refAdornmentProvider.js';
import type { WipStats, WipStatsAdornmentOptions } from './adornments/wipStatsAdornmentProvider.js';
import type { GraphCommitView, RowRefOrder } from './commit.js';
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

export interface CommitGraphRefsExtension {
	readonly id: 'refs';
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
	readonly id: 'wip-stats';
	createProvider(options: WipStatsAdornmentOptions): RowAdornmentProvider<TemplateResult, WipStats>;
}

export interface CommitGraphLaneCollapseExtension {
	readonly id: 'lane-collapse';
	createProvider(
		options: LaneCollapseAdornmentOptions,
	): RowAdornmentProvider<TemplateResult, LaneCollapseChipContext>;
	branchHintFor(rowBySha: ReadonlyMap<Sha, CommitGraphSourceRow> | undefined, tipSha: Sha): string | undefined;
}

export interface CommitGraphStickyTimelineExtension {
	readonly id: 'sticky-timeline';
	readonly createController: CommitGraphStickyTimelineControllerFactory;
	readonly groupKey: (dateMs: number, nowMs: number) => number;
}

export interface CommitGraphScrollMarkersExtension {
	readonly id: 'scroll-markers';
	readonly createController: CommitGraphScrollMarkersControllerFactory;
}

export type CommitGraphExtension =
	| CommitGraphRefsExtension
	| CommitGraphWipStatsExtension
	| CommitGraphLaneCollapseExtension
	| CommitGraphStickyTimelineExtension
	| CommitGraphScrollMarkersExtension;

export interface CommitGraphProfileDefinition {
	readonly rowAdapter?: CommitGraphRowAdapter;
	readonly extensions?: readonly CommitGraphExtension[];
	/** Optional attribute used by the host's native context-menu protocol. */
	readonly hostContextAttribute?: string;
	readonly renderRefFinder?: GraphRefFinderRenderer;
	readonly resolveWipRowContext?: GraphWipRowContextResolver;
}

export interface PreparedCommitGraphRuntime {
	readonly rowAdapter: CommitGraphRowAdapter;
	readonly hostContextAttribute?: string;
	readonly refs?: CommitGraphRefsExtension;
	readonly wipStats?: CommitGraphWipStatsExtension;
	readonly laneCollapse?: CommitGraphLaneCollapseExtension;
	readonly stickyTimeline?: CommitGraphStickyTimelineExtension;
	readonly scrollMarkers?: CommitGraphScrollMarkersExtension;
	readonly renderRefFinder?: GraphRefFinderRenderer;
	readonly resolveWipRowContext?: GraphWipRowContextResolver;
}

/** Captures a profile without importing or discovering any extensions. */
export function defineCommitGraphProfile<const TProfile extends CommitGraphProfileDefinition>(
	profile: TProfile,
): Readonly<TProfile> {
	return Object.freeze({ ...profile, extensions: Object.freeze([...(profile.extensions ?? [])]) });
}

/**
 * Resolves extension slots once, before mount. The surface subsequently reads direct immutable fields;
 * there are no feature maps, discovery scans, or dependency-injection calls on row/scroll paths.
 */
export function prepareCommitGraphRuntime(profile: CommitGraphProfileDefinition): PreparedCommitGraphRuntime {
	let refs: CommitGraphRefsExtension | undefined;
	let wipStats: CommitGraphWipStatsExtension | undefined;
	let laneCollapse: CommitGraphLaneCollapseExtension | undefined;
	let stickyTimeline: CommitGraphStickyTimelineExtension | undefined;
	let scrollMarkers: CommitGraphScrollMarkersExtension | undefined;

	for (const extension of profile.extensions ?? []) {
		switch (extension.id) {
			case 'refs':
				if (refs != null) throw new Error("Duplicate commit graph extension slot 'refs'");

				refs = extension;
				break;
			case 'wip-stats':
				if (wipStats != null) throw new Error("Duplicate commit graph extension slot 'wip-stats'");

				wipStats = extension;
				break;
			case 'lane-collapse':
				if (laneCollapse != null) throw new Error("Duplicate commit graph extension slot 'lane-collapse'");

				laneCollapse = extension;
				break;
			case 'sticky-timeline':
				if (stickyTimeline != null) throw new Error("Duplicate commit graph extension slot 'sticky-timeline'");

				stickyTimeline = extension;
				break;
			case 'scroll-markers':
				if (scrollMarkers != null) throw new Error("Duplicate commit graph extension slot 'scroll-markers'");

				scrollMarkers = extension;
				break;
		}
	}

	if (profile.renderRefFinder != null && refs == null) {
		throw new Error("The commit graph ref finder requires the 'refs' extension");
	}

	return Object.freeze({
		rowAdapter: profile.rowAdapter ?? defaultCommitGraphRowAdapter,
		hostContextAttribute: profile.hostContextAttribute,
		refs: refs,
		wipStats: wipStats,
		laneCollapse: laneCollapse,
		stickyTimeline: stickyTimeline,
		scrollMarkers: scrollMarkers,
		renderRefFinder: profile.renderRefFinder,
		resolveWipRowContext: profile.resolveWipRowContext,
	});
}

// Keep the built-in surface default as a literal. In full-profile consumers this lets bundlers discard
// profile validation entirely; paying the composition cost in every graph bundle would defeat static opt-in.
export const minimalCommitGraphRuntime: PreparedCommitGraphRuntime = Object.freeze({
	rowAdapter: defaultCommitGraphRowAdapter,
});
