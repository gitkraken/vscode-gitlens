import {
	Badge,
	Button,
	defineGkElement,
	FocusContainer,
	Input,
	Menu,
	MenuItem,
	Popover,
} from '@gitkraken/shared-web-components';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { map } from 'lit/directives/map.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { Source } from '../../../../../constants';
import type { State } from '../../../../../plus/webviews/focus/protocol';
import { debounce } from '../../../../../system/function';
import { themeProperties } from './gk-theme.css';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import '../../../shared/components/feature-gate';
import '../../../shared/components/feature-badge';
import './gk-pull-request-row';
import './gk-issue-row';

@customElement('gl-focus-app')
export class GlFocusApp extends LitElement {
	static override styles = [themeProperties];
	private readonly tabFilters = ['prs', 'issues', 'snoozed'];
	private readonly tabFilterOptions = [
		{ label: 'Pull Requests', value: 'prs' },
		{ label: 'Issues', value: 'issues' },
		{ label: 'All', value: '' },
		{ label: 'Snoozed', value: 'snoozed' },
	];
	private readonly mineFilters = ['authored', 'assigned', 'review-requested', 'mentioned'];
	private readonly mineFilterOptions = [
		{ label: 'Mine', value: '' },
		{ label: 'Opened by Me', value: 'authored' },
		{ label: 'Assigned to Me', value: 'assigned' },
		{ label: 'Needs my Review', value: 'review-requested' },
		{ label: 'Mentions Me', value: 'mentioned' },
	];

	@state()
	private selectedTabFilter?: string = 'prs';

	@state()
	private selectedMineFilter?: string;

	@state()
	private searchText?: string;

	@property({ type: Object })
	state?: State;

	constructor() {
		super();

		defineGkElement(Button, Badge, Input, FocusContainer, Popover, Menu, MenuItem);
	}

	get subscription() {
		return this.state?.access.subscription?.current;
	}

	get showSubscriptionGate() {
		return this.state?.access.allowed === false;
	}

	get showFeatureGate() {
		return this.state?.access.allowed !== true;
	}

	get showConnectionGate() {
		return this.state?.access.allowed === true && !(this.state?.repos?.some(r => r.isConnected) ?? false);
	}

	get mineFilterMenuLabel() {
		if (this.selectedMineFilter != null && this.selectedMineFilter !== '') {
			return this.mineFilterOptions.find(f => f.value === this.selectedMineFilter)?.label;
		}

		return this.mineFilterOptions[0].label;
	}

	get items() {
		if (this.isLoading) {
			return [];
		}

		const items: {
			isPullrequest: boolean;
			rank: number;
			state: Record<string, any>;
			tags: string[];
			isPinned?: string;
			isSnoozed?: string;
		}[] = [];

		this.state?.pullRequests?.forEach(
			({
				pullRequest,
				reasons,
				isCurrentBranch,
				isCurrentWorktree,
				hasWorktree,
				hasLocalBranch,
				rank,
				enriched,
			}) => {
				const isPinned = enriched?.find(item => item.type === 'pin')?.id;
				const isSnoozed = enriched?.find(item => item.type === 'snooze')?.id;

				items.push({
					isPullrequest: true,
					state: {
						pullRequest: pullRequest,
						isCurrentBranch: isCurrentBranch,
						isCurrentWorktree: isCurrentWorktree,
						hasWorktree: hasWorktree,
						hasLocalBranch: hasLocalBranch,
					},
					rank: rank ?? 0,
					tags: reasons,
					isPinned: isPinned,
					isSnoozed: isSnoozed,
				});
			},
		);
		this.state?.issues?.forEach(({ issue, reasons, rank, enriched }) => {
			const isPinned = enriched?.find(item => item.type === 'pin')?.id;
			const isSnoozed = enriched?.find(item => item.type === 'snooze')?.id;

			items.push({
				isPullrequest: false,
				rank: rank ?? 0,
				state: {
					issue: issue,
				},
				tags: reasons,
				isPinned: isPinned,
				isSnoozed: isSnoozed,
			});
		});

		return items;
	}

