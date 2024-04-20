import type { ConfigurationChangeEvent, StatusBarItem, ThemeColor } from 'vscode';
import { Disposable, MarkdownString, StatusBarAlignment, window } from 'vscode';
import type { Container } from '../../container';
import { registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { groupByMap } from '../../system/iterable';
import { pluralize } from '../../system/string';
import type { ConnectionStateChangeEvent } from '../integrations/integrationService';
import { HostingIntegrationId } from '../integrations/providers/models';
import type { FocusItem, FocusProvider, FocusRefreshEvent } from './focusProvider';
import { focusGroups, groupAndSortFocusItems, supportedFocusIntegrations } from './focusProvider';

type FocusIndicatorState = 'loading' | 'idle' | 'data' | 'disconnected';

export class FocusIndicator implements Disposable {
	private readonly _disposable: Disposable;

	private _statusBarFocus: StatusBarItem | undefined;

	private _refreshTimer: ReturnType<typeof setInterval> | undefined;

	private _state: FocusIndicatorState;

	constructor(
		private readonly container: Container,
		private readonly focus: FocusProvider,
	) {
		this._disposable = Disposable.from(
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
		if (!configuration.changed(e, 'focus.experimental.indicators')) return;

		if (configuration.changed(e, 'focus.experimental.indicators.openQuickFocus')) {
			this.updateStatusBarFocusCommand();
		}

		if (configuration.changed(e, 'focus.experimental.indicators.data')) {
			if (configuration.changed(e, 'focus.experimental.indicators.data.enabled')) {
				await this.maybeLoadData();
			} else if (configuration.changed(e, 'focus.experimental.indicators.data.refreshRate')) {
				this.startRefreshTimer();
			}
		}
	}

	private async maybeLoadData() {
		if (
			configuration.get('focus.experimental.indicators.data.enabled') &&
			configuration.get('focus.experimental.indicators.data.refreshRate') > 0
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
		if (this._statusBarFocus == null || !configuration.get('focus.experimental.indicators.data.enabled')) return;
		this.updateStatusBar('data', e.items);
	}

	private async onReady(): Promise<void> {
		if (!configuration.get('focus.experimental.indicators.enabled')) {
			return;
		}

		this._statusBarFocus = window.createStatusBarItem('gitlens.focus', StatusBarAlignment.Left, 10000 - 2);
		this._statusBarFocus.name = 'GitLens Focus';
		await this.maybeLoadData();
		this.updateStatusBarFocusCommand();
		this._statusBarFocus.show();
	}

	private updateStatusBarFocusCommand() {
		if (this._statusBarFocus == null) return;

		this._statusBarFocus.command = configuration.get('focus.experimental.indicators.openQuickFocus')
			? 'gitlens.quickFocus'
			: 'gitlens.showFocusPage';
	}

	private startRefreshTimer(immediate: boolean = false) {
		if (this._refreshTimer != null) {
			clearInterval(this._refreshTimer);
		}

		if (!configuration.get('focus.experimental.indicators.data.enabled')) return;

		const refreshInterval = configuration.get('focus.experimental.indicators.data.refreshRate') * 1000 * 60;
		if (refreshInterval <= 0) return;

		if (immediate) {
			void this.focus.getCategorizedItems({ force: true });
		}

		this._refreshTimer = setInterval(() => {
			void this.focus.getCategorizedItems({ force: true });
		}, refreshInterval);
	}

	private clearRefreshTimer() {
		if (this._refreshTimer != null) {
			clearInterval(this._refreshTimer);
			this._refreshTimer = undefined;
		}
	}

	private updateStatusBar(state: 'loading' | 'idle' | 'data' | 'disconnected', categorizedItems?: FocusItem[]) {
		if (this._statusBarFocus == null) return;
		if (state !== 'data' && state === this._state) return;
		this._state = state;
		this._statusBarFocus.tooltip = new MarkdownString('', true);
		this._statusBarFocus.tooltip.appendMarkdown('Focus (PREVIEW)\n\n---\n\n');
		this._statusBarFocus.tooltip.supportHtml = true;
		this._statusBarFocus.tooltip.isTrusted = true;
		if (state === 'loading') {
			this._statusBarFocus.text = '$(loading~spin)';
			this._statusBarFocus.tooltip.appendMarkdown('Loading...');
			this._statusBarFocus.color = undefined;
			setTimeout(() => this.startRefreshTimer(true), 5000);
		} else if (state === 'idle') {
			this.clearRefreshTimer();
			this._statusBarFocus.text = '$(target)';
			this._statusBarFocus.tooltip.appendMarkdown('Click to open Focus');
			this._statusBarFocus.color = undefined;
		} else if (state === 'disconnected') {
			this.clearRefreshTimer();
			this._statusBarFocus.text = '$(target) Disconnected';
			this._statusBarFocus.tooltip.appendMarkdown(
				`[Connect to GitHub](command:gitlens.focus.experimental.updateIndicators?"connectGitHub") to see Focus items.`,
			);
			this._statusBarFocus.color = undefined;
		} else if (state === 'data') {
			let color: string | ThemeColor | undefined = undefined;
			let topItem: { item: FocusItem; groupLabel: string } | undefined;
			const groupedItems = groupAndSortFocusItems(categorizedItems);
			if (!groupedItems?.size) {
				this._statusBarFocus.tooltip.appendMarkdown('You are all caught up!');
			} else {
				for (const group of focusGroups) {
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
									)})`,
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
									)})`,
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
									)})`,
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
									)})`,
								);
								color ??= '#FFA500';
								topItem ??= { item: items[0], groupLabel: 'requires follow-up' };
								break;
						}
					}
				}
			}

			this._statusBarFocus.text = topItem
				? `$(target)${
						topItem.item.repository != null
							? ` ${topItem.item.repository.owner.login}/${topItem.item.repository.name}`
							: ''
				  } #${topItem.item.id} ${topItem.groupLabel}`
				: '$(target)';
			this._statusBarFocus.color = color;
		}

		this._statusBarFocus.tooltip.appendMarkdown('\n\n---\n\n');
		this._statusBarFocus.tooltip.appendMarkdown(
			configuration.get('focus.experimental.indicators.data.enabled')
				? `<span>$(bell-slash) [Mute](command:gitlens.focus.experimental.updateIndicators?"mute")</span>`
				: `<span>$(bell) [Unmute](command:gitlens.focus.experimental.updateIndicators?"unmute")</span>`,
		);
		this._statusBarFocus.tooltip.appendMarkdown('\t|\t');
		this._statusBarFocus.tooltip.appendMarkdown(
			`<span>$(circle-slash) [Hide](command:gitlens.focus.experimental.updateIndicators?"hide")</span>`,
		);
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.focus.experimental.updateIndicators', async (action: string) => {
				switch (action) {
					case 'mute':
						void configuration.updateEffective('focus.experimental.indicators.data.enabled', false);
						break;
					case 'unmute':
						void configuration.updateEffective('focus.experimental.indicators.data.enabled', true);
						break;
					case 'hide':
						this._statusBarFocus?.hide();
						break;
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
