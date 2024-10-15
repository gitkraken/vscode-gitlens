import { consume } from '@lit/context';
import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { PullRequestShape } from '../../../../git/models/pullRequest';
import { isSubscriptionPaid } from '../../../../plus/gk/account/subscription';
import type { State } from '../../../../plus/webviews/graph/protocol';
import { createWebviewCommandLink } from '../../../../system/webview';
import { createCommandLink } from '../../shared/commands';
import { GlElement } from '../../shared/components/element';
import { graphBaselineStyles } from './graph.css';
import { stateContext } from './stateProvider';
import { titleBarStyles } from './titlebar/titlebar.css';

@customElement('gl-graph-header')
export class GlGraphHeader extends GlElement {
	static override styles = [graphBaselineStyles, titleBarStyles];

	@consume({ context: stateContext, subscribe: true })
	@state()
	state!: State;

	get repo() {
		return this.state.repositories?.find(r => r.id === this.state.selectedRepository);
	}

	override render() {
		return html`
			<div class="titlebar">
				<div class="titlebar__row">
					<div className="titlebar__group">${this.renderRepoActions()}</div>
					<div className="titlebar__group">
						<gl-tooltip placement="bottom">
							<a
								href=${`command:gitlens.showLaunchpad?${encodeURIComponent(
									JSON.stringify({
										source: 'graph',
									}),
								)}`}
								class="action-button"
							>
								<span class="codicon codicon-rocket"></span>
							</a>
							<span slot="content">
								<span style="white-space: break-spaces">
									<strong>Launchpad</strong> &mdash; organizes your pull requests into actionable
									groups to help you focus and keep your team unblocked
								</span>
							</span>
						</gl-tooltip>
						${this.state.subscription == null || !isSubscriptionPaid(this.state.subscription)
							? html`
									<gl-feature-badge
										.source=${{ source: 'graph', detail: 'badge' }}
										.subscription=${this.state.subscription}
									></gl-feature-badge>
							  `
							: ''}
					</div>
				</div>
			</div>
		`;
	}

	private renderRepoActions() {
		if (this.repo == null) return undefined;

		const { provider, formattedName } = this.repo;
		const repoCount = this.state.repositories?.length ?? 0;

		return html`
			${when(
				provider?.url,
				() => html`
					<gl-tooltip placement="bottom">
						<a
							href=${provider!.url}
							class="action-button"
							style="margin-right: -0.5rem"
							aria-label="Open Repository on ${provider!.name}"
						>
							<code-icon
								class="action-button__icon"
								icon=${provider!.icon === 'cloud' ? 'cloud' : `gl-provider-${provider!.icon}`}
								aria-hidden="true"
							></code-icon>
						</a>
						<span slot="content">Open Repository on ${provider!.name}</span>
					</gl-tooltip>
				`,
			)}
			${when(
				provider?.connected !== true,
				() => html`
					<gl-connect
						type="action"
						.connected=${false}
						.integration=${provider!.name}
						.connectUrl=${createCommandLink('gitlens.plus.cloudIntegrations.connect', {
							args: {
								source: 'graph',
							},
						})}
					></gl-connect>
				`,
			)}
			<gl-tooltip placement="bottom">
				<button
					type="button"
					class="action-button"
					aria-label="Switch to Another Repository..."
					?disabled=${repoCount < 2}
					@click=${this.handleChooseRepository}
				>
					${formattedName ?? 'none selected'}
					${when(
						repoCount > 1,
						() =>
							html`<code-icon
								class="action-button__more"
								icon="chevron-down"
								aria-hidden="true"
							></code-icon>`,
					)}
				</button>
				<span slot="content">Switch to Another Repository...</span>
			</gl-tooltip>
			${when(
				this.state.allowed,
				() => html`
					<span><code-icon icon="chevron-right"></code-icon></span>
					${when(
						this.state.branchState?.pr,
						() => html`
							<gl-popover placement="bottom">
								<button slot="anchor" type="button" class="action-button">
									<gl-issue-pull-request
										type="pr"
										.identifier=${`#${this.state.branchState!.pr!.id}`}
										.status=${this.state.branchState!.pr!.state}
										compact
									></gl-issue-pull-request>
								</button>
								<div slot="content">
									<gl-issue-pull-request
										type="pr"
										.name=${this.state.branchState!.pr!.title}
										.url=${this.state.branchState!.pr!.url}
										.identifier=${`#${this.state.branchState!.pr!.id}`}
										.status=${this.state.branchState!.pr!.state}
										.date=${this.state.branchState!.pr!.updatedDate}
										.dateFormat=${this.state.config?.dateFormat}
										.dateStyle=${this.state.config?.dateStyle}
										details
										@open-details=${() => {
											if (this.state.branchState?.pr?.id) {
												this.onOpenPullRequest(this.state.branchState.pr);
											}
										}}
									></gl-issue-pull-request>
								</div>
							</gl-popover>
						`,
					)}
					<gl-popover placement="bottom">
						<a
							slot="anchor"
							href=${createWebviewCommandLink(
								'gitlens.graph.switchToAnotherBranch',
								this.state.webviewId,
								this.state.webviewInstanceId,
							)}
							class="action-button"
							style=${this.state.branchState?.pr ? 'margin-left: -0.6rem' : ''}
							aria-label="Switch to Another Branch..."
						>
							${when(
								!this.state.branchState?.pr,
								() =>
									html`<code-icon
										icon=${(this.state.branchState! as any).worktree
											? 'gl-repositories-view'
											: 'git-branch'}
										aria-hidden="true"
									></code-icon>`,
							)}
							${this.state.branchName}
							<code-icon icon="chevron-down" class="action-button__more" aria-hidden="true"></code-icon>
						</a>
						<div slot="content">
							<span>
								Switch to Another Branch...
								<hr />
								<code-icon icon="git-branch" aria-hidden="true"></code-icon>
								<span class="md-code">${this.state.branchName}</span>
								${when((this.state.branchState! as any).worktree, () => html`<i> (in a worktree)</i>`)}
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
					<span><code-icon icon="chevron-right"></code-icon></span>
					${this.renderBranchActions()}
				`,
			)}
		`;
	}

	private onOpenPullRequest(_pr: PullRequestShape) {
		// TODO
	}

	private handleJumpToRef() {
		// TODO
	}

	private handleChooseRepository() {
		// TODO
	}

	private renderBranchActions() {
		return nothing;
	}
}
