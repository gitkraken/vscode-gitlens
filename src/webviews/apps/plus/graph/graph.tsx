/*global document window*/
import type { CssVariables, GraphRef, GraphRow } from '@gitkraken/gitkraken-components';
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import type { GitGraphRowType } from '../../../../git/models/graph';
import type { SearchQuery } from '../../../../git/search';
import type {
	GraphAvatars,
	GraphColumnsConfig,
	GraphExcludedRef,
	GraphExcludeTypes,
	GraphMissingRefsMetadata,
	GraphRefMetadataItem,
	InternalNotificationType,
	State,
	UpdateGraphConfigurationParams,
	UpdateStateCallback,
} from '../../../../plus/webviews/graph/protocol';
import {
	ChooseRepositoryCommandType,
	DidChangeAvatarsNotificationType,
	DidChangeColumnsNotificationType,
	DidChangeFocusNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeNotificationType,
	DidChangeRefsMetadataNotificationType,
	DidChangeRefsVisibilityNotificationType,
	DidChangeRowsNotificationType,
	DidChangeRowsStatsNotificationType,
	DidChangeScrollMarkersNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DidChangeWindowFocusNotificationType,
	DidChangeWorkingTreeNotificationType,
	DidEnsureRowNotificationType,
	DidFetchNotificationType,
	DidSearchNotificationType,
	DimMergeCommitsCommandType,
	DoubleClickedCommandType,
	EnsureRowCommandType,
	GetMissingAvatarsCommandType,
	GetMissingRefsMetadataCommandType,
	GetMoreRowsCommandType,
	SearchCommandType,
	SearchOpenInViewCommandType,
	UpdateColumnsCommandType,
	UpdateExcludeTypeCommandType,
	UpdateGraphConfigurationCommandType,
	UpdateIncludeOnlyRefsCommandType,
	UpdateRefsVisibilityCommandType,
	UpdateSelectionCommandType,
} from '../../../../plus/webviews/graph/protocol';
import { Color, darken, getCssVariable, lighten, mix, opacity } from '../../../../system/color';
import { debounce } from '../../../../system/function';
import type { IpcMessage, IpcNotificationType } from '../../../protocol';
import { onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import type { ThemeChangeEvent } from '../../shared/theme';
import { GraphWrapper } from './GraphWrapper';
import './graph.scss';

const graphLaneThemeColors = new Map([
	['--vscode-gitlens-graphLane1Color', '#15a0bf'],
	['--vscode-gitlens-graphLane2Color', '#0669f7'],
	['--vscode-gitlens-graphLane3Color', '#8e00c2'],
	['--vscode-gitlens-graphLane4Color', '#c517b6'],
	['--vscode-gitlens-graphLane5Color', '#d90171'],
	['--vscode-gitlens-graphLane6Color', '#cd0101'],
	['--vscode-gitlens-graphLane7Color', '#f25d2e'],
	['--vscode-gitlens-graphLane8Color', '#f2ca33'],
	['--vscode-gitlens-graphLane9Color', '#7bd938'],
	['--vscode-gitlens-graphLane10Color', '#2ece9d'],
]);

export class GraphApp extends App<State> {
	private callback?: UpdateStateCallback;

	constructor() {
		super('GraphApp');
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];
		// disposables.push(DOM.on(window, 'keyup', e => this.onKeyUp(e)));

		this.log(`onBind()`);

		this.ensureTheming(this.state);

		const $root = document.getElementById('root');
		if ($root != null) {
			render(
				<GraphWrapper
					nonce={this.state.nonce}
					state={this.state}
					subscriber={(callback: UpdateStateCallback) => this.registerEvents(callback)}
					onColumnsChange={debounce<GraphApp['onColumnsChanged']>(
						settings => this.onColumnsChanged(settings),
						250,
					)}
					onDimMergeCommits={dim => this.onDimMergeCommits(dim)}
					onRefsVisibilityChange={(refs: GraphExcludedRef[], visible: boolean) =>
						this.onRefsVisibilityChanged(refs, visible)
					}
					onChooseRepository={debounce<GraphApp['onChooseRepository']>(() => this.onChooseRepository(), 250)}
					onDoubleClickRef={(ref, metadata) => this.onDoubleClickRef(ref, metadata)}
					onDoubleClickRow={(row, preserveFocus) => this.onDoubleClickRow(row, preserveFocus)}
					onMissingAvatars={(...params) => this.onGetMissingAvatars(...params)}
					onMissingRefsMetadata={(...params) => this.onGetMissingRefsMetadata(...params)}
					onMoreRows={(...params) => this.onGetMoreRows(...params)}
					onSearch={debounce<GraphApp['onSearch']>((search, options) => this.onSearch(search, options), 250)}
					onSearchPromise={(...params) => this.onSearchPromise(...params)}
					onSearchOpenInView={(...params) => this.onSearchOpenInView(...params)}
					onSelectionChange={debounce<GraphApp['onSelectionChanged']>(
						rows => this.onSelectionChanged(rows),
						250,
					)}
					onEnsureRowPromise={this.onEnsureRowPromise.bind(this)}
					onExcludeType={this.onExcludeType.bind(this)}
					onIncludeOnlyRef={this.onIncludeOnlyRef.bind(this)}
					onUpdateGraphConfiguration={this.onUpdateGraphConfiguration.bind(this)}
				/>,
				$root,
			);
			disposables.push({
				dispose: () => unmountComponentAtNode($root),
			});
		}

		return disposables;
	}

	// private onKeyUp(e: KeyboardEvent) {
	// 	if (e.key === 'Enter' || e.key === ' ') {
	// 		const inputFocused = e.composedPath().some(el => (el as HTMLElement).tagName === 'INPUT');
	// 		if (!inputFocused) return;

	// 		const $target = e.target as HTMLElement;
	// 	}
	// }

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;
		this.log(`onMessageReceived(${msg.id}): name=${msg.method}`);

		switch (msg.method) {
			case DidChangeNotificationType.method:
				onIpc(DidChangeNotificationType, msg, (params, type) => {
					this.setState({ ...this.state, ...params.state }, type);
				});
				break;

			case DidFetchNotificationType.method:
				onIpc(DidFetchNotificationType, msg, (params, type) => {
					this.state.lastFetched = params.lastFetched;
					this.setState(this.state, type);
				});
				break;

			case DidChangeAvatarsNotificationType.method:
				onIpc(DidChangeAvatarsNotificationType, msg, (params, type) => {
					this.state.avatars = params.avatars;
					this.setState(this.state, type);
				});
				break;
			case DidChangeFocusNotificationType.method:
				onIpc(DidChangeFocusNotificationType, msg, params => {
					window.dispatchEvent(new CustomEvent(params.focused ? 'webview-focus' : 'webview-blur'));
				});
				break;

			case DidChangeWindowFocusNotificationType.method:
				onIpc(DidChangeWindowFocusNotificationType, msg, (params, type) => {
					this.state.windowFocused = params.focused;
					this.setState(this.state, type);
				});
				break;

			case DidChangeColumnsNotificationType.method:
				onIpc(DidChangeColumnsNotificationType, msg, (params, type) => {
					this.state.columns = params.columns;
					this.state.context = {
						...this.state.context,
						header: params.context,
						settings: params.settingsContext,
					};
					this.setState(this.state, type);
				});
				break;

			case DidChangeRefsVisibilityNotificationType.method:
				onIpc(DidChangeRefsVisibilityNotificationType, msg, (params, type) => {
					this.state.excludeRefs = params.excludeRefs;
					this.state.excludeTypes = params.excludeTypes;
					this.state.includeOnlyRefs = params.includeOnlyRefs;
					this.setState(this.state, type);
				});
				break;

			case DidChangeRefsMetadataNotificationType.method:
				onIpc(DidChangeRefsMetadataNotificationType, msg, (params, type) => {
					this.state.refsMetadata = params.metadata;
					this.setState(this.state, type);
				});
				break;

			case DidChangeRowsNotificationType.method:
				onIpc(DidChangeRowsNotificationType, msg, (params, type) => {
					let rows;
					if (params.rows.length && params.paging?.startingCursor != null && this.state.rows != null) {
						const previousRows = this.state.rows;
						const lastId = previousRows[previousRows.length - 1]?.sha;

						let previousRowsLength = previousRows.length;
						const newRowsLength = params.rows.length;

						this.log(
							`onMessageReceived(${msg.id}:${msg.method}): paging in ${newRowsLength} rows into existing ${previousRowsLength} rows at ${params.paging.startingCursor} (last existing row: ${lastId})`,
						);

						rows = [];
						// Preallocate the array to avoid reallocations
						rows.length = previousRowsLength + newRowsLength;

						if (params.paging.startingCursor !== lastId) {
							this.log(
								`onMessageReceived(${msg.id}:${msg.method}): searching for ${params.paging.startingCursor} in existing rows`,
							);

							let i = 0;
							let row;
							for (row of previousRows) {
								rows[i++] = row;
								if (row.sha === params.paging.startingCursor) {
									this.log(
										`onMessageReceived(${msg.id}:${msg.method}): found ${params.paging.startingCursor} in existing rows`,
									);

									previousRowsLength = i;

									if (previousRowsLength !== previousRows.length) {
										// If we stopped before the end of the array, we need to trim it
										rows.length = previousRowsLength + newRowsLength;
									}

									break;
								}
							}
						} else {
							for (let i = 0; i < previousRowsLength; i++) {
								rows[i] = previousRows[i];
							}
						}

						for (let i = 0; i < newRowsLength; i++) {
							rows[previousRowsLength + i] = params.rows[i];
						}
					} else {
						this.log(`onMessageReceived(${msg.id}:${msg.method}): setting to ${params.rows.length} rows`);

						if (params.rows.length === 0) {
							rows = this.state.rows;
						} else {
							rows = params.rows;
						}
					}

					this.state.avatars = params.avatars;
					this.state.downstreams = params.downstreams;
					if (params.refsMetadata !== undefined) {
						this.state.refsMetadata = params.refsMetadata;
					}
					this.state.rows = rows;
					this.state.paging = params.paging;
					if (params.rowsStats != null) {
						this.state.rowsStats = { ...this.state.rowsStats, ...params.rowsStats };
					}
					this.state.rowsStatsLoading = params.rowsStatsLoading;
					if (params.selectedRows != null) {
						this.state.selectedRows = params.selectedRows;
					}
					this.state.loading = false;
					this.setState(this.state, type);
				});
				break;

			case DidChangeRowsStatsNotificationType.method:
				onIpc(DidChangeRowsStatsNotificationType, msg, (params, type) => {
					this.state.rowsStats = { ...this.state.rowsStats, ...params.rowsStats };
					this.state.rowsStatsLoading = params.rowsStatsLoading;
					this.setState(this.state, type);
				});
				break;

			case DidChangeScrollMarkersNotificationType.method:
				onIpc(DidChangeScrollMarkersNotificationType, msg, (params, type) => {
					this.state.context = { ...this.state.context, settings: params.context };
					this.setState(this.state, type);
				});
				break;

			case DidSearchNotificationType.method:
				onIpc(DidSearchNotificationType, msg, (params, type) => {
					this.state.searchResults = params.results;
					if (params.selectedRows != null) {
						this.state.selectedRows = params.selectedRows;
					}
					this.setState(this.state, type);
				});
				break;

			case DidChangeSelectionNotificationType.method:
				onIpc(DidChangeSelectionNotificationType, msg, (params, type) => {
					this.state.selectedRows = params.selection;
					this.setState(this.state, type);
				});
				break;

			case DidChangeGraphConfigurationNotificationType.method:
				onIpc(DidChangeGraphConfigurationNotificationType, msg, (params, type) => {
					this.state.config = params.config;
					this.setState(this.state, type);
				});
				break;

			case DidChangeSubscriptionNotificationType.method:
				onIpc(DidChangeSubscriptionNotificationType, msg, (params, type) => {
					this.state.subscription = params.subscription;
					this.state.allowed = params.allowed;
					this.setState(this.state, type);
				});
				break;

			case DidChangeWorkingTreeNotificationType.method:
				onIpc(DidChangeWorkingTreeNotificationType, msg, (params, type) => {
					this.state.workingTreeStats = params.stats;
					this.setState(this.state, type);
				});
				break;

			default:
				super.onMessageReceived?.(e);
		}
	}

	protected override onThemeUpdated(e: ThemeChangeEvent) {
		const rootStyle = document.documentElement.style;
		rootStyle.setProperty('--graph-theme-opacity-factor', e.isLightTheme ? '0.5' : '1');

		rootStyle.setProperty(
			'--color-graph-actionbar-background',
			e.isLightTheme ? darken(e.colors.background, 5) : lighten(e.colors.background, 5),
		);

		rootStyle.setProperty(
			'--color-graph-background',
			e.isLightTheme ? darken(e.colors.background, 5) : lighten(e.colors.background, 5),
		);
		rootStyle.setProperty(
			'--color-graph-background2',
			e.isLightTheme ? darken(e.colors.background, 10) : lighten(e.colors.background, 10),
		);

		const color = getCssVariable('--color-graph-text-selected-row', e.computedStyle);
		rootStyle.setProperty('--color-graph-text-dimmed-selected', opacity(color, 50));
		rootStyle.setProperty('--color-graph-text-dimmed', opacity(e.colors.foreground, 20));

		rootStyle.setProperty('--color-graph-text-normal', opacity(e.colors.foreground, 85));
		rootStyle.setProperty('--color-graph-text-secondary', opacity(e.colors.foreground, 65));
		rootStyle.setProperty('--color-graph-text-disabled', opacity(e.colors.foreground, 50));

		const backgroundColor = Color.from(e.colors.background);
		const foregroundColor = Color.from(e.colors.foreground);

		const backgroundLuminance = backgroundColor.getRelativeLuminance();
		const foregroundLuminance = foregroundColor.getRelativeLuminance();

		const themeLuminance = (luminance: number) => {
			let min;
			let max;
			if (foregroundLuminance > backgroundLuminance) {
				max = foregroundLuminance;
				min = backgroundLuminance;
			} else {
				min = foregroundLuminance;
				max = backgroundLuminance;
			}
			const percent = luminance / 1;
			return percent * (max - min) + min;
		};

		// minimap and scroll markers

		let c = Color.fromCssVariable('--vscode-scrollbarSlider-background', e.computedStyle);
		rootStyle.setProperty(
			'--color-graph-minimap-visibleAreaBackground',
			c.luminance(themeLuminance(e.isLightTheme ? 0.6 : 0.1)).toString(),
		);

		if (!e.isLightTheme) {
			c = Color.fromCssVariable('--color-graph-scroll-marker-local-branches', e.computedStyle);
			rootStyle.setProperty(
				'--color-graph-minimap-tip-branchBackground',
				c.luminance(themeLuminance(0.55)).toString(),
			);

			c = Color.fromCssVariable('--color-graph-scroll-marker-local-branches', e.computedStyle);
			rootStyle.setProperty(
				'--color-graph-minimap-tip-branchBorder',
				c.luminance(themeLuminance(0.55)).toString(),
			);

			c = Color.fromCssVariable('--vscode-editor-foreground', e.computedStyle);
			rootStyle.setProperty(
				'--color-graph-minimap-tip-branchForeground',
				c.isLighter() ? c.luminance(0.01).toString() : c.luminance(0.99).toString(),
			);

			c = Color.fromCssVariable('--vscode-editor-foreground', e.computedStyle);
			rootStyle.setProperty(
				'--color-graph-minimap-tip-headForeground',
				c.isLighter() ? c.luminance(0.01).toString() : c.luminance(0.99).toString(),
			);

			c = Color.fromCssVariable('--vscode-editor-foreground', e.computedStyle);
			rootStyle.setProperty(
				'--color-graph-minimap-tip-upstreamForeground',
				c.isLighter() ? c.luminance(0.01).toString() : c.luminance(0.99).toString(),
			);
		}

		const branchStatusLuminance = themeLuminance(e.isLightTheme ? 0.72 : 0.064);
		const branchStatusHoverLuminance = themeLuminance(e.isLightTheme ? 0.64 : 0.076);
		const branchStatusPillLuminance = themeLuminance(e.isLightTheme ? 0.92 : 0.02);
		// branch status ahead
		c = Color.fromCssVariable('--branch-status-ahead-foreground', e.computedStyle);
		rootStyle.setProperty('--branch-status-ahead-background', c.luminance(branchStatusLuminance).toString());
		rootStyle.setProperty(
			'--branch-status-ahead-hover-background',
			c.luminance(branchStatusHoverLuminance).toString(),
		);
		rootStyle.setProperty(
			'--branch-status-ahead-pill-background',
			c.luminance(branchStatusPillLuminance).toString(),
		);

		// branch status behind
		c = Color.fromCssVariable('--branch-status-behind-foreground', e.computedStyle);
		rootStyle.setProperty('--branch-status-behind-background', c.luminance(branchStatusLuminance).toString());
		rootStyle.setProperty(
			'--branch-status-behind-hover-background',
			c.luminance(branchStatusHoverLuminance).toString(),
		);
		rootStyle.setProperty(
			'--branch-status-behind-pill-background',
			c.luminance(branchStatusPillLuminance).toString(),
		);

		// branch status both
		c = Color.fromCssVariable('--branch-status-both-foreground', e.computedStyle);
		rootStyle.setProperty('--branch-status-both-background', c.luminance(branchStatusLuminance).toString());
		rootStyle.setProperty(
			'--branch-status-both-hover-background',
			c.luminance(branchStatusHoverLuminance).toString(),
		);
		rootStyle.setProperty(
			'--branch-status-both-pill-background',
			c.luminance(branchStatusPillLuminance).toString(),
		);

		if (e.isInitializing) return;

		this.state.theming = undefined;
		this.setState(this.state, 'didChangeTheme');
	}

	protected override setState(state: State, type?: IpcNotificationType<any> | InternalNotificationType) {
		this.log(`setState()`);
		const themingChanged = this.ensureTheming(state);

		this.state = state;
		super.setState({ timestamp: state.timestamp, selectedRepository: state.selectedRepository });

		this.callback?.(this.state, type, themingChanged);
	}

	private ensureTheming(state: State): boolean {
		if (state.theming == null) {
			state.theming = this.getGraphTheming();
			return true;
		}
		return false;
	}

	private getGraphTheming(): { cssVariables: CssVariables; themeOpacityFactor: number } {
		// this will be called on theme updated as well as on config updated since it is dependent on the column colors from config changes and the background color from the theme
		const computedStyle = window.getComputedStyle(document.documentElement);
		const bgColor = getCssVariable('--color-background', computedStyle);

		const mixedGraphColors: CssVariables = {};

		let i = 0;
		let color;
		for (const [colorVar, colorDefault] of graphLaneThemeColors) {
			color = getCssVariable(colorVar, computedStyle) || colorDefault;

			mixedGraphColors[`--column-${i}-color`] = color;

			mixedGraphColors[`--graph-color-${i}`] = color;
			for (const mixInt of [15, 25, 45, 50]) {
				mixedGraphColors[`--graph-color-${i}-bg${mixInt}`] = mix(bgColor, color, mixInt);
			}
			for (const mixInt of [10, 50]) {
				mixedGraphColors[`--graph-color-${i}-f${mixInt}`] = opacity(color, mixInt);
			}

			i++;
		}

		const isHighContrastTheme = document.body.classList.contains('vscode-high-contrast');

		return {
			cssVariables: {
				'--app__bg0': bgColor,
				'--panel__bg0': getCssVariable('--color-graph-background', computedStyle),
				'--panel__bg1': getCssVariable('--color-graph-background2', computedStyle),
				'--section-border': getCssVariable('--color-graph-background2', computedStyle),

				'--selected-row': getCssVariable('--color-graph-selected-row', computedStyle),
				'--selected-row-border': isHighContrastTheme
					? `1px solid ${getCssVariable('--color-graph-contrast-border', computedStyle)}`
					: 'none',
				'--hover-row': getCssVariable('--color-graph-hover-row', computedStyle),
				'--hover-row-border': isHighContrastTheme
					? `1px dashed ${getCssVariable('--color-graph-contrast-border', computedStyle)}`
					: 'none',

				'--scrollable-scrollbar-thickness': getCssVariable('--graph-column-scrollbar-thickness', computedStyle),
				'--scroll-thumb-bg': getCssVariable('--vscode-scrollbarSlider-background', computedStyle),

				'--scroll-marker-head-color': getCssVariable('--color-graph-scroll-marker-head', computedStyle),
				'--scroll-marker-upstream-color': getCssVariable('--color-graph-scroll-marker-upstream', computedStyle),
				'--scroll-marker-highlights-color': getCssVariable(
					'--color-graph-scroll-marker-highlights',
					computedStyle,
				),
				'--scroll-marker-local-branches-color': getCssVariable(
					'--color-graph-scroll-marker-local-branches',
					computedStyle,
				),
				'--scroll-marker-remote-branches-color': getCssVariable(
					'--color-graph-scroll-marker-remote-branches',
					computedStyle,
				),
				'--scroll-marker-stashes-color': getCssVariable('--color-graph-scroll-marker-stashes', computedStyle),
				'--scroll-marker-tags-color': getCssVariable('--color-graph-scroll-marker-tags', computedStyle),
				'--scroll-marker-selection-color': getCssVariable(
					'--color-graph-scroll-marker-selection',
					computedStyle,
				),

				'--stats-added-color': getCssVariable('--color-graph-stats-added', computedStyle),
				'--stats-deleted-color': getCssVariable('--color-graph-stats-deleted', computedStyle),
				'--stats-files-color': getCssVariable('--color-graph-stats-files', computedStyle),
				'--stats-bar-border-radius': getCssVariable('--graph-stats-bar-border-radius', computedStyle),
				'--stats-bar-height': getCssVariable('--graph-stats-bar-height', computedStyle),

				'--text-selected': getCssVariable('--color-graph-text-selected', computedStyle),
				'--text-selected-row': getCssVariable('--color-graph-text-selected-row', computedStyle),
				'--text-hovered': getCssVariable('--color-graph-text-hovered', computedStyle),
				'--text-dimmed-selected': getCssVariable('--color-graph-text-dimmed-selected', computedStyle),
				'--text-dimmed': getCssVariable('--color-graph-text-dimmed', computedStyle),
				'--text-normal': getCssVariable('--color-graph-text-normal', computedStyle),
				'--text-secondary': getCssVariable('--color-graph-text-secondary', computedStyle),
				'--text-disabled': getCssVariable('--color-graph-text-disabled', computedStyle),

				'--text-accent': getCssVariable('--color-link-foreground', computedStyle),
				'--text-inverse': getCssVariable('--vscode-input-background', computedStyle),
				'--text-bright': getCssVariable('--vscode-input-background', computedStyle),
				...mixedGraphColors,
			},
			themeOpacityFactor: parseInt(getCssVariable('--graph-theme-opacity-factor', computedStyle)) || 1,
		};
	}

	private onColumnsChanged(settings: GraphColumnsConfig) {
		this.sendCommand(UpdateColumnsCommandType, {
			config: settings,
		});
	}

	private onRefsVisibilityChanged(refs: GraphExcludedRef[], visible: boolean) {
		this.sendCommand(UpdateRefsVisibilityCommandType, {
			refs: refs,
			visible: visible,
		});
	}

	private onChooseRepository() {
		this.sendCommand(ChooseRepositoryCommandType, undefined);
	}

	private onDimMergeCommits(dim: boolean) {
		this.sendCommand(DimMergeCommitsCommandType, {
			dim: dim,
		});
	}

	private onDoubleClickRef(ref: GraphRef, metadata?: GraphRefMetadataItem) {
		this.sendCommand(DoubleClickedCommandType, {
			type: 'ref',
			ref: ref,
			metadata: metadata,
		});
	}

	private onDoubleClickRow(row: GraphRow, preserveFocus?: boolean) {
		this.sendCommand(DoubleClickedCommandType, {
			type: 'row',
			row: { id: row.sha, type: row.type as GitGraphRowType },
			preserveFocus: preserveFocus,
		});
	}

	private onGetMissingAvatars(emails: GraphAvatars) {
		this.sendCommand(GetMissingAvatarsCommandType, { emails: emails });
	}

	private onGetMissingRefsMetadata(metadata: GraphMissingRefsMetadata) {
		this.sendCommand(GetMissingRefsMetadataCommandType, { metadata: metadata });
	}

	private onGetMoreRows(sha?: string) {
		this.sendCommand(GetMoreRowsCommandType, { id: sha });
	}

	private onSearch(search: SearchQuery | undefined, options?: { limit?: number }) {
		if (search == null) {
			this.state.searchResults = undefined;
		}
		this.sendCommand(SearchCommandType, { search: search, limit: options?.limit });
	}

	private async onSearchPromise(search: SearchQuery, options?: { limit?: number; more?: boolean }) {
		try {
			return await this.sendCommandWithCompletion(
				SearchCommandType,
				{ search: search, limit: options?.limit, more: options?.more },
				DidSearchNotificationType,
			);
		} catch {
			return undefined;
		}
	}

	private onSearchOpenInView(search: SearchQuery) {
		this.sendCommand(SearchOpenInViewCommandType, { search: search });
	}

	private async onEnsureRowPromise(id: string, select: boolean) {
		try {
			return await this.sendCommandWithCompletion(
				EnsureRowCommandType,
				{ id: id, select: select },
				DidEnsureRowNotificationType,
			);
		} catch {
			return undefined;
		}
	}

	private onExcludeType(key: keyof GraphExcludeTypes, value: boolean) {
		this.sendCommand(UpdateExcludeTypeCommandType, { key: key, value: value });
	}

	private onIncludeOnlyRef(all?: boolean) {
		this.sendCommand(
			UpdateIncludeOnlyRefsCommandType,
			all ? {} : { refs: [{ id: 'HEAD', type: 'head', name: 'HEAD' }] },
		);
	}

	private onUpdateGraphConfiguration(changes: UpdateGraphConfigurationParams['changes']) {
		this.sendCommand(UpdateGraphConfigurationCommandType, { changes: changes });
	}

	private onSelectionChanged(rows: GraphRow[]) {
		const selection = rows.filter(r => r != null).map(r => ({ id: r.sha, type: r.type as GitGraphRowType }));
		this.sendCommand(UpdateSelectionCommandType, {
			selection: selection,
		});
	}

	private registerEvents(callback: UpdateStateCallback): () => void {
		this.callback = callback;

		return () => {
			this.callback = undefined;
		};
	}
}

new GraphApp();
