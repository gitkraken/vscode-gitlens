import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { Commands } from '../../../../../constants.commands';
import { createCommandLink } from '../../../../../system/commands';
import type { GetOverviewBranch, OpenInGraphParams } from '../../../../home/protocol';
import type { GlCard } from '../../../shared/components/card/card';
import { srOnlyStyles } from '../../../shared/components/styles/lit/a11y.css';
import { linkStyles } from '../../shared/components/vscode.css';
import '../../../shared/components/code-icon';
import '../../../shared/components/avatar/avatar';
import '../../../shared/components/avatar/avatar-list';
import '../../../shared/components/commit/commit-stats';
import '../../../shared/components/formatted-date';
import '../../../shared/components/pills/tracking';
import '../../../shared/components/rich/issue-icon';
import '../../../shared/components/rich/pr-icon';
import '../../../shared/components/actions/action-item';
import '../../../shared/components/actions/action-nav';

export const branchCardStyles = css`
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

	.branch-item__grouping {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		max-width: 100%;
		margin-block: 0;
	}

	.branch-item__grouping--secondary,
	.branch-item__grouping--mergingRebasing {
		gap: 0.3rem;
		font-size: 0.9em;
	}

	.branch-item__grouping--secondary {
		color: var(--vscode-descriptionForeground);
	}

	.branch-item__grouping--mergingRebasing {
		color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}
	.branch-item__grouping--mergingRebasing.has-conflicts {
		color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
	}

	.branch-item__grouping--secondary .branch-item__name,
	.branch-item__grouping--mergingRebasing .branch-item__name {
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
		background-color: var(--gl-card-hover-background);
	}

	.branch-item:not(:focus-within):not(:hover) .branch-item__actions {
		${srOnlyStyles}
	}

	.pill {
		--gl-pill-border: color-mix(in srgb, transparent 80%, var(--color-foreground));
	}

	.branch-item__indicator {
		color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingForegroundColor);
	}
	.branch-item__indicator.has-conflicts {
		color: var(--vscode-gitlens-decorations\\.statusMergingOrRebasingConflictForegroundColor);
	}

	.work-item {
		--gl-card-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 3%);
		--gl-card-hover-background: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 1.5%);
	}
	.work-item::part(base) {
		margin-block-end: 0;
	}

	.branch-item__section.mb-1 {
		margin-block: 0.4rem;
	}
`;

export abstract class GlBranchCardBase extends LitElement {
	static override styles = [linkStyles, branchCardStyles];

	@property()
	repo!: string;

	@property({ type: Object })
	branch!: GetOverviewBranch;

	@property({ type: Boolean, reflect: true })
	busy = false;

	get branchRefs() {
		return {
			repoPath: this.repo,
			branchId: this.branch.id,
		};
	}

	get isWorktree() {
		return this.branch.worktree != null;
	}

	get isPr() {
		return this.branch.pr != null;
	}

	get cardIndicator() {
		const isMerging = this.branch.mergeStatus != null;
		const isRabasing = this.branch.rebaseStatus != null;
		if (isMerging || isRabasing) {
			if (this.branch.hasConflicts) {
				return 'conflict';
			}
			return isMerging ? 'merging' : 'rebasing';
		}
		return this.branch.opened ? 'active' : undefined;
	}

	protected renderAutolinks() {
		const { autolinks } = this.branch;
		if (!autolinks) return nothing;

		return html`
			${autolinks.map(autolink => {
				return html`
					<p class="branch-item__grouping">
						<span class="branch-item__icon">
							<issue-icon state=${autolink.state} issue-id=${autolink.id}></issue-icon>
						</span>
						<a href=${autolink.url} class="branch-item__name">${autolink.title}</a>
						<span class="branch-item__identifier">#${autolink.id}</span>
					</p>
				`;
			})}
		`;
	}

	protected renderWip() {
		const { workingTreeState } = this.branch;
		if (workingTreeState == null) return nothing;

		return html`<commit-stats
			added=${workingTreeState.added}
			modified=${workingTreeState.changed}
			removed=${workingTreeState.deleted}
			symbol="icons"
		></commit-stats>`;
	}

	protected renderAvatars() {
		const { owner, contributors } = this.branch;

		const avatars = [];

		if (owner) {
			avatars.push(owner);
		}

		if (contributors) {
			contributors.push(...contributors);
		}

		if (avatars.length === 0) {
			return undefined;
		}

		return html`<gl-avatar-list
			.avatars=${avatars.map(a => ({ name: a.name, src: a.avatarUrl }))}
		></gl-avatar-list>`;
	}