	get tabFilterOptionsWithCounts() {
		const counts: Record<string, number> = {};
		this.tabFilters.forEach(f => (counts[f] = 0));

		this.items.forEach(({ isPullrequest, isSnoozed }) => {
			const key = isSnoozed ? 'snoozed' : isPullrequest ? 'prs' : 'issues';
			if (counts[key] != null) {
				counts[key]++;
			}
		});

		return this.tabFilterOptions.map(o => {
			return {
				...o,
				count: o.value === '' ? this.items.length : counts[o.value],
			};
		});
	}

	get filteredItems() {
		if (this.items.length === 0) {
			return this.items;
		}

		const hasSearch = this.searchText != null && this.searchText !== '';
		const hasMineFilter = this.selectedMineFilter != null && this.selectedMineFilter !== '';
		const hasTabFilter = this.selectedTabFilter != null && this.selectedTabFilter !== '';
		if (!hasSearch && !hasMineFilter && !hasTabFilter) {
			return this.items.filter(i => i.isSnoozed == null);
		}

		const searchText = this.searchText?.toLowerCase();
		return this.items.filter(i => {
			if (hasTabFilter) {
				if (
					(i.isSnoozed != null && this.selectedTabFilter !== 'snoozed') ||
					(i.isSnoozed == null && this.selectedTabFilter == 'snoozed') ||
					(i.isPullrequest === true && this.selectedTabFilter === 'issues') ||
					(i.isPullrequest === false && this.selectedTabFilter === 'prs')
				) {
					return false;
				}
			} else if (i.isSnoozed != null) {
				return false;
			}

			if (hasMineFilter && !i.tags.includes(this.selectedMineFilter!)) {
				return false;
			}

			if (hasSearch) {
				if (i.state.issue && !i.state.issue.title.toLowerCase().includes(searchText)) {
					return false;
				}

				if (i.state.pullRequest && !i.state.pullRequest.title.toLowerCase().includes(searchText)) {
					return false;
				}
			}

			return true;
		});
	}

	get sortedItems() {
		return this.filteredItems.sort((a, b) => {
			if (a.isPinned === b.isPinned) {
				return 0;
				// return a.rank - b.rank;
			}
			return a.isPinned ? -1 : 1;
		});
	}

	get isLoading() {
		return this.state?.pullRequests == null || this.state?.issues == null;
	}

	loadingContent() {
		return html`
			<div class="alert">
				<span class="alert__content"><code-icon modifier="spin" icon="loading"></code-icon> Loading</span>
			</div>
		`;
	}

	focusItemsContent() {
		if (this.isLoading) {
			return this.loadingContent();
		}

		if (this.sortedItems.length === 0) {
			return html`
				<div class="alert">
					<span class="alert__content">None found</span>
				</div>
			`;
		}

		return html`
			${repeat(
				this.sortedItems,
				(item, i) =>
					`item-${i}-${
						item.isPullrequest ? `pr-${item.state.pullRequest.id}` : `issue-${item.state.issue.id}`
					}`,
				({ isPullrequest, rank, state, isPinned, isSnoozed }) =>
					when(
						isPullrequest,
						() =>
							html`<gk-pull-request-row
								.rank=${rank}
								.pullRequest=${state.pullRequest}
								.isCurrentBranch=${state.isCurrentBranch}
								.isCurrentWorktree=${state.isCurrentWorktree}
								.hasWorktree=${state.hasWorktree}
								.hasLocalBranch=${state.hasLocalBranch}
								.pinned=${isPinned}
								.snoozed=${isSnoozed}
								.enrichedId=${state.enrichedId}
							></gk-pull-request-row>`,
						() =>
							html`<gk-issue-row
								.rank=${rank}
								.issue=${state.issue}
								.pinned=${isPinned}
								.snoozed=${isSnoozed}
								.enrichedId=${state.enrichedId}
							></gk-issue-row>`,
					),
			)}
		`;
	}

