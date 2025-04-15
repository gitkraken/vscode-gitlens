import type { GraphRefOptData } from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../commands/cloudIntegrations';
import type { BranchGitCommandArgs } from '../../../../commands/git/branch';
import type { GraphBranchesVisibility } from '../../../../config';
import type { SearchQuery } from '../../../../constants.search';
import { isSubscriptionPaid } from '../../../../plus/gk/utils/subscription.utils';
import type { LaunchpadCommandArgs } from '../../../../plus/launchpad/launchpad';
import { createCommandLink } from '../../../../system/commands';
import { debounce } from '../../../../system/decorators/debounce';
import { createWebviewCommandLink } from '../../../../system/webview';
import type {
	GraphExcludedRef,
	GraphExcludeTypes,
	GraphMinimapMarkerTypes,
	GraphRepository,
	GraphSearchResults,
	State,
	UpdateGraphConfigurationParams,
} from '../../../plus/graph/protocol';
import {
	ChooseRefRequest,
	ChooseRepositoryCommand,
	EnsureRowRequest,
	OpenPullRequestDetailsCommand,
	SearchOpenInViewCommand,
	SearchRequest,
	UpdateExcludeTypesCommand,
	UpdateGraphConfigurationCommand,
	UpdateGraphSearchModeCommand,
	UpdateIncludedRefsCommand,
	UpdateRefsVisibilityCommand,
} from '../../../plus/graph/protocol';
import type { CustomEventType } from '../../shared/components/element';
import type { RadioGroup } from '../../shared/components/radio/radio-group';
import type { GlSearchBox } from '../../shared/components/search/search-box';
import type { SearchNavigationEventDetail } from '../../shared/components/search/search-input';
import { inlineCode } from '../../shared/components/styles/lit/base.css';
import { ipcContext } from '../../shared/contexts/ipc';
import type { TelemetryContext } from '../../shared/contexts/telemetry';
import { telemetryContext } from '../../shared/contexts/telemetry';
import { emitTelemetrySentEvent } from '../../shared/telemetry';
import { stateContext } from './context';
import { graphStateContext } from './stateProvider';
import { actionButton, linkBase, ruleBase } from './styles/graph.css';
import { graphHeaderControlStyles, progressStyles, repoHeaderStyles, titlebarStyles } from './styles/header.css';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '../../shared/components/button';
import '../../shared/components/checkbox/checkbox';
import '../../shared/components/code-icon';
import '../../shared/components/indicators/indicator';
import '../../shared/components/menu';
import '../../shared/components/overlays/popover';
import '../../shared/components/overlays/tooltip';
import '../../shared/components/radio/radio';
import '../../shared/components/radio/radio-group';
import '../../shared/components/rich/issue-pull-request';
import '../../shared/components/search/search-box';
import '../shared/components/merge-rebase-status';
import './actions/gitActionsButtons';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-header': GlGraphHeader;
	}

	interface GlobalEventHandlersEventMap {
		'gl-select-commits': CustomEvent<string>;
	}
}

function getRemoteIcon(type: number | string) {
	switch (type) {
		case 'head':
			return 'vm';
		case 'remote':
			return 'cloud';
		case 'tag':
			return 'tag';
		default:
			return '';
	}
}

function getSearchResultIdByIndex(results: GraphSearchResults, index: number): string | undefined {
	// Loop through the search results without using Object.entries or Object.keys and return the id at the specified index
	const { ids } = results;
	for (const id in ids) {
		if (ids[id].i === index) return id;
	}
	return undefined;

	// return Object.entries(results.ids).find(([, { i }]) => i === index)?.[0];
}

@customElement('gl-graph-header')
export class GlGraphHeader extends SignalWatcher(LitElement) {
	static override styles = [
		inlineCode,
		linkBase,
		ruleBase,
		actionButton,
		titlebarStyles,
		repoHeaderStyles,
		graphHeaderControlStyles,
		progressStyles,
	];

	// FIXME: remove light DOM
	// protected override createRenderRoot(): HTMLElement | DocumentFragment {
	// 	return this;
	// }

