/*global document window*/
import type { CssVariables, GraphRef, GraphRefOptData, GraphRow } from '@gitkraken/gitkraken-components';
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import type { GraphBranchesVisibility } from '../../../../config';
import type { SearchQuery } from '../../../../constants.search';
import type { GitGraphRowType } from '../../../../git/models/graph';
import { Color, getCssVariable, mix, opacity } from '../../../../system/color';
import { debug, log } from '../../../../system/decorators/log';
import { debounce } from '../../../../system/function';
import { getLogScope, setLogScopeExit } from '../../../../system/logger.scope';
import type {
	DidSearchParams,
	GraphAvatars,
	GraphColumnsConfig,
	GraphExcludedRef,
	GraphExcludeTypes,
	GraphMissingRefsMetadata,
	GraphRefMetadataItem,
	GraphSearchMode,
	InternalNotificationType,
	State,
	UpdateGraphConfigurationParams,
	UpdateStateCallback,
} from '../../../plus/graph/protocol';
import {
	ChooseRefRequest,
	ChooseRepositoryCommand,
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeNotification,
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidSearchNotification,
	DidStartFeaturePreviewNotification,
	DoubleClickedCommandType,
	EnsureRowRequest,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	GetRowHoverRequest,
	OpenPullRequestDetailsCommand,
	SearchOpenInViewCommand,
	SearchRequest,
	UpdateColumnsCommand,
	UpdateExcludeTypesCommand,
	UpdateGraphConfigurationCommand,
	UpdateGraphSearchModeCommand,
	UpdateIncludedRefsCommand,
	UpdateRefsVisibilityCommand,
	UpdateSelectionCommand,
} from '../../../plus/graph/protocol';
import type { IpcMessage, IpcNotification } from '../../../protocol';
import { DidChangeHostWindowFocusNotification } from '../../../protocol';
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
	private updateStateCallback?: UpdateStateCallback;

	constructor() {
		super('GraphApp');
	}

	@log()
	protected override onBind() {
		const disposables = super.onBind?.() ?? [];
		// disposables.push(DOM.on(window, 'keyup', e => this.onKeyUp(e)));

		this.ensureTheming(this.state);

		const $root = document.getElementById('root');
		if ($root != null) {
			render(
				<GraphWrapper
					nonce={this.state.nonce}
					state={this.state}
					subscriber={(updateState: UpdateStateCallback) => this.registerUpdateStateCallback(updateState)}
					onChangeColumns={debounce<GraphApp['onColumnsChanged']>(
						settings => this.onColumnsChanged(settings),
						250,
					)}
					onChangeExcludeTypes={this.onExcludeTypesChanged.bind(this)}
					onChangeGraphConfiguration={this.onGraphConfigurationChanged.bind(this)}
					onChangeGraphSearchMode={this.onGraphSearchModeChanged.bind(this)}
					onChangeRefIncludes={this.onRefIncludesChanged.bind(this)}
					onChangeRefsVisibility={(refs: GraphExcludedRef[], visible: boolean) =>
						this.onRefsVisibilityChanged(refs, visible)
					}
					onChangeSelection={debounce<GraphApp['onSelectionChanged']>(
						rows => this.onSelectionChanged(rows),
						250,
					)}
					onChooseRepository={debounce<GraphApp['onChooseRepository']>(() => this.onChooseRepository(), 250)}
					onDoubleClickRef={(ref, metadata) => this.onDoubleClickRef(ref, metadata)}
					onDoubleClickRow={(row, preserveFocus) => this.onDoubleClickRow(row, preserveFocus)}
					onEnsureRowPromise={this.onEnsureRowPromise.bind(this)}
					onHoverRowPromise={(row: GraphRow) => this.onHoverRowPromise(row)}
					onJumpToRefPromise={(shift: boolean) => this.onJumpToRefPromise(shift)}
					onMissingAvatars={(...params) => this.onGetMissingAvatars(...params)}
					onMissingRefsMetadata={(...params) => this.onGetMissingRefsMetadata(...params)}
					onMoreRows={(...params) => this.onGetMoreRows(...params)}
					onOpenPullRequest={(...params) => this.onOpenPullRequest(...params)}
					onSearch={debounce<GraphApp['onSearch']>((search, options) => this.onSearch(search, options), 250)}
					onSearchPromise={(...params) => this.onSearchPromise(...params)}
					onSearchOpenInView={(...params) => this.onSearchOpenInView(...params)}
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

	protected override onMessageReceived(msg: IpcMessage) {
		const scope = getLogScope();

		switch (true) {
			case DidChangeNotification.is(msg):
				this.setState({ ...this.state, ...msg.params.state }, DidChangeNotification);
				break;

			case DidFetchNotification.is(msg):
				this.state.lastFetched = msg.params.lastFetched;
				this.setState(this.state, DidFetchNotification);
				break;

			case DidChangeAvatarsNotification.is(msg):
				this.state.avatars = msg.params.avatars;
				this.setState(this.state, DidChangeAvatarsNotification);
				break;
			case DidStartFeaturePreviewNotification.is(msg):
				this.state.featurePreview = msg.params.featurePreview;
				this.state.allowed = msg.params.allowed;
				this.setState(this.state, DidStartFeaturePreviewNotification);
				break;
			case DidChangeBranchStateNotification.is(msg):
				this.state.branchState = msg.params.branchState;
				this.setState(this.state, DidChangeBranchStateNotification);
				break;

			case DidChangeHostWindowFocusNotification.is(msg):
				this.state.windowFocused = msg.params.focused;
				this.setState(this.state, DidChangeHostWindowFocusNotification);
				break;

			case DidChangeColumnsNotification.is(msg):
				this.state.columns = msg.params.columns;
				this.state.context = {
					...this.state.context,
					header: msg.params.context,
					settings: msg.params.settingsContext,
				};
				this.setState(this.state, DidChangeColumnsNotification);
				break;

			case DidChangeRefsVisibilityNotification.is(msg):
				this.state.branchesVisibility = msg.params.branchesVisibility;
				this.state.excludeRefs = msg.params.excludeRefs;
				this.state.excludeTypes = msg.params.excludeTypes;
				this.state.includeOnlyRefs = msg.params.includeOnlyRefs;
				this.setState(this.state, DidChangeRefsVisibilityNotification);
				break;

			case DidChangeRefsMetadataNotification.is(msg):
				this.state.refsMetadata = msg.params.metadata;
				this.setState(this.state, DidChangeRefsMetadataNotification);
				break;

			case DidChangeRowsNotification.is(msg): {
				let rows;
				if (msg.params.rows.length && msg.params.paging?.startingCursor != null && this.state.rows != null) {
					const previousRows = this.state.rows;
					const lastId = previousRows[previousRows.length - 1]?.sha;

					let previousRowsLength = previousRows.length;
					const newRowsLength = msg.params.rows.length;

					this.log(
						scope,
						`paging in ${newRowsLength} rows into existing ${previousRowsLength} rows at ${msg.params.paging.startingCursor} (last existing row: ${lastId})`,
					);

					rows = [];
					// Preallocate the array to avoid reallocations
					rows.length = previousRowsLength + newRowsLength;

					if (msg.params.paging.startingCursor !== lastId) {
						this.log(scope, `searching for ${msg.params.paging.startingCursor} in existing rows`);

						let i = 0;
						let row;
						for (row of previousRows) {
							rows[i++] = row;
							if (row.sha === msg.params.paging.startingCursor) {
								this.log(scope, `found ${msg.params.paging.startingCursor} in existing rows`);

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
						rows[previousRowsLength + i] = msg.params.rows[i];
					}
				} else {
					this.log(scope, `setting to ${msg.params.rows.length} rows`);

					if (msg.params.rows.length === 0) {
						rows = this.state.rows;
					} else {
						rows = msg.params.rows;
					}
				}

				this.state.avatars = msg.params.avatars;
				this.state.downstreams = msg.params.downstreams;
				if (msg.params.refsMetadata !== undefined) {
					this.state.refsMetadata = msg.params.refsMetadata;
				}
				this.state.rows = rows;
				this.state.paging = msg.params.paging;
				if (msg.params.rowsStats != null) {
					this.state.rowsStats = { ...this.state.rowsStats, ...msg.params.rowsStats };
				}
				this.state.rowsStatsLoading = msg.params.rowsStatsLoading;
				if (msg.params.selectedRows != null) {
					this.state.selectedRows = msg.params.selectedRows;
				}
				this.state.loading = false;
				this.setState(this.state, DidChangeRowsNotification);

				setLogScopeExit(scope, ` \u2022 rows=${this.state.rows?.length ?? 0}`);
				break;
			}
			case DidChangeRowsStatsNotification.is(msg):
				this.state.rowsStats = { ...this.state.rowsStats, ...msg.params.rowsStats };
				this.state.rowsStatsLoading = msg.params.rowsStatsLoading;
				this.setState(this.state, DidChangeRowsStatsNotification);
				break;

			case DidChangeScrollMarkersNotification.is(msg):
				this.state.context = { ...this.state.context, settings: msg.params.context };
				this.setState(this.state, DidChangeScrollMarkersNotification);
				break;

			case DidSearchNotification.is(msg):
				this.updateSearchResultState(msg.params);
				break;

			case DidChangeSelectionNotification.is(msg):
				this.state.selectedRows = msg.params.selection;
				this.setState(this.state, DidChangeSelectionNotification);
				break;

			case DidChangeGraphConfigurationNotification.is(msg):
				this.state.config = msg.params.config;
				this.setState(this.state, DidChangeGraphConfigurationNotification);
				break;

			case DidChangeSubscriptionNotification.is(msg):
				this.state.subscription = msg.params.subscription;
				this.state.allowed = msg.params.allowed;
				this.setState(this.state, DidChangeSubscriptionNotification);
				break;

			case DidChangeWorkingTreeNotification.is(msg):
				this.state.workingTreeStats = msg.params.stats;
				this.setState(this.state, DidChangeWorkingTreeNotification);
				break;

			case DidChangeRepoConnectionNotification.is(msg):
				this.state.repositories = msg.params.repositories;
				this.setState(this.state, DidChangeRepoConnectionNotification);
				break;

			default:
				super.onMessageReceived?.(msg);
		}
	}

	protected override onThemeUpdated(e: ThemeChangeEvent) {
		const rootStyle = document.documentElement.style;

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
			const tipForeground = c.isLighter() ? c.luminance(0.01).toString() : c.luminance(0.99).toString();
			rootStyle.setProperty('--color-graph-minimap-tip-headForeground', tipForeground);
			rootStyle.setProperty('--color-graph-minimap-tip-upstreamForeground', tipForeground);
			rootStyle.setProperty('--color-graph-minimap-tip-highlightForeground', tipForeground);
			rootStyle.setProperty('--color-graph-minimap-tip-branchForeground', tipForeground);
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

	@debug({ args: false, singleLine: true })
	protected override setState(state: State, type?: IpcNotification<any> | InternalNotificationType) {
		const themingChanged = this.ensureTheming(state);

		this.state = state;
		super.setState({ timestamp: state.timestamp, selectedRepository: state.selectedRepository });

		this.updateStateCallback?.(this.state, type, themingChanged);
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

		const isHighContrastTheme =
			document.body.classList.contains('vscode-high-contrast') ||
			document.body.classList.contains('vscode-high-contrast-light');

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
				'--scroll-marker-pull-requests-color': getCssVariable(
					'--color-graph-scroll-marker-pull-requests',
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
		this.sendCommand(UpdateColumnsCommand, {
			config: settings,
		});
	}

	private onRefsVisibilityChanged(refs: GraphExcludedRef[], visible: boolean) {
		this.sendCommand(UpdateRefsVisibilityCommand, {
			refs: refs,
			visible: visible,
		});
	}

	private onChooseRepository() {
		this.sendCommand(ChooseRepositoryCommand, undefined);
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

	private async onHoverRowPromise(row: GraphRow) {
		try {
			const request = await this.sendRequest(GetRowHoverRequest, {
				type: row.type as GitGraphRowType,
				id: row.sha,
			});
			this._telemetry.sendEvent({ name: 'graph/row/hovered', data: {} });
			return request;
		} catch (ex) {
			return { id: row.sha, markdown: { status: 'rejected' as const, reason: ex } };
		}
	}

	private async onJumpToRefPromise(alt: boolean): Promise<{ name: string; sha: string } | undefined> {
		try {
			// Assuming we have a command to get the ref details
			const rsp = await this.sendRequest(ChooseRefRequest, { alt: alt });
			this._telemetry.sendEvent({ name: 'graph/action/jumpTo', data: { alt: alt } });
			return rsp;
		} catch {
			return undefined;
		}
	}

	private onGetMissingAvatars(emails: GraphAvatars) {
		this.sendCommand(GetMissingAvatarsCommand, { emails: emails });
	}

	private onGetMissingRefsMetadata(metadata: GraphMissingRefsMetadata) {
		this.sendCommand(GetMissingRefsMetadataCommand, { metadata: metadata });
	}

	private onGetMoreRows(sha?: string) {
		this.sendCommand(GetMoreRowsCommand, { id: sha });
	}

	onOpenPullRequest(pr: NonNullable<NonNullable<State['branchState']>['pr']>): void {
		this.sendCommand(OpenPullRequestDetailsCommand, { id: pr.id });
	}

	private async onSearch(search: SearchQuery | undefined, options?: { limit?: number }) {
		if (search == null) {
			this.state.searchResults = undefined;
		}
		try {
			const rsp = await this.sendRequest(SearchRequest, { search: search, limit: options?.limit });
			this.updateSearchResultState(rsp);
		} catch {
			this.state.searchResults = undefined;
		}
	}

	private async onSearchPromise(search: SearchQuery, options?: { limit?: number; more?: boolean }) {
		try {
			const rsp = await this.sendRequest(SearchRequest, {
				search: search,
				limit: options?.limit,
				more: options?.more,
			});
			this.updateSearchResultState(rsp);
			return rsp;
		} catch {
			return undefined;
		}
	}

	private onSearchOpenInView(search: SearchQuery) {
		this.sendCommand(SearchOpenInViewCommand, { search: search });
	}

	private async onEnsureRowPromise(id: string, select: boolean) {
		try {
			return await this.sendRequest(EnsureRowRequest, { id: id, select: select });
		} catch {
			return undefined;
		}
	}

	private onExcludeTypesChanged(key: keyof GraphExcludeTypes, value: boolean) {
		this.sendCommand(UpdateExcludeTypesCommand, { key: key, value: value });
	}

	private onRefIncludesChanged(branchesVisibility: GraphBranchesVisibility, refs?: GraphRefOptData[]) {
		this.sendCommand(UpdateIncludedRefsCommand, { branchesVisibility: branchesVisibility, refs: refs });
	}

	private onGraphConfigurationChanged(changes: UpdateGraphConfigurationParams['changes']) {
		this.sendCommand(UpdateGraphConfigurationCommand, { changes: changes });
	}

	private onGraphSearchModeChanged(searchMode: GraphSearchMode) {
		this.sendCommand(UpdateGraphSearchModeCommand, { searchMode: searchMode });
	}

	private onSelectionChanged(rows: GraphRow[]) {
		const selection = rows.filter(r => r != null).map(r => ({ id: r.sha, type: r.type as GitGraphRowType }));
		this._telemetry.sendEvent({ name: 'graph/row/selected', data: { rows: selection.length } });
		this.sendCommand(UpdateSelectionCommand, {
			selection: selection,
		});
	}

	private registerUpdateStateCallback(updateState: UpdateStateCallback): () => void {
		this.updateStateCallback = updateState;

		return () => {
			this.updateStateCallback = undefined;
		};
	}

	private updateSearchResultState(params: DidSearchParams) {
		this.state.searchResults = params.results;
		if (params.selectedRows != null) {
			this.state.selectedRows = params.selectedRows;
		}
		this.setState(this.state, DidSearchNotification);
	}
}

new GraphApp();