	override render() {
		if (this.state == null) {
			return this.loadingContent();
		}

		return html`
			<div class="app">
				<div class="app__toolbar">
					<span class="preview"> </span>
					<gl-button
						class="feedback"
						appearance="toolbar"
						href="https://github.com/gitkraken/vscode-gitlens/discussions/2535"
						tooltip="Give Us Feedback"
						aria-label="Give Us Feedback"
						><code-icon icon="feedback"></code-icon
					></gl-button>
					<gl-feature-badge
						preview
						featureWithArticleIfNeeded="Launchpad"
						.subscription=${this.subscription}
					></gl-feature-badge>
				</div>

				<div class="app__content">
					<gl-feature-gate
						.state=${this.subscription?.state}
						featureWithArticleIfNeeded="Launchpad"
						.source=${{ source: 'launchpad', detail: 'gate' } satisfies Source}
						.visible=${this.showFeatureGate}
						id="subscription-gate"
						class="scrollable"
						><p slot="feature">
							<a href="https://help.gitkraken.com/gitlens/gitlens-features/#focus-view-%e2%9c%a8"
								>Launchpad</a
							>
							<gl-feature-badge preview .subscription=${this.subscription}></gl-feature-badge>
							&mdash; effortlessly view all of your GitHub pull requests and issues in a unified,
							actionable view.
						</p></gl-feature-gate
					>
					<gl-feature-gate
						id="connection-gate"
						class="scrollable"
						.source=${{ source: 'launchpad', detail: 'gate' } satisfies Source}
						.visible=${this.showConnectionGate}
					>
						<h3>No GitHub remotes are connected</h3>
						<p>
							This enables access to Pull Requests and Issues as well as provide additional information
							inside hovers and the Inspect view, such as auto-linked issues and pull requests and
							avatars.
						</p>
						<gl-button appearance="alert" href="command:gitlens.connectRemoteProvider"
							>Connect to GitHub</gl-button
						>
					</gl-feature-gate>

					<div class="app__focus">
						<header class="app__header">
							<div class="app__header-group">
								<nav class="tab-filter" id="filter-focus-items">
									${map(
										this.tabFilterOptionsWithCounts,
										({ label, value, count }) => html`
											<button
												class="tab-filter__tab ${(
													this.selectedTabFilter
														? value === this.selectedTabFilter
														: value === ''
												)
													? 'is-active'
													: ''}"
												type="button"
												data-tab="${value}"
												@click=${() => (this.selectedTabFilter = value)}
											>
												${label} <gk-badge variant="filled">${count}</gk-badge>
											</button>
										`,
									)}
								</nav>
								<gk-popover>
									<gk-button slot="trigger"
										><code-icon icon="list-filter"></code-icon> ${this.mineFilterMenuLabel}
										<code-icon icon="chevron-down"></code-icon
									></gk-button>
									<gk-menu class="mine-menu" @select=${this.onSelectMineFilter}>
										${map(
											this.mineFilterOptions,
											({ label, value }, i) => html`
												<gk-menu-item
													data-value="${value}"
													?disabled=${this.selectedMineFilter
														? value === this.selectedMineFilter
														: i === 0}
													>${label}</gk-menu-item
												>
											`,
										)}
									</gk-menu>
								</gk-popover>
							</div>
							<div class="app__header-group">
								<gk-input
									class="app__search"
									label="Search field"
									label-visibility="sr-only"
									placeholder="Search"
									@input=${debounce(this.onSearchInput.bind(this), 200)}
								>
									<code-icon slot="prefix" icon="search"></code-icon>
								</gk-input>
							</div>
						</header>
						<main class="app__main">
							<gk-focus-container id="list-focus-items">
								<span slot="pin">
									<code-icon icon="pinned"></code-icon>
								</span>
								<span slot="key"><code-icon icon="circle-large-outline"></code-icon></span>
								<span slot="date"><code-icon icon="gl-clock"></code-icon></span>
								<span slot="repo">Repo / Branch</span>
								${this.focusItemsContent()}
							</gk-focus-container>
						</main>
					</div>
				</div>
			</div>
		`;
	}

	onSearchInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const value = input.value;

		if (value === '' || value.length < 3) {
			this.searchText = undefined;
			return;
		}

		this.searchText = value;
	}

	onSelectMineFilter(e: CustomEvent<{ target: MenuItem }>) {
		const target = e.detail?.target;
		if (target?.dataset?.value != null) {
			this.selectedMineFilter = target.dataset.value;

			const menuEl: Popover | null = target.closest('gk-popover');
			menuEl?.hidePopover();
		}
	}

	protected override createRenderRoot() {
		return this;
	}
}
