import type { TemplateResult } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../../commands/cloudIntegrations.js';
import type { LaunchpadCommandArgs } from '../../../../../plus/launchpad/launchpad.js';
import type { LaunchpadSummaryResult } from '../../../../../plus/launchpad/launchpadIndicator.js';
import { createCommandLink } from '../../../../../system/commands.js';
import { elementBase } from '../../../shared/components/styles/lit/base.css.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/skeleton-loader.js';

/** Where the summary is rendered — drives the `source` recorded on the Launchpad command links. */
export type LaunchpadSummarySource = 'graph-header' | 'graph-details';

/**
 * Grouped Launchpad summary (connect / loading / error / all-caught-up / per-group). Shared by the
 * Graph header's Launchpad indicator popover and the WIP details "empty pane". Purely property-driven
 * (no context) so it stays safe for the WIP pane's cross-webview reuse in commit-details.
 *
 * `:host { display: contents }` keeps the rendered `<ul>` a direct flex child of the consumer's
 * layout — preserving the WIP empty pane's tuned stable-footprint spacing after the extraction.
 */
@customElement('gl-launchpad-summary')
export class GlLaunchpadSummary extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: contents;
			}

			.launchpad-items {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);

				/* Match the left inset of Next-step rows so the launchpad items line up with the
				   Next-steps content column rather than sitting flush with the section heading. */
				padding-inline-start: var(--gl-space-6);

				/* Matches the start-new top padding so the Launchpad heading-to-content gap reads the
				   same as the other sections — first launchpad row sits flush with where the first row
				   of Next-steps and the first button of Start-new sit. */
				margin-block: var(--gl-space-8) var(--gl-space-6);
				list-style: none;
			}

			.launchpad-items--loading {
				gap: var(--gl-space-4);
			}

			.launchpad-item {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				font-size: var(--gl-font-md);
				color: inherit;
				text-decoration: none;
			}

			.launchpad-item__icon {
				color: var(--gl-launchpad-item-color, inherit);
			}

			.launchpad-item--link {
				cursor: pointer;
			}

			.launchpad-item--link:hover {
				text-decoration: none;
			}

			.launchpad-item--link:hover span {
				text-decoration: underline;
			}

			.launchpad-item--link:hover .launchpad-item__icon {
				color: var(--gl-launchpad-item-hover-color, var(--gl-launchpad-item-color, inherit));
			}

			.launchpad-item--link:focus-visible {
				outline: var(--gl-border-width) solid var(--vscode-focusBorder);
				outline-offset: 2px;
				border-radius: var(--gl-radius-xs);
			}

			.launchpad-item--muted {
				font-style: italic;
				color: var(--color-foreground--65);
			}

			.launchpad-item--mergeable {
				--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorMergeableColor);
				--gl-launchpad-item-hover-color: var(--vscode-gitlens-launchpadIndicatorMergeableHoverColor);
			}

			.launchpad-item--blocked {
				--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorBlockedColor);
				--gl-launchpad-item-hover-color: var(--vscode-gitlens-launchpadIndicatorBlockedHoverColor);
			}

			.launchpad-item--attention {
				--gl-launchpad-item-color: var(--vscode-gitlens-launchpadIndicatorAttentionColor);
				--gl-launchpad-item-hover-color: var(--vscode-gitlens-launchpadIndicatorAttentionHoverColor);
			}
		`,
	];

	@property({ type: Object }) summary?: LaunchpadSummaryResult | { error: Error };
	@property({ type: Boolean, attribute: 'has-integrations-connected' }) hasIntegrationsConnected = false;
	@property() source: LaunchpadSummarySource = 'graph-details';

	override render(): TemplateResult {
		if (!this.hasIntegrationsConnected) {
			return html`<ul class="launchpad-items">
				<li>
					<a
						class="launchpad-item launchpad-item--link"
						href=${createCommandLink<ConnectCloudIntegrationsCommandArgs>(
							'gitlens.plus.cloudIntegrations.connect',
							{ source: { source: this.source } },
						)}
					>
						<code-icon class="launchpad-item__icon" icon="plug"></code-icon>
						<span>Connect to see PRs here</span>
					</a>
				</li>
			</ul>`;
		}

		const summary = this.summary;
		if (summary == null) {
			// Single skeleton line matches the most common landed content — "You are all caught
			// up!" or a single group summary. Two lines was nearly always over-tall, causing a
			// downward shift when content landed.
			return html`<div class="launchpad-items launchpad-items--loading">
				<skeleton-loader lines="1"></skeleton-loader>
			</div>`;
		}

		if (!('total' in summary)) {
			return html`<ul class="launchpad-items">
				<li class="launchpad-item launchpad-item--muted">Unable to load items</li>
			</ul>`;
		}

		const items: TemplateResult[] = [];

		if (summary.error != null) {
			items.push(
				html`<li>
					<span class="launchpad-item launchpad-item--muted">
						<code-icon class="launchpad-item__icon" icon="warning"></code-icon>
						<span>Some integrations failed to load</span>
					</span>
				</li>`,
			);
		}

		if (summary.total === 0) {
			items.push(html`<li class="launchpad-item launchpad-item--muted">You are all caught up!</li>`);
			return html`<ul class="launchpad-items">
				${items}
			</ul>`;
		}

		if (!summary.hasGroupedItems) {
			items.push(
				html`<li class="launchpad-item launchpad-item--muted">No pull requests need your attention</li>
					<li class="launchpad-item launchpad-item--muted">(${summary.total} other pull requests)</li>`,
			);
			return html`<ul class="launchpad-items">
				${items}
			</ul>`;
		}

		for (const group of summary.groups) {
			switch (group) {
				case 'mergeable': {
					const total = summary.mergeable?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--mergeable"
								href=${this.createShowLaunchpadLink('mergeable')}
							>
								<code-icon class="launchpad-item__icon" icon="rocket"></code-icon>
								<span>${pluralize('pull request', total)} can be merged</span>
							</a>
						</li>`,
					);
					break;
				}
				case 'blocked': {
					const total = summary.blocked?.total ?? 0;
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

					const href = this.createShowLaunchpadLink('blocked');
					if (messages.length === 1) {
						items.push(
							html`<li>
								<a class="launchpad-item launchpad-item--link launchpad-item--blocked" href=${href}>
									<code-icon class="launchpad-item__icon" icon="error"></code-icon>
									<span>${pluralize('pull request', total)} ${messages[0].message}</span>
								</a>
							</li>`,
						);
					} else {
						items.push(
							html`<li>
								<a class="launchpad-item launchpad-item--link launchpad-item--blocked" href=${href}>
									<code-icon class="launchpad-item__icon" icon="error"></code-icon>
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
					const total = summary.followUp?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--attention"
								href=${this.createShowLaunchpadLink('follow-up')}
							>
								<code-icon class="launchpad-item__icon" icon="report"></code-icon>
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
					const total = summary.needsReview?.total ?? 0;
					if (total === 0) continue;

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--attention"
								href=${this.createShowLaunchpadLink('needs-review')}
							>
								<code-icon class="launchpad-item__icon" icon="comment-unresolved"></code-icon>
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

		return html`<ul class="launchpad-items">
			${items}
		</ul>`;
	}

	private createShowLaunchpadLink(group: NonNullable<LaunchpadCommandArgs['state']>['initialGroup']): string {
		return `command:gitlens.showLaunchpad?${encodeURIComponent(
			JSON.stringify({
				source: this.source,
				state: { initialGroup: group },
			} satisfies Omit<LaunchpadCommandArgs, 'command'>),
		)}`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-launchpad-summary': GlLaunchpadSummary;
	}
}
