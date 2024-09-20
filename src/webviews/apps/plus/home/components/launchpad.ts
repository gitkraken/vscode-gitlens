import { consume } from '@lit/context';
import { Task } from '@lit/task';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { pluralize } from '../../../../../system/string';
import type { GetLaunchpadSummaryResponse } from '../../../../home/protocol';
import { GetLaunchpadSummary } from '../../../../home/protocol';
import { ipcContext } from '../../../shared/context';
import type { Disposable } from '../../../shared/events';
import type { HostIpc } from '../../../shared/ipc';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';

type LaunchpadSummary = GetLaunchpadSummaryResponse;

@customElement('gl-launchpad')
export class GlLaunchpad extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = css`
		:host {
			display: block;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			margin-bottom: 1.6rem;
		}
		.header {
			font-weight: bold;
			margin-bottom: 1rem;
		}
		.summary {
			margin-bottom: 1rem;
		}
	`;

	@consume({ context: ipcContext })
	private _ipc!: HostIpc;
	private _disposable: Disposable | undefined;
	private _summaryTask = new Task(this, {
		args: () => [this.fetchSummary()],
		task: ([summary]) => summary,
		autoRun: false,
	});

	override disconnectedCallback() {
		super.disconnectedCallback();

		this._disposable?.dispose();
	}

	private _summary: Promise<LaunchpadSummary | undefined> | undefined;
	private async fetchSummary() {
		if (this._summary == null) {
			const ipc = this._ipc;
			if (ipc != null) {
				async function fetch() {
					const rsp = await ipc.sendRequest(GetLaunchpadSummary, {});
					return rsp;
				}
				this._summary = fetch();
			} else {
				this._summary = Promise.resolve(undefined);
			}
		}
		return this._summary;
	}

	override render() {
		return html`
			<div class="header">GitLens Launchpad</div>
			<div class="summary">${this.renderSummaryResult()}</div>
			<button-container>
				<gl-button full class="start-work">Start work</gl-button>
			</button-container>
		`;
	}

	private renderSummaryResult() {
		if (this._summary == null) {
			void this._summaryTask.run();
		}

		return this._summaryTask.render({
			pending: () => html`<span>Loading...</span>`,
			complete: summary => this.renderSummary(summary),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderSummary(summary: LaunchpadSummary | undefined) {
		if (summary == null) return [nothing];
		if (summary.total === 0) {
			return [html`<span>You are all caught up!</span>`];
		}
		if (!summary.hasGroupedItems) {
			return [
				html`<span>No pull requests need your attention</span
					><span>(${summary.total} other pull requests)</span>`,
			];
		}

		const result: TemplateResult[] = [];
		for (const group of summary.groups) {
			let total;
			switch (group) {
				case 'mergeable':
					total = summary.mergeable?.total ?? 0;
					if (total === 0) continue;

					result.push(
						html`<code-icon icon="rocket"></code-icon>
							<span>${pluralize('pull request', total)} can be merged</span>`,
					);
					break;

				case 'blocked': {
					total = summary.blocked?.total ?? 0;
					if (total === 0) continue;

					const messages: { count: number; message: string }[] = [];
					if (summary.blocked!.unassignedReviewers) {
						messages.push({
							count: summary.blocked!.unassignedReviewers,
							message: `${summary.blocked!.unassignedReviewers > 1 ? 'need' : 'needs'} reviewers`,
						});
					}
					if (summary.blocked!.failedChecks) {
						messages.push({
							count: summary.blocked!.failedChecks,
							message: `${summary.blocked!.failedChecks > 1 ? 'have' : 'has'} failed CI checks`,
						});
					}
					if (summary.blocked!.conflicts) {
						messages.push({
							count: summary.blocked!.conflicts,
							message: `${summary.blocked!.conflicts > 1 ? 'have' : 'has'} conflicts`,
						});
					}

					if (messages.length === 1) {
						result.push(
							html`<code-icon icon="error"></code-icon>
								<span>${pluralize('pull request', total)} ${messages[0].message}</span>`,
						);
					} else {
						result.push(
							html`<code-icon icon="error"></code-icon>
								<span
									>${pluralize('pull request', total)} ${total > 1 ? 'are' : 'is'} blocked
									(${messages.map(m => `${m.count} ${m.message}`).join(', ')})</span
								>`,
						);
					}

					break;
				}
				case 'follow-up':
					total = summary.followUp?.total ?? 0;
					if (total === 0) continue;

					result.push(
						html`<code-icon icon="report"></code-icon>
							<span
								>${pluralize('pull request', total)} ${total > 1 ? 'require' : 'requires'}
								follow-up</span
							>`,
					);
					break;

				case 'needs-review':
					total = summary.needsReview?.total ?? 0;
					if (total === 0) continue;

					result.push(
						html`<code-icon icon="comment-unresolved"></code-icon>
							<span
								>${pluralize('pull request', total)} ${total > 1 ? 'need' : 'needs'} your review</span
							>`,
					);
					break;
			}
		}

		return result;
	}
}

@customElement('pull-request-item')
export class PullRequestItem extends LitElement {
	static override styles = css`
		:host {
			display: block;
			border-left: 0.3rem solid var(--vscode-gitDecoration-addedResourceForeground);
			padding: 1rem;
			margin-bottom: 1rem;
		}
		.title {
			font-weight: bold;
		}
		.branch {
			font-size: 0.9em;
			color: var(--vscode-descriptionForeground);
		}
		.stats {
			display: flex;
			gap: 1rem;
			font-size: 0.9em;
		}
	`;

	@property() number = '';
	@property() prtitle = '';
	@property() branch = '';
	@property() status = '';
	@property() additions = '';
	@property() deletions = '';
	@property() comments = '';

	override render() {
		return html`
			<div class="title">${this.number} ${this.prtitle}</div>
			<div class="branch">${this.branch}</div>
			<div class="stats">
				<span>+${this.additions}</span>
				<span>-${this.deletions}</span>
				<span>💬${this.comments}</span>
			</div>
		`;
	}
}
