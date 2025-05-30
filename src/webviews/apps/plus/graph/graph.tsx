/*global document window*/
import type { CssVariables, GraphRef, GraphRow } from '@gitkraken/gitkraken-components';
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import type { GitGraphRowType } from '../../../../git/models/graph';
import type { SearchQuery } from '../../../../git/search';
import type {
	DismissBannerParams,
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
	DidChangeGraphConfigurationNotificationType,
	DidChangeNotificationType,
	DidChangeRefsMetadataNotificationType,
	DidChangeRefsVisibilityNotificationType,
	DidChangeRowsNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DidChangeWindowFocusNotificationType,
	DidChangeWorkingTreeNotificationType,
	DidEnsureRowNotificationType,
	DidFetchNotificationType,
	DidSearchNotificationType,
	DimMergeCommitsCommandType,
	DismissBannerCommandType,
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
import { Color, darken, lighten, mix, opacity } from '../../../../system/color';
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
					onDismissBanner={key => this.onDismissBanner(key)}
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

			case DidChangeWindowFocusNotificationType.method:
				onIpc(DidChangeWindowFocusNotificationType, msg, (params, type) => {
					this.state.windowFocused = params.focused;
					this.setState(this.state, type);
				});
				break;

			case DidChangeColumnsNotificationType.method:
				onIpc(DidChangeColumnsNotificationType, msg, (params, type) => {
					this.state.columns = params.columns;
					if (params.context != null) {
						if (this.state.context == null) {
							this.state.context = { header: params.context };
						} else {
							this.state.context.header = params.context;
						}
					} else if (this.state.context?.header != null) {
						this.state.context.header = undefined;
					}

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
					if (params.refsMetadata !== undefined) {
						this.state.refsMetadata = params.refsMetadata;
					}
					this.state.rows = rows;
					this.state.paging = params.paging;
					if (params.selectedRows != null) {
						this.state.selectedRows = params.selectedRows;
					}
					this.state.loading = false;
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
		const backgroundColor = Color.from(e.colors.background);
		const backgroundLuminance = backgroundColor.getRelativeLuminance();

		const foregroundColor = Color.from(e.colors.foreground);
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

		const bodyStyle = document.body.style;
		bodyStyle.setProperty('--graph-theme-opacity-factor', e.isLightTheme ? '0.5' : '1');

		bodyStyle.setProperty(
			'--color-graph-actionbar-background',
			e.isLightTheme ? darken(e.colors.background, 5) : lighten(e.colors.background, 5),
		);
		bodyStyle.setProperty(
			'--color-graph-actionbar-selectedBackground',
			e.isLightTheme ? darken(e.colors.background, 10) : lighten(e.colors.background, 10),
		);

		bodyStyle.setProperty(
			'--color-graph-background',
			e.isLightTheme ? darken(e.colors.background, 5) : lighten(e.colors.background, 5),
		);
		bodyStyle.setProperty(
			'--color-graph-background2',
			e.isLightTheme ? darken(e.colors.background, 10) : lighten(e.colors.background, 10),
		);
		let color = e.computedStyle.getPropertyValue('--vscode-list-focusOutline').trim();
		bodyStyle.setProperty('--color-graph-contrast-border', color);
		color = e.computedStyle.getPropertyValue('--vscode-list-activeSelectionBackground').trim();
		bodyStyle.setProperty('--color-graph-selected-row', color);
		color = e.computedStyle.getPropertyValue('--vscode-list-hoverBackground').trim();
		bodyStyle.setProperty('--color-graph-hover-row', color);
		color = e.computedStyle.getPropertyValue('--vscode-list-activeSelectionForeground').trim();
		bodyStyle.setProperty('--color-graph-text-selected-row', color);
		bodyStyle.setProperty('--color-graph-text-dimmed-selected', opacity(color, 50));
		bodyStyle.setProperty('--color-graph-text-dimmed', opacity(e.colors.foreground, 20));
		color = e.computedStyle.getPropertyValue('--vscode-list-hoverForeground').trim();
		bodyStyle.setProperty('--color-graph-text-hovered', color);
		bodyStyle.setProperty('--color-graph-text-selected', e.colors.foreground);
		bodyStyle.setProperty('--color-graph-text-normal', opacity(e.colors.foreground, 85));
		bodyStyle.setProperty('--color-graph-text-secondary', opacity(e.colors.foreground, 65));
		bodyStyle.setProperty('--color-graph-text-disabled', opacity(e.colors.foreground, 50));

		// minimap and scroll markers

		const resultColor = Color.fromHex('#ffff00');
		const headColor = Color.fromHex('#00ff00');
		const branchColor = Color.fromHex('#ff7f50');
		const tagColor = Color.fromHex('#15a0bf');
		const stashColor = Color.fromHex('#800080');

		color = e.computedStyle.getPropertyValue('--vscode-progressBar-background').trim();
		const activityColor = Color.from(color);
		// bodyStyle.setProperty('--color-graph-minimap-line0', color);
		bodyStyle.setProperty('--color-graph-minimap-line0', activityColor.luminance(themeLuminance(0.5)).toString());

		bodyStyle.setProperty(
			'--color-graph-minimap-focusLine',
			backgroundColor.luminance(themeLuminance(e.isLightTheme ? 0.6 : 0.2)).toString(),
		);

		color = e.computedStyle.getPropertyValue('--vscode-scrollbarSlider-background').trim();
		bodyStyle.setProperty(
			'--color-graph-minimap-visibleAreaBackground',
			Color.from(color)
				.luminance(themeLuminance(e.isLightTheme ? 0.6 : 0.15))
				.toString(),
		);

		color = e.computedStyle.getPropertyValue('--vscode-scrollbarSlider-hoverBackground').trim();
		bodyStyle.setProperty(
			'--color-graph-minimap-visibleAreaHoverBackground',
			Color.from(color)
				.luminance(themeLuminance(e.isLightTheme ? 0.6 : 0.15))
				.toString(),
		);

		color = Color.from(e.computedStyle.getPropertyValue('--vscode-list-activeSelectionBackground').trim())
			.luminance(themeLuminance(e.isLightTheme ? 0.45 : 0.32))
			.toString();
		// color = e.computedStyle.getPropertyValue('--vscode-editorCursor-foreground').trim();
		bodyStyle.setProperty('--color-graph-minimap-selectedMarker', color);
		bodyStyle.setProperty('--color-graph-scroll-marker-selection', color);
		bodyStyle.setProperty('--color-graph-minimap-highlightedMarker', opacity(color, 60));

		bodyStyle.setProperty(
			'--color-graph-minimap-resultMarker',
			resultColor.luminance(themeLuminance(0.6)).toString(),
		);
		bodyStyle.setProperty(
			'--color-graph-scroll-marker-highlights',
			resultColor.luminance(themeLuminance(0.6)).toString(),
		);

		const pillLabel = foregroundColor.luminance(themeLuminance(e.isLightTheme ? 0 : 1)).toString();
		const headBackground = headColor.luminance(themeLuminance(e.isLightTheme ? 0.9 : 0.2)).toString();
		const headBorder = headColor.luminance(themeLuminance(e.isLightTheme ? 0.2 : 0.4)).toString();
		const headMarker = headColor.luminance(themeLuminance(0.5)).toString();

		bodyStyle.setProperty('--color-graph-minimap-headBackground', headBackground);
		bodyStyle.setProperty('--color-graph-minimap-headBorder', headBorder);
		bodyStyle.setProperty('--color-graph-minimap-headForeground', pillLabel);
		bodyStyle.setProperty('--color-graph-minimap-headMarker', opacity(headMarker, 80));
		bodyStyle.setProperty('--color-graph-scroll-marker-head', opacity(headMarker, 90));

		bodyStyle.setProperty('--color-graph-minimap-upstreamBackground', headBackground);
		bodyStyle.setProperty('--color-graph-minimap-upstreamBorder', headBorder);
		bodyStyle.setProperty('--color-graph-minimap-upstreamForeground', pillLabel);
		bodyStyle.setProperty('--color-graph-minimap-upstreamMarker', opacity(headMarker, 60));
		bodyStyle.setProperty('--color-graph-scroll-marker-upstream', opacity(headMarker, 60));

		const branchBackground = branchColor.luminance(themeLuminance(e.isLightTheme ? 0.8 : 0.3)).toString();
		const branchBorder = branchColor.luminance(themeLuminance(e.isLightTheme ? 0.2 : 0.4)).toString();
		const branchMarker = branchColor.luminance(themeLuminance(0.6)).toString();

		bodyStyle.setProperty('--color-graph-minimap-branchBackground', branchBackground);
		bodyStyle.setProperty('--color-graph-minimap-branchBorder', branchBorder);
		bodyStyle.setProperty('--color-graph-minimap-branchForeground', pillLabel);
		bodyStyle.setProperty('--color-graph-minimap-branchMarker', opacity(branchMarker, 70));
		bodyStyle.setProperty('--color-graph-scroll-marker-local-branches', opacity(branchMarker, 90));

		bodyStyle.setProperty('--color-graph-minimap-remoteBackground', opacity(branchBackground, 80));
		bodyStyle.setProperty('--color-graph-minimap-remoteBorder', opacity(branchBorder, 80));
		bodyStyle.setProperty('--color-graph-minimap-remoteForeground', pillLabel);
		bodyStyle.setProperty('--color-graph-minimap-remoteMarker', opacity(branchMarker, 30));
		bodyStyle.setProperty('--color-graph-scroll-marker-remote-branches', opacity(branchMarker, 60));

		bodyStyle.setProperty(
			'--color-graph-minimap-tagBackground',
			tagColor.luminance(themeLuminance(e.isLightTheme ? 0.8 : 0.2)).toString(),
		);
		bodyStyle.setProperty(
			'--color-graph-minimap-tagBorder',
			tagColor.luminance(themeLuminance(e.isLightTheme ? 0.2 : 0.4)).toString(),
		);
		bodyStyle.setProperty('--color-graph-minimap-tagForeground', pillLabel);
		bodyStyle.setProperty(
			'--color-graph-minimap-tagMarker',
			opacity(tagColor.luminance(themeLuminance(0.5)).toString(), 60),
		);
		bodyStyle.setProperty(
			'--color-graph-scroll-marker-tags',
			opacity(tagColor.luminance(themeLuminance(0.9)).toString(), 90),
		);

		bodyStyle.setProperty(
			'--color-graph-scroll-marker-stashes',
			opacity(stashColor.luminance(themeLuminance(0.9)).toString(), 90),
		);

		if (e.isInitializing) return;

		this.state.theming = undefined;
		this.setState(this.state, 'didChangeTheme');
	}

	protected override setState(state: State, type?: IpcNotificationType<any> | InternalNotificationType) {
		this.log(`setState()`);
		const themingChanged = this.ensureTheming(state);

		// Avoid calling the base for now, since we aren't using the vscode state
		this.state = state;
		// super.setState(state);

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
		const computedStyle = window.getComputedStyle(document.body);
		const bgColor = computedStyle.getPropertyValue('--color-background');

		const mixedGraphColors: CssVariables = {};

		let i = 0;
		let color;
		for (const [colorVar, colorDefault] of graphLaneThemeColors) {
			color = computedStyle.getPropertyValue(colorVar) || colorDefault;

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
				'--panel__bg0': computedStyle.getPropertyValue('--color-graph-background'),
				'--panel__bg1': computedStyle.getPropertyValue('--color-graph-background2'),
				'--section-border': computedStyle.getPropertyValue('--color-graph-background2'),

				'--selected-row': computedStyle.getPropertyValue('--color-graph-selected-row'),
				'--selected-row-border': isHighContrastTheme
					? `1px solid ${computedStyle.getPropertyValue('--color-graph-contrast-border')}`
					: 'none',
				'--hover-row': computedStyle.getPropertyValue('--color-graph-hover-row'),
				'--hover-row-border': isHighContrastTheme
					? `1px dashed ${computedStyle.getPropertyValue('--color-graph-contrast-border')}`
					: 'none',

				'--text-selected': computedStyle.getPropertyValue('--color-graph-text-selected'),
				'--text-selected-row': computedStyle.getPropertyValue('--color-graph-text-selected-row'),
				'--text-hovered': computedStyle.getPropertyValue('--color-graph-text-hovered'),
				'--text-dimmed-selected': computedStyle.getPropertyValue('--color-graph-text-dimmed-selected'),
				'--text-dimmed': computedStyle.getPropertyValue('--color-graph-text-dimmed'),
				'--text-normal': computedStyle.getPropertyValue('--color-graph-text-normal'),
				'--text-secondary': computedStyle.getPropertyValue('--color-graph-text-secondary'),
				'--text-disabled': computedStyle.getPropertyValue('--color-graph-text-disabled'),

				'--text-accent': computedStyle.getPropertyValue('--color-link-foreground'),
				'--text-inverse': computedStyle.getPropertyValue('--vscode-input-background'),
				'--text-bright': computedStyle.getPropertyValue('--vscode-input-background'),
				...mixedGraphColors,
			},
			themeOpacityFactor: parseInt(computedStyle.getPropertyValue('--graph-theme-opacity-factor')) || 1,
		};
	}

	private onDismissBanner(key: DismissBannerParams['key']) {
		this.sendCommand(DismissBannerCommandType, { key: key });
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
		return this.sendCommand(GetMoreRowsCommandType, { id: sha });
	}

	private onSearch(search: SearchQuery | undefined, options?: { limit?: number }) {
		if (search == null) {
			this.state.searchResults = undefined;
		}
		return this.sendCommand(SearchCommandType, { search: search, limit: options?.limit });
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
		const selection = rows.map(r => ({ id: r.sha, type: r.type as GitGraphRowType }));
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