	protected renderTracking() {
		const { state } = this.branch;
		if (state == null) return nothing;

		return html`<gl-tracking-pill
			class="pill"
			colorized
			outlined
			ahead=${state.ahead}
			behind=${state.behind}
		></gl-tracking-pill>`;
	}

	protected abstract getActions(): TemplateResult[];
	protected renderActions() {
		const actions = this.getActions?.();
		if (!actions?.length) return nothing;

		return html`<action-nav class="branch-item__actions">${actions}</action-nav>`;
	}

	protected createCommandLink(command: Commands) {
		return createCommandLink(command, this.branchRefs);
	}

	protected renderTimestamp() {
		const { timestamp } = this.branch;
		if (timestamp == null) return nothing;

		return html`<formatted-date .date=${new Date(timestamp)} class="branch-item__date"></formatted-date>`;
	}

	protected renderBranchItem() {
		const wip = this.renderWip();
		const tracking = this.renderTracking();
		const avatars = this.renderAvatars();

		return html`
			<gl-work-item class="is-expanded" ?primary=${!this.branch.opened} .indicator=${this.cardIndicator}>
				<div class="branch-item__section">
					<p class="branch-item__grouping">
						<span class="branch-item__icon">
							<code-icon icon=${this.branch.worktree ? 'gl-worktrees-view' : 'git-branch'}></code-icon>
						</span>
						<span class="branch-item__name">${this.branch.name}</span>
					</p>
				</div>
				<div class="branch-item__section branch-item__section--details" slot="context">
					${when(
						wip || tracking || avatars,
						() => html`<p class="branch-item__changes">${wip}${tracking}${avatars}</p>`,
					)}
					${this.renderTimestamp()}
				</div>
			</gl-work-item>
		`;
	}

	protected renderPrItem() {
		if (!this.branch.pr) return nothing;

		return html`
			<gl-work-item class="is-expanded">
				<div class="branch-item__section">
					<p class="branch-item__grouping">
						<span class="branch-item__icon">
							<pr-icon state=${this.branch.pr.state} pr-id=${this.branch.pr.id}></pr-icon>
						</span>
						<a href=${this.branch.pr.url} class="branch-item__name">${this.branch.pr.title}</a>
						<span class="branch-item__identifier">#${this.branch.pr.id}</span>
					</p>
				</div>
			</gl-work-item>
		`;
	}

	protected renderAutolinksItem() {
		if (!this.branch.autolinks?.length) return nothing;

		return html`
			<gl-work-item class="is-expanded">
				<div class="branch-item__section">${this.renderAutolinks()}</div>
			</gl-work-item>
		`;
	}
}

@customElement('gl-branch-card')
export class GlBranchCard extends GlBranchCardBase {
	override render() {
		return html`
			<gl-card class="branch-item" .indicator=${this.cardIndicator}>
				<div class="branch-item__container">
					${this.renderBranchItem()}${this.renderPrItem()}${this.renderAutolinksItem()}
				</div>
				${this.renderActions()}
			</gl-card>
		`;
	}

	protected getActions() {
		const actions = [];
		if (this.branch.pr) {
			actions.push(
				html`<action-item
					label="Open Pull Request Changes"
					icon="request-changes"
					href=${this.createCommandLink('gitlens.home.openPullRequestChanges')}
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
				icon="repo-fetch"
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

		return actions;
	}
}

@customElement('gl-work-item')
export class GlWorkUnit extends LitElement {
	static override styles = [
		css`
			.work-item {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
			}

			.work-item__content {
				display: none;
				flex-direction: column;
				gap: 0.8rem;
			}

			:host-context(.is-expanded) .work-item__content {
				display: flex;
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	primary: boolean = false;

	@property({ reflect: true })
	indicator?: GlCard['indicator'];

	override render() {
		// if (this.primary) {
		// 	return html`${this.renderContent()}`;
		// }

		return html`<gl-card
			.density=${this.primary ? 'tight' : undefined}
			.grouping=${this.primary ? 'item-primary' : 'item'}
			.indicator=${this.indicator}
			>${this.renderContent()}</gl-card
		>`;
	}

	private renderContent() {
		return html`
			<div class="work-item">
				<header class="work-item__main">
					<slot></slot>
				</header>
				<div class="work-item__content">
					<slot class="work-item__context" name="context"></slot>
					<slot class="work-item__actions" name="actions"></slot>
				</div>
			</div>
		`;
	}
}
