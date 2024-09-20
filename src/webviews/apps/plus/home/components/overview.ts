import { consume } from '@lit/context';
import { Task } from '@lit/task';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitTrackingState } from '../../../../../git/models/branch';
import { fromNow } from '../../../../../system/date';
import type { GetOverviewBranch, GetOverviewResponse } from '../../../../home/protocol';
import { GetOverview } from '../../../../home/protocol';
import { ipcContext } from '../../../shared/context';
import type { Disposable } from '../../../shared/events';
import type { HostIpc } from '../../../shared/ipc';
import '../../../shared/components/code-icon';

type Overview = GetOverviewResponse;
type OverviewBranch = GetOverviewBranch;

@customElement('gl-overview')
export class GlOverview extends LitElement {
	static override styles = css`
		h2 {
			font-size: 1.4rem;
			margin-block: 0 1.4rem;
		}

		.repository {
			color: var(--vscode-foreground);
		}
	`;

	@consume({ context: ipcContext })
	private _ipc!: HostIpc;
	private _disposable: Disposable | undefined;
	private _overviewTask = new Task(this, {
		args: () => [this.fetchOverview()],
		task: ([overview]) => overview,
		autoRun: false,
	});

	override disconnectedCallback() {
		super.disconnectedCallback();

		this._disposable?.dispose();
	}

	private _overview: Promise<Overview | undefined> | undefined;
	private async fetchOverview() {
		if (this._overview == null) {
			const ipc = this._ipc;
			if (ipc != null) {
				async function fetch() {
					const rsp = await ipc.sendRequest(GetOverview, {});
					return rsp;
				}
				this._overview = fetch();
			} else {
				this._overview = Promise.resolve(undefined);
			}
		}
		return this._overview;
	}

	override render() {
		return html`<div>${this.renderOverviewResult()}</div>`;
	}

