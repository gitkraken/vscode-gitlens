import type { GraphRow } from '@gitkraken/gitkraken-components';
import { css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type {
	GraphDownstreams,
	GraphMinimapMarkerTypes,
	GraphRefsMetadata,
	GraphRowStats,
	GraphSearchResults,
	GraphSearchResultsError,
} from '../../../../plus/graph/protocol.js';
import { GlElement, observe } from '../../../shared/components/element.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/checkbox/checkbox.js';
import '../../../shared/components/menu/menu-divider.js';
import '../../../shared/components/menu/menu-item.js';
import '../../../shared/components/menu/menu-label.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/radio/radio.js';
import '../../../shared/components/radio/radio-group.js';
import type {
	GlGraphMinimap,
	GraphMinimapMarker,
	GraphMinimapSearchResultMarker,
	GraphMinimapStats,
	StashMarker,
} from './minimap.js';
import './minimap.js';

export interface GraphMinimapConfigChangeEventDetail {
	minimapDataType?: 'commits' | 'lines';
	markerType?: GraphMinimapMarkerTypes;
	checked?: boolean;
}

@customElement('gl-graph-minimap-container')
export class GlGraphMinimapContainer extends GlElement {
	static override styles = css`
		:host {
			display: block;
			position: relative;
		}

		.minimap-settings-wrapper {
			position: absolute;
			top: 2px;
			right: 2px;
			z-index: 2;
		}

		:host([collapsed]) .minimap-settings-wrapper {
			display: none;
		}

		.minimap-settings__trigger {
			appearance: none;
			background: transparent;
			border: none;
			color: var(--color-foreground--75);
			cursor: pointer;
			padding: 2px;
			border-radius: 3px;
			line-height: 1;
		}

		.minimap-settings__trigger:hover {
			color: var(--color-foreground);
			background-color: var(--color-graph-actionbar-selectedBackground);
		}

		.minimap-marker-swatch {
			display: inline-block;
			width: 1rem;
			height: 1rem;
			border-radius: 2px;
			transform: scale(1.6);
			margin-left: 0.3rem;
			margin-right: 1rem;
		}

		.minimap-marker-swatch[data-marker='localBranches'] {
			background-color: var(--color-graph-minimap-marker-local-branches);
		}

		.minimap-marker-swatch[data-marker='remoteBranches'] {
			background-color: var(--color-graph-minimap-marker-remote-branches);
		}

		.minimap-marker-swatch[data-marker='pullRequests'] {
			background-color: var(--color-graph-minimap-marker-pull-requests);
		}

		.minimap-marker-swatch[data-marker='stashes'] {
			background-color: var(--color-graph-minimap-marker-stashes);
		}

		.minimap-marker-swatch[data-marker='tags'] {
			background-color: var(--color-graph-minimap-marker-tags);
		}
	`;

	@property({ type: Number })
	activeDay: number | undefined;

	@property({ type: Boolean })
	disabled = false;

	@property({ type: Boolean, reflect: true })
	collapsed = false;

	@observe('disabled')
	private onDisabledChanged() {
		this.flushPendingWork();
	}

	@observe('collapsed')
	private onCollapsedChanged() {
		this.flushPendingWork();
	}

	private flushPendingWork() {
		if (this.disabled || this.collapsed) return;

		if (this.pendingDataChange) {
			this.processRows();
		}

		if (this.pendingSearchResultsChange) {
			this.processSearchResults();
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
		if (this.disabled || this.collapsed) return;

		this.processRows();
	}

	private pendingSearchResultsChange = false;

	@observe(['markerTypes', 'searchResults'])
	private handleSearchResultsChanged() {
		this.pendingSearchResultsChange = true;
		if (this.disabled || this.collapsed) return;

		this.processSearchResults();
	}

	@query('#minimap')
	private minimap: GlGraphMinimap | undefined;

	override render(): unknown {
		if (this.disabled) return nothing;

		return html`<gl-graph-minimap
				id="minimap"
				.activeDay=${this.activeDay}
				.data=${this.statsByDay}
				.dataType=${this.dataType}
				.markers=${this.markersByDay}
				.searchResults=${this.searchResultsByDay}
				.visibleDays=${this.visibleDays}
			></gl-graph-minimap>
			<div class="minimap-settings-wrapper">
				<gl-popover placement="bottom-end" trigger="hover focus click" ?arrow=${false} distance=${0} hoist>
					<button type="button" class="minimap-settings__trigger" aria-label="Minimap Options" slot="anchor">
						<code-icon
							icon=${this.dataType === 'lines' ? 'request-changes' : 'git-commit'}
							size="16"
						></code-icon>
					</button>
					<div slot="content">
						<menu-label>Minimap</menu-label>
						<menu-item role="none">
							<gl-radio-group value=${this.dataType} @gl-change-value=${this.handleDataTypeChanged}>
								<gl-radio name="minimap-datatype" value="commits">Commits</gl-radio>
								<gl-radio name="minimap-datatype" value="lines">Lines Changed</gl-radio>
							</gl-radio-group>
						</menu-item>
						<menu-divider></menu-divider>
						<menu-label>Markers</menu-label>
						<menu-item role="none">
							<gl-checkbox
								value="localBranches"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('localBranches')}
							>
								<span class="minimap-marker-swatch" data-marker="localBranches"></span>
								Local Branches
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="remoteBranches"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('remoteBranches')}
							>
								<span class="minimap-marker-swatch" data-marker="remoteBranches"></span>
								Remote Branches
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="pullRequests"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('pullRequests')}
							>
								<span class="minimap-marker-swatch" data-marker="pullRequests"></span>
								Pull Requests
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="stashes"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('stashes')}
							>
								<span class="minimap-marker-swatch" data-marker="stashes"></span>
								Stashes
							</gl-checkbox>
						</menu-item>
						<menu-item role="none">
							<gl-checkbox
								value="tags"
								@gl-change-value=${this.handleMarkerTypeChanged}
								?checked=${this.markerTypes.includes('tags')}
							>
								<span class="minimap-marker-swatch" data-marker="tags"></span>
								Tags
							</gl-checkbox>
						</menu-item>
					</div>
				</gl-popover>
			</div>`;
	}

	private handleDataTypeChanged(e: Event) {
		const el = e.target as HTMLElement & { value: string };
		const minimapDataType = el.value === 'lines' ? 'lines' : 'commits';
		if (this.dataType === minimapDataType) return;

		this.dispatchEvent(
			new CustomEvent<GraphMinimapConfigChangeEventDetail>('gl-graph-minimap-config-change', {
				detail: { minimapDataType: minimapDataType },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleMarkerTypeChanged(e: Event) {
		const el = e.target as HTMLInputElement;
		const markerType = el.value as GraphMinimapMarkerTypes;

		this.dispatchEvent(
			new CustomEvent<GraphMinimapConfigChangeEventDetail>('gl-graph-minimap-config-change', {
				detail: { markerType: markerType, checked: el.checked },
				bubbles: true,
				composed: true,
			}),
		);
	}

	select(date: number | Date | undefined, trackOnly: boolean = false): void {
		if (this.disabled || this.collapsed) return;
		this.minimap?.select(date, trackOnly);
	}

	unselect(date?: number | Date, focus: boolean = false): void {
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
