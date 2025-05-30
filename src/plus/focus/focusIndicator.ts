import type { ConfigurationChangeEvent, StatusBarItem } from 'vscode';
import { Disposable, MarkdownString, StatusBarAlignment, ThemeColor, window } from 'vscode';
import type { OpenWalkthroughCommandArgs } from '../../commands/walkthroughs';
import type { Colors } from '../../constants';
import { Commands, previewBadge } from '../../constants';
import type { Container } from '../../container';
import { executeCommand, registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { groupByMap } from '../../system/iterable';
import { wait } from '../../system/promise';
import { pluralize } from '../../system/string';
import type { ConnectionStateChangeEvent } from '../integrations/integrationService';
import { HostingIntegrationId } from '../integrations/providers/models';
import type { FocusCommandArgs } from './focus';
import type { FocusGroup, FocusItem, FocusProvider, FocusRefreshEvent } from './focusProvider';
import {
	focusGroupIconMap,
	focusPriorityGroups,
	groupAndSortFocusItems,
	supportedFocusIntegrations,
} from './focusProvider';

type FocusIndicatorState = 'idle' | 'disconnected' | 'loading' | 'load' | 'failed';

export class FocusIndicator implements Disposable {
	private readonly _disposable: Disposable;
	private _categorizedItems: FocusItem[] | undefined;
	/** Tracks if this is the first state after startup */
	private _firstStateAfterStartup: boolean = true;
	private _lastDataUpdate: Date | undefined;
	private _lastRefreshPaused: Date | undefined;
	private _refreshTimer: ReturnType<typeof setInterval> | undefined;
	private _state?: FocusIndicatorState;
	private _statusBarFocus!: StatusBarItem;

	constructor(
		private readonly container: Container,
		private readonly provider: FocusProvider,
	) {
		this._disposable = Disposable.from(
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			provider.onDidRefresh(this.onFocusRefreshed, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.integrations.onDidChangeConnectionState(this.onConnectedIntegrationsChanged, this),
			...this.registerCommands(),
		);

		void this.onReady();
	}

	dispose() {
		this.clearRefreshTimer();
		this._statusBarFocus?.dispose();
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
		if (supportedFocusIntegrations.includes(e.key as HostingIntegrationId)) {
			await this.maybeLoadData();
		}
	}

	private async onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'launchpad.indicator')) return;

		if (
			configuration.changed(e, 'launchpad.indicator.openInEditor') ||
			configuration.changed(e, 'launchpad.indicator.label')
		) {
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

	private async maybeLoadData() {
		if (this.pollingEnabled) {
			if (await this.provider.hasConnectedIntegration()) {
				if (this._state === 'load' && this._categorizedItems != null)
					this.updateStatusBarState('load', this._categorizedItems);
				else {
					this.updateStatusBarState('loading');
				}
			} else {
				this.updateStatusBarState('disconnected');
			}
		} else {
			this.updateStatusBarState('idle');
		}
	}

	private onFocusRefreshed(e: FocusRefreshEvent) {
		if (!this.pollingEnabled) {
			this.updateStatusBarState('idle');

			return;
		}

		if (e.error != null) {
			this.updateStatusBarState('failed');

			return;
		}

		this.updateStatusBarState('load', e.items);
	}

	private async onReady(): Promise<void> {
		this._statusBarFocus = window.createStatusBarItem('gitlens.launchpad', StatusBarAlignment.Left, 10000 - 3);
		this._statusBarFocus.name = 'GitLens Launchpad';

		await this.maybeLoadData();
		this.updateStatusBarCommand();

		this._statusBarFocus.show();
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
					void wait(5000).then(() => this.provider.getCategorizedItems({ force: true }));
				} else {
					void this.provider.getCategorizedItems({ force: true });
				}
			}, startDelay);
		} else {
			startRefreshInterval();
		}
	}

	private updateStatusBarState(state: FocusIndicatorState, categorizedItems?: FocusItem[]) {
		if (state !== 'load' && state === this._state) return;

		this._state = state;
		this._categorizedItems = categorizedItems;

		const tooltip = new MarkdownString('', true);
		tooltip.supportHtml = true;
		tooltip.isTrusted = true;

		tooltip.appendMarkdown(
			`GitLens Launchpad ${previewBadge}\u00a0\u00a0\u00a0\u00a0&mdash;\u00a0\u00a0\u00a0\u00a0`,
		);
		tooltip.appendMarkdown(`[$(question)](command:gitlens.launchpad.indicator.action?%22info%22 "What is this?")`);
		tooltip.appendMarkdown('\u00a0');
		tooltip.appendMarkdown(`[$(gear)](command:workbench.action.openSettings?%22gitlens.launchpad%22 "Settings")`);
		tooltip.appendMarkdown('\u00a0\u00a0|\u00a0\u00a0');
		tooltip.appendMarkdown(`[$(circle-slash) Hide](command:gitlens.launchpad.indicator.action?%22hide%22 "Hide")`);

		if (
			state === 'idle' ||
			state === 'disconnected' ||
			state === 'loading' ||
			(state === 'load' && !this.hasInteracted())
		) {
			tooltip.appendMarkdown('\n\n---\n\n');
			tooltip.appendMarkdown(
				'[Launchpad](command:gitlens.launchpad.indicator.action?%info%22 "Learn about Launchpad") organizes your pull requests into actionable groups to help you focus and keep your team unblocked.',
			);
			tooltip.appendMarkdown(
				"\n\nIt's always accessible using the `GitLens: Open Launchpad` command from the Command Palette.",
			);
		}

		switch (state) {
			case 'idle':
				this.clearRefreshTimer();
				this._statusBarFocus.text = '$(rocket)';
				this._statusBarFocus.tooltip = tooltip;
				this._statusBarFocus.color = undefined;
				break;

			case 'disconnected':
				this.clearRefreshTimer();
				tooltip.appendMarkdown(
					`\n\n---\n\n[Connect to GitHub](command:gitlens.launchpad.indicator.action?%22connectGitHub%22 "Connect to GitHub") to get started.`,
				);

				this._statusBarFocus.text = `$(rocket)$(gitlens-unplug) Launchpad`;
				this._statusBarFocus.tooltip = tooltip;
				this._statusBarFocus.color = undefined;
				break;

			case 'loading':
				this.startRefreshTimer(0);
				tooltip.appendMarkdown('\n\n---\n\n$(loading~spin) Loading...');

				this._statusBarFocus.text = '$(rocket)$(loading~spin)';
				this._statusBarFocus.tooltip = tooltip;
				this._statusBarFocus.color = undefined;
				break;

			case 'load':
				this.updateStatusBarWithItems(tooltip, categorizedItems);
				break;

			case 'failed':
				this.clearRefreshTimer();
				tooltip.appendMarkdown('\n\n---\n\n$(alert) Unable to load items');

				this._statusBarFocus.text = '$(rocket)$(alert)';
				this._statusBarFocus.tooltip = tooltip;
				this._statusBarFocus.color = undefined;
				break;
		}

		// After the first state change, clear this
		this._firstStateAfterStartup = false;
	}

	private updateStatusBarCommand() {
		const labelType = configuration.get('launchpad.indicator.label') ?? 'item';
		this._statusBarFocus.command = configuration.get('launchpad.indicator.openInEditor')
			? 'gitlens.showFocusPage'
			: {
					title: 'Open Launchpad',
					command: Commands.ShowLaunchpad,
					arguments: [
						{
							source: 'launchpad-indicator',
							state: { selectTopItem: labelType === 'item' },
						} satisfies Omit<FocusCommandArgs, 'command'>,
					],
			  };
	}

	private updateStatusBarWithItems(tooltip: MarkdownString, categorizedItems: FocusItem[] | undefined) {
		this.sendTelemetryFirstLoadEvent();

		this._lastDataUpdate = new Date();
		const useColors = configuration.get('launchpad.indicator.useColors');
		const groups: FocusGroup[] = configuration.get('launchpad.indicator.groups') ?? [];
		const labelType = configuration.get('launchpad.indicator.label') ?? 'item';
		const iconType = configuration.get('launchpad.indicator.icon') ?? 'default';

		let color: string | ThemeColor | undefined = undefined;
		let priorityIcon: `$(${string})` | undefined;
		let priorityItem: { item: FocusItem; groupLabel: string } | undefined;

		const groupedItems = groupAndSortFocusItems(categorizedItems);
		const totalGroupedItems = Array.from(groupedItems.values()).reduce((total, group) => total + group.length, 0);

		const hasImportantGroupsWithItems = groups.some(group => groupedItems.get(group)?.length);
		if (totalGroupedItems === 0) {
			tooltip.appendMarkdown('\n\n---\n\n');
			tooltip.appendMarkdown('You are all caught up!');
		} else if (!hasImportantGroupsWithItems) {
			tooltip.appendMarkdown('\n\n---\n\n');
			tooltip.appendMarkdown(
				`No pull requests need your attention\\\n(${totalGroupedItems} other pull requests)`,
			);
		} else {
			for (const group of groups) {
				const items = groupedItems.get(group);
				if (!items?.length) continue;

				if (tooltip.value.length > 0) {
					tooltip.appendMarkdown(`\n\n---\n\n`);
				}

				const icon = focusGroupIconMap.get(group)!;
				switch (group) {
					case 'mergeable': {
						priorityIcon ??= icon;
						color = new ThemeColor('gitlens.launchpadIndicatorMergeableColor' satisfies Colors);
						priorityItem ??= { item: items[0], groupLabel: 'can be merged' };
						tooltip.appendMarkdown(
							`<span style="color:var(--vscode-gitlens-launchpadIndicatorMergeableHoverColor);">${icon}</span>$(blank) [${
								labelType === 'item' && priorityItem != null
									? this.getPriorityItemLabel(priorityItem.item, items.length)
									: pluralize('pull request', items.length)
							} can be merged](command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'launchpad-indicator',
									state: {
										initialGroup: 'mergeable',
										selectTopItem: labelType === 'item',
									},
								} satisfies Omit<FocusCommandArgs, 'command'>),
							)} "Open Ready to Merge in Launchpad")`,
						);
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

						let item: FocusItem | undefined;
						let actionMessage = '';
						let summaryMessage = '(';

						let actionGroupItems = action.get('unassigned-reviewers');
						if (actionGroupItems?.length) {
							actionMessage = `${actionGroupItems.length > 1 ? 'need' : 'needs'} reviewers`;
							summaryMessage += `${actionGroupItems.length} ${actionMessage}`;
							item ??= actionGroupItems[0];
						}

						actionGroupItems = action.get('failed-checks');
						if (actionGroupItems?.length) {
							actionMessage = `failed CI checks`;
							summaryMessage += `${hasMultipleCategories ? ', ' : ''}${
								actionGroupItems.length
							} ${actionMessage}`;
							item ??= actionGroupItems[0];
						}

						actionGroupItems = action.get('conflicts');
						if (actionGroupItems?.length) {
							actionMessage = `${actionGroupItems.length > 1 ? 'have' : 'has'} conflicts`;
							summaryMessage += `${hasMultipleCategories ? ', ' : ''}${
								actionGroupItems.length
							} ${actionMessage}`;
							item ??= actionGroupItems[0];
						}

						summaryMessage += ')';

						priorityIcon ??= icon;
						color ??= new ThemeColor('gitlens.launchpadIndicatorBlockedColor' satisfies Colors);
						tooltip.appendMarkdown(
							`<span style="color:var(--vscode-gitlens-launchpadIndicatorBlockedColor);">${icon}</span>$(blank) [${
								labelType === 'item' && item != null && priorityItem == null
									? this.getPriorityItemLabel(item, items.length)
									: pluralize('pull request', items.length)
							} ${
								hasMultipleCategories ? 'are blocked' : actionMessage
							}](command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'launchpad-indicator',
									state: { initialGroup: 'blocked', selectTopItem: labelType === 'item' },
								} satisfies Omit<FocusCommandArgs, 'command'>),
							)} "Open Blocked in Launchpad")`,
						);
						if (hasMultipleCategories) {
							tooltip.appendMarkdown(`\\\n$(blank)$(blank) ${summaryMessage}`);
						}

						if (item != null) {
							let label = 'is blocked';
							if (item.actionableCategory === 'unassigned-reviewers') {
								label = 'needs reviewers';
							} else if (item.actionableCategory === 'failed-checks') {
								label = 'failed CI checks';
							} else if (item.actionableCategory === 'conflicts') {
								label = 'has conflicts';
							}
							priorityItem ??= { item: item, groupLabel: label };
						}
						break;
					}
					case 'follow-up': {
						priorityIcon ??= icon;
						color ??= new ThemeColor('gitlens.launchpadIndicatorAttentionColor' satisfies Colors);
						tooltip.appendMarkdown(
							`<span style="color:var(--vscode-gitlens-launchpadIndicatorAttentionHoverColor);">${icon}</span>$(blank) [${
								labelType === 'item' && priorityItem == null && items.length
									? this.getPriorityItemLabel(items[0], items.length)
									: pluralize('pull request', items.length)
							} ${
								items.length > 1 ? 'require' : 'requires'
							} follow-up](command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'launchpad-indicator',
									state: {
										initialGroup: 'follow-up',
										selectTopItem: labelType === 'item',
									},
								} satisfies Omit<FocusCommandArgs, 'command'>),
							)} "Open Follow-Up in Launchpad")`,
						);
						priorityItem ??= { item: items[0], groupLabel: 'requires follow-up' };
						break;
					}
					case 'needs-review': {
						priorityIcon ??= icon;
						color ??= new ThemeColor('gitlens.launchpadIndicatorAttentionColor' satisfies Colors);
						tooltip.appendMarkdown(
							`<span style="color:var(--vscode-gitlens-launchpadIndicatorAttentionHoverColor);">${icon}</span>$(blank) [${
								labelType === 'item' && priorityItem == null && items.length
									? this.getPriorityItemLabel(items[0], items.length)
									: pluralize('pull request', items.length)
							} ${
								items.length > 1 ? 'need' : 'needs'
							} your review](command:gitlens.showLaunchpad?${encodeURIComponent(
								JSON.stringify({
									source: 'launchpad-indicator',
									state: {
										initialGroup: 'needs-review',
										selectTopItem: labelType === 'item',
									},
								} satisfies Omit<FocusCommandArgs, 'command'>),
							)} "Open Needs Your Review in Launchpad")`,
						);
						priorityItem ??= { item: items[0], groupLabel: 'needs your review' };
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
						? ` ${this.getPriorityItemLabel(priorityItem.item)} ${priorityItem.groupLabel}`
						: '';
				break;

			case 'counts':
				labelSegment = '';
				for (const group of groups) {
					if (!focusPriorityGroups.includes(group)) continue;

					const count = groupedItems.get(group)?.length ?? 0;
					const icon = focusGroupIconMap.get(group)!;

					labelSegment +=
						!labelSegment && iconSegment === icon ? `\u00a0${count}` : `\u00a0\u00a0${icon} ${count}`;
				}
				break;

			default:
				labelSegment = '';
				break;
		}

		this._statusBarFocus.text = `${iconSegment}${labelSegment}`;
		this._statusBarFocus.tooltip = tooltip;
		this._statusBarFocus.color = useColors ? color : undefined;
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.launchpad.indicator.action', async (action: string) => {
				this.storeFirstInteractionIfNeeded();
				switch (action) {
					case 'info': {
						void executeCommand<OpenWalkthroughCommandArgs>(Commands.OpenWalkthrough, {
							step: 'launchpad',
							source: 'launchpad-indicator',
							detail: 'info',
						});
						break;
					}
					case 'hide': {
						const hide = { title: 'Hide Anyway' };
						const cancel = { title: 'Cancel', isCloseAffordance: true };
						const action = await window.showInformationMessage(
							'GitLens Launchpad helps you focus and keep your team unblocked.\n\nAre you sure you want hide the indicator?',
							{
								modal: true,
								detail: '\nYou can always access Launchpad using the "GitLens: Open Launchpad" command, and can re-enable the indicator with the "GitLens: Toggle Launchpad Indicator" command.',
							},
							hide,
							cancel,
						);
						if (action === hide) {
							void configuration.updateEffective('launchpad.indicator.enabled', false);
						}
						break;
					}
					case 'connectGitHub': {
						const github = await this.container.integrations?.get(HostingIntegrationId.GitHub);
						if (github == null) break;
						if (!(github.maybeConnected ?? (await github.isConnected()))) {
							void github.connect('launchpad-indicator');
						}
						break;
					}
					default:
						break;
				}
			}),
		];
	}

	private getPriorityItemLabel(item: FocusItem, groupLength?: number) {
		return `${item.repository != null ? `${item.repository.owner.login}/${item.repository.name}` : ''}#${item.id}${
			groupLength != null && groupLength > 1
				? ` and ${pluralize('pull request', groupLength - 1, { infix: ' other ' })}`
				: ''
		}`;
	}

	private sendTelemetryFirstLoadEvent() {
		if (!this.container.telemetry.enabled) return;

		const hasLoaded = this.container.storage.get('launchpad:indicator:hasLoaded') ?? false;
		if (!hasLoaded) {
			void this.container.storage.store('launchpad:indicator:hasLoaded', true);
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
