import type { GraphRow } from '@gitkraken/gitkraken-components';
import type {
	GraphDownstreams,
	GraphMinimapMarkerTypes,
	GraphRefsMetadata,
	GraphRowStats,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphWipMetadataBySha,
} from '../../../../plus/graph/protocol.js';
import type {
	GraphMinimapMarker,
	GraphMinimapSearchResultMarker,
	GraphMinimapStats,
	StashMarker,
	WorktreeMarker,
} from './minimap.js';

export interface MinimapAggregateInput {
	readonly rows: readonly GraphRow[];
	readonly rowsStats: Record<string, GraphRowStats> | undefined;
	readonly refMetadata: GraphRefsMetadata | null | undefined;
	readonly downstreams: GraphDownstreams | undefined;
	readonly markerTypes: readonly GraphMinimapMarkerTypes[];
	readonly dataType: 'commits' | 'lines';
	readonly wipMetadataBySha: GraphWipMetadataBySha | undefined;
}

export interface MinimapAggregate {
	statsByDay: Map<number, GraphMinimapStats>;
	markersByDay: Map<number, GraphMinimapMarker[]>;
}

export function getDay(date: number | Date): number {
	return new Date(date).setHours(0, 0, 0, 0);
}

export function aggregate(input: MinimapAggregateInput): MinimapAggregate {
	const { rows, rowsStats, refMetadata, downstreams, markerTypes, dataType, wipMetadataBySha } = input;
	const showLinesChanged = dataType === 'lines';
	if (!rows.length || (showLinesChanged && rowsStats == null)) {
		return { statsByDay: new Map(), markersByDay: new Map() };
	}

	const wantsHeads =
		markerTypes.includes('head') || markerTypes.includes('localBranches') || markerTypes.includes('pullRequests');
	const wantsRemotes =
		markerTypes.includes('upstream') ||
		markerTypes.includes('remoteBranches') ||
		markerTypes.includes('localBranches') ||
		markerTypes.includes('pullRequests');
	const wantsTags = markerTypes.includes('tags');
	const wantsStashes = markerTypes.includes('stashes');
	const wantsPullRequests = markerTypes.includes('pullRequests');
	const wantsLocalBranches = markerTypes.includes('localBranches');
	const wantsHeadOnly = markerTypes.includes('head');
	const wantsRemoteBranches = markerTypes.includes('remoteBranches');
	const wantsUpstream = markerTypes.includes('upstream');

	const statsByDay = new Map<number, GraphMinimapStats>();
	const markersByDay = new Map<number, GraphMinimapMarker[]>();

	// Group worktree HEADs by their parent commit SHA up front, so the row scan can emit a worktree
	// marker into `markersByDay` whenever it visits one of those commits — no separate post-pass.
	// Skipped entirely (no Map allocated) when the toggle is off or there are no non-current worktrees.
	const wantsWorktrees = markerTypes.includes('worktree') && wipMetadataBySha != null;
	let worktreesByParentSha: Map<string, WorktreeMarker[]> | undefined;
	if (wantsWorktrees) {
		for (const meta of Object.values(wipMetadataBySha)) {
			const marker: WorktreeMarker = { type: 'worktree', name: meta.label };
			worktreesByParentSha ??= new Map();
			const existing = worktreesByParentSha.get(meta.parentSha);
			if (existing == null) {
				worktreesByParentSha.set(meta.parentSha, [marker]);
			} else {
				existing.push(marker);
			}
		}
	}

	let rankedHead: string | undefined;
	let rankedBranch: string | undefined;
	let rankedRemote: string | undefined;
	let rankedTag: string | undefined;
	let prevDay: number | undefined;

	for (let i = rows.length - 1; i >= 0; i--) {
		const row = rows[i];
		// WIP rows represent the working tree, not commits. Their `date` is `Date.now()` (set in
		// `graph-wrapper.ts`), so bucketing them would bump today's commit count and let `stat.sha`
		// resolve to a non-commit SHA (`'work-dir-changes'` / `'worktree-wip::…'`) on click.
		if (row.type === 'work-dir-changes') continue;
		const day = getDay(row.date);
		if (day !== prevDay) {
			prevDay = day;
			rankedHead = undefined;
			rankedBranch = undefined;
			rankedRemote = undefined;
			rankedTag = undefined;
		}

		const worktreeMarkers = worktreesByParentSha?.get(row.sha);
		if (worktreeMarkers != null) {
			appendMarkers(markersByDay, day, worktreeMarkers);
		}

		const pullRequestMarkers: GraphMinimapMarker[] = [];

		if (wantsHeads && row.heads?.length) {
			rankedBranch = row.sha;

			const headMarkers: GraphMinimapMarker[] = [];
			for (const h of row.heads) {
				if (h.isCurrentHead) {
					rankedHead = row.sha;
				}

				if (wantsLocalBranches || (wantsHeadOnly && h.isCurrentHead)) {
					headMarkers.push({
						type: 'branch',
						name: h.name,
						current: h.isCurrentHead && wantsHeadOnly,
					});
				}

				if (wantsPullRequests && h.id != null) {
					const prs = refMetadata?.[h.id]?.pullRequest;
					if (prs?.length) {
						for (const pr of prs) {
							pullRequestMarkers.push({ type: 'pull-request', name: pr.title });
						}
					}
				}
			}

			if (headMarkers.length) {
				appendMarkers(markersByDay, day, headMarkers);
			}
		}

		if (wantsRemotes && row.remotes?.length) {
			rankedRemote = row.sha;

			const remoteMarkers: GraphMinimapMarker[] = [];
			for (const r of row.remotes) {
				let current = false;
				const hasDownstream = downstreams?.[`${r.owner}/${r.name}`]?.length;
				if (r.current) {
					rankedRemote = row.sha;
					current = true;
				}

				if (wantsRemoteBranches || (wantsUpstream && current) || (wantsLocalBranches && hasDownstream)) {
					remoteMarkers.push({
						type: 'remote',
						name: `${r.owner}/${r.name}`,
						current: current && wantsUpstream,
					});
				}

				if (wantsPullRequests && r.id != null) {
					const prs = refMetadata?.[r.id]?.pullRequest;
					if (prs?.length) {
						for (const pr of prs) {
							pullRequestMarkers.push({ type: 'pull-request', name: pr.title });
						}
					}
				}
			}

			if (remoteMarkers.length) {
				appendMarkers(markersByDay, day, remoteMarkers);
			}
		}

		if (wantsStashes && row.type === 'stash-node') {
			const stashMarker: StashMarker = { type: 'stash', name: row.message };
			appendMarkers(markersByDay, day, [stashMarker]);
		}

		if (wantsTags && row.tags?.length) {
			rankedTag = row.sha;

			const tagMarkers: GraphMinimapMarker[] = row.tags.map(t => ({ type: 'tag', name: t.name }));
			appendMarkers(markersByDay, day, tagMarkers);
		}

		if (pullRequestMarkers.length) {
			appendMarkers(markersByDay, day, pullRequestMarkers);
		}

		let stat = statsByDay.get(day);
		if (stat == null) {
			if (showLinesChanged) {
				const stats = rowsStats?.[row.sha];
				if (stats != null) {
					stat = {
						activity: { additions: stats.additions, deletions: stats.deletions },
						commits: 1,
						files: stats.files,
						sha: row.sha,
					};
					statsByDay.set(day, stat);
				}
			} else {
				stat = { commits: 1, sha: row.sha };
				statsByDay.set(day, stat);
			}
		} else {
			stat.commits++;
			stat.sha = rankedHead ?? rankedBranch ?? rankedRemote ?? rankedTag ?? stat.sha;
			if (showLinesChanged) {
				const stats = rowsStats?.[row.sha];
				if (stats != null) {
					if (stat.activity == null) {
						stat.activity = { additions: stats.additions, deletions: stats.deletions };
					} else {
						stat.activity.additions += stats.additions;
						stat.activity.deletions += stats.deletions;
					}
					stat.files = (stat.files ?? 0) + stats.files;
				}
			}
		}
	}

	// Worktrees whose parentSha didn't appear in `rows` (out of paging window, hidden branch) are
	// implicitly dropped — `worktreesByParentSha` lookups during the scan simply never match. Mirrors
	// the WIP-row policy in `graph-wrapper.ts`: a floating marker with no anchor is more confusing
	// than a missing one.

	return { statsByDay: statsByDay, markersByDay: markersByDay };
}

export function aggregateSearchResults(
	searchResults: GraphSearchResults | GraphSearchResultsError | undefined,
): Map<number, GraphMinimapSearchResultMarker> {
	const searchResultsByDay = new Map<number, GraphMinimapSearchResultMarker>();
	if (searchResults == null || 'error' in searchResults || searchResults.ids == null) {
		return searchResultsByDay;
	}

	for (const [sha, r] of Object.entries(searchResults.ids)) {
		const day = getDay(r.date);
		const existing = searchResultsByDay.get(day);
		if (existing == null) {
			searchResultsByDay.set(day, { type: 'search-result', sha: sha, count: 1 });
		} else {
			existing.count++;
		}
	}

	return searchResultsByDay;
}

function appendMarkers(
	markersByDay: Map<number, GraphMinimapMarker[]>,
	day: number,
	markers: GraphMinimapMarker[],
): void {
	const existing = markersByDay.get(day);
	if (existing == null) {
		markersByDay.set(day, markers);
		return;
	}
	for (const m of markers) {
		existing.push(m);
	}
}
