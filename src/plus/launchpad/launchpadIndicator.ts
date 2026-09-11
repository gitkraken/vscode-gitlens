import type { ConfigurationChangeEvent, StatusBarItem } from 'vscode';
import { Disposable, l10n, MarkdownString, StatusBarAlignment, ThemeColor, window } from 'vscode';
import type { GitCloudHostIntegrationId } from '@gitlens/integrations/constants.js';
import type { ConnectionStateChangeEvent } from '@gitlens/integrations/index.js';
import { once } from '@gitlens/utils/event.js';
import { groupByMap } from '@gitlens/utils/iterable.js';
import { escapeMarkdown } from '@gitlens/utils/markdown.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import { wait } from '@gitlens/utils/promise.js';
import type { Colors } from '../../constants.colors.js';
import { proBadge } from '../../constants.js';
import type { Container } from '../../container.js';
import { createCommand, executeCommand, registerCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { LaunchpadCommandArgs } from './launchpad.js';
import type { LaunchpadItem, LaunchpadProvider, LaunchpadRefreshEvent } from './launchpadProvider.js';
import { groupAndSortLaunchpadItems, supportedLaunchpadIntegrations } from './launchpadProvider.js';
import type { LaunchpadGroup } from './models/launchpad.js';
import { launchpadGroupIconMap, launchpadPriorityGroups } from './models/launchpad.js';

type LaunchpadIndicatorState = 'idle' | 'disconnected' | 'loading' | 'load' | 'failed';
type LaunchpadIndicatorItemState =
	| 'mergeable'
	| 'blocked'
	| 'unassigned-reviewers'
	| 'failed-checks'
	| 'conflicts'
	| 'follow-up'
	| 'needs-review';

const richTextToken = '\ue000richText\ue001';

function appendLocalizedMarkdown(
	markdown: MarkdownString,
	localized: string,
	richText: ReadonlyMap<string, string>,
): void {
	let remaining = localized;
	while (remaining.length !== 0) {
		let token: string | undefined;
		let tokenIndex = -1;
		for (const candidate of richText.keys()) {
			const candidateIndex = remaining.indexOf(candidate);
			if (candidateIndex !== -1 && (tokenIndex === -1 || candidateIndex < tokenIndex)) {
				token = candidate;
				tokenIndex = candidateIndex;
			}
		}

		if (token == null) {
			appendPlainText(markdown, remaining);
			return;
		}

		appendPlainText(markdown, remaining.slice(0, tokenIndex));
		markdown.appendMarkdown(richText.get(token)!);
		remaining = remaining.slice(tokenIndex + token.length);
	}
}

/** Appends plain text, escaped — `appendText` would turn space runs into `&nbsp;` */
function appendPlainText(markdown: MarkdownString, text: string): void {
	markdown.appendMarkdown(escapeMarkdown(text));
}

function escapeMarkdownLinkTitle(value: string): string {
	return value.replace(/[\\"]/g, '\\$&');
}

function getPullRequestCountStateLabel(count: number, state: LaunchpadIndicatorItemState): string {
	switch (state) {
		case 'mergeable':
			return formatPlural(
				l10n.t(
					'{count, plural, one{{count} pull request can be merged} other{{count} pull requests can be merged}}',
				),
				{ count: count },
			);
		case 'blocked':
			return formatPlural(
				l10n.t(
					'{count, plural, one{{count} pull request is blocked} other{{count} pull requests are blocked}}',
				),
				{ count: count },
			);
		case 'unassigned-reviewers':
			return formatPlural(
				l10n.t(
					'{count, plural, one{{count} pull request needs reviewers} other{{count} pull requests need reviewers}}',
				),
				{ count: count },
			);
		case 'failed-checks':
			return formatPlural(
				l10n.t(
					'{count, plural, one{{count} pull request failed CI checks} other{{count} pull requests failed CI checks}}',
				),
				{ count: count },
			);
		case 'conflicts':
			return formatPlural(
				l10n.t(
					'{count, plural, one{{count} pull request has conflicts} other{{count} pull requests have conflicts}}',
				),
				{ count: count },
			);
		case 'follow-up':
			return formatPlural(
				l10n.t(
					'{count, plural, one{{count} pull request requires follow-up} other{{count} pull requests require follow-up}}',
				),
				{ count: count },
			);
		case 'needs-review':
			return formatPlural(
				l10n.t(
					'{count, plural, one{{count} pull request needs your review} other{{count} pull requests need your review}}',
				),
				{ count: count },
			);
	}
}

function getBlockedSummaryLabel(
	reviewersCount: number | undefined,
	failedChecksCount: number | undefined,
	conflictsCount: number | undefined,
): string {
	if (reviewersCount != null) {
		if (failedChecksCount != null) {
			if (conflictsCount != null) {
				return formatPlural(
					l10n.t(
						'{reviewers, plural, one{{conflicts, plural, one{({reviewers} needs reviewers, {failedChecks} failed CI checks, {conflicts} has conflicts)} other{({reviewers} needs reviewers, {failedChecks} failed CI checks, {conflicts} have conflicts)}}} other{{conflicts, plural, one{({reviewers} need reviewers, {failedChecks} failed CI checks, {conflicts} has conflicts)} other{({reviewers} need reviewers, {failedChecks} failed CI checks, {conflicts} have conflicts)}}}}',
					),
					{ reviewers: reviewersCount, failedChecks: failedChecksCount, conflicts: conflictsCount },
				);
			}

			return formatPlural(
				l10n.t(
					'{reviewers, plural, one{({reviewers} needs reviewers, {failedChecks} failed CI checks)} other{({reviewers} need reviewers, {failedChecks} failed CI checks)}}',
				),
				{ reviewers: reviewersCount, failedChecks: failedChecksCount },
			);
		}

		if (conflictsCount != null) {
			return formatPlural(
				l10n.t(
					'{reviewers, plural, one{{conflicts, plural, one{({reviewers} needs reviewers, {conflicts} has conflicts)} other{({reviewers} needs reviewers, {conflicts} have conflicts)}}} other{{conflicts, plural, one{({reviewers} need reviewers, {conflicts} has conflicts)} other{({reviewers} need reviewers, {conflicts} have conflicts)}}}}',
				),
				{ reviewers: reviewersCount, conflicts: conflictsCount },
			);
		}

		return formatPlural(
			l10n.t('{reviewers, plural, one{({reviewers} needs reviewers)} other{({reviewers} need reviewers)}}'),
			{ reviewers: reviewersCount },
		);
	}

	if (failedChecksCount != null) {
		if (conflictsCount != null) {
			return formatPlural(
				l10n.t(
					'{conflicts, plural, one{({failedChecks} failed CI checks, {conflicts} has conflicts)} other{({failedChecks} failed CI checks, {conflicts} have conflicts)}}',
				),
				{ failedChecks: failedChecksCount, conflicts: conflictsCount },
			);
		}

		return l10n.t('({failedChecks} failed CI checks)', { failedChecks: failedChecksCount });
	}

	if (conflictsCount != null) {
		return formatPlural(
			l10n.t('{conflicts, plural, one{({conflicts} has conflicts)} other{({conflicts} have conflicts)}}'),
			{ conflicts: conflictsCount },
		);
	}

	return '';
}

export class LaunchpadIndicator implements Disposable {
	private readonly _disposable: Disposable;
	private _categorizedItems: LaunchpadItem[] | undefined;
	/** Tracks if this is the first state after startup */
	private _firstStateAfterStartup: boolean = true;
	private _hasRefreshed: boolean = false;
	private _lastDataUpdate: Date | undefined;
	private _lastRefreshPaused: Date | undefined;
	private _refreshTimer: ReturnType<typeof setInterval> | undefined;
	private _state?: LaunchpadIndicatorState;
	private _statusBarLaunchpad!: StatusBarItem;

	constructor(
		private readonly container: Container,
		private readonly provider: LaunchpadProvider,
	) {
		this._disposable = Disposable.from(
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			provider.onDidChange(this.onLaunchpadChanged, this),
			provider.onDidRefresh(this.onLaunchpadRefreshed, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.integrations.onDidChangeConnectionState(this.onConnectedIntegrationsChanged, this),
			once(container.onReady)(this.onReady, this),
			...this.registerCommands(),
		);
	}

	dispose(): void {
		this.clearRefreshTimer();
		this._statusBarLaunchpad?.dispose();
		this._disposable.dispose();
	}

	private get pollingEnabled() {
		return (
			configuration.get('launchpad.indicator.polling.enabled') &&
			configuration.get('launchpad.indicator.polling.interval') > 0
		);
	}

	private get pollingInterval() {
		return configuration.get('launchpad.indicator.polling.interval') * 1000 * 60;
	}

	private async onConnectedIntegrationsChanged(e: ConnectionStateChangeEvent) {
		if (supportedLaunchpadIntegrations.includes(e.key as GitCloudHostIntegrationId)) {
			await this.maybeLoadData(true);
		}
	}

	private async onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'launchpad.indicator')) return;

		if (configuration.changed(e, 'launchpad.indicator.label')) {
			this.updateStatusBarCommand();
		}

		let load = false;

		if (configuration.changed(e, 'launchpad.indicator.polling')) {
			if (configuration.changed(e, 'launchpad.indicator.polling.enabled')) {
				load = true;
			} else if (configuration.changed(e, 'launchpad.indicator.polling.interval')) {
				this.startRefreshTimer();
			}
		}

		load ||=
			configuration.changed(e, 'launchpad.indicator.useColors') ||
			configuration.changed(e, 'launchpad.indicator.icon') ||
			configuration.changed(e, 'launchpad.indicator.label') ||
			configuration.changed(e, 'launchpad.indicator.groups');

		if (load) {
			await this.maybeLoadData();
		}
	}

	private async maybeLoadData(forceIfConnected: boolean = false) {
		if (this.pollingEnabled) {
			if (await this.provider.hasConnectedIntegration()) {
				if (this._state === 'load' && this._categorizedItems != null && !forceIfConnected) {
					this.updateStatusBarState('load', this._categorizedItems);
				} else {
					this.updateStatusBarState('loading');
				}
			} else {
				this.updateStatusBarState('disconnected');
			}
		} else {
			this.updateStatusBarState('idle');
		}
	}

	private onLaunchpadRefreshed(e: LaunchpadRefreshEvent) {
		this._hasRefreshed = true;
		if (!this.pollingEnabled) {
			this.updateStatusBarState('idle');

			return;
		}

		if (e.error != null && !e.items?.length) {
			this.updateStatusBarState('failed');

			return;
		}

		this.updateStatusBarState('load', e.items);
	}

	private async onLaunchpadChanged() {
		this._hasRefreshed = false;
		if (!this.pollingEnabled) {
			this.updateStatusBarState('idle');

			return;
		}

		const items = await this.provider.getCategorizedItems();
		if (items.error != null && !items.items?.length) {
			this.updateStatusBarState('failed');

			return;
		}

		this.updateStatusBarState('load', items.items);
	}

	private async onReady(): Promise<void> {
		this._statusBarLaunchpad = window.createStatusBarItem('gitlens.launchpad', StatusBarAlignment.Left, 10000 - 3);
		this._statusBarLaunchpad.name = l10n.t('GitLens Launchpad');

		await this.maybeLoadData();
		this.updateStatusBarCommand();

		this._statusBarLaunchpad.show();
	}

	private onWindowStateChanged(e: { focused: boolean }) {
		if (this._state === 'disconnected' || this._state === 'idle') return;

		if (!e.focused) {
			this.clearRefreshTimer();
			this._lastRefreshPaused = new Date();

			return;
		}

		if (this._lastRefreshPaused == null) return;
		if (this._state === 'loading') {
			this.startRefreshTimer();

			return;
		}

		const now = Date.now();
		const timeSinceLastUpdate = this._lastDataUpdate != null ? now - this._lastDataUpdate.getTime() : undefined;
		const timeSinceLastUnfocused = now - this._lastRefreshPaused.getTime();
		this._lastRefreshPaused = undefined;

		const refreshInterval = configuration.get('launchpad.indicator.polling.interval') * 1000 * 60;

		let timeToNextPoll = timeSinceLastUpdate != null ? refreshInterval - timeSinceLastUpdate : refreshInterval;
		if (timeToNextPoll < 0) {
			timeToNextPoll = 0;
		}

		const diff = timeToNextPoll - timeSinceLastUnfocused;
		this.startRefreshTimer(diff < 0 ? 0 : diff);
	}

	private clearRefreshTimer() {
		if (this._refreshTimer != null) {
			clearInterval(this._refreshTimer);
			this._refreshTimer = undefined;
		}
	}

	private startRefreshTimer(startDelay?: number) {
		const starting = this._firstStateAfterStartup;
		if (starting) {
			this._firstStateAfterStartup = false;
		}

		this.clearRefreshTimer();
		if (!this.pollingEnabled || this._state === 'disconnected') {
			if (this._state !== 'idle' && this._state !== 'disconnected') {
				this.updateStatusBarState('idle');
			}
			return;
		}

		const startRefreshInterval = () => {
			this._refreshTimer = setInterval(() => {
				void this.provider.getCategorizedItems({ force: true });
			}, this.pollingInterval);
		};

		if (startDelay != null) {
			this._refreshTimer = setTimeout(() => {
				startRefreshInterval();

				// If we are loading at startup, wait to give vscode time to settle before querying
				if (starting) {
					// Using a wait here, instead using the `startDelay` to avoid case where the timer could be cancelled if the user focused a different windows before the timer fires (because we will cancel the timer)
					void wait(5000).then(() => {
						// If something else has already caused a refresh, don't do another one
						if (this._hasRefreshed) return;

						// Don't force at startup -- nothing is cached yet, so this still fetches, but it shares the
						// gate with any load already in flight instead of duplicating the whole pipeline
						void this.provider.getCategorizedItems();
					});
				} else {
					void this.provider.getCategorizedItems({ force: true });
				}
			}, startDelay);
		} else {
			startRefreshInterval();
		}
	}

	private updateStatusBarState(state: LaunchpadIndicatorState, categorizedItems?: LaunchpadItem[]) {
		if (state !== 'load' && state === this._state) return;

		this._state = state;
		this._categorizedItems = categorizedItems;

		const tooltip = new MarkdownString('', true);
		tooltip.supportHtml = true;
		tooltip.isTrusted = true;

		appendPlainText(tooltip, l10n.t('GitLens Launchpad {0}', proBadge));
		tooltip.appendMarkdown(`\u00a0\u00a0\u00a0\u00a0&mdash;\u00a0\u00a0\u00a0\u00a0`);
		tooltip.appendMarkdown(
			`[$(question)](command:gitlens.launchpad.indicator.action?%22info%22 "${escapeMarkdownLinkTitle(l10n.t('What is this?'))}")`,
		);
		tooltip.appendMarkdown('\u00a0');
		tooltip.appendMarkdown(
			`[$(gear)](command:workbench.action.openSettings?%22gitlens.launchpad%22 "${escapeMarkdownLinkTitle(l10n.t('Settings'))}")`,
		);
		tooltip.appendMarkdown('\u00a0\u00a0|\u00a0\u00a0');
		tooltip.appendMarkdown(
			`[$(circle-slash) ${escapeMarkdown(l10n.t('Hide'))}](command:gitlens.launchpad.indicator.action?%22hide%22 "${escapeMarkdownLinkTitle(l10n.t('Hide'))}")`,
		);

		if (
			state === 'idle' ||
			state === 'disconnected' ||
			state === 'loading' ||
			(state === 'load' && !this.hasInteracted())
		) {
			tooltip.appendMarkdown('\n\n---\n\n');
			appendLocalizedMarkdown(
				tooltip,
				l10n.t(
					'{link} organizes your pull requests into actionable groups to help you focus and keep your team unblocked.',
					{ link: richTextToken },
				),
				new Map([
					[
						richTextToken,
						`[Launchpad](command:gitlens.launchpad.indicator.action?%22info%22 "${escapeMarkdownLinkTitle(l10n.t('Learn about Launchpad'))}")`,
					],
				]),
			);
			tooltip.appendMarkdown('\n\n');
			appendLocalizedMarkdown(
				tooltip,
				l10n.t("It's always accessible using the {command} command from the Command Palette.", {
					command: richTextToken,
				}),
				new Map([[richTextToken, '`GitLens: Open Launchpad`']]),
			);
		}

		switch (state) {
			case 'idle':
				this.clearRefreshTimer();
				this._statusBarLaunchpad.text = '$(rocket)';
				this._statusBarLaunchpad.tooltip = tooltip;
				this._statusBarLaunchpad.color = undefined;
				break;

			case 'disconnected':
				this.clearRefreshTimer();
				tooltip.appendMarkdown('\n\n---\n\n');
				appendLocalizedMarkdown(
					tooltip,
					l10n.t('{link} to get started.', { link: richTextToken }),
					new Map([
						[
							richTextToken,
							`[${escapeMarkdown(l10n.t('Connect an integration'))}](command:gitlens.showLaunchpad?%7B%22source%22%3A%22launchpad-indicator%22%7D "${escapeMarkdownLinkTitle(l10n.t('Connect an integration'))}")`,
						],
					]),
				);

				this._statusBarLaunchpad.text = `$(rocket)$(gitlens-unplug) Launchpad`;
				this._statusBarLaunchpad.tooltip = tooltip;
				this._statusBarLaunchpad.color = undefined;
				break;

			case 'loading':
				this.startRefreshTimer(0);
				tooltip.appendMarkdown('\n\n---\n\n$(loading~spin) ');
				appendPlainText(tooltip, l10n.t('Loading...'));

				this._statusBarLaunchpad.text = '$(rocket)$(loading~spin)';
				this._statusBarLaunchpad.tooltip = tooltip;
				this._statusBarLaunchpad.color = undefined;
				break;

			case 'load':
				this.updateStatusBarWithItems(tooltip, categorizedItems);
				break;

			case 'failed':
				this.clearRefreshTimer();
				tooltip.appendMarkdown('\n\n---\n\n$(alert) ');
				appendPlainText(tooltip, l10n.t('Unable to load items'));

				this._statusBarLaunchpad.text = '$(rocket)$(alert)';
				this._statusBarLaunchpad.tooltip = tooltip;
				this._statusBarLaunchpad.color = undefined;
				break;
		}

		// After the first state change, clear this
		this._firstStateAfterStartup = false;
	}

	private updateStatusBarCommand() {
		const labelType = configuration.get('launchpad.indicator.label') ?? 'item';
		this._statusBarLaunchpad.command = createCommand<[Omit<LaunchpadCommandArgs, 'command'>]>(
			'gitlens.showLaunchpad',
			l10n.t('Open Launchpad'),
			{
				source: 'launchpad-indicator',
				state: { selectTopItem: labelType === 'item' },
			} satisfies Omit<LaunchpadCommandArgs, 'command'>,
		);
	}

	private updateStatusBarWithItems(tooltip: MarkdownString, categorizedItems: LaunchpadItem[] | undefined) {
		this.sendTelemetryFirstLoadEvent();

		this._lastDataUpdate = new Date();
		const useColors = configuration.get('launchpad.indicator.useColors');
		const groups: LaunchpadGroup[] = configuration.get('launchpad.indicator.groups') ?? [];
		const labelType = configuration.get('launchpad.indicator.label') ?? 'item';
		const iconType = configuration.get('launchpad.indicator.icon') ?? 'default';

		let color: string | ThemeColor | undefined = undefined;
		let priorityIcon: `$(${string})` | undefined;
		let priorityItem: { item: LaunchpadItem; state: LaunchpadIndicatorItemState } | undefined;

		const groupedItems = groupAndSortLaunchpadItems(categorizedItems);
		const totalGroupedItems = [...groupedItems.values()].reduce((total, group) => total + group.length, 0);

		const hasImportantGroupsWithItems = groups.some(group => groupedItems.get(group)?.length);
		if (totalGroupedItems === 0) {
			tooltip.appendMarkdown('\n\n---\n\n');
			appendPlainText(tooltip, l10n.t('You are all caught up!'));
		} else if (!hasImportantGroupsWithItems) {
			tooltip.appendMarkdown('\n\n---\n\n');
			appendLocalizedMarkdown(
				tooltip,
				formatPlural(
					l10n.t(
						'{count, plural, one{No pull requests need your attention{lineBreak}({count} other pull request)} other{No pull requests need your attention{lineBreak}({count} other pull requests)}}',
					),
					{ count: totalGroupedItems, lineBreak: richTextToken },
				),
				new Map([[richTextToken, '\\\n']]),
			);
		} else {
			for (const group of groups) {
				const items = groupedItems.get(group);
				if (!items?.length) continue;

				if (tooltip.value.length > 0) {
					tooltip.appendMarkdown(`\n\n---\n\n`);
				}

				const icon = launchpadGroupIconMap.get(group)!;
				switch (group) {
					case 'mergeable': {
						priorityIcon ??= icon;
						color = new ThemeColor('gitlens.launchpadIndicatorMergeableColor' satisfies Colors);
						const linkText =
							labelType === 'item' && priorityItem == null
								? this.getPriorityItemStateLabel(items[0], 'mergeable', items.length)
								: getPullRequestCountStateLabel(items.length, 'mergeable');
						tooltip.appendMarkdown(
							`<span style="color:var(--vscode-gitlens-launchpadIndicatorMergeableHoverColor);">${icon}</span>$(blank) [${escapeMarkdown(linkText)}](command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'launchpad-indicator',
									state: {
										initialGroup: 'mergeable',
										selectTopItem: true,
									},
								} satisfies Omit<LaunchpadCommandArgs, 'command'>),
							)} "${escapeMarkdownLinkTitle(l10n.t('Open Ready to Merge in Launchpad'))}")`,
						);
						priorityItem ??= { item: items[0], state: 'mergeable' };
						break;
					}
					case 'blocked': {
						const action = groupByMap(items, i =>
							i.actionableCategory === 'failed-checks' ||
							i.actionableCategory === 'conflicts' ||
							i.actionableCategory === 'unassigned-reviewers'
								? i.actionableCategory
								: 'blocked',
						);

						const hasMultipleCategories = action.size > 1;

						let item: LaunchpadItem | undefined;
						let itemState: LaunchpadIndicatorItemState = 'blocked';
						let reviewersCount: number | undefined;
						let failedChecksCount: number | undefined;
						let conflictsCount: number | undefined;

						let actionGroupItems = action.get('unassigned-reviewers');
						if (actionGroupItems?.length) {
							reviewersCount = actionGroupItems.length;
							item ??= actionGroupItems[0];
							itemState = 'unassigned-reviewers';
						}

						actionGroupItems = action.get('failed-checks');
						if (actionGroupItems?.length) {
							failedChecksCount = actionGroupItems.length;
							if (item == null) {
								item = actionGroupItems[0];
								itemState = 'failed-checks';
							}
						}

						actionGroupItems = action.get('conflicts');
						if (actionGroupItems?.length) {
							conflictsCount = actionGroupItems.length;
							if (item == null) {
								item = actionGroupItems[0];
								itemState = 'conflicts';
							}
						}

						item ??= items[0];
						const state = hasMultipleCategories ? 'blocked' : itemState;
						const linkText =
							labelType === 'item' && priorityItem == null
								? this.getPriorityItemStateLabel(item, state, items.length)
								: getPullRequestCountStateLabel(items.length, state);

						priorityIcon ??= icon;
						color ??= new ThemeColor('gitlens.launchpadIndicatorBlockedColor' satisfies Colors);
						tooltip.appendMarkdown(
							`<span style="color:var(--vscode-gitlens-launchpadIndicatorBlockedColor);">${icon}</span>$(blank) [${escapeMarkdown(linkText)}](command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'launchpad-indicator',
									state: {
										initialGroup: 'blocked',
										selectTopItem: true,
									},
								} satisfies Omit<LaunchpadCommandArgs, 'command'>),
							)} "${escapeMarkdownLinkTitle(l10n.t('Open Blocked in Launchpad'))}")`,
						);
						if (hasMultipleCategories) {
							const summary = getBlockedSummaryLabel(reviewersCount, failedChecksCount, conflictsCount);
							if (summary) {
								tooltip.appendMarkdown(`\\\n$(blank)$(blank) ${escapeMarkdown(summary)}`);
							}
						}

						priorityItem ??= { item: item, state: itemState };
						break;
					}
					case 'follow-up': {
						priorityIcon ??= icon;
						color ??= new ThemeColor('gitlens.launchpadIndicatorAttentionColor' satisfies Colors);
						const linkText =
							labelType === 'item' && priorityItem == null
								? this.getPriorityItemStateLabel(items[0], 'follow-up', items.length)
								: getPullRequestCountStateLabel(items.length, 'follow-up');
						tooltip.appendMarkdown(
							`<span style="color:var(--vscode-gitlens-launchpadIndicatorAttentionHoverColor);">${icon}</span>$(blank) [${escapeMarkdown(linkText)}](command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'launchpad-indicator',
									state: {
										initialGroup: 'follow-up',
										selectTopItem: true,
									},
								} satisfies Omit<LaunchpadCommandArgs, 'command'>),
							)} "${escapeMarkdownLinkTitle(l10n.t('Open Follow-Up in Launchpad'))}")`,
						);
						priorityItem ??= { item: items[0], state: 'follow-up' };
						break;
					}
					case 'needs-review': {
						priorityIcon ??= icon;
						color ??= new ThemeColor('gitlens.launchpadIndicatorAttentionColor' satisfies Colors);
						const linkText =
							labelType === 'item' && priorityItem == null
								? this.getPriorityItemStateLabel(items[0], 'needs-review', items.length)
								: getPullRequestCountStateLabel(items.length, 'needs-review');
						tooltip.appendMarkdown(
							`<span style="color:var(--vscode-gitlens-launchpadIndicatorAttentionHoverColor);">${icon}</span>$(blank) [${escapeMarkdown(linkText)}](command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'launchpad-indicator',
									state: {
										initialGroup: 'needs-review',
										selectTopItem: true,
									},
								} satisfies Omit<LaunchpadCommandArgs, 'command'>),
							)} "${escapeMarkdownLinkTitle(l10n.t('Open Needs Your Review in Launchpad'))}")`,
						);
						priorityItem ??= { item: items[0], state: 'needs-review' };
						break;
					}
				}
			}
		}

		const iconSegment = iconType === 'group' && priorityIcon != null ? priorityIcon : '$(rocket)';

		let labelSegment;
		switch (labelType) {
			case 'item':
				labelSegment =
					priorityItem != null
						? ` ${this.getPriorityItemStateLabel(priorityItem.item, priorityItem.state)}`
						: '';
				break;

			case 'counts':
				labelSegment = '';
				for (const group of groups) {
					if (!launchpadPriorityGroups.includes(group)) continue;

					const count = groupedItems.get(group)?.length ?? 0;
					const icon = launchpadGroupIconMap.get(group)!;
					labelSegment +=
						!labelSegment && iconSegment === icon ? `\u00a0${count}` : `\u00a0\u00a0${icon} ${count}`;
				}
				break;

			default:
				labelSegment = '';
				break;
		}

		this._statusBarLaunchpad.text = `${iconSegment}${labelSegment}`;
		this._statusBarLaunchpad.tooltip = tooltip;
		this._statusBarLaunchpad.color = useColors ? color : undefined;
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.launchpad.indicator.action', async (action: string) => {
				this.storeFirstInteractionIfNeeded();
				switch (action) {
					case 'info': {
						void executeCommand('gitlens.showWelcomeView');
						break;
					}
					case 'hide': {
						const hide = { title: l10n.t('Hide Anyway') };
						const cancel = { title: l10n.t('Cancel'), isCloseAffordance: true };
						const action = await window.showInformationMessage(
							l10n.t(
								'GitLens Launchpad helps you focus and keep your team unblocked.\n\nAre you sure you want hide the indicator?',
							),
							{
								modal: true,
								detail: l10n.t(
									'\nYou can always access Launchpad using the "GitLens: Open Launchpad" command, and can re-enable the indicator with the "GitLens: Toggle Launchpad Indicator" command.',
								),
							},
							hide,
							cancel,
						);
						if (action === hide) {
							void configuration.updateEffective('launchpad.indicator.enabled', false);
						}
						break;
					}
					default:
						break;
				}
			}),
		];
	}

	private getPriorityItemStateLabel(
		item: LaunchpadItem,
		state: LaunchpadIndicatorItemState,
		groupLength?: number,
	): string {
		const itemLabel = `${item.repository != null ? `${item.repository.owner.login}/${item.repository.name}` : ''}#${item.id}`;
		const otherCount = groupLength != null ? groupLength - 1 : 0;
		if (otherCount === 0) {
			switch (state) {
				case 'mergeable':
					return l10n.t('{item} can be merged', { item: itemLabel });
				case 'blocked':
					return l10n.t('{item} is blocked', { item: itemLabel });
				case 'unassigned-reviewers':
					return l10n.t('{item} needs reviewers', { item: itemLabel });
				case 'failed-checks':
					return l10n.t('{item} failed CI checks', { item: itemLabel });
				case 'conflicts':
					return l10n.t('{item} has conflicts', { item: itemLabel });
				case 'follow-up':
					return l10n.t('{item} requires follow-up', { item: itemLabel });
				case 'needs-review':
					return l10n.t('{item} needs your review', { item: itemLabel });
			}
		}

		switch (state) {
			case 'mergeable':
				return formatPlural(
					l10n.t(
						'{count, plural, one{{item} and {count} other pull request can be merged} other{{item} and {count} other pull requests can be merged}}',
					),
					{ item: itemLabel, count: otherCount },
				);
			case 'blocked':
				return formatPlural(
					l10n.t(
						'{count, plural, one{{item} and {count} other pull request are blocked} other{{item} and {count} other pull requests are blocked}}',
					),
					{ item: itemLabel, count: otherCount },
				);
			case 'unassigned-reviewers':
				return formatPlural(
					l10n.t(
						'{count, plural, one{{item} and {count} other pull request need reviewers} other{{item} and {count} other pull requests need reviewers}}',
					),
					{ item: itemLabel, count: otherCount },
				);
			case 'failed-checks':
				return formatPlural(
					l10n.t(
						'{count, plural, one{{item} and {count} other pull request failed CI checks} other{{item} and {count} other pull requests failed CI checks}}',
					),
					{ item: itemLabel, count: otherCount },
				);
			case 'conflicts':
				return formatPlural(
					l10n.t(
						'{count, plural, one{{item} and {count} other pull request have conflicts} other{{item} and {count} other pull requests have conflicts}}',
					),
					{ item: itemLabel, count: otherCount },
				);
			case 'follow-up':
				return formatPlural(
					l10n.t(
						'{count, plural, one{{item} and {count} other pull request require follow-up} other{{item} and {count} other pull requests require follow-up}}',
					),
					{ item: itemLabel, count: otherCount },
				);
			case 'needs-review':
				return formatPlural(
					l10n.t(
						'{count, plural, one{{item} and {count} other pull request need your review} other{{item} and {count} other pull requests need your review}}',
					),
					{ item: itemLabel, count: otherCount },
				);
		}
	}

	private sendTelemetryFirstLoadEvent() {
		if (!this.container.telemetry.enabled) return;

		const hasLoaded = this.container.storage.get('launchpad:indicator:hasLoaded') ?? false;
		if (!hasLoaded) {
			void this.container.storage.store('launchpad:indicator:hasLoaded', true).catch();
			this.container.telemetry.sendEvent('launchpad/indicator/firstLoad');
		}
	}

	private storeFirstInteractionIfNeeded() {
		if (this.container.storage.get('launchpad:indicator:hasInteracted') != null) return;

		void this.container.storage.store('launchpad:indicator:hasInteracted', new Date().toISOString());
	}

	private hasInteracted() {
		return this.container.storage.get('launchpad:indicator:hasInteracted') != null;
	}
}