	private renderOverviewResult() {
		if (this._overview == null) {
			void this._overviewTask.run();
		}

		return this._overviewTask.render({
			pending: () => html`<span>Loading...</span>`,
			complete: summary => this.renderOverview(summary),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderOverview(overview: Overview | undefined) {
		if (overview == null) return [nothing];

		const { repository } = overview;
		return html`
			<div class="repository">
				<h2>${repository.name}</h2>
				<gl-branch-section
					label="ACTIVE (${repository.branches.active.length})"
					.branches=${repository.branches.active}
				></gl-branch-section>
				<gl-branch-section
					label="RECENTLY MODIFIED (${repository.branches.recent.length})"
					.branches=${repository.branches.recent}
				></gl-branch-section>
				<gl-branch-section
					label="STALE (${repository.branches.stale.length})"
					.branches=${repository.branches.stale}
				></gl-branch-section>
			</div>
		`;
	}
}

@customElement('gl-branch-section')
export class GlBranchSection extends LitElement {
	static override styles = css`
		h3 {
			font-size: 1.3rem;
			font-weight: normal;
			margin-block: 0 0.8rem;
		}

		.section {
			margin-bottom: 1.2rem;
		}
	`;

	@property({ type: String }) label!: string;
	@property({ type: Array }) branches!: GetOverviewBranch[];

	override render() {
		return html`
			<div class="section">
				<h3>${this.label}</h3>
				${this.branches.map(branch => html`<gl-branch-item .branch=${branch}></gl-branch-item>`)}
			</div>
		`;
	}
}

@customElement('gl-branch-item')
export class GlBranchItem extends LitElement {
	static override styles = css`
		img {
			width: 1.6rem;
			height: 1.6rem;
			border-radius: 50%;
		}
		.branch-item {
			display: flex;
			flex-direction: column;
			background-color: color-mix(in lab, var(--vscode-sideBar-background) 100%, #fff 10%);
			gap: 0.8rem;
			padding: 0.8rem;
			margin-bottom: 0.6rem;
			border-radius: 0.4rem;
			border-left: 0.3rem solid transparent;
		}

		.pill {
			display: inline-flex;
			align-items: center;
			/* gap: 0.4rem; */
			padding: 0.2rem 0.4rem 0.2rem 0.8rem;
			margin-left: 0.4rem;
			border-radius: 0.4rem;
			border: 1px solid color-mix(in lab, var(--vscode-sideBar-foreground) 100%, #000 10%);
			/* background-color: var(--vscode-gitDecoration-untrackedResourceForeground); */
		}
		.active {
			border-left-color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.branch-item__main {
			display: flex;
			/* flex-direction: column; */
			/* align-items: center; */
		}

		.branch-item__icon {
			margin-right: 0.4rem;
			color: var(--vscode-gitDecoration-addedResourceForeground);
		}

		.branch-item__name {
			font-weight: bold;
			margin-right: 0.8rem;
		}

		.branch-item__pr-number {
			color: var(--vscode-descriptionForeground);
			margin-right: 0.8rem;
		}
		.branch-item__pr-title {
			flex-grow: 1;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.branch-item__details {
			display: flex;
			flex-direction: column;
			gap: 0.4rem;
			/* align-items: center; */
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}

		.branch-item__upstream,
		.branch-item__pr-status,
		.branch-item__commit-count {
			display: flex;
			align-items: center;
			margin-right: 1.6rem;
		}

		.branch-item__upstream code-icon,
		.branch-item__pr-status code-icon,
		.branch-item__commit-count code-icon {
			margin-right: 0.4rem;
		}

		.branch-item__more-actions {
			margin-left: auto;
		}
	`;

	@property({ type: Object }) branch!: GetOverviewBranch;

	override render() {
		const { name, pr, opened: active, timestamp: date, state, workingTreeState } = this.branch;
		return html`
			<div class="branch-item${active ? ' active' : ''}">
				<div class="branch-item__main">
					<span class="branch-item__icon">${this.renderIcon(this.branch)}</span>
					${pr
						? html`<span class="branch-item__pr-title">${pr.title}</span>
								<span class="branch-item__pr-number">#${pr.id}</span>`
						: html`<span class="branch-item__name">${name}</span>`}
				</div>
				<div class="branch-item__details">
					${this.renderAvatars(this.branch)}
					${pr
						? html`<span
								><span class="branch-item__icon">${this.renderIcon(this.branch, true)}</span
								><span class="branch-item__name">${name}</span></span
						  >`
						: ''}
					${this.renderStatus(workingTreeState, state)}
					${date ? html`<span class="branch-item__date">${fromNow(date)}</span>` : ''}
				</div>
			</div>
		`;
	}
	private renderAvatars(branch: GetOverviewBranch) {
		return html`
			<span class="branch-item__avatars">
				${branch.contributors?.map(contributor => html`<img src="${contributor.avatarUrl}" />`)}
			</span>
			${branch.owner ? html`<img src="${branch.owner.avatarUrl}" />` : ''}
		`;
	}

	private renderIcon(branch: OverviewBranch, noPr?: boolean) {
		if (branch.pr && !noPr) {
			if (branch.pr.state === 'closed') {
				return html`<code-icon icon="git-pull-request-closed"></code-icon>`;
			} else if (branch.pr.state === 'merged') {
				return html`<code-icon icon="git-merge"></code-icon>`;
			}
			return html`<code-icon icon="git-pull-request"></code-icon>`;
		}
		if (branch.worktree) {
			return html`<code-icon icon="gl-repositories-view"></code-icon>`;
		}
		return html`<code-icon icon="git-branch"></code-icon>`;
	}

	private renderStatus(
		workingTreeState: { added: number; changed: number; deleted: number } | undefined,
		state: GitTrackingState | undefined,
	) {
		const rendered = [];
		if (workingTreeState?.added || workingTreeState?.changed || workingTreeState?.deleted) {
			if (workingTreeState.added) {
				rendered.push(html`<span>${workingTreeState.added}<code-icon icon="add"></code-icon></span>`);
			}
			if (workingTreeState.changed) {
				rendered.push(html`<span>${workingTreeState.changed}<code-icon icon="edit"></code-icon></span>`);
			}
			if (workingTreeState.deleted) {
				rendered.push(html`<span>${workingTreeState.deleted}<code-icon icon="trash"></code-icon></span>`);
			}
		}

		if (state?.ahead || state?.behind) {
			if (state.ahead) {
				rendered.push(html`<span class="pill">${state.ahead}<code-icon icon="arrow-up"></code-icon></span>`);
			}
			if (state.behind) {
				rendered.push(html`<span class="pill">${state.behind}<code-icon icon="arrow-down"></code-icon></span>`);
			}
		}

		if (rendered.length) {
			return html`<span class="branch-item__status">${rendered}</span>`;
		}
		return '';
	}
}
