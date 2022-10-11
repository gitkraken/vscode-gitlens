/*global document window*/
import type { CssVariables, GraphRow } from '@gitkraken/gitkraken-components';
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import type { GitGraphRowType } from '../../../../git/models/graph';
import type { SearchQuery } from '../../../../git/search';
import type {
	DismissBannerParams,
	GraphAvatars,
	GraphColumnConfig,
	GraphColumnName,
	GraphHiddenRef,
	GraphMissingRefsMetadata,
	GraphRepository,
	InternalNotificationType,
	State,
	UpdateStateCallback,
} from '../../../../plus/webviews/graph/protocol';
import {
	DidChangeAvatarsNotificationType,
	DidChangeColumnsNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeNotificationType,
	DidChangeRefsMetadataNotificationType,
	DidChangeRefsVisibilityNotificationType,
	DidChangeRowsNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DidChangeWorkingTreeNotificationType,
	DidEnsureRowNotificationType,
	DidSearchNotificationType,
	DismissBannerCommandType,
	EnsureRowCommandType,
	GetMissingAvatarsCommandType,
	GetMissingRefsMetadataCommandType,
	GetMoreRowsCommandType,
	SearchCommandType,
	SearchOpenInViewCommandType,
	UpdateColumnCommandType,
	UpdateRefsVisibilityCommandType,
	UpdateSelectedRepositoryCommandType as UpdateRepositorySelectionCommandType,
	UpdateSelectionCommandType,
} from '../../../../plus/webviews/graph/protocol';
import { debounce } from '../../../../system/function';
import type { IpcMessage, IpcNotificationType } from '../../../../webviews/protocol';
import { onIpc } from '../../../../webviews/protocol';
import { App } from '../../shared/appBase';
import { mix, opacity } from '../../shared/colors';
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

		this.log(`${this.appName}.onBind`);

		this.ensureTheming(this.state);

		const $root = document.getElementById('root');
		if ($root != null) {
			render(
				<GraphWrapper
					nonce={this.state.nonce}
					state={this.state}
					subscriber={(callback: UpdateStateCallback) => this.registerEvents(callback)}
					onColumnChange={debounce<GraphApp['onColumnChanged']>(
						(name, settings) => this.onColumnChanged(name, settings),
						250,
					)}
					onRefsVisibilityChange={(refs: GraphHiddenRef[], visible: boolean) =>
						this.onRefsVisibilityChanged(refs, visible)
					}
					onSelectRepository={debounce<GraphApp['onRepositorySelectionChanged']>(
						path => this.onRepositorySelectionChanged(path),
						250,
					)}
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
				/>,
				$root,
			);
			disposables.push({
				dispose: () => unmountComponentAtNode($root),
			});
		}

		return disposables;
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;
		this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

		switch (msg.method) {
			case DidChangeNotificationType.method:
				onIpc(DidChangeNotificationType, msg, (params, type) => {
					this.setState({ ...this.state, ...params.state }, type);
				});
				break;

			case DidChangeAvatarsNotificationType.method:
				onIpc(DidChangeAvatarsNotificationType, msg, (params, type) => {
					this.state.avatars = params.avatars;
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
					this.state.hiddenRefs = params.hiddenRefs;
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
							`${this.appName}.onMessageReceived(${msg.id}:${msg.method}): paging in ${newRowsLength} rows into existing ${previousRowsLength} rows at ${params.paging.startingCursor} (last existing row: ${lastId})`,
						);

						rows = [];
						// Preallocate the array to avoid reallocations
						rows.length = previousRowsLength + newRowsLength;

						if (params.paging.startingCursor !== lastId) {
							this.log(
								`${this.appName}.onMessageReceived(${msg.id}:${msg.method}): searching for ${params.paging.startingCursor} in existing rows`,
							);

							let i = 0;
							let row;
							for (row of previousRows) {
								rows[i++] = row;
								if (row.sha === params.paging.startingCursor) {
									this.log(
										`${this.appName}.onMessageReceived(${msg.id}:${msg.method}): found ${params.paging.startingCursor} in existing rows`,
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
						this.log(
							`${this.appName}.onMessageReceived(${msg.id}:${msg.method}): setting to ${params.rows.length} rows`,
						);

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

	protected override onThemeUpdated() {
		this.state.theming = undefined;
		this.setState(this.state, 'didChangeTheme');
	}

	protected override setState(state: State, type?: IpcNotificationType<any> | InternalNotificationType) {
		this.log(`${this.appName}.setState`);
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
					? `1px solid ${computedStyle.getPropertyValue('--color-graph-contrast-border-color')}`
					: 'none',
				'--hover-row': computedStyle.getPropertyValue('--color-graph-hover-row'),
				'--hover-row-border': isHighContrastTheme
					? `1px dashed ${computedStyle.getPropertyValue('--color-graph-contrast-border-color')}`
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

	private onColumnChanged(name: GraphColumnName, settings: GraphColumnConfig) {
		this.sendCommand(UpdateColumnCommandType, {
			name: name,
			config: settings,
		});
	}

	private onRefsVisibilityChanged(refs: GraphHiddenRef[], visible: boolean) {
		this.sendCommand(UpdateRefsVisibilityCommandType, {
			refs: refs,
			visible: visible,
		});
	}

	private onRepositorySelectionChanged(repo: GraphRepository) {
		this.sendCommand(UpdateRepositorySelectionCommandType, {
			path: repo.path,
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
