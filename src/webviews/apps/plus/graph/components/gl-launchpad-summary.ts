import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { boxSizingBase } from '@gitlens/components/components/styles/lit/base.css.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../../commands/cloudIntegrations.js';
import type { LaunchpadCommandArgs } from '../../../../../plus/launchpad/launchpad.js';
import type {
	LaunchpadSummaryError,
	LaunchpadSummaryResult,
} from '../../../../../plus/launchpad/launchpadIndicator.js';
import { createCommandLink } from '../../../../../system/commands.js';
import '@gitlens/components/components/codeIcon.js';
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
		boxSizingBase,
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

	@property({ type: Object }) summary?: LaunchpadSummaryResult | { error: LaunchpadSummaryError };
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
						<span>${l10n.t('Connect to see PRs here')}</span>
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
				<li class="launchpad-item launchpad-item--muted" title=${summary.error.message || nothing}>
					${l10n.t('Unable to load items')}
				</li>
			</ul>`;
		}

		const items: TemplateResult[] = [];

		if (summary.error != null) {
			items.push(
				html`<li>
					<span class="launchpad-item launchpad-item--muted" title=${summary.error.message || nothing}>
						<code-icon class="launchpad-item__icon" icon="warning"></code-icon>
						<span>${l10n.t('Some integrations failed to load')}</span>
					</span>
				</li>`,
			);
		}

		if (summary.total === 0) {
			items.push(html`<li class="launchpad-item launchpad-item--muted">${l10n.t('You are all caught up!')}</li>`);
			return html`<ul class="launchpad-items">
				${items}
			</ul>`;
		}

		if (!summary.hasGroupedItems) {
			items.push(
				html`<li class="launchpad-item launchpad-item--muted">
						${l10n.t('No pull requests need your attention')}
					</li>
					<li class="launchpad-item launchpad-item--muted">
						${
							summary.total === 1
								? l10n.t('({count} other pull request)', { count: summary.total })
								: l10n.t('({count} other pull requests)', { count: summary.total })
						}
					</li>`,
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

					const count = getNumericFormat()(total);

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--mergeable"
								href=${this.createShowLaunchpadLink('mergeable')}
							>
								<code-icon class="launchpad-item__icon" icon="rocket"></code-icon>
								<span
									>${
										total === 1
											? l10n.t('{count} pull request can be merged', { count: count })
											: l10n.t('{count} pull requests can be merged', { count: count })
									}</span
								>
							</a>
						</li>`,
					);
					break;
				}
				case 'blocked': {
					const total = summary.blocked?.total ?? 0;
					if (total === 0) continue;

					const reasons: { count: number; type: 'reviewers' | 'checks' | 'conflicts' }[] = [];
					if (summary.blocked!.unassignedReviewers) {
						reasons.push({
							count: summary.blocked!.unassignedReviewers,
							type: 'reviewers',
						});
					}
					if (summary.blocked!.failedChecks) {
						reasons.push({
							count: summary.blocked!.failedChecks,
							type: 'checks',
						});
					}
					if (summary.blocked!.conflicts) {
						reasons.push({
							count: summary.blocked!.conflicts,
							type: 'conflicts',
						});
					}

					const href = this.createShowLaunchpadLink('blocked');
					if (reasons.length === 1) {
						items.push(
							html`<li>
								<a class="launchpad-item launchpad-item--link launchpad-item--blocked" href=${href}>
									<code-icon class="launchpad-item__icon" icon="error"></code-icon>
									<span>${formatSingleBlockedReason(total, reasons[0].type)}</span>
								</a>
							</li>`,
						);
					} else {
						items.push(
							html`<li>
								<a class="launchpad-item launchpad-item--link launchpad-item--blocked" href=${href}>
									<code-icon class="launchpad-item__icon" icon="error"></code-icon>
									<span>${formatMultipleBlockedReasons(total, reasons)}</span>
								</a>
							</li>`,
						);
					}
					break;
				}
				case 'follow-up': {
					const total = summary.followUp?.total ?? 0;
					if (total === 0) continue;

					const count = getNumericFormat()(total);

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--attention"
								href=${this.createShowLaunchpadLink('follow-up')}
							>
								<code-icon class="launchpad-item__icon" icon="report"></code-icon>
								<span
									>${
										total === 1
											? l10n.t('{count} pull request requires follow-up', { count: count })
											: l10n.t('{count} pull requests require follow-up', { count: count })
									}</span
								>
							</a>
						</li>`,
					);
					break;
				}
				case 'needs-review': {
					const total = summary.needsReview?.total ?? 0;
					if (total === 0) continue;

					const count = getNumericFormat()(total);

					items.push(
						html`<li>
							<a
								class="launchpad-item launchpad-item--link launchpad-item--attention"
								href=${this.createShowLaunchpadLink('needs-review')}
							>
								<code-icon class="launchpad-item__icon" icon="comment-unresolved"></code-icon>
								<span
									>${
										total === 1
											? l10n.t('{count} pull request needs your review', { count: count })
											: l10n.t('{count} pull requests need your review', { count: count })
									}</span
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

function formatSingleBlockedReason(total: number, reason: 'reviewers' | 'checks' | 'conflicts'): string {
	const count = getNumericFormat()(total);
	switch (reason) {
		case 'reviewers':
			return total === 1
				? l10n.t('{count} pull request needs reviewers', { count: count })
				: l10n.t('{count} pull requests need reviewers', { count: count });
		case 'checks':
			return total === 1
				? l10n.t('{count} pull request has failed CI checks', { count: count })
				: l10n.t('{count} pull requests have failed CI checks', { count: count });
		case 'conflicts':
			return total === 1
				? l10n.t('{count} pull request has conflicts', { count: count })
				: l10n.t('{count} pull requests have conflicts', { count: count });
	}
}

function formatMultipleBlockedReasons(
	total: number,
	reasons: { count: number; type: 'reviewers' | 'checks' | 'conflicts' }[],
): string {
	const reasonMessages = reasons.map(reason => {
		switch (reason.type) {
			case 'reviewers':
				return reason.count === 1
					? l10n.t('{count} needs reviewers', { count: reason.count })
					: l10n.t('{count} need reviewers', { count: reason.count });
			case 'checks':
				return reason.count === 1
					? l10n.t('{count} has failed CI checks', { count: reason.count })
					: l10n.t('{count} have failed CI checks', { count: reason.count });
			case 'conflicts':
				return reason.count === 1
					? l10n.t('{count} has conflicts', { count: reason.count })
					: l10n.t('{count} have conflicts', { count: reason.count });
		}
	});
	const count = getNumericFormat()(total);
	const reasonList = reasonMessages.join(', ');
	return total === 1
		? l10n.t('{count} pull request is blocked ({reasons})', { count: count, reasons: reasonList })
		: l10n.t('{count} pull requests are blocked ({reasons})', { count: count, reasons: reasonList });
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-launchpad-summary': GlLaunchpadSummary;
	}
}