/** Serializable stand-in for `Error` — the summary crosses the webview RPC, which uses `JSON.stringify` */
export interface LaunchpadSummaryError {
	name: string;
	message: string;
}

export interface LaunchpadSummaryResult {
	total: number;
	groups: LaunchpadGroup[];
	hasGroupedItems: boolean;
	error?: LaunchpadSummaryError;

	mergeable?: {
		total: number;
	};

	blocked?: {
		total: number;

		blocked: number;
		conflicts: number;
		failedChecks: number;
		unassignedReviewers: number;
	};

	followUp?: {
		total: number;
	};
	needsReview?: {
		total: number;
	};

	snoozed?: {
		total: number;
		items: LaunchpadItem[];
	};
	pinned?: {
		total: number;
		items: LaunchpadItem[];
	};
}

export function generateLaunchpadSummary(
	items: LaunchpadItem[] | undefined,
	groups: LaunchpadGroup[],
): LaunchpadSummaryResult {
	const groupedItems = groupAndSortLaunchpadItems(items);
	const total = [...groupedItems.values()].reduce((total, group) => total + group.length, 0);
	const hasGroupedItems = groups.some(group => groupedItems.get(group)?.length);

	if (total === 0 || !hasGroupedItems) {
		return { total: total, groups: groups, hasGroupedItems: false };
	}

	const result: LaunchpadSummaryResult = { total: total, groups: groups, hasGroupedItems: hasGroupedItems };

	for (const group of groups) {
		const itemsInGroup = groupedItems.get(group);
		if (!itemsInGroup?.length) continue;

		switch (group) {
			case 'mergeable':
				result.mergeable = { total: itemsInGroup.length };
				break;
			case 'blocked': {
				const grouped = groupByMap(itemsInGroup, i =>
					i.actionableCategory === 'failed-checks' ||
					i.actionableCategory === 'conflicts' ||
					i.actionableCategory === 'unassigned-reviewers'
						? i.actionableCategory
						: 'blocked',
				);

				result.blocked = {
					total: itemsInGroup.length,

					blocked: grouped.get('blocked')?.length ?? 0,
					conflicts: grouped.get('conflicts')?.length ?? 0,
					failedChecks: grouped.get('failed-checks')?.length ?? 0,
					unassignedReviewers: grouped.get('unassigned-reviewers')?.length ?? 0,
				};

				break;
			}
			case 'follow-up':
				result.followUp = { total: itemsInGroup.length };
				break;
			case 'needs-review':
				result.needsReview = { total: itemsInGroup.length };
				break;
			case 'snoozed':
				result.snoozed = { items: itemsInGroup, total: itemsInGroup.length };
				break;
			case 'pinned':
				result.pinned = { items: itemsInGroup, total: itemsInGroup.length };
				break;
		}
	}

	return result;
}
