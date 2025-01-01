import type { GraphRow } from '@gitkraken/gitkraken-components';
import { html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type {
	GraphDownstreams,
	GraphMinimapMarkerTypes,
	GraphRefsMetadata,
	GraphRowStats,
	GraphSearchResults,
	GraphSearchResultsError,
} from '../../../../plus/graph/protocol';
import { GlElement, observe } from '../../../shared/components/element';
import type {
	GlGraphMinimap,
	GraphMinimapMarker,
	GraphMinimapSearchResultMarker,
	GraphMinimapStats,
	StashMarker,
} from './minimap';
import './minimap';

@customElement('gl-graph-minimap-container')
export class GlGraphMinimapContainer extends GlElement {
	@property({ type: Number })
	activeDay: number | undefined;

	@property({ type: Boolean })
	disabled = false;

	@observe('disabled')
	private onDisabledChanged() {
		if (!this.disabled) {
			if (this.pendingDataChange) {
				this.processRows();
			}

			if (this.pendingSearchResultsChange) {
				this.processSearchResults();
			}
		}
	}

	@property({ type: String })
	dataType: 'commits' | 'lines' = 'commits';

	@property({ type: Object })
	downstreams?: GraphDownstreams;

	@property({ type: Array })
	markerTypes: GraphMinimapMarkerTypes[] = [];

	@property({ type: Object })
	refMetadata?: GraphRefsMetadata | null;

	@property({ type: Array })
	rows: GraphRow[] = [];

	@property({ type: Object })
	rowsStats?: Record<string, GraphRowStats>;

	@property({ type: Object })
	searchResults?: GraphSearchResults | GraphSearchResultsError;

	@property({ type: Object })
	visibleDays: { top: number; bottom: number } | undefined;

	@state()
	private markersByDay = new Map<number, GraphMinimapMarker[]>();

	@state()
	private searchResultsByDay = new Map<number, GraphMinimapSearchResultMarker>();

	@state()
	private statsByDay = new Map<number, GraphMinimapStats>();

	private pendingDataChange = false;

	@observe(['dataType', 'downstreams', 'markerTypes', 'refMetadata', 'rows', 'rowsStats'])
	private handleDataChanged(changedKeys: PropertyKey[]) {
		// If only the rowsStats changed, and we're not in lines mode, we don't need to reprocess the rows
		if (changedKeys.length === 1 && changedKeys[0] === 'rowsStats') {
			if (this.dataType !== 'lines') return;
		}

		this.pendingDataChange = true;
		if (this.disabled) return;

		this.processRows();
	}

	private pendingSearchResultsChange = false;

	@observe(['markerTypes', 'searchResults'])
	private handleSearchResultsChanged() {
		this.pendingSearchResultsChange = true;
		if (this.disabled) return;

		this.processSearchResults();
	}

	@query('#minimap')
	private minimap: GlGraphMinimap | undefined;

	override render() {
		if (this.disabled) return nothing;

		return html`<gl-graph-minimap
			id="minimap"
			.activeDay=${this.activeDay}
			.data=${this.statsByDay}
			.dataType=${this.dataType}
			.markers=${this.markersByDay}
			.searchResults=${this.searchResultsByDay}
			.visibleDays=${this.visibleDays}
		></gl-graph-minimap>`;
	}

	select(date: number | Date | undefined, trackOnly: boolean = false) {
		if (this.disabled) return;
		this.minimap?.select(date, trackOnly);
	}

	unselect(date?: number | Date, focus: boolean = false) {
		if (this.disabled) return;
		this.minimap?.unselect(date, focus);
	}

	private processRows() {
		this.pendingDataChange = false;

		const statsByDayMap = new Map<number, GraphMinimapStats>();
		const markersByDay = new Map<number, GraphMinimapMarker[]>();

		const showLinesChanged = this.dataType === 'lines';
		if (!this.rows?.length || (showLinesChanged && this.rowsStats == null)) {
			this.statsByDay = statsByDayMap;
			this.markersByDay = markersByDay;

			return;
		}

		// Loops through all the rows and group them by day and aggregate the row.stats

		let rankedShas: {
			head: string | undefined;
			branch: string | undefined;
			remote: string | undefined;
			tag: string | undefined;
		} = {
			head: undefined,
			branch: undefined,
			remote: undefined,
			tag: undefined,
		};

		let day;
		let prevDay;

		let markers;
		let headMarkers: GraphMinimapMarker[];
		let pullRequestMarkers: GraphMinimapMarker[];
		let remoteMarkers: GraphMinimapMarker[];
		let stashMarker: StashMarker | undefined;
		let tagMarkers: GraphMinimapMarker[];
		let row: GraphRow;
		let stat;
		let stats;

		const rows = this.rows ?? [];
		// Iterate in reverse order so that we can track the HEAD upstream properly
		for (let i = rows.length - 1; i >= 0; i--) {
			row = rows[i];
			pullRequestMarkers = [];

			day = getDay(row.date);
			if (day !== prevDay) {
				prevDay = day;
				rankedShas = {
					head: undefined,
					branch: undefined,
					remote: undefined,
					tag: undefined,
				};
			}

			if (
				row.heads?.length &&
				(this.markerTypes.includes('head') ||
					this.markerTypes.includes('localBranches') ||
					this.markerTypes.includes('pullRequests'))
			) {
				rankedShas.branch = row.sha;

				headMarkers = [];

				// eslint-disable-next-line no-loop-func
				row.heads.forEach(h => {
					if (h.isCurrentHead) {
						rankedShas.head = row.sha;
					}

					if (
						this.markerTypes.includes('localBranches') ||
						(this.markerTypes.includes('head') && h.isCurrentHead)
					) {
						headMarkers.push({
							type: 'branch',
							name: h.name,
							current: h.isCurrentHead && this.markerTypes.includes('head'),
						});
					}

					if (
						this.markerTypes.includes('pullRequests') &&
						h.id != null &&
						this.refMetadata?.[h.id]?.pullRequest?.length
					) {
						for (const pr of this.refMetadata?.[h.id]?.pullRequest ?? []) {
							pullRequestMarkers.push({
								type: 'pull-request',
								name: pr.title,
							});
						}
					}
				});

				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, headMarkers);
				} else {
					markers.push(...headMarkers);
				}
			}

			if (
				row.remotes?.length &&
				(this.markerTypes.includes('upstream') ||
					this.markerTypes.includes('remoteBranches') ||
					this.markerTypes.includes('localBranches') ||
					this.markerTypes.includes('pullRequests'))
			) {
				rankedShas.remote = row.sha;

				remoteMarkers = [];

				// eslint-disable-next-line no-loop-func
				row.remotes.forEach(r => {
					let current = false;
					const hasDownstream = this.downstreams?.[`${r.owner}/${r.name}`]?.length;
					if (r.current) {
						rankedShas.remote = row.sha;
						current = true;
					}

					if (
						this.markerTypes.includes('remoteBranches') ||
						(this.markerTypes.includes('upstream') && current) ||
						(this.markerTypes.includes('localBranches') && hasDownstream)
					) {
						remoteMarkers.push({
							type: 'remote',
							name: `${r.owner}/${r.name}`,
							current: current && this.markerTypes.includes('upstream'),
						});
					}

					if (
						this.markerTypes.includes('pullRequests') &&
						r.id != null &&
						this.refMetadata?.[r.id]?.pullRequest?.length
					) {
						for (const pr of this.refMetadata?.[r.id]?.pullRequest ?? []) {
							pullRequestMarkers.push({
								type: 'pull-request',
								name: pr.title,
							});
						}
					}
				});

				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, remoteMarkers);
				} else {
					markers.push(...remoteMarkers);
				}
			}

			if (row.type === 'stash-node' && this.markerTypes.includes('stashes')) {
				stashMarker = { type: 'stash', name: row.message };
				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, [stashMarker]);
				} else {
					markers.push(stashMarker);
				}
			}

			if (row.tags?.length && this.markerTypes.includes('tags')) {
				rankedShas.tag = row.sha;

				tagMarkers = row.tags.map<GraphMinimapMarker>(t => ({
					type: 'tag',
					name: t.name,
				}));

				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, tagMarkers);
				} else {
					markers.push(...tagMarkers);
				}
			}

			markers = markersByDay.get(day);
			if (markers == null) {
				markersByDay.set(day, pullRequestMarkers);
			} else {
				markers.push(...pullRequestMarkers);
			}

			stat = statsByDayMap.get(day);
			if (stat == null) {
				if (showLinesChanged) {
					stats = this.rowsStats?.[row.sha];
					if (stats != null) {
						stat = {
							activity: { additions: stats.additions, deletions: stats.deletions },
							commits: 1,
							files: stats.files,
							sha: row.sha,
						};
						statsByDayMap.set(day, stat);
					}
				} else {
					stat = {
						commits: 1,
						sha: row.sha,
					};
					statsByDayMap.set(day, stat);
				}
			} else {
				stat.commits++;
				stat.sha = rankedShas.head ?? rankedShas.branch ?? rankedShas.remote ?? rankedShas.tag ?? stat.sha;
				if (showLinesChanged) {
					stats = this.rowsStats?.[row.sha];
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

		this.statsByDay = statsByDayMap;
		this.markersByDay = markersByDay;
	}

	private processSearchResults() {
		this.pendingSearchResultsChange = false;

		const searchResultsByDay = new Map<number, GraphMinimapSearchResultMarker>();

		if (this.searchResults != null && 'error' in this.searchResults) {
			this.searchResultsByDay = searchResultsByDay;

			return;
		}

		if (this.searchResults?.ids != null) {
			let day;
			let sha;
			let r;
			let result;
			for ([sha, r] of Object.entries(this.searchResults.ids)) {
				day = getDay(r.date);

				result = searchResultsByDay.get(day);
				if (result == null) {
					searchResultsByDay.set(day, { type: 'search-result', sha: sha, count: 1 });
				} else {
					result.count++;
				}
			}
		}

		this.searchResultsByDay = searchResultsByDay;
	}
}

function getDay(date: number | Date): number {
	return new Date(date).setHours(0, 0, 0, 0);
}
