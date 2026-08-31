import type { CommitGraphRowAdapter } from '@gitkraken/commit-graph-ui/contracts/rows.js';
import { laneCollapseExtension } from '@gitkraken/commit-graph-ui/extensions/laneCollapse.js';
import { refsExtension } from '@gitkraken/commit-graph-ui/extensions/refs.js';
import { scrollMarkersExtension } from '@gitkraken/commit-graph-ui/extensions/scrollMarkers.js';
import { stickyTimelineExtension } from '@gitkraken/commit-graph-ui/extensions/stickyTimeline.js';
import { wipStatsExtension } from '@gitkraken/commit-graph-ui/extensions/wipStats.js';
import type { PreparedCommitGraphRuntime } from '@gitkraken/commit-graph-ui/runtime.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import { renderGitLensGraphRefFinder } from '../components/gl-graph-ref-find.js';
import { serializeWipContext } from '../utils/rowContext.utils.js';
import { toGraphCommit } from './graph-commit.js';

const gitLensRowAdapter: CommitGraphRowAdapter = (row, idLength, repoPath, pinnedRefId) =>
	toGraphCommit(row as GitGraphRow, idLength, repoPath, pinnedRefId);

/** GitLens' explicit build-time composition. External products define a smaller profile of their own. */
export const gitLensGraphRuntime: PreparedCommitGraphRuntime = Object.freeze({
	rowAdapter: gitLensRowAdapter,
	hostContextAttribute: 'data-vscode-context',
	refs: refsExtension,
	wipStats: wipStatsExtension,
	laneCollapse: laneCollapseExtension,
	stickyTimeline: stickyTimelineExtension,
	scrollMarkers: scrollMarkersExtension,
	renderRefFinder: renderGitLensGraphRefFinder,
	resolveWipRowContext: serializeWipContext,
});
