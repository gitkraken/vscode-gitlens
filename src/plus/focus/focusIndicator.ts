import type { ConfigurationChangeEvent, StatusBarItem, ThemeColor } from 'vscode';
import { Disposable, MarkdownString, StatusBarAlignment, window } from 'vscode';
import type { Container } from '../../container';
import { registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { groupByMap } from '../../system/iterable';
import { pluralize } from '../../system/string';
import type { ConnectionStateChangeEvent } from '../integrations/integrationService';
import { HostingIntegrationId } from '../integrations/providers/models';
import type { FocusGroup, FocusItem, FocusProvider, FocusRefreshEvent } from './focusProvider';
import { focusGroups, groupAndSortFocusItems, supportedFocusIntegrations } from './focusProvider';

type FocusIndicatorState = 'loading' | 'idle' | 'data' | 'disconnected';

export class FocusIndicator implements Disposable {
	private readonly _disposable: Disposable;

	private _statusBarFocus: StatusBarItem | undefined;

	private _refreshTimer: ReturnType<typeof setInterval> | undefined;

	private _state: FocusIndicatorState;

	private _lastDataUpdate: Date | undefined;

	private _lastRefreshPaused: Date | undefined;

	constructor(
		private readonly container: Container,
		private readonly focus: FocusProvider,
	) {
		this._disposable = Disposable.from(
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			focus.onDidRefresh(this.onFocusRefreshed, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.integrations.onDidChangeConnectionState(this.onConnectedIntegrationsChanged, this),
			...this.registerCommands(),
		);
		this._state = 'idle';
		void this.onReady();
	}

	dispose() {
		this.clearRefreshTimer();
		this._statusBarFocus?.dispose();
		this._statusBarFocus = undefined!;
		this._disposable.dispose();
	}

	private async onConnectedIntegrationsChanged(e: ConnectionStateChangeEvent) {
		if (supportedFocusIntegrations.includes(e.key as HostingIntegrationId)) {
			await this.maybeLoadData();
		}
	}

	private async onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'launchpad.indicator')) return;

		if (configuration.changed(e, 'launchpad.indicator.openInEditor')) {
			this.updateStatusBarFocusCommand();
		}

		let reloaded = false;
		if (configuration.changed(e, 'launchpad.indicator.polling')) {
			if (configuration.changed(e, 'launchpad.indicator.polling.enabled')) {
				await this.maybeLoadData();
				reloaded = true;
			} else if (configuration.changed(e, 'launchpad.indicator.polling.interval')) {
				this.startRefreshTimer();
			}
		}

		if (
			(!reloaded && configuration.changed(e, 'launchpad.indicator.useColors')) ||
			configuration.changed(e, 'launchpad.indicator.showTopItem') ||
			configuration.changed(e, 'launchpad.indicator.groups')
		) {
			await this.maybeLoadData();
		}
	}

	private async maybeLoadData() {
		if (
			configuration.get('launchpad.indicator.polling.enabled') &&
			configuration.get('launchpad.indicator.polling.interval') > 0
		) {
			if (await this.focus.hasConnectedIntegration()) {
				this.updateStatusBar('loading');
			} else {
				this.updateStatusBar('disconnected');
			}
		} else {
			this.updateStatusBar('idle');
		}
	}

	private onFocusRefreshed(e: FocusRefreshEvent) {
		if (this._statusBarFocus == null || !configuration.get('launchpad.indicator.polling.enabled')) return;
		this.updateStatusBar('data', e.items);
	}

	private async onReady(): Promise<void> {
		if (!configuration.get('launchpad.indicator.enabled')) {
			return;
		}

		this._statusBarFocus = window.createStatusBarItem('gitlens.focus', StatusBarAlignment.Left, 10000 - 2);
		this._statusBarFocus.name = 'GitLens Launchpad';
		await this.maybeLoadData();
		this.updateStatusBarFocusCommand();
		this._statusBarFocus.show();
	}

	private updateStatusBarFocusCommand() {
		if (this._statusBarFocus == null) return;

		this._statusBarFocus.command = configuration.get('launchpad.indicator.openInEditor')
			? 'gitlens.showFocusPage'
			: 'gitlens.quickFocus';
	}

	private startRefreshTimer(firstDelay?: number) {
		if (this._refreshTimer != null) {
			clearInterval(this._refreshTimer);
		}

		if (!configuration.get('launchpad.indicator.polling.enabled') || this._state === 'disconnected') return;

		const refreshInterval = configuration.get('launchpad.indicator.polling.interval') * 1000 * 60;
		if (refreshInterval <= 0) return;

		if (firstDelay != null) {
			this._refreshTimer = setTimeout(() => {
				void this.focus.getCategorizedItems({ force: true });
				this._refreshTimer = setInterval(() => {
					void this.focus.getCategorizedItems({ force: true });
				}, refreshInterval);
			}, firstDelay);
		} else {
			this._refreshTimer = setInterval(() => {
				void this.focus.getCategorizedItems({ force: true });
			}, refreshInterval);
		}
	}

	private clearRefreshTimer() {
		if (this._refreshTimer != null) {
			clearInterval(this._refreshTimer);
			this._refreshTimer = undefined;
		}
	}

	private onWindowStateChanged(e: { focused: boolean }) {
		if (!e.focused) {
			this.clearRefreshTimer();
			this._lastRefreshPaused = new Date();
		} else if (this._lastRefreshPaused != null) {
			const now = new Date();
			const timeSinceLastUpdate =
				this._lastDataUpdate != null ? now.getTime() - this._lastDataUpdate.getTime() : undefined;
			const timeSinceLastUnfocused = now.getTime() - this._lastRefreshPaused.getTime();
			this._lastRefreshPaused = undefined;
			const refreshInterval = configuration.get('launchpad.indicator.polling.interval') * 1000 * 60;
			let timeToNextPoll = timeSinceLastUpdate != null ? refreshInterval - timeSinceLastUpdate : refreshInterval;
			if (timeToNextPoll < 0) timeToNextPoll = 0;
			const diff = timeToNextPoll - timeSinceLastUnfocused;
			this.startRefreshTimer(diff < 0 ? 0 : diff);
		}
	}

	private updateStatusBar(state: FocusIndicatorState, categorizedItems?: FocusItem[]) {
		if (this._statusBarFocus == null) return;
		if (state !== 'data' && state === this._state) return;
		this._state = state;
		this._statusBarFocus.tooltip = new MarkdownString('', true);
		this._statusBarFocus.tooltip.supportHtml = true;
		this._statusBarFocus.tooltip.isTrusted = true;
		if (state === 'loading') {
			this._statusBarFocus.text = '$(loading~spin)';
			this._statusBarFocus.tooltip.appendMarkdown('Loading...');
			this._statusBarFocus.color = undefined;
			this.startRefreshTimer(5000);
		} else if (state === 'idle') {
			this.clearRefreshTimer();
			this._statusBarFocus.text = '$(rocket)';
			this._statusBarFocus.tooltip.appendMarkdown('Click to open Focus');
			this._statusBarFocus.color = undefined;
		} else if (state === 'disconnected') {
			this.clearRefreshTimer();
			this._statusBarFocus.text = '$(rocket) Disconnected';
			this._statusBarFocus.tooltip.appendMarkdown(
				`[Connect to GitHub](command:gitlens.launchpad.indicator.update?"connectGitHub") to see Focus items.`,
			);
			this._statusBarFocus.color = undefined;
		} else if (state === 'data') {
			this._lastDataUpdate = new Date();
			const useColors = configuration.get('launchpad.indicator.useColors');
			const groups = configuration.get('launchpad.indicator.groups') satisfies FocusGroup[];
			const showTopItem = configuration.get('launchpad.indicator.showTopItem');
			let color: string | ThemeColor | undefined = undefined;
			let topItem: { item: FocusItem; groupLabel: string } | undefined;
			const groupedItems = groupAndSortFocusItems(categorizedItems);
			if (!groupedItems?.size) {
				this._statusBarFocus.tooltip.appendMarkdown('You are all caught up!');
			} else {
				for (const group of groups ?? focusGroups) {
					const items = groupedItems.get(group);
					if (items?.length) {
						if (this._statusBarFocus.tooltip.value.length > 0) {
							this._statusBarFocus.tooltip.appendMarkdown(`\n\n---\n\n`);
						}
						switch (group) {
							case 'mergeable':
								this._statusBarFocus.tooltip.appendMarkdown(
									`<span style="color:#3d90fc;">$(rocket)</span> [${pluralize(
										'pull request',
										items.length,
									)} can be merged.](command:gitlens.quickFocus?${encodeURIComponent(
										JSON.stringify({ state: { initialGroup: 'mergeable' } }),
									)} "Open Ready to Merge in Launchpad")`,
								);
								color = '#00FF00';
								topItem ??= { item: items[0], groupLabel: 'can be merged' };
								break;
							case 'blocked': {
								const action = groupByMap(items, i =>
									i.actionableCategory === 'failed-checks' ||
									i.actionableCategory === 'conflicts' ||
									i.actionableCategory === 'unassigned-reviewers'
										? i.actionableCategory
										: 'blocked',
								);
								let item: FocusItem | undefined;
								let actionMessage = '';
								let summaryMessage = '(';
								let actionGroupItems = action.get('unassigned-reviewers');
								const hasMultipleCategories = action.size > 1;
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
								this._statusBarFocus.tooltip.appendMarkdown(
									`<span style="color:#FF0000;">$(error)</span> [${pluralize(
										'pull request',
										items.length,
									)} ${
										hasMultipleCategories ? 'are blocked' : actionMessage
									}.](command:gitlens.quickFocus?${encodeURIComponent(
										JSON.stringify({ state: { initialGroup: 'blocked' } }),
									)} "Open Blocked in Launchpad")`,
								);
								if (hasMultipleCategories) {
									this._statusBarFocus.tooltip.appendMarkdown(`\\\n$(blank)${summaryMessage}`);
								}
								color ??= '#FF0000';
								if (item != null) {
									let label = 'is blocked';
									if (item.actionableCategory === 'failed-checks') {
										label = 'failed CI checks';
									} else if (item.actionableCategory === 'conflicts') {
										label = 'has conflicts';
									}
									topItem ??= { item: item, groupLabel: label };
								}
								break;
							}
							case 'needs-review':
								this._statusBarFocus.tooltip.appendMarkdown(
									`<span style="color:#3d90fc;">$(comment-draft)</span> [${pluralize(
										'pull request',
										items.length,
									)} ${
										items.length > 1 ? 'need' : 'needs'
									} your review.](command:gitlens.quickFocus?${encodeURIComponent(
										JSON.stringify({ state: { initialGroup: 'needs-review' } }),
									)} "Open Needs Your Review in Launchpad")`,
								);
								color ??= '#FFFF00';
								topItem ??= { item: items[0], groupLabel: 'needs your review' };
								break;
							case 'follow-up':
								this._statusBarFocus.tooltip.appendMarkdown(
									`<span style="color:#3d90fc;">$(report)</span> [${pluralize(
										'pull request',
										items.length,
									)} ${
										items.length > 1 ? 'require' : 'requires'
									} follow-up.](command:gitlens.quickFocus?${encodeURIComponent(
										JSON.stringify({ state: { initialGroup: 'follow-up' } }),
									)} "Open Follow-Up in Launchpad")`,
								);
								color ??= '#FFA500';
								topItem ??= { item: items[0], groupLabel: 'requires follow-up' };
								break;
						}
					}
				}
			}

			this._statusBarFocus.text =
				topItem != null && showTopItem
					? `$(rocket)${
							topItem.item.repository != null
								? ` ${topItem.item.repository.owner.login}/${topItem.item.repository.name}`
								: ''
					  } #${topItem.item.id} ${topItem.groupLabel}`
					: '$(rocket)';
			this._statusBarFocus.color = useColors ? color : undefined;
		}

		if (this._statusBarFocus.tooltip.value.length) {
			this._statusBarFocus.tooltip.appendMarkdown('\n\n---\n\n');
		}
		this._statusBarFocus.tooltip.appendMarkdown(
			'GitLens Launchpad ᴘʀᴇᴠɪᴇᴡ\u00a0\u00a0\u00a0&mdash;\u00a0\u00a0\u00a0',
		);

		this._statusBarFocus.tooltip.appendMarkdown(
			configuration.get('launchpad.indicator.polling.enabled')
				? `<span>[$(bell-slash) Mute](command:gitlens.launchpad.indicator.update?"mute" "Mute")</span>`
				: `<span>[$(bell) Unmute](command:gitlens.launchpad.indicator.update?"unmute" "Unmute")</span>`,
		);
		this._statusBarFocus.tooltip.appendMarkdown('\u00a0\u00a0\u00a0|\u00a0\u00a0\u00a0');
		this._statusBarFocus.tooltip.appendMarkdown(
			`<span>[$(circle-slash) Hide](command:gitlens.launchpad.indicator.update?"hide" "Hide")</span>`,
		);
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.launchpad.indicator.update', async (action: string) => {
				switch (action) {
					case 'mute':
						void configuration.updateEffective('launchpad.indicator.polling.enabled', false);
						break;
					case 'unmute':
						void configuration.updateEffective('launchpad.indicator.polling.enabled', true);
						break;
					case 'hide': {
						const action = await window.showInformationMessage(
							'Would you like to hide the Launchpad status bar icon? You can re-enable it at any time using the "GitLens: Toggle Launchpad Status Bar Icon" command.',
							{ modal: true },
							'Hide',
						);
						if (action === 'Hide') {
							void configuration.updateEffective('launchpad.indicator.enabled', false);
						}
						break;
					}
					case 'connectGitHub': {
						const github = await this.container.integrations?.get(HostingIntegrationId.GitHub);
						if (github == null) break;
						if (!(github.maybeConnected ?? (await github.isConnected()))) {
							void github.connect();
						}
						break;
					}
					default:
						break;
				}
			}),
		];
	}
}
