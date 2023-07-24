import { html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import type { State } from '../../../../../plus/webviews/focus/protocol';
import type { FeatureGate } from '../../../shared/components/feature-gate';
import type { FeatureGateBadge } from '../../../shared/components/feature-gate-badge';

@customElement('gl-focus-app')
export class GlFocusApp extends LitElement {
	@query('#subscription-gate', true)
	private subscriptionEl!: FeatureGate;

	@query('#connection-gate', true)
	private connectionEl!: FeatureGate;

	@query('#subscription-gate-badge', true)
	private subScriptionBadgeEl!: FeatureGateBadge;

	@state()
	private focusFilter?: string;

	@state()
	private loading = true;

	@property({ type: Object })
	state?: State;

	get subscriptionState() {
		return this.state?.access.subscription.current;
	}

	get showSubscriptionGate() {
		return this.state?.access.allowed === false;
	}

	get showConnectionGate() {
		return this.state?.access.allowed === true && !(this.state?.repos?.some(r => r.isConnected) ?? false);
	}

	get filteredItems() {
		const items: { isPullrequest: boolean; rank: number; state: Record<string, any> }[] = [];

		let rank = 0;
		this.state?.pullRequests?.forEach(
			({ pullRequest, reasons, isCurrentBranch, isCurrentWorktree, hasWorktree, hasLocalBranch }, i) => {
				if (this.focusFilter == null || this.focusFilter === '' || reasons.includes(this.focusFilter)) {
					items.push({
						isPullrequest: true,
						state: {
							pullRequest: pullRequest,
							// reasons: reasons,
							isCurrentBranch: isCurrentBranch,
							isCurrentWorktree: isCurrentWorktree,
							hasWorktree: hasWorktree,
							hasLocalBranch: hasLocalBranch,
						},
						rank: ++rank,
					});
				}
			},
		);

		this.state?.issues?.forEach(({ issue, reasons }) => {
			if (this.focusFilter == null || this.focusFilter === '' || reasons.includes(this.focusFilter)) {
				items.push({
					isPullrequest: false,
					rank: ++rank,
					state: {
						issue: issue,
					},
				});
			}
		});

		return items;
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

				<div class="app__content" id="content">
					<gk-feature-gate .state=${this.subscriptionState?.state} id="subscription-gate" class="scrollable"
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
										<button class="tab-filter__tab is-active" type="button" data-tab="">All</button>
										<button class="tab-filter__tab" type="button" data-tab="authored">
											Opened by Me
										</button>
										<button class="tab-filter__tab" type="button" data-tab="assigned">
											Assigned to Me
										</button>
										<button class="tab-filter__tab" type="button" data-tab="review-requested">
											Needs my Review
										</button>
										<button class="tab-filter__tab" type="button" data-tab="mentioned">
											Mentions Me
										</button>
									</nav>
								</div>
								<div class="focus-section__header-group">
									<gk-input
										class="search"
										label="Search field"
										label-visibility="sr-only"
										placeholder="Search"
									>
										<code-icon slot="prefix" icon="search"></code-icon>
									</gk-input>
								</div>
							</header>
							<div class="focus-section__content">
								<gk-focus-container id="list-focus-items">
									${when(
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
									)}
								</gk-focus-container>
								<div class="alert" id="loading-focus-items">
									<span class="alert__content"
										><code-icon modifier="spin" icon="loading"></code-icon> Loading</span
									>
								</div>
								<div class="alert" id="no-focus-items">
									<span class="alert__content">None found</span>
								</div>
							</div>
						</section>
					</main>
				</div>
			</div>
		`;
	}

	protected override createRenderRoot() {
		return this;
	}
}
