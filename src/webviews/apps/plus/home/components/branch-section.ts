import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { Commands } from '../../../../../constants.commands';
import type { GitTrackingState } from '../../../../../git/models/branch';
import type { GetOverviewBranch, OpenInGraphParams } from '../../../../home/protocol';
import { srOnlyStyles } from '../../../shared/components/styles/lit/a11y.css';
import { linkStyles } from '../../shared/components/vscode.css';
import '../../../shared/components/code-icon';
import '../../../shared/components/progress';
import '../../../shared/components/avatar/avatar';
import '../../../shared/components/avatar/avatar-list';
import '../../../shared/components/card/card';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/formatted-date';
import '../../../shared/components/pills/tracking';
import '../../../shared/components/rich/pr-icon';
import '../../../shared/components/actions/action-item';
import '../../../shared/components/actions/action-nav';

type OverviewBranch = GetOverviewBranch;

@customElement('gl-section')
export class GlSection extends LitElement {
	static override styles = [
		css`
			.section {
				margin-bottom: 1.2rem;
			}
			.section__header {
				position: relative;
				display: flex;
				justify-content: space-between;
				gap: 8px;
				margin-block: 0 0.8rem;
			}
			.section__heading {
				flex: 1;
				font-size: 1.3rem;
			}
			.section__headline {
				font-weight: normal;
				text-transform: uppercase;
			}

			.section__actions {
				margin-inline-start: auto;
			}

			.section__loader {
				position: absolute;
				left: 0;
				bottom: 0;
			}
		`,
	];

	@property({ type: Boolean })
	loading = false;

	@property({ attribute: 'heading-level' })
	headingLevel: ARIAMixin['ariaLevel'] = '3';

	override render() {
		return html`
			<div class="section">
				<header class="section__header">
					<div class="section__heading" role="heading" aria-level=${this.headingLevel}>
						<slot name="heading" class="section__headline"></slot>
					</div>
					<slot name="heading-actions" class="section__actions"></slot>
					<progress-indicator class="section__loader" ?active="${this.loading}"></progress-indicator>
				</header>
				<slot></slot>
			</div>
		`;
	}
}

@customElement('gl-branch-section')
export class GlBranchSection extends LitElement {
	@property({ type: String }) label!: string;
	@property() repo!: string;
	@property({ type: Array }) branches!: GetOverviewBranch[];
	@property({ type: Boolean }) isFetching = false;

	private renderSectionLabel() {
		if (this.isFetching || this.branches.length === 0) {
			return this.label;
		}

		return `${this.label} (${this.branches.length})`;
	}

	override render() {
		return html`
			<gl-section ?loading=${this.isFetching}>
				<span slot="heading">${this.renderSectionLabel()}</span>
				<span slot="heading-actions"><slot name="heading-actions"></slot></span>
				${when(
					this.branches.length > 0,
					() =>
						this.branches.map(
							branch => html`<gl-branch-card .repo=${this.repo} .branch=${branch}></gl-branch-card>`,
						),
					() => html`<p>No ${this.label} branches</p>`,
				)}
			</gl-section>
		`;
	}
}

export const headingLoaderStyles = css`
	.heading-loader {
		flex: 1;
	}
`;

export const branchCardStyles = css`
	:host {
		--gl-card-hover-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 8%);
	}
	.branch-item {
		position: relative;
	}

	.branch-item__container {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.branch-item__container > * {
		margin-block: 0;
	}

	.branch-item__section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.branch-item__section > * {
		margin-block: 0;
	}

	.branch-item__section--details {
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
	}

	.branch-item__icon {
		color: var(--vscode-descriptionForeground);
	}

	.branch-item__name {
		flex-grow: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: bold;
	}

	.branch-item__identifier {
		color: var(--vscode-descriptionForeground);
		text-decoration: none;
	}

	.branch-item__identifier:hover {
		text-decoration: underline;
	}

	.branch-item__grouping {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		max-width: 100%;
		margin-block: 0;
	}

	.branch-item__grouping--secondary {
		gap: 0.3rem;
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
	}
	.branch-item__grouping--secondary .branch-item__name {
		font-weight: normal;
	}

	.branch-item__changes {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.branch-item__actions {
		position: absolute;
		right: 0.4rem;
		bottom: 0.4rem;
		padding: 0.2rem 0.4rem;
		background-color: var(--gl-card-background);
	}

	.branch-item:hover .branch-item__actions,
	.branch-item:focus-within .branch-item__actions {
		background-color: var(--gl-card-hover-background);
	}
	.branch-item:not(:focus-within):not(:hover) .branch-item__actions {
		${srOnlyStyles}
	}

	.pill {
		--gl-pill-border: color-mix(in srgb, transparent 80%, var(--color-foreground));
	}
`;

@customElement('gl-branch-card')
export class GlBranchCard extends LitElement {
	static override styles = [linkStyles, branchCardStyles];

	@property()
	repo!: string;

	@property({ type: Object })
	branch!: GetOverviewBranch;

	get branchRefs() {
		return {
			repoPath: this.repo,
			branchId: this.branch.id,
		};
	}

