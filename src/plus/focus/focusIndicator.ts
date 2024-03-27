import type { ConfigurationChangeEvent, StatusBarItem, ThemeColor } from 'vscode';
import { Disposable, MarkdownString, StatusBarAlignment, window } from 'vscode';
import type { Container } from '../../container';
import { registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { groupByMap } from '../../system/iterable';
import { pluralize } from '../../system/string';
import type { FocusItem, FocusProvider, FocusRefreshEvent } from './focusProvider';
import { focusGroups, groupAndSortFocusItems } from './focusProvider';

export class FocusIndicator implements Disposable {
	private readonly _disposable: Disposable;

	private _statusBarFocus: StatusBarItem | undefined;

	private _refreshTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly container: Container,
		private readonly focus: FocusProvider,
	) {
		this._disposable = Disposable.from(
			focus.onDidRefresh(this.onFocusRefreshed, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			...this.registerCommands(),
		);
		this.onReady();
	}

	dispose() {
		this.clearRefreshTimer();
		this._statusBarFocus?.dispose();
		this._statusBarFocus = undefined!;
		this._disposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'focus.experimental.indicators')) return;

		if (configuration.changed(e, 'focus.experimental.indicators.openQuickFocus')) {
			this.updateStatusBarFocusCommand();
		}

		if (configuration.changed(e, 'focus.experimental.indicators.data')) {
			if (configuration.changed(e, 'focus.experimental.indicators.data.enabled')) {
				if (
					configuration.get('focus.experimental.indicators.data.enabled') &&
					configuration.get('focus.experimental.indicators.data.refreshRate') > 0
				) {
					this.updateStatusBar('loading');
				} else {
					this.updateStatusBar('idle');
				}
			} else if (configuration.changed(e, 'focus.experimental.indicators.data.refreshRate')) {
				this.startRefreshTimer();
			}
		}
	}

	private onFocusRefreshed(e: FocusRefreshEvent) {
		if (this._statusBarFocus == null || !configuration.get('focus.experimental.indicators.data.enabled')) return;
		this.updateStatusBar('data', e.items);
	}

	private onReady(): void {
		if (!configuration.get('focus.experimental.indicators.enabled')) {
			return;
		}

		this._statusBarFocus = window.createStatusBarItem('gitlens.focus', StatusBarAlignment.Left, 10000 - 2);
		this._statusBarFocus.name = 'GitLens Focus';
		if (
			configuration.get('focus.experimental.indicators.data.enabled') &&
			configuration.get('focus.experimental.indicators.data.refreshRate') > 0
		) {
			this.updateStatusBar('loading');
		} else {
			this.updateStatusBar('idle');
		}
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

	private updateStatusBar(state: 'loading' | 'idle' | 'data', categorizedItems?: FocusItem[]) {
		if (this._statusBarFocus == null) return;
		this._statusBarFocus.tooltip = new MarkdownString('', true);
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
									`<span style="color:#00FF00;">$(circle-filled)</span> You have ${pluralize(
										'pull request',
										items.length,
									)} that can be merged.`,
								);
								this._statusBarFocus.tooltip.appendMarkdown('\n');
								this._statusBarFocus.tooltip.appendMarkdown(
									`<span>[Show all mergeable](command:gitlens.quickFocus?${encodeURIComponent(
										JSON.stringify({ state: { initialGroup: 'mergeable' } }),
									)})</span>`,
								);
								color = '#00FF00';
								topItem ??= { item: items[0], groupLabel: 'can be merged' };
								break;
							case 'blocked': {
								const action = groupByMap(items, i =>
									i.actionableCategory === 'failed-checks' || i.actionableCategory === 'conflicts'
										? i.actionableCategory
										: 'blocked',
								);
								let item: FocusItem | undefined;

								let actionGroupItems = action.get('failed-checks');
								if (actionGroupItems?.length) {
									const message = `You have ${pluralize(
										'pull request',
										actionGroupItems.length,
									)} that ${actionGroupItems.length > 1 ? 'have' : 'has'} failed CI checks.`;
									this._statusBarFocus.tooltip.appendMarkdown(
										`<span style="color:#FF0000;">$(circle-filled)</span> ${message}`,
									);
									item ??= actionGroupItems[0];
								}

								actionGroupItems = action.get('conflicts');
								if (actionGroupItems?.length) {
									const message = `You have ${pluralize(
										'pull request',
										actionGroupItems.length,
									)} that ${actionGroupItems.length > 1 ? 'have' : 'has'} conflicts.`;
									this._statusBarFocus.tooltip.appendMarkdown(
										`<span style="color:#FF0000;">$(circle-filled)</span> ${message}`,
									);
									item ??= actionGroupItems[0];
								}

								actionGroupItems = action.get('blocked');
								if (actionGroupItems?.length) {
									const message = `You have ${pluralize(
										'pull request',
										actionGroupItems.length,
									)} that ${actionGroupItems.length > 1 ? 'need' : 'needs'} attention.`;
									this._statusBarFocus.tooltip.appendMarkdown(
										`<span style="color:#FF0000;">$(circle-filled)</span> ${message}`,
									);
									item ??= actionGroupItems[0];
								}

								color ??= '#FF0000';
								if (item != null) {
									this._statusBarFocus.tooltip.appendMarkdown('\n');
									this._statusBarFocus.tooltip.appendMarkdown(
										`<span>[Show all blocked](command:gitlens.quickFocus?${encodeURIComponent(
											JSON.stringify({ state: { initialGroup: 'blocked' } }),
										)})</span>`,
									);
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
									`<span style="color:#FFFF00;">$(circle-filled)</span> You have ${pluralize(
										'pull request',
										items.length,
									)} that ${items.length > 1 ? 'need' : 'needs'} your review.`,
								);
								this._statusBarFocus.tooltip.appendMarkdown('\n');
								this._statusBarFocus.tooltip.appendMarkdown(
									`<span>[Show all needing your review](command:gitlens.quickFocus?${encodeURIComponent(
										JSON.stringify({ state: { initialGroup: 'needs-review' } }),
									)})</span>`,
								);
								color ??= '#FFFF00';
								topItem ??= { item: items[0], groupLabel: 'needs your review' };
								break;
							case 'follow-up':
								this._statusBarFocus.tooltip.appendMarkdown(
									`<span style="color:#FFA500;">$(circle-filled)</span> You have ${pluralize(
										'pull request',
										items.length,
									)} that ${items.length > 1 ? 'have' : 'has'} been reviewed and ${
										items.length > 1 ? 'require' : 'requires'
									} follow-up.`,
								);
								this._statusBarFocus.tooltip.appendMarkdown('\n');
								this._statusBarFocus.tooltip.appendMarkdown(
									`<span>[Show all requiring follow-up](command:gitlens.quickFocus?${encodeURIComponent(
										JSON.stringify({ state: { initialGroup: 'follow-up' } }),
									)})</span>`,
								);
								color ??= '#FFA500';
								topItem ??= { item: items[0], groupLabel: 'requires follow-up' };
								break;
						}
					}
				}
			}

			this._statusBarFocus.text = topItem ? `$(target) #${topItem.item.id} ${topItem.groupLabel}` : '$(target)';
			this._statusBarFocus.color = color;
		}

		this._statusBarFocus.tooltip.appendMarkdown('\n\n---\n\n');
		this._statusBarFocus.tooltip.appendMarkdown(
			configuration.get('focus.experimental.indicators.data.enabled')
				? `<span>[Mute](command:gitlens.focus.experimental.updateIndicators?"mute")</span>`
				: `<span>[Unmute](command:gitlens.focus.experimental.updateIndicators?"unmute")</span>`,
		);
		this._statusBarFocus.tooltip.appendMarkdown('\t\t');
		this._statusBarFocus.tooltip.appendMarkdown(
			`<span>[Hide](command:gitlens.focus.experimental.updateIndicators?"hide")</span>`,
		);
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.focus.experimental.updateIndicators', (action: string) => {
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
					default:
						break;
				}
			}),
		];
	}
}
