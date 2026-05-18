import type { TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { LaunchpadSummaryResult } from '../../../../../plus/launchpad/launchpadIndicator.js';
import type { GitBranchShape, Wip } from '../../../../plus/graph/detailsProtocol.js';
import { elementBase } from '../../../shared/components/styles/lit/base.css.js';
import { detailsWipEmptyPaneStyles } from './gl-details-wip-empty-pane.css.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';

type NextStep = {
	icon: string;
	label: string;
	actionLabel: string;
	event: string;
};

function getRemoteNameFromUpstream(upstreamName: string | undefined): string {
	if (!upstreamName) return 'origin';

	const slash = upstreamName.indexOf('/');
	return slash > 0 ? upstreamName.slice(0, slash) : upstreamName;
}

@customElement('gl-details-wip-empty-pane')
export class GlDetailsWipEmptyPane extends LitElement {
	static override styles = [elementBase, detailsWipEmptyPaneStyles];

	@property({ type: Object }) wip?: Wip;
	@property({ type: Boolean }) hasPullRequest = false;
	@property({ type: Object }) launchpadSummary?: LaunchpadSummaryResult | { error: Error };
	@property({ type: Boolean }) aiEnabled = false;

	override render(): unknown {
		const branch = this.wip?.branch;
		if (!branch) return this.renderIdle();

		const nextSteps = this.computeNextSteps(branch);
		const active = nextSteps.length > 0;

		return active ? this.renderActive(branch, nextSteps) : this.renderIdle();
	}

	private renderActive(branch: GitBranchShape, nextSteps: NextStep[]) {
		const ahead = branch.tracking?.ahead ?? 0;
		const hasDiverged = ahead > 0 || branch.upstream?.missing === true || branch.upstream == null;

		return html`<div class="hub">
			<section class="section">
				<h3 class="section__heading">Next steps</h3>
				${nextSteps.map(
					step =>
						html`<div class="next-step">
							<code-icon class="next-step__icon" icon=${step.icon}></code-icon>
							<span class="next-step__label">${step.label}</span>
							<gl-button
								class="next-step__action"
								appearance="secondary"
								@click=${() => this.emit(step.event)}
								>${step.actionLabel}</gl-button
							>
						</div>`,
				)}
			</section>
			${this.aiEnabled && hasDiverged ? this.renderAiWorkflows(ahead) : nothing}
			<section class="section">
				<h3 class="section__heading">Launchpad</h3>
				${this.renderLaunchpadSummary()}
				<div class="start-fresh">
					<gl-button appearance="secondary" @click=${() => this.emit('start-work')}>
						<code-icon icon="rocket"></code-icon>Start Work on an Issue…
					</gl-button>
				</div>
			</section>
		</div>`;
	}

	private renderAiWorkflows(ahead: number) {
		return html`<section class="section">
			<h3 class="section__heading">AI workflows</h3>
			<div class="ai-grid">
				<gl-button class="ai-button" appearance="secondary" @click=${() => this.emit('ai-draft-pr')}>
					<code-icon icon="sparkle"></code-icon>Draft PR description
				</gl-button>
				<gl-button class="ai-button" appearance="secondary" @click=${() => this.emit('ai-summarize-branch')}>
					<code-icon icon="sparkle"></code-icon>Summarize branch
				</gl-button>
				${ahead > 0
					? html`<gl-button
							class="ai-button"
							appearance="secondary"
							@click=${() => this.emit('ai-review-unpushed')}
						>
							<code-icon icon="sparkle"></code-icon>Review ${pluralize('unpushed commit', ahead)}
						</gl-button>`
					: nothing}
				<gl-button class="ai-button" appearance="secondary" @click=${() => this.emit('ai-changelog')}>
					<code-icon icon="sparkle"></code-icon>Generate changelog entry
				</gl-button>
			</div>
		</section>`;
	}

	private renderIdle() {
		return html`<div class="hub hub--idle">
			<p class="caption">Nothing pending on this branch.</p>
			<div class="start-fresh">
				<gl-button appearance="secondary" @click=${() => this.emit('start-work')}>
					<code-icon icon="rocket"></code-icon>Start Work…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('create-branch')}>
					<code-icon icon="custom-start-work"></code-icon>Create Branch…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('switch-branch')}>
					<code-icon icon="gl-switch"></code-icon>Switch Branch…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('apply-stash')}>
					<code-icon icon="gl-stash-pop"></code-icon>Apply Stash…
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('new-worktree')}>
					<code-icon icon="gl-worktrees-view"></code-icon>New Worktree…
				</gl-button>
			</div>
		</div>`;
	}

	private renderLaunchpadSummary(): TemplateResult | typeof nothing {
		const summary = this.launchpadSummary;
		if (summary == null || !('total' in summary) || summary.total === 0) return nothing;
		if (!summary.hasGroupedItems) return nothing;

		const items: TemplateResult[] = [];

		for (const group of summary.groups) {
			switch (group) {
				case 'mergeable': {
					const total = summary.mergeable?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li class="launchpad-item launchpad-item--mergeable">
							<code-icon class="launchpad-item__icon" icon="rocket"></code-icon>
							<span>${pluralize('PR', total)} can be merged</span>
						</li>`,
					);
					break;
				}
				case 'blocked': {
					const total = summary.blocked?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li class="launchpad-item launchpad-item--blocked">
							<code-icon class="launchpad-item__icon" icon="error"></code-icon>
							<span>${pluralize('PR', total)} ${total > 1 ? 'are' : 'is'} blocked</span>
						</li>`,
					);
					break;
				}
				case 'follow-up': {
					const total = summary.followUp?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li class="launchpad-item launchpad-item--attention">
							<code-icon class="launchpad-item__icon" icon="report"></code-icon>
							<span>${pluralize('PR', total)} ${total > 1 ? 'require' : 'requires'} follow-up</span>
						</li>`,
					);
					break;
				}
				case 'needs-review': {
					const total = summary.needsReview?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li class="launchpad-item launchpad-item--attention">
							<code-icon class="launchpad-item__icon" icon="comment-unresolved"></code-icon>
							<span>${pluralize('PR', total)} ${total > 1 ? 'need' : 'needs'} your review</span>
						</li>`,
					);
					break;
				}
			}
		}

		if (items.length === 0) return nothing;

		return html`<ul class="launchpad-items">
			${items}
		</ul>`;
	}

	private computeNextSteps(branch: GitBranchShape): NextStep[] {
		const ahead = branch.tracking?.ahead ?? 0;
		const behind = branch.tracking?.behind ?? 0;
		const upstreamMissing = branch.upstream == null || branch.upstream.missing === true;
		const remoteName = getRemoteNameFromUpstream(branch.upstream?.name);

		if (upstreamMissing) {
			return [
				{
					icon: 'cloud-upload',
					label: `Publish ${branch.name} to ${remoteName}`,
					actionLabel: 'Publish',
					event: 'publish-branch',
				},
			];
		}

		const steps: NextStep[] = [];

		if (behind > 0) {
			steps.push({
				icon: 'repo-pull',
				label: `Pull ${pluralize('commit', behind)} from ${remoteName}`,
				actionLabel: 'Pull',
				event: 'pull',
			});
		} else if (ahead > 0) {
			steps.push({
				icon: 'repo-push',
				label: `Push ${pluralize('commit', ahead)} to ${remoteName}`,
				actionLabel: 'Push',
				event: 'push',
			});
		}

		// Show "Create PR" for any published branch without an existing PR,
		// regardless of ahead/behind state — matches Home view behavior.
		if (!this.hasPullRequest) {
			steps.push({
				icon: 'git-pull-request-create',
				label: 'Create a Pull Request',
				actionLabel: 'Create PR',
				event: 'create-pr',
			});
		}

		return steps;
	}

	private emit(name: string): void {
		this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-details-wip-empty-pane': GlDetailsWipEmptyPane;
	}
}
