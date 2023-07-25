import { html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { map } from 'lit/directives/map.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { State } from '../../../../../plus/webviews/focus/protocol';
import { debounce } from '../../../../../system/function';
import type { FeatureGate } from '../../../shared/components/feature-gate';
import type { FeatureGateBadge } from '../../../shared/components/feature-gate-badge';

@customElement('gl-focus-app')
export class GlFocusApp extends LitElement {
	private readonly tabFilters = ['authored', 'assigned', 'review-requested', 'mentioned'];
	private readonly tabFilterOptions = [
		{ label: 'All', value: '' },
		{ label: 'Opened by Me', value: 'authored' },
		{ label: 'Assigned to Me', value: 'assigned' },
		{ label: 'Needs my Review', value: 'review-requested' },
		{ label: 'Mentions Me', value: 'mentioned' },
	];
	@query('#subscription-gate', true)
	private subscriptionEl!: FeatureGate;

	@query('#connection-gate', true)
	private connectionEl!: FeatureGate;

	@query('#subscription-gate-badge', true)
	private subScriptionBadgeEl!: FeatureGateBadge;

	@state()
	private selectedTabFilter?: string;

	@state()
	private searchText?: string;

	@property({ type: Object })
	state?: State;

	get subscriptionState() {
		return this.state?.access.subscription.current;
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

	get items() {
		if (this.isLoading) {
			return [];
		}

		const items: { isPullrequest: boolean; rank: number; state: Record<string, any>; reasons: string[] }[] = [];

		let rank = 0;
		this.state?.pullRequests?.forEach(
			({ pullRequest, reasons, isCurrentBranch, isCurrentWorktree, hasWorktree, hasLocalBranch }) => {
				items.push({
					isPullrequest: true,
					state: {
						pullRequest: pullRequest,
						isCurrentBranch: isCurrentBranch,
						isCurrentWorktree: isCurrentWorktree,
						hasWorktree: hasWorktree,
						hasLocalBranch: hasLocalBranch,
					},
					rank: ++rank,
					reasons: reasons,
				});
			},
		);

		this.state?.issues?.forEach(({ issue, reasons }) => {
			items.push({
				isPullrequest: false,
				rank: ++rank,
				state: {
					issue: issue,
				},
				reasons: reasons,
			});
		});

		return items;
	}

	get filteredItems() {
		if (this.items.length === 0) {
			return this.items;
		}

		const hasSearch = this.searchText != null && this.searchText !== '';
		const hasTabFilter = this.selectedTabFilter != null && this.selectedTabFilter !== '';
		if (!hasSearch && !hasTabFilter) {
			return this.items;
		}

		const searchText = this.searchText?.toLowerCase();
		return this.items.filter(i => {
			if (hasTabFilter && !i.reasons.includes(this.selectedTabFilter!)) {
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

	get isLoading() {
		return this.state?.pullRequests == null || this.state?.issues == null;
	}

	override render() {
		if (this.state == null) {
			return undefined;
		}

		return html`
			<div class="app">
				<header class="app__header">
					<span class="badge">Preview</span>
					<gk-feature-gate-badge
						.subscription=${this.subscriptionState}
						id="subscription-gate-badge"
					></gk-feature-gate-badge>
					<gk-button
						appearance="toolbar"
						href="https://github.com/gitkraken/vscode-gitlens/discussions/2535"
						title="Focus View Feedback"
						aria-label="Focus View Feedback"
						><code-icon icon="feedback"></code-icon
					></gk-button>
				</header>

				<div class="app__content">
					<gk-feature-gate
						.state=${this.subscriptionState?.state}
						.visible=${this.showFeatureGate}
						id="subscription-gate"
						class="scrollable"
						><p slot="feature">
							Brings all of your GitHub pull requests and issues into a unified actionable view to help to
							you more easily juggle work in progress, pending work, reviews, and more. Quickly see if
							anything requires your attention while keeping you focused.
						</p></gk-feature-gate
					>
					<gk-feature-gate .visible=${this.showConnectionGate} id="connection-gate" class="scrollable">
						<h3>No GitHub remotes are connected</h3>
						<p>
							This enables access to Pull Requests and Issues in the Focus View as well as provide
							additional information inside hovers and the Commit Details view, such as auto-linked issues
							and pull requests and avatars.
						</p>
						<gk-button appearance="alert" href="command:gitlens.connectRemoteProvider"
							>Connect to GitHub</gk-button
						>
					</gk-feature-gate>

					<main class="app__main">
						<section class="focus-section app__section">
							<header class="focus-section__header">
								<div class="focus-section__header-group">
									<nav class="tab-filter" id="filter-focus-items">
										${map(
											this.tabFilterOptions,
											({ label, value }, i) => html`
												<button
													class="tab-filter__tab ${(
														this.selectedTabFilter
															? value === this.selectedTabFilter
															: i === 0
													)
														? 'is-active'
														: ''}"
													type="button"
													data-tab="${value}"
													@click=${() => (this.selectedTabFilter = value)}
												>
													${label}
												</button>
											`,
										)}
									</nav>
								</div>
								<div class="focus-section__header-group">
									<gk-input
										class="search"
										label="Search field"
										label-visibility="sr-only"
										placeholder="Search"
										@input=${debounce(this.onSearchInput.bind(this), 200)}
									>
										<code-icon slot="prefix" icon="search"></code-icon>
									</gk-input>
								</div>
							</header>
							<div class="focus-section__content">
								<gk-focus-container id="list-focus-items">
									${when(
										this.isLoading,
										() => html`
											<div class="alert">
												<span class="alert__content"
													><code-icon modifier="spin" icon="loading"></code-icon>
													Loading</span
												>
											</div>
										`,
										() =>
											when(
												this.filteredItems.length > 0,
												() => html`
													${repeat(
														this.filteredItems,
														item => item.rank,
														({ isPullrequest, rank, state }) =>
															when(
																isPullrequest,
																() =>
																	html`<gk-pull-request-row
																		.rank=${rank}
																		.pullRequest=${state.pullRequest}
																	></gk-pull-request-row>`,
																() =>
																	html`<gk-issue-row
																		.rank=${rank}
																		.issue=${state.issue}
																	></gk-issue-row>`,
															),
													)}
												`,
												() => html`
													<div class="alert">
														<span class="alert__content">None found</span>
													</div>
												`,
											),
									)}
								</gk-focus-container>
							</div>
						</section>
					</main>
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

	protected override createRenderRoot() {
		return this;
	}
}