	override render() {
		const { name, pr, opened: active, timestamp: date } = this.branch;
		return html`
			<gl-card class="branch-item" .active=${active}>
				<div class="branch-item__container">
					<div class="branch-item__section">
						<p class="branch-item__grouping">
							<span class="branch-item__icon">${this.renderIcon(this.branch)}</span>
							${when(
								pr,
								pr =>
									html`<span class="branch-item__name">${pr.title} </span
										><a href=${pr.url} class="branch-item__identifier">#${pr.id}</a>`,
								() => html`<span class="branch-item__name">${name}</span>`,
							)}
						</p>
						${this.renderPrBranch(this.branch)}
					</div>
					<div class="branch-item__section branch-item__section--details">
						${this.renderChanges(this.branch)}
						${when(
							date,
							() =>
								html`<p>
									<formatted-date .date=${new Date(date!)} class="branch-item__date"></formatted-date>
								</p>`,
						)}
					</div>
				</div>
				${this.renderActions()}
			</gl-card>
		`;
	}

	private renderPrBranch(branch: OverviewBranch) {
		if (!branch.pr) {
			return nothing;
		}
		return html`
			<p class="branch-item__grouping branch-item__grouping--secondary">
				<span class="branch-item__icon">${this.renderIcon(branch, true)}</span
				><span class="branch-item__name">${branch.name}</span>
			</p>
		`;
	}

	private renderChanges(branch: OverviewBranch) {
		const { state, workingTreeState } = branch;

		const wip = this.renderWip(workingTreeState);
		const tracking = this.renderTracking(state);
		const avatars = this.renderAvatars(branch);
		if (wip || tracking || avatars) {
			return html`<p class="branch-item__changes">${wip}${tracking}${avatars}</p>`;
		}

		return nothing;
	}

	private renderIcon(branch: OverviewBranch, noPr?: boolean) {
		if (branch.pr && !noPr) {
			return html`<pr-icon state=${branch.pr.state} pr-id=${branch.pr.id}></pr-icon>`;
		}
		if (branch.worktree) {
			return html`<code-icon icon="gl-worktrees-view"></code-icon>`;
		}
		return html`<code-icon icon="git-branch"></code-icon>`;
	}

	private renderAvatars(branch: GetOverviewBranch) {
		const contributors = [];

		if (branch.owner) {
			contributors.push(branch.owner);
		}

		if (branch.contributors) {
			contributors.push(...branch.contributors);
		}

		if (contributors.length === 0) {
			return undefined;
		}

		return html`<gl-avatar-list
			.avatars=${contributors.map(a => ({ name: a.name, src: a.avatarUrl }))}
		></gl-avatar-list>`;
	}

	private renderWip(workingTreeState: { added: number; changed: number; deleted: number } | undefined) {
		if (workingTreeState?.added || workingTreeState?.changed || workingTreeState?.deleted) {
			return html`<commit-stats
				added=${workingTreeState.added}
				modified=${workingTreeState.changed}
				removed=${workingTreeState.deleted}
				symbol="icons"
			></commit-stats>`;
		}

		return undefined;
	}

	private renderTracking(state: GitTrackingState | undefined) {
		if (state?.ahead || state?.behind) {
			// if (state.ahead) {
			// 	rendered.push(html`<span class="pill">${state.ahead}<code-icon icon="arrow-up"></code-icon></span>`);
			// }
			// if (state.behind) {
			// 	rendered.push(html`<span class="pill">${state.behind}<code-icon icon="arrow-down"></code-icon></span>`);
			// }
			return html`<gl-tracking-pill
				class="pill"
				colorized
				outlined
				ahead=${state.ahead}
				behind=${state.behind}
			></gl-tracking-pill>`;
		}

		return undefined;
	}

	private renderActions() {
		const actions = [];
		if (this.branch.pr) {
			actions.push(
				html`<action-item
					label="Open Pull Request Changes"
					icon="request-changes"
					href=${this.createCommandLink('gitlens.home.openPullRequestComparison')}
				></action-item>`,
			);
			actions.push(
				html`<action-item
					label="Open Pull Request on Remote"
					icon="globe"
					href=${this.createCommandLink('gitlens.home.openPullRequestOnRemote')}
				></action-item>`,
			);
		} else if (this.branch.upstream?.missing === false) {
			actions.push(
				html`<action-item
					label="Create Pull Request..."
					icon="git-pull-request-create"
					href=${this.createCommandLink('gitlens.home.createPullRequest')}
				></action-item>`,
			);
		}
		if (this.branch.worktree) {
			actions.push(
				html`<action-item
					label="Open Worktree"
					icon="browser"
					href=${this.createCommandLink('gitlens.home.openWorktree')}
				></action-item>`,
			);
		} else {
			actions.push(
				html`<action-item
					label="Switch to Branch..."
					icon="gl-switch"
					href=${this.createCommandLink('gitlens.home.switchToBranch')}
				></action-item>`,
			);
		}

		// branch actions
		actions.push(
			html`<action-item
				label="Fetch"
				icon="gl-repo-fetch"
				href=${this.createCommandLink('gitlens.home.fetch')}
			></action-item>`,
		);
		actions.push(
			html`<action-item
				label="Open in Commit Graph"
				icon="gl-graph"
				href=${createCommandLink('gitlens.home.openInGraph', {
					...this.branchRefs,
					type: 'branch',
				} satisfies OpenInGraphParams)}
			></action-item>`,
		);

		if (!actions.length) {
			return nothing;
		}
		return html`<action-nav class="branch-item__actions">${actions}</action-nav>`;
	}

	private createCommandLink(command: string) {
		return createCommandLink(command, this.branchRefs);
	}
}

export function createCommandLink<T>(command: Commands | string, args: T) {
	if (args == null) return `command:${command}`;

	return `command:${command}?${encodeURIComponent(typeof args === 'string' ? args : JSON.stringify(args))}`;
}
