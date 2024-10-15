import { consume } from '@lit/context';
import { html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { SearchQuery } from '../../../../constants.search';
import type { GraphSearchResults, GraphSearchResultsError, State } from '../../../../plus/webviews/graph/protocol';
import { GlElement } from '../../shared/components/element';
import type { GlSearchBox } from '../../shared/components/search/search-box';
import { graphBaselineStyles, graphWrapperStyles } from './graph.css';
import type { GlGraphHover } from './hover/graphHover';
import type { GlGraphMinimapContainer } from './minimap/minimap-container';
import { stateContext } from './stateProvider';
import { titleBarStyles } from './titlebar/titlebar.css';

import '../../shared/components/code-icon';
import '../../shared/components/progress';
// import './graph-container';

@customElement('gl-graph-wrapper')
export class GlGraphWrapper extends GlElement {
	static override styles = [graphBaselineStyles, titleBarStyles, graphWrapperStyles];

	@consume({ context: stateContext, subscribe: true })
	@state()
	state!: State;

	get repo() {
		return this.state.repositories?.find(r => r.id === this.state.selectedRepository);
	}

	get hasFilters() {
		if (this.state.config?.onlyFollowFirstParent) return true;
		if (this.state.excludeTypes == null) return false;

		return Object.values(this.state.excludeTypes).includes(true);
	}

	@query('gl-graph-minimap-container')
	minimapEl!: GlGraphMinimapContainer;

	@query('gl-graph-hover')
	hoverEl!: GlGraphHover;

	// search state
	@query('gl-search-box')
	searchEl!: GlSearchBox;

	@state()
	private searchQuery: SearchQuery | undefined = undefined;

	@state()
	private searchResultsHidden = false;

	@state()
	private searching = false;

	get searchResultState() {
		let results: GraphSearchResults | undefined;
		let resultsError: GraphSearchResultsError | undefined;
		if (this.state.searchResults != null) {
			if ('error' in this.state.searchResults) {
				resultsError = this.state.searchResults;
			} else {
				results = this.state.searchResults;
			}
		}
		return { results: results, resultsError: resultsError };
	}

	get searchResults() {
		return this.searchResultState.results;
	}

	get searchResultsError() {
		return this.searchResultState.resultsError;
	}

	get searchPosition() {
		if (this.searchResults?.ids == null || !this.searchQuery?.query) return 0;

		const id = getActiveRowInfo(this.state.activeRow)?.id;
		let searchIndex = id ? this.searchResults.ids[id]?.i : undefined;
		if (searchIndex == null) {
			[searchIndex] = getClosestSearchResultIndex(this.searchResults, this.searchQuery, this.state.activeRow);
		}
		return searchIndex < 1 ? 1 : searchIndex + 1;
	}

	override render() {
		return html`
			<section class="graph-wrapper" aria-hidden=${!this.state.allowed}>
				<header class="titlebar">
					<!-- row: search and filter -->
					${this.renderFilterAndSearch()}
					<!-- progress bar -->
					<progress-indicator position="bottom" active></progress-indicator>
				</header>
				<gl-graph-minimap-container
					.activeDay=${this.state.activeDay}
					.disabled=${!this.state.config?.minimap}
					.rows=${this.state.rows ?? []}
					.rowsStats=${this.state.rowsStats}
					.dataType=${this.state.config?.minimapDataType ?? 'commits'}
					.markerTypes=${this.state.config?.minimapMarkerTypes ?? []}
					.refMetadata=${this.state.refsMetadata}
					.searchResults=${this.state.searchResults}
					.visibleDays=${this.state.visibleDays}
					@selected=${this.handleOnMinimapDaySelected}
				></gl-graph-minimap-container>
				<gl-graph-hover id="commit-hover" distance=${0} skidding=${15}></gl-graph-hover>
				<div>
					<!-- sidebar -->
					<gl-graph-sidebar
						?enabled=${this.state.config?.sidebar}
						.include=${this.repo?.isVirtual
							? ['branches', 'remotes', 'tags']
							: ['branches', 'remotes', 'tags', 'stashes', 'worktrees']}
					></gl-graph-sidebar>
					${when(
						this.repo != null,
						() => html` <gl-graph-container></gl-graph-container> `,
						() => html`<p>No repository is selected</p>`,
					)}
				</div>
			</section>
		`;
	}

	private handleOnMinimapDaySelected() {}

	private renderFilterAndSearch() {
		if (!this.state.allowed) return undefined;

		return html`
			<div className="titlebar__row">
				<div className="titlebar__group">
					<gl-tooltip placement="top" content="Branches Visibility">
						<sl-select
							value=${this.state.branchesVisibility}
							@sl-change=${this.handleBranchesVisibility}
							hoist
						>
							<code-icon icon="chevron-down" slot="expand-icon"></code-icon>
							<sl-option value="all" ?disabled=${this.repo?.isVirtual}>All Branches</sl-option>
							<sl-option value="smart" ?disabled=${this.repo?.isVirtual}>
								Smart Branches
								${!this.repo?.isVirtual
									? html`
											<gl-tooltip placement="right" slot="suffix">
												<code-icon icon="info"></code-icon>
												<span slot="content">
													Shows only relevant branches
													<br /><br />
													<i
														>Includes the current branch, its upstream, and its base or
														target branch</i
													>
												</span>
											</gl-tooltip>
									  `
									: html`<code-icon icon="info" slot="suffix"></code-icon>`}
							</sl-option>
							<sl-option value="current">Current Branch</sl-option>
						</sl-select>
					</gl-tooltip>
					<gl-popover class="popover" placement="bottom-start" trigger="focus" ?arrow=${false} distance=${0}>
						<gl-tooltip placement="top" slot="anchor">
							<button type="button" class="action-button">
								<span class=${`codicon codicon-filter${this.hasFilters ? '-filled' : ''}`}></span>
								<span
									class="codicon codicon-chevron-down action-button__more"
									aria-hidden="true"
								></span>
							</button>
							<span slot="content">Graph Filtering</span>
						</gl-tooltip>
						<div slot="content">
							<menu-label>Graph Filters</menu-label>
							${this.repo?.isVirtual !== true
								? html`
										<menu-item role="none">
											<gl-tooltip
												placement="right"
												content="Only follow the first parent of merge commits to provide a more linear history"
											>
												<gl-checkbox
													value="onlyFollowFirstParent"
													@change=${this.handleFilterChange}
													?checked=${this.state.config?.onlyFollowFirstParent ?? false}
												>
													Simplify Merge History
												</gl-checkbox>
											</gl-tooltip>
										</menu-item>
										<menu-divider></menu-divider>
										<menu-item role="none">
											<gl-checkbox
												value="remotes"
												@change=${this.handleFilterChange}
												?checked=${this.state.excludeTypes?.remotes ?? false}
											>
												Hide Remote-only Branches
											</gl-checkbox>
										</menu-item>
										<menu-item role="none">
											<gl-checkbox
												value="stashes"
												@change=${this.handleFilterChange}
												?checked=${this.state.excludeTypes?.stashes ?? false}
											>
												Hide Stashes
											</gl-checkbox>
										</menu-item>
								  `
								: ''}
							<menu-item role="none">
								<gl-checkbox
									value="tags"
									@change=${this.handleFilterChange}
									?checked=${this.state.excludeTypes?.tags ?? false}
								>
									Hide Tags
								</gl-checkbox>
							</menu-item>
							<menu-divider></menu-divider>
							<menu-item role="none">
								<gl-checkbox
									value="mergeCommits"
									@change=${this.handleFilterChange}
									?checked=${this.state.config?.dimMergeCommits ?? false}
								>
									Dim Merge Commit Rows
								</gl-checkbox>
							</menu-item>
						</div>
					</gl-popover>
					<span><span class="action-divider"></span></span>
					<gl-search-box
						label="Search Commits"
						step=${this.searchPosition}
						total=${this.searchResults?.count ?? 0}
						.valid=${this.searchQuery?.query != null && this.searchQuery.query.length > 2}
						.more=${this.searchResults?.paging?.hasMore ?? false}
						.searching=${this.searching}
						value=${this.searchQuery?.query ?? ''}
						errorMessage=${this.searchResultsError?.error ?? ''}
						.resultsHidden=${this.searchResultsHidden}
						.resultsLoaded=${this.searchResults != null}
						@change=${this.handleSearchInput}
						@navigate=${this.handleSearchNavigation}
						@open-in-view=${this.handleSearchOpenInView}
					></gl-search-box>
					<span><span class="action-divider"></span></span>
					<span class="button-group">
						<gl-tooltip placement="bottom">
							<button
								type="button"
								role="checkbox"
								class="action-button"
								aria-label="Toggle Minimap"
								aria-checked=${this.state.config?.minimap ?? false}
								@click=${this.handleOnMinimapToggle}
							>
								<span class="codicon codicon-graph-line action-button__icon"></span>
							</button>
							<span slot="content">Toggle Minimap</span>
						</gl-tooltip>
						<gl-popover
							class="popover"
							placement="bottom-end"
							trigger="focus"
							?arrow=${false}
							distance=${0}
						>
							<gl-tooltip placement="top" distance=${7} slot="anchor">
								<button type="button" class="action-button" aria-label="Minimap Options">
									<span
										class="codicon codicon-chevron-down action-button__more"
										aria-hidden="true"
									></span>
								</button>
								<span slot="content">Minimap Options</span>
							</gl-tooltip>
							<div slot="content">
								<menu-label>Minimap</menu-label>
								<menu-item role="none">
									<gl-radio-group
										value=${this.state.config?.minimapDataType ?? 'commits'}
										@change=${this.handleOnMinimapDataTypeChange}
									>
										<gl-radio name="minimap-datatype" value="commits">Commits</gl-radio>
										<gl-radio name="minimap-datatype" value="lines">Lines Changed</gl-radio>
									</gl-radio-group>
								</menu-item>
								<menu-divider></menu-divider>
								<menu-label>Markers</menu-label>
								<menu-item role="none">
									<gl-checkbox
										value="localBranches"
										@change=${this.handleOnMinimapAdditionalTypesChange}
										?checked=${this.state.config?.minimapMarkerTypes?.includes('localBranches') ??
										false}
									>
										<span class="minimap-marker-swatch" data-marker="localBranches"></span>
										Local Branches
									</gl-checkbox>
								</menu-item>
								<menu-item role="none">
									<gl-checkbox
										value="remoteBranches"
										@change=${this.handleOnMinimapAdditionalTypesChange}
										?checked=${this.state.config?.minimapMarkerTypes?.includes('remoteBranches') ??
										true}
									>
										<span class="minimap-marker-swatch" data-marker="remoteBranches"></span>
										Remote Branches
									</gl-checkbox>
								</menu-item>
								<menu-item role="none">
									<gl-checkbox
										value="pullRequests"
										@change=${this.handleOnMinimapAdditionalTypesChange}
										?checked=${this.state.config?.minimapMarkerTypes?.includes('pullRequests') ??
										true}
									>
										<span class="minimap-marker-swatch" data-marker="pullRequests"></span>
										Pull Requests
									</gl-checkbox>
								</menu-item>
								<menu-item role="none">
									<gl-checkbox
										value="stashes"
										@change=${this.handleOnMinimapAdditionalTypesChange}
										?checked=${this.state.config?.minimapMarkerTypes?.includes('stashes') ?? false}
									>
										<span class="minimap-marker-swatch" data-marker="stashes"></span>
										Stashes
									</gl-checkbox>
								</menu-item>
								<menu-item role="none">
									<gl-checkbox
										value="tags"
										@change=${this.handleOnMinimapAdditionalTypesChange}
										?checked=${this.state.config?.minimapMarkerTypes?.includes('tags') ?? true}
									>
										<span class="minimap-marker-swatch" data-marker="tags"></span>
										Tags
									</gl-checkbox>
								</menu-item>
							</div>
						</gl-popover>
					</span>
				</div>
			</div>
		`;
	}

	private handleBranchesVisibility() {}
	private handleFilterChange() {}
	private handleSearchInput() {}
	private handleSearchNavigation() {}
	private handleSearchOpenInView() {}
	private handleOnMinimapToggle() {}
	private handleOnMinimapDataTypeChange() {}
	private handleOnMinimapAdditionalTypesChange() {}
}

function getClosestSearchResultIndex(
	results: GraphSearchResults,
	query: SearchQuery | undefined,
	activeRow: string | undefined,
	next: boolean = true,
): [number, string | undefined] {
	if (results.ids == null) return [0, undefined];

	const activeInfo = getActiveRowInfo(activeRow);
	const activeId = activeInfo?.id;
	if (activeId == null) return [0, undefined];

	let index: number | undefined;
	let nearestId: string | undefined;
	let nearestIndex: number | undefined;

	const data = results.ids[activeId];
	if (data != null) {
		index = data.i;
		nearestId = activeId;
		nearestIndex = index;
	}

	if (index == null) {
		const activeDate = activeInfo?.date != null ? activeInfo.date + (next ? 1 : -1) : undefined;
		if (activeDate == null) return [0, undefined];

		// Loop through the search results and:
		//  try to find the active id
		//  if next=true find the nearest date before the active date
		//  if next=false find the nearest date after the active date

		let i: number;
		let id: string;
		let date: number;
		let nearestDate: number | undefined;
		for ([id, { date, i }] of Object.entries(results.ids)) {
			if (next) {
				if (date < activeDate && (nearestDate == null || date > nearestDate)) {
					nearestId = id;
					nearestDate = date;
					nearestIndex = i;
				}
			} else if (date > activeDate && (nearestDate == null || date <= nearestDate)) {
				nearestId = id;
				nearestDate = date;
				nearestIndex = i;
			}
		}

		index = nearestIndex == null ? results.count - 1 : nearestIndex + (next ? -1 : 1);
	}

	index = getNextOrPreviousSearchResultIndex(index, next, results, query);

	return index === nearestIndex ? [index, nearestId] : [index, undefined];
}

function getNextOrPreviousSearchResultIndex(
	index: number,
	next: boolean,
	results: GraphSearchResults,
	query: SearchQuery | undefined,
) {
	if (next) {
		if (index < results.count - 1) {
			index++;
		} else if (query != null && results?.paging?.hasMore) {
			index = -1; // Indicates a boundary that we should load more results
		} else {
			index = 0;
		}
	} else if (index > 0) {
		index--;
	} else if (query != null && results?.paging?.hasMore) {
		index = -1; // Indicates a boundary that we should load more results
	} else {
		index = results.count - 1;
	}
	return index;
}

function getActiveRowInfo(activeRow: string | undefined): { id: string; date: number } | undefined {
	if (activeRow == null) return undefined;

	const [id, date] = activeRow.split('|');
	return {
		id: id,
		date: Number(date),
	};
}