	@consume({ context: ipcContext })
	_ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as { __context__: TelemetryContext } })
	_telemetry!: TelemetryContext;

	@consume({ context: stateContext, subscribe: true })
	hostState!: typeof stateContext.__context__;

	@consume({ context: graphStateContext })
	appState!: typeof graphStateContext.__context__;

	get hasFilters() {
		if (this.hostState.config?.onlyFollowFirstParent) return true;
		if (this.hostState.excludeTypes == null) return false;

		return Object.values(this.hostState.excludeTypes).includes(true);
	}

	private async onJumpToRefPromise(alt: boolean): Promise<{ name: string; sha: string } | undefined> {
		try {
			// Assuming we have a command to get the ref details
			const rsp = await this._ipc.sendRequest(ChooseRefRequest, { alt: alt });
			this._telemetry.sendEvent({ name: 'graph/action/jumpTo', data: { alt: alt } });
			return rsp;
		} catch {
			return undefined;
		}
	}

	private async handleJumpToRef(e: MouseEvent) {
		const ref = await this.onJumpToRefPromise(e.altKey);
		if (ref != null) {
			const sha = await this.ensureSearchResultRow(ref.sha);
			if (sha == null) return;

			this.dispatchEvent(new CustomEvent('gl-select-commits', { detail: sha }));
		}
	}

	private onOpenPullRequest(pr: NonNullable<NonNullable<State['branchState']>['pr']>): void {
		this._ipc.sendCommand(OpenPullRequestDetailsCommand, { id: pr.id });
	}

	private onSearchOpenInView() {
		this._ipc.sendCommand(SearchOpenInViewCommand, { search: { ...this.appState.filter } });
	}

	private onExcludeTypesChanged(key: keyof GraphExcludeTypes, value: boolean) {
		this._ipc.sendCommand(UpdateExcludeTypesCommand, { key: key, value: value });
	}

	private onRefIncludesChanged(branchesVisibility: GraphBranchesVisibility, refs?: GraphRefOptData[]) {
		this._ipc.sendCommand(UpdateIncludedRefsCommand, { branchesVisibility: branchesVisibility, refs: refs });
	}

	private getActiveRowInfo(): undefined | { date: number; id: string } {
		if (this.appState.activeRow == null) return undefined;

		const [id, date] = this.appState.activeRow.split('|');
		return {
			date: Number(date),
			id: id,
		};
	}

	private getNextOrPreviousSearchResultIndex(
		index: number,
		next: boolean,
		results: GraphSearchResults,
		query: undefined | SearchQuery,
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

	private getClosestSearchResultIndex(
		results: GraphSearchResults,
		query: undefined | SearchQuery,
		next: boolean = true,
	): [number, undefined | string] {
		if (results.ids == null) return [0, undefined];

		const activeInfo = this.getActiveRowInfo();
		const activeId = activeInfo?.id;
		if (activeId == null) return [0, undefined];

		let index: undefined | number;
		let nearestId: undefined | string;
		let nearestIndex: undefined | number;

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
			let nearestDate: undefined | number;
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

		index = this.getNextOrPreviousSearchResultIndex(index, next, results, query);

		return index === nearestIndex ? [index, nearestId] : [index, undefined];
	}

	private get searchPosition(): number {
		if (this.appState.searchResults?.ids == null || !this.appState.filter.query) return 0;

		const id = this.getActiveRowInfo()?.id;
		let searchIndex = id ? this.appState.searchResults.ids[id]?.i : undefined;
		if (searchIndex == null) {
			[searchIndex] = this.getClosestSearchResultIndex(this.appState.searchResults, { ...this.appState.filter });
		}
		return searchIndex < 1 ? 1 : searchIndex + 1;
	}

	get searchValid() {
		return this.appState.filter.query.length > 2;
	}
	handleFilterChange(e: CustomEvent) {
		const $el = e.target as HTMLInputElement;
		if ($el == null) return;

		const { checked } = $el;

		switch ($el.value) {
			case 'mergeCommits':
				this.changeGraphConfiguration({ dimMergeCommits: checked });
				break;

			case 'onlyFollowFirstParent':
				this.changeGraphConfiguration({ onlyFollowFirstParent: checked });
				break;

			case 'remotes':
			case 'stashes':
			case 'tags': {
				const key = $el.value satisfies keyof GraphExcludeTypes;
				const currentFilter = this.hostState.excludeTypes?.[key];
				if ((currentFilter == null && checked) || (currentFilter != null && currentFilter !== checked)) {
					this.onExcludeTypesChanged(key, checked);
				}
				break;
			}
		}
	}
	handleOnToggleRefsVisibilityClick(_event: any, refs: GraphExcludedRef[], visible: boolean) {
		this._ipc.sendCommand(UpdateRefsVisibilityCommand, {
			refs: refs,
			visible: visible,
		});
	}
	handleBranchesVisibility(e: CustomEvent) {
		const $el = e.target as HTMLSelectElement;
		if ($el == null) return;
		this.onRefIncludesChanged($el.value as GraphBranchesVisibility);
	}

	@debounce(250)
	async handleSearch() {
		this.appState.searching = this.searchValid;
		try {
			const rsp = await this._ipc.sendRequest(SearchRequest, {
				search: this.searchValid ? { ...this.appState.filter } : undefined /*limit: options?.limit*/,
			});

			if (rsp.results && this.appState.filter.query) {
				this.searchEl.logSearch({ ...this.appState.filter });
			}

			this.appState.searchResultsResponse = rsp.results;
			this.appState.selectedRows = rsp.selectedRows;
		} catch {
			this.appState.searchResultsResponse = undefined;
		}
		this.appState.searching = false;
	}

	private handleSearchInput = (e: CustomEvent<SearchQuery>) => {
		this.appState.filter = e.detail;
		void this.handleSearch();
	};

	private async onSearchPromise(search: SearchQuery, options?: { limit?: number; more?: boolean }) {
		try {
			const rsp = await this._ipc.sendRequest(SearchRequest, {
				search: search,
				limit: options?.limit,
				more: options?.more,
			});
			this.appState.searchResultsResponse = rsp.results;
			this.appState.selectedRows = rsp.selectedRows;
			return rsp;
		} catch {
			return undefined;
		}
	}

	private async handleSearchNavigation(e: CustomEvent<SearchNavigationEventDetail>) {
		let results = this.appState.searchResults;
		if (results == null) return;

		const direction = e.detail?.direction ?? 'next';

		let count = results.count;

		let searchIndex;
		let id: string | undefined;

		let next;
		if (direction === 'first') {
			next = false;
			searchIndex = 0;
		} else if (direction === 'last') {
			next = false;
			searchIndex = -1;
		} else {
			next = direction === 'next';
			[searchIndex, id] = this.getClosestSearchResultIndex(results, { ...this.appState.filter }, next);
		}

		let iterations = 0;
		// Avoid infinite loops
		while (iterations < 1000) {
			iterations++;

			// Indicates a boundary and we need to load more results
			if (searchIndex === -1) {
				if (next) {
					if (this.appState.filter.query && results?.paging?.hasMore) {
						this.appState.searching = true;
						let moreResults;
						try {
							moreResults = await this.onSearchPromise?.({ ...this.appState.filter }, { more: true });
						} finally {
							this.appState.searching = false;
						}
						if (moreResults?.results != null && !('error' in moreResults.results)) {
							if (count < moreResults.results.count) {
								results = moreResults.results;
								searchIndex = count;
								count = results.count;
							} else {
								searchIndex = 0;
							}
						} else {
							searchIndex = 0;
						}
					} else {
						searchIndex = 0;
					}
					// this.appState.filter != null seems noop
				} else if (direction === 'last' && this.appState.filter != null && results?.paging?.hasMore) {
					this.appState.searching = true;
					let moreResults;
					try {
						moreResults = await this.onSearchPromise({ ...this.appState.filter }, { limit: 0, more: true });
					} finally {
						this.appState.searching = false;
					}
					if (moreResults?.results != null && !('error' in moreResults.results)) {
						if (count < moreResults.results.count) {
							results = moreResults.results;
							count = results.count;
						}
						searchIndex = count;
					}
				} else {
					searchIndex = count - 1;
				}
			}

			id = id ?? getSearchResultIdByIndex(results, searchIndex);
			if (id != null) {
				id = await this.ensureSearchResultRow(id);
				if (id != null) break;
			}

			this.appState.searchResultsHidden = true;

			searchIndex = this.getNextOrPreviousSearchResultIndex(searchIndex, next, results, {
				...this.appState.filter,
			});
		}

		if (id != null) {
			this.dispatchEvent(new CustomEvent('gl-select-commits', { detail: id }));
		}
	}

	private async onEnsureRowPromise(id: string, select: boolean) {
		try {
			return await this._ipc.sendRequest(EnsureRowRequest, { id: id, select: select });
		} catch {
			return undefined;
		}
	}

	private readonly ensuredIds = new Set<string>();
	private readonly ensuredSkippedIds = new Set<string>();

	private async ensureSearchResultRow(id: string): Promise<string | undefined> {
		if (this.ensuredIds.has(id)) return id;
		if (this.ensuredSkippedIds.has(id)) return undefined;

		let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
			timeout = undefined;
			this.appState.loading = true;
		}, 500);

		const e = await this.onEnsureRowPromise(id, false);
		if (timeout == null) {
			this.appState.loading = false;
		} else {
			clearTimeout(timeout);
		}

		if (e?.id === id) {
			this.ensuredIds.add(id);
			return id;
		}

		if (e != null) {
			this.ensuredSkippedIds.add(id);
		}
		return undefined;
	}

	handleSearchModeChanged(e: CustomEvent) {
		this._ipc.sendCommand(UpdateGraphSearchModeCommand, { searchMode: e.detail.searchMode });
	}

	handleMinimapToggled() {
		this.changeGraphConfiguration({ minimap: !this.hostState.config?.minimap });
	}

	private changeGraphConfiguration(changes: UpdateGraphConfigurationParams['changes']) {
		this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: changes });
	}

	private handleMinimapDataTypeChanged(e: Event) {
		if (this.hostState.config == null) return;

		const $el = e.target as RadioGroup;
		const minimapDataType = $el.value === 'lines' ? 'lines' : 'commits';
		if (this.hostState.config.minimapDataType === minimapDataType) return;

		this.changeGraphConfiguration({ minimapDataType: minimapDataType });
	}

	private handleMinimapAdditionalTypesChanged(e: Event) {
		if (this.hostState.config?.minimapMarkerTypes == null) return;

		const $el = e.target as HTMLInputElement;
		const value = $el.value as GraphMinimapMarkerTypes;

		if ($el.checked) {
			if (!this.hostState.config.minimapMarkerTypes.includes(value)) {
				const minimapMarkerTypes = [...this.hostState.config.minimapMarkerTypes, value];
				this.changeGraphConfiguration({ minimapMarkerTypes: minimapMarkerTypes });
			}
		} else {
			const index = this.hostState.config.minimapMarkerTypes.indexOf(value);
			if (index !== -1) {
				const minimapMarkerTypes = [...this.hostState.config.minimapMarkerTypes];
				minimapMarkerTypes.splice(index, 1);
				this.changeGraphConfiguration({ minimapMarkerTypes: minimapMarkerTypes });
			}
		}
	}

	@debounce(250)
	private handleChooseRepository() {
		this._ipc.sendCommand(ChooseRepositoryCommand);
	}

	@query('gl-search-box')
	private readonly searchEl!: GlSearchBox;

	private renderBranchStateIcon(): unknown {
		const { branchState } = this.hostState;
		if (branchState?.pr) {
			return nothing;
		}
		if (branchState?.worktree) {
			return html`<code-icon icon="gl-worktrees-view" aria-hidden="true"></code-icon>`;
		}
		return html`<code-icon icon="git-branch" aria-hidden="true"></code-icon>`;
	}

	private renderRepoControl(repo?: GraphRepository) {
		return html`
			<gl-popover placement="bottom">
				<a
					href=${ifDefined(repo!.provider!.url)}
					class="action-button"
					style="margin-right: -0.5rem"
					aria-label=${`Open Repository on ${repo!.provider!.name}`}
					slot="anchor"
					@click=${(e: Event) =>
						emitTelemetrySentEvent<'graph/action/openRepoOnRemote'>(e.target!, {
							name: 'graph/action/openRepoOnRemote',
							data: {},
						})}
				>
					<span>
						<code-icon
							class="action-button__icon"
							icon=${repo!.provider!.icon === 'cloud' ? 'cloud' : `gl-provider-${repo!.provider!.icon}`}
							aria-hidden="true"
						></code-icon
						>${when(
							repo!.provider!.integration?.connected,
							() => html`<gl-indicator class="action-button__indicator"></gl-indicator>`,
						)}
					</span>
				</a>
				<span slot="content">
					Open Repository on ${repo!.provider!.name}
					<hr />
					${when(
						repo!.provider!.integration?.connected,
						() => html`
							<span>
								<code-icon style="margin-top: -3px" icon="check" aria-hidden="true"></code-icon>
								Connected to ${repo!.provider!.name}
							</span>
						`,
						() => {
							if (repo!.provider!.integration?.connected !== false) {
								return nothing;
							}
							return html`
								<code-icon style="margin-top: -3px" icon="plug" aria-hidden="true"></code-icon>
								<a
									href=${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
										'gitlens.plus.cloudIntegrations.connect',
										{
											integrationIds: [repo!.provider!.integration.id],
											source: { source: 'graph' },
										},
									)}
								>
									Connect to ${repo!.provider!.name}
								</a>
								<span>&mdash; not connected</span>
							`;
						},
					)}
				</span>
			</gl-popover>
			${when(
				repo?.provider?.integration?.connected === false,
				() => html`
					<gl-button
						appearance="toolbar"
						href=${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
							'gitlens.plus.cloudIntegrations.connect',
							{
								integrationIds: [repo!.provider!.integration!.id],
								source: { source: 'graph' },
							},
						)}
					>
						<code-icon icon="plug" style="color: var(--titlebar-fg)"></code-icon>
						<span slot="tooltip">
							Connect to ${repo!.provider!.name}
							<hr />
							View pull requests and issues in the Commit Graph, Launchpad, autolinks, and more
						</span>
					</gl-button>
				`,
			)}
		`;
	}

	override render() {
		const repo = this.hostState.repositories?.find(repo => repo.id === this.hostState.selectedRepository);
		return html`<header class="titlebar graph-app__header">
			<div class="titlebar__row titlebar__row--wrap">
				<div class="titlebar__group">
					${when(repo?.provider?.url, this.renderRepoControl.bind(this, repo))}
					<gl-tooltip placement="bottom">
						<button
							type="button"
							class="action-button"
							aria-label="Switch to Another Repository..."
							?disabled=${!this.hostState.repositories || this.hostState.repositories.length < 2}
							@click=${() => this.handleChooseRepository()}
						>
							<span class="action-button__truncated">${repo?.formattedName ?? 'none selected'}</span
							>${when(
								this.hostState.repositories && this.hostState.repositories.length > 1,
								() => html`
									<code-icon
										class="action-button__more"
										icon="chevron-down"
										aria-hidden="true"
									></code-icon>
								`,
							)}
						</button>
						<span slot="content">Switch to Another Repository...</span>
					</gl-tooltip>
					${when(
						this.hostState.allowed && repo,
						() => html`
							<span> <code-icon icon="chevron-right"></code-icon> </span>${when(
								this.hostState.branchState?.pr,
								pr => html`
									<gl-popover placement="bottom">
										<button slot="anchor" type="button" class="action-button">
											<issue-pull-request
												type="pr"
												identifier=${`#${pr.id}`}
												status=${pr.state}
												compact
											></issue-pull-request>
										</button>
										<div slot="content">
											<issue-pull-request
												type="pr"
												name=${pr.title}
												url=${pr.url}
												identifier=${`#${pr.id}`}
												status=${pr.state}
												.date=${pr.updatedDate}
												.dateFormat=${this.hostState.config?.dateFormat}
												.dateStyle=${this.hostState.config?.dateStyle}
												details
												@gl-issue-pull-request-details=${() => {
													this.onOpenPullRequest(pr);
												}}
											>
											</issue-pull-request>
										</div>
									</gl-popover>
								`,
							)}
							<gl-popover placement="bottom">
								<a
									slot="anchor"
									href=${createWebviewCommandLink(
										'gitlens.graph.switchToAnotherBranch',
										this.hostState.webviewId,
										this.hostState.webviewInstanceId,
									)}
									class="action-button"
									style=${this.hostState.branchState?.pr ? { marginLeft: '-0.6rem' } : {}}
									aria-label="Switch to Another Branch..."
								>
									${this.renderBranchStateIcon()}
									<span class="action-button__truncated">${this.hostState.branch?.name}</span>
									<code-icon
										class="action-button__more"
										icon="chevron-down"
										aria-hidden="true"
									></code-icon>
								</a>
								<div slot="content">
									<span>
										Switch to Another Branch...
										<hr />
										<code-icon icon="git-branch" aria-hidden="true"></code-icon>
										<span class="inline-code">${this.hostState.branch?.name}</span>${when(
											this.hostState.branchState?.worktree,
											() => html`<i> (in a worktree)</i> `,
										)}
									</span>
								</div>
							</gl-popover>
							<gl-button class="jump-to-ref" appearance="toolbar" @click=${this.handleJumpToRef}>
								<code-icon icon="target"></code-icon>
								<span slot="tooltip">
									Jump to HEAD
									<br />
									[Alt] Jump to Reference...
								</span>
							</gl-button>
							<span>
								<code-icon icon="chevron-right"></code-icon>
							</span>
							<gl-git-actions-buttons
								.branchName=${this.hostState.branch?.name}
								.branchState=${this.hostState.branchState}
								.lastFetched=${this.hostState.lastFetched}
								.state=${this.hostState}
							></gl-git-actions-buttons>
						`,
					)}
				</div>
				<div class="titlebar__group">
					<gl-tooltip placement="bottom">
						<a
							class="action-button"
							href=${createCommandLink<BranchGitCommandArgs>('gitlens.gitCommands.branch', {
								state: {
									subcommand: 'create',
									reference: this.hostState.branch,
								},
								command: 'branch',
								confirm: true,
							})}
						>
							<code-icon class="action-button__icon" icon="custom-start-work"></code-icon>
						</a>
						<span slot="content">
							Create New Branch from
							<code-icon icon="git-branch"></code-icon>
							<span class="inline-code">${this.hostState.branch?.name}</span>
						</span>
					</gl-tooltip>
					<gl-tooltip placement="bottom">
						<a
							href=${`command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'graph',
								} satisfies Omit<LaunchpadCommandArgs, 'command'>),
							)}`}
							class="action-button"
						>
							<code-icon icon="rocket"></code-icon>
						</a>
						<span slot="content">
							<strong>Launchpad</strong> &mdash; organizes your pull requests into actionable groups to
							help you focus and keep your team unblocked
						</span>
					</gl-tooltip>
					<gl-tooltip placement="bottom">
						<a
							href=${'command:gitlens.views.home.focus'}
							class="action-button"
							aria-label=${`Open GitLens Home View`}
						>
							<span>
								<code-icon
									class="action-button__icon"
									icon=${'gl-gitlens'}
									aria-hidden="true"
								></code-icon>
							</span>
						</a>
						<span slot="content">
							<strong>GitLens Home</strong> — track, manage, and collaborate on your branches and pull
							requests, all in one intuitive hub
						</span>
					</gl-tooltip>
					${when(
						this.hostState.subscription == null || !isSubscriptionPaid(this.hostState.subscription),
						() => html`
							<gl-feature-badge
								.source=${{ source: 'graph', detail: 'badge' } as const}
								.subscription=${this.hostState.subscription}
							></gl-feature-badge>
						`,
					)}
				</div>
			</div>

			${when(
				this.hostState.allowed &&
					this.hostState.workingTreeStats != null &&
					(this.hostState.workingTreeStats.hasConflicts || this.hostState.workingTreeStats.pausedOpStatus),
				() => html`
					<div class="merge-conflict-warning">
						<gl-merge-rebase-status
							class="merge-conflict-warning__content"
							?conflicts=${this.hostState.workingTreeStats?.hasConflicts}
							.pausedOpStatus=${this.hostState.workingTreeStats?.pausedOpStatus}
							skipCommand="gitlens.graph.skipPausedOperation"
							continueCommand="gitlens.graph.continuePausedOperation"
							abortCommand="gitlens.graph.abortPausedOperation"
							openEditorCommand="gitlens.graph.openRebaseEditor"
							.webviewCommandContext=${{
								webview: this.hostState.webviewId,
								webviewInstance: this.hostState.webviewInstanceId,
							}}
						></gl-merge-rebase-status>
					</div>
				`,
			)}
			${when(
				this.hostState.allowed,
				() => html`
					<div class="titlebar__row">
						<div class="titlebar__group">
							<gl-tooltip placement="top" content="Branches Visibility">
								<sl-select
									value=${ifDefined(this.hostState.branchesVisibility)}
									@sl-change=${this.handleBranchesVisibility}
									hoist
								>
									<code-icon icon="chevron-down" slot="expand-icon"></code-icon>
									<sl-option value="all" ?disabled=${repo?.isVirtual}> All Branches </sl-option>
									<sl-option value="smart" ?disabled=${repo?.isVirtual}>
										Smart Branches
										${when(
											!repo?.isVirtual,
											() => html`
												<gl-tooltip placement="right" slot="suffix">
													<code-icon icon="info"></code-icon>
													<span slot="content">
														Shows only relevant branches
														<br />
														<br />
														<i>
															Includes the current branch, its upstream, and its base or
															target branch
														</i>
													</span>
												</gl-tooltip>
											`,
											() => html` <code-icon icon="info" slot="suffix"></code-icon> `,
										)}
									</sl-option>
									<sl-option value="current">Current Branch</sl-option>
								</sl-select>
							</gl-tooltip>
							<div
								class=${`shrink ${!Object.values(this.hostState.excludeRefs ?? {}).length && 'hidden'}`}
							>
								<gl-popover
									class="popover"
									placement="bottom-start"
									trigger="click focus"
									?arrow=${false}
									distance=${0}
								>
									<gl-tooltip placement="top" slot="anchor">
										<button type="button" id="hiddenRefs" class="action-button">
											<code-icon icon=${`eye-closed`}></code-icon>
											${Object.values(this.hostState.excludeRefs ?? {}).length}
											<code-icon
												class="action-button__more"
												icon="chevron-down"
												aria-hidden="true"
											></code-icon>
										</button>
										<span slot="content">Hidden Branches / Tags</span>
									</gl-tooltip>
									<div slot="content">
										<menu-label>Hidden Branches / Tags</menu-label>
										${when(this.hostState.excludeRefs, excludeRefs => {
											if (!Object.keys(excludeRefs).length) {
												return nothing;
											}
											return repeat([...Object.values(excludeRefs), null], ref => {
												if (ref) {
													return html` <menu-item
														@click=${(event: CustomEvent) => {
															this.handleOnToggleRefsVisibilityClick(event, [ref], true);
														}}
														class="flex-gap"
													>
														<code-icon icon=${getRemoteIcon(ref.type)}></code-icon>
														<span>${ref.name}</span>
													</menu-item>`;
												}
												return html` <menu-item
													@click=${(event: CustomEvent) => {
														this.handleOnToggleRefsVisibilityClick(
															event,
															Object.values(excludeRefs ?? {}),
															true,
														);
													}}
												>
													Show All
												</menu-item>`;
											});
										})}
									</div>
								</gl-popover>
							</div>
							<gl-popover
								class="popover"
								placement="bottom-start"
								trigger="click focus"
								?arrow=${false}
								distance=${0}
							>
								<gl-tooltip placement="top" slot="anchor">
									<button type="button" class="action-button">
										<code-icon icon=${`filter${this.hasFilters ? '-filled' : ''}`}></code-icon>
										<code-icon
											class="action-button__more"
											icon="chevron-down"
											aria-hidden="true"
										></code-icon>
									</button>
									<span slot="content">Graph Filtering</span>
								</gl-tooltip>
								<div slot="content">
									<menu-label>Graph Filters</menu-label>
									${when(
										repo?.isVirtual !== true,
										() => html`
											<menu-item role="none">
												<gl-tooltip
													placement="right"
													content="Only follow the first parent of merge commits to provide a more linear history"
												>
													<gl-checkbox
														value="onlyFollowFirstParent"
														@gl-change-value=${this.handleFilterChange}
														?checked=${this.hostState.config?.onlyFollowFirstParent ??
														false}
													>
														Simplify Merge History
													</gl-checkbox>
												</gl-tooltip>
											</menu-item>
											<menu-divider></menu-divider>
											<menu-item role="none">
												<gl-checkbox
													value="remotes"
													@gl-change-value=${this.handleFilterChange}
													?checked=${this.hostState.excludeTypes?.remotes ?? false}
												>
													Hide Remote-only Branches
												</gl-checkbox>
											</menu-item>
											<menu-item role="none">
												<gl-checkbox
													value="stashes"
													@gl-change-value=${this.handleFilterChange}
													?checked=${this.hostState.excludeTypes?.stashes ?? false}
												>
													Hide Stashes
												</gl-checkbox>
											</menu-item>
										`,
									)}
									<menu-item role="none">
										<gl-checkbox
											value="tags"
											@gl-change-value=${this.handleFilterChange}
											?checked=${this.hostState.excludeTypes?.tags ?? false}
										>
											Hide Tags
										</gl-checkbox>
									</menu-item>
									<menu-divider></menu-divider>
									<menu-item role="none">
										<gl-checkbox
											value="mergeCommits"
											@gl-change-value=${this.handleFilterChange}
											?checked=${this.hostState.config?.dimMergeCommits ?? false}
										>
											Dim Merge Commit Rows
										</gl-checkbox>
									</menu-item>
								</div>
							</gl-popover>
							<span>
								<span class="action-divider"></span>
							</span>
							<gl-search-box
								step=${this.searchPosition}
								total=${this.appState.searchResults?.count ?? 0}
								?valid=${this.searchValid}
								?more=${this.appState.searchResults?.paging?.hasMore ?? false}
								?searching=${this.appState.searching}
								?filter=${this.hostState.defaultSearchMode === 'filter'}
								value=${this.appState.filter.query}
								errorMessage=${this.appState.searchResultsError?.error ?? ''}
								?resultsHidden=${this.appState.searchResultsHidden}
								?resultsLoaded=${this.appState.searchResults != null}
								@gl-search-inputchange=${(e: CustomEventType<'gl-search-inputchange'>) =>
									this.handleSearchInput(e)}
								@gl-search-navigate=${this.handleSearchNavigation}
								@gl-search-openinview=${this.onSearchOpenInView}
								@gl-search-modechange=${this.handleSearchModeChanged}
							></gl-search-box>
							<span>
								<span class="action-divider"></span>
							</span>
							<span class="button-group">
								<gl-tooltip placement="bottom">
									<button
										type="button"
										role="checkbox"
										class="action-button"
										aria-label="Toggle Minimap"
										aria-checked=${this.hostState.config?.minimap ?? false}
										@click=${() => this.handleMinimapToggled()}
									>
										<code-icon class="action-button__icon" icon="graph-line"></code-icon>
									</button>
									<span slot="content">Toggle Minimap</span>
								</gl-tooltip>
								<gl-popover
									class="popover"
									placement="bottom-end"
									trigger="click focus"
									?arrow=${false}
									distance=${0}
								>
									<gl-tooltip placement="top" distance=${7} slot="anchor">
										<button type="button" class="action-button" aria-label="Minimap Options">
											<code-icon
												class="action-button__more"
												icon="chevron-down"
												aria-hidden="true"
											></code-icon>
										</button>
										<span slot="content">Minimap Options</span>
									</gl-tooltip>
									<div slot="content">
										<menu-label>Minimap</menu-label>
										<menu-item role="none">
											<gl-radio-group
												value=${this.hostState.config?.minimapDataType ?? 'commits'}
												@gl-change-value=${this.handleMinimapDataTypeChanged}
											>
												<gl-radio name="minimap-datatype" value="commits"> Commits </gl-radio>
												<gl-radio name="minimap-datatype" value="lines">
													Lines Changed
												</gl-radio>
											</gl-radio-group>
										</menu-item>
										<menu-divider></menu-divider>
										<menu-label>Markers</menu-label>
										<menu-item role="none">
											<gl-checkbox
												value="localBranches"
												@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
												?checked=${this.hostState.config?.minimapMarkerTypes?.includes(
													'localBranches',
												) ?? false}
											>
												<span class="minimap-marker-swatch" data-marker="localBranches"></span>
												Local Branches
											</gl-checkbox>
										</menu-item>
										<menu-item role="none">
											<gl-checkbox
												value="remoteBranches"
												@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
												?checked=${this.hostState.config?.minimapMarkerTypes?.includes(
													'remoteBranches',
												) ?? true}
											>
												<span class="minimap-marker-swatch" data-marker="remoteBranches"></span>
												Remote Branches
											</gl-checkbox>
										</menu-item>
										<menu-item role="none">
											<gl-checkbox
												value="pullRequests"
												@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
												?checked=${this.hostState.config?.minimapMarkerTypes?.includes(
													'pullRequests',
												) ?? true}
											>
												<span class="minimap-marker-swatch" data-marker="pullRequests"></span>
												Pull Requests
											</gl-checkbox>
										</menu-item>
										<menu-item role="none">
											<gl-checkbox
												value="stashes"
												@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
												?checked=${this.hostState.config?.minimapMarkerTypes?.includes(
													'stashes',
												) ?? false}
											>
												<span class="minimap-marker-swatch" data-marker="stashes"></span>
												Stashes
											</gl-checkbox>
										</menu-item>
										<menu-item role="none">
											<gl-checkbox
												value="tags"
												@gl-change-value=${this.handleMinimapAdditionalTypesChanged}
												?checked=${this.hostState.config?.minimapMarkerTypes?.includes(
													'tags',
												) ?? true}
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
				`,
			)}
			<div
				class=${`progress-container infinite${
					this.hostState.loading || this.hostState.rowsStatsLoading ? ' active' : ''
				}`}
				role="progressbar"
			>
				<div class="progress-bar"></div>
			</div>
		</header>`;
	}
}
