import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { LaunchpadCommandArgs } from '../../../../../plus/launchpad/launchpad';
import { pluralize } from '../../../../../system/string';
import type { GetLaunchpadSummaryResponse } from '../../../../home/protocol';
import { GetLaunchpadSummary } from '../../../../home/protocol';
import { AsyncComputedState } from '../../../shared/components/signal-utils';
import { ipcContext } from '../../../shared/context';
import type { Disposable } from '../../../shared/events';
import type { HostIpc } from '../../../shared/ipc';
import { sectionHeadingStyles } from './branch-section';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';

type LaunchpadSummary = GetLaunchpadSummaryResponse;

@customElement('gl-launchpad')
export class GlLaunchpad extends SignalWatcher(LitElement) {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [
		sectionHeadingStyles,
		css`
			:host {
				display: block;
				font-family: var(--vscode-font-family);
				color: var(--vscode-foreground);
				margin-bottom: 2.4rem;
			}
			.summary {
				margin-bottom: 1rem;
			}

			.menu {
				list-style: none;
				padding-inline-start: 0;
				margin-block-start: 0;
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}

			.launchpad-action {
				display: flex;
				align-items: center;
				gap: 0.6rem;
				color: inherit;
				text-decoration: none;
			}

			.launchpad-action:hover span {
				text-decoration: underline;
			}

			.launchpad-action__icon {
				color: var(--gl-launchpad-action-color, inherit);
			}

			.launchpad-action:hover .launchpad-action__icon {
				color: var(--gl-launchpad-action-hover-color, inherit);
			}

			.launchpad-action--mergable {
				--gl-launchpad-action-color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
				--gl-launchpad-action-hover-color: var(--vscode-gitlens-launchpadIndicatorMergeableHoverColor);
			}

			.launchpad-action--blocked {
				--gl-launchpad-action-color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
				--gl-launchpad-action-hover-color: var(--vscode-gitlens-launchpadIndicatorBlockedHoverColor);
			}

			.launchpad-action--attention {
				--gl-launchpad-action-color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
				--gl-launchpad-action-hover-color: var(--vscode-gitlens-launchpadIndicatorAttentionHoverColor);
			}

			.loader {
				display: flex;
				flex-direction: column;
				gap: 0.4rem;
			}
		`,
	];

	@consume({ context: ipcContext })
	private _ipc!: HostIpc;
	private _disposable: Disposable | undefined;

	private _summaryState = new AsyncComputedState<LaunchpadSummary>(async _abortSignal => {
		const rsp = await this._ipc.sendRequest(GetLaunchpadSummary, {});
		return rsp;
	});

	private get _summary() {
		return this._summaryState.state.value;
	}

	override disconnectedCallback() {
		super.disconnectedCallback();

		this._disposable?.dispose();
	}

	override render() {
		return html`
			<div class="section-heading">GitLens Launchpad</div>
			<div class="summary">${this.renderSummaryResult()}</div>
			<button-container>
				<gl-button full class="start-work">Start work</gl-button>
			</button-container>
		`;
	}

	private renderSummaryResult() {
		if (this._summary == null) {
			this._summaryState.run();
		}

		return this._summaryState.render({
			pending: () => this.renderPending(),
			complete: summary => this.renderSummary(summary),
			error: () => html`<span>Error</span>`,
		});
	}

	private renderPending() {
		return html`
			<div class="loader">
				<skeleton-loader lines="1"></skeleton-loader>
				<skeleton-loader lines="1"></skeleton-loader>
			</div>
		`;
	}

	private renderSummary(summary: LaunchpadSummary | undefined) {
		if (summary == null) return nothing;
		if (summary.total === 0) {
			return html`<span>You are all caught up!</span>`;
		}
		if (!summary.hasGroupedItems) {
			return html`<span>No pull requests need your attention</span
				><span>(${summary.total} other pull requests)</span>`;
		}

		const result: TemplateResult[] = [];
		for (const group of summary.groups) {
			let total;
			switch (group) {
				case 'mergeable': {
					total = summary.mergeable?.total ?? 0;
					if (total === 0) continue;

					const commandUrl = `command:gitlens.showLaunchpad?${encodeURIComponent(
						JSON.stringify({
							source: 'home',
							state: {
								initialGroup: 'mergeable',
							},
						} satisfies Omit<LaunchpadCommandArgs, 'command'>),
					)}`;
					result.push(
						html`<li>
							<a href=${commandUrl} class="launchpad-action launchpad-action--mergable">
								<code-icon class="launchpad-action__icon" icon="rocket"></code-icon>
								<span>${pluralize('pull request', total)} can be merged</span>
							</a>
						</li>`,
					);
					break;
				}
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

					const commandUrl = `command:gitlens.showLaunchpad?${encodeURIComponent(
						JSON.stringify({
							source: 'home',
							state: { initialGroup: 'blocked' },
						} satisfies Omit<LaunchpadCommandArgs, 'command'>),
					)}`;
					if (messages.length === 1) {
						result.push(
							html`<li>
								<a href=${commandUrl} class="launchpad-action launchpad-action--blocked">
									<code-icon class="launchpad-action__icon" icon="error"></code-icon>
									<span>${pluralize('pull request', total)} ${messages[0].message}</span>
								</a>
							</li>`,
						);
					} else {
						result.push(
							html`<li>
								<a href=${commandUrl} class="launchpad-action launchpad-action--blocked">
									<code-icon class="launchpad-action__icon" icon="error"></code-icon>
									<span
										>${pluralize('pull request', total)} ${total > 1 ? 'are' : 'is'} blocked
										(${messages.map(m => `${m.count} ${m.message}`).join(', ')})</span
									>
								</a>
							</li>`,
						);
					}

					break;
				}
				case 'follow-up': {
					total = summary.followUp?.total ?? 0;
					if (total === 0) continue;

					const commandUrl = `command:gitlens.showLaunchpad?${encodeURIComponent(
						JSON.stringify({
							source: 'home',
							state: {
								initialGroup: 'follow-up',
							},
						} satisfies Omit<LaunchpadCommandArgs, 'command'>),
					)}`;
					result.push(
						html`<li>
							<a href=${commandUrl} class="launchpad-action launchpad-action--attention">
								<code-icon class="launchpad-action__icon" icon="report"></code-icon>
								<span
									>${pluralize('pull request', total)} ${total > 1 ? 'require' : 'requires'}
									follow-up</span
								>
							</a>
						</li>`,
					);
					break;
				}
				case 'needs-review': {
					total = summary.needsReview?.total ?? 0;
					if (total === 0) continue;

					const commandUrl = `command:gitlens.showLaunchpad?${encodeURIComponent(
						JSON.stringify({
							source: 'home',
							state: {
								initialGroup: 'needs-review',
							},
						} satisfies Omit<LaunchpadCommandArgs, 'command'>),
					)}`;
					result.push(
						html`<li>
							<a href=${commandUrl} class="launchpad-action launchpad-action--attention">
								<code-icon class="launchpad-action__icon" icon="comment-unresolved"></code-icon>
								<span
									>${pluralize('pull request', total)} ${total > 1 ? 'need' : 'needs'} your
									review</span
								>
							</a>
						</li>`,
					);
					break;
				}
			}
		}

		return html`<menu class="menu">${result}</menu>`;
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
