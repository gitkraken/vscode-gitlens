/*global document window*/
import type { CssVariables } from '@gitkraken/gitkraken-components';
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import type { GitGraphRowType } from 'src/git/models/graph';
import type { GraphColumnConfig } from '../../../../config';
import type {
	DismissBannerParams,
	GraphRepository,
	State,
	UpdateStateCallback,
} from '../../../../plus/webviews/graph/protocol';
import {
	DidChangeAvatarsNotificationType,
	DidChangeCommitsNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DismissBannerCommandType,
	GetMissingAvatarsCommandType,
	GetMoreCommitsCommandType,
	UpdateColumnCommandType,
	UpdateSelectedRepositoryCommandType as UpdateRepositorySelectionCommandType,
	UpdateSelectionCommandType,
} from '../../../../plus/webviews/graph/protocol';
import { debounce } from '../../../../system/function';
import type { IpcMessage } from '../../../../webviews/protocol';
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

		this.log('GraphApp.onBind paging:', this.state.paging);

		const $root = document.getElementById('root');
		if ($root != null) {
			render(
				<GraphWrapper
					subscriber={(callback: UpdateStateCallback) => this.registerEvents(callback)}
					onColumnChange={debounce(
						(name: string, settings: GraphColumnConfig) => this.onColumnChanged(name, settings),
						250,
					)}
					onSelectRepository={debounce(
						(path: GraphRepository) => this.onRepositorySelectionChanged(path),
						250,
					)}
					onMissingAvatars={(...params) => this.onGetMissingAvatars(...params)}
					onMoreCommits={(...params) => this.onGetMoreCommits(...params)}
					onSelectionChange={debounce(
						(selection: { id: string; type: GitGraphRowType }[]) => this.onSelectionChanged(selection),
						250,
					)}
					onDismissBanner={key => this.onDismissBanner(key)}
					{...this.state}
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
				onIpc(DidChangeNotificationType, msg, params => {
					this.setState({ ...this.state, ...params.state });
					this.refresh(this.state);
				});
				break;

			case DidChangeAvatarsNotificationType.method:
				onIpc(DidChangeAvatarsNotificationType, msg, params => {
					this.setState({ ...this.state, avatars: params.avatars });
					this.refresh(this.state);
				});
				break;

			case DidChangeCommitsNotificationType.method:
				onIpc(DidChangeCommitsNotificationType, msg, params => {
					let rows;
					if (params?.paging?.startingCursor != null && this.state.rows != null) {
						const previousRows = this.state.rows;
						const lastSha = previousRows[previousRows.length - 1]?.sha;

						let previousRowsLength = previousRows.length;
						const newRowsLength = params.rows.length;

						this.log(
							`${this.appName}.onMessageReceived(${msg.id}:${msg.method}): paging in ${newRowsLength} rows into existing ${previousRowsLength} rows at ${params.paging.startingCursor} (last existing row: ${lastSha})`,
						);

						rows = [];
						// Preallocate the array to avoid reallocations
						rows.length = previousRowsLength + newRowsLength;

						if (params.paging.startingCursor !== lastSha) {
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

					this.setState({
						...this.state,
						avatars: params.avatars,
						rows: rows,
						loading: false,
						paging: params.paging,
					});
					this.refresh(this.state);
				});
				break;

			case DidChangeSelectionNotificationType.method:
				onIpc(DidChangeSelectionNotificationType, msg, params => {
					this.setState({ ...this.state, selectedRows: params.selection });
					this.refresh(this.state);
				});
				break;

			case DidChangeGraphConfigurationNotificationType.method:
				onIpc(DidChangeGraphConfigurationNotificationType, msg, params => {
					this.setState({ ...this.state, config: params.config });
					this.refresh(this.state);
				});
				break;

			case DidChangeSubscriptionNotificationType.method:
				onIpc(DidChangeSubscriptionNotificationType, msg, params => {
					this.setState({
						...this.state,
						subscription: params.subscription,
						allowed: params.allowed,
					});
					this.refresh(this.state);
				});
				break;

			default:
				super.onMessageReceived?.(e);
		}
	}

	protected override onThemeUpdated() {
		this.setState({ ...this.state, mixedColumnColors: undefined });
		this.refresh(this.state);
	}

	protected override setState(state: State) {
		if (state.mixedColumnColors == null) {
			state.mixedColumnColors = this.getGraphColors();
		}
		super.setState(state);
	}

	private getGraphColors(): CssVariables {
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

		return mixedGraphColors;
	}

	private onDismissBanner(key: DismissBannerParams['key']) {
		this.sendCommand(DismissBannerCommandType, { key: key });
	}

	private onColumnChanged(name: string, settings: GraphColumnConfig) {
		this.sendCommand(UpdateColumnCommandType, {
			name: name,
			config: settings,
		});
	}

	private onRepositorySelectionChanged(repo: GraphRepository) {
		this.sendCommand(UpdateRepositorySelectionCommandType, {
			path: repo.path,
		});
	}

	private onGetMissingAvatars(emails: { [email: string]: string }) {
		this.sendCommand(GetMissingAvatarsCommandType, { emails: emails });
	}

	private onGetMoreCommits() {
		this.sendCommand(GetMoreCommitsCommandType, undefined);
	}

	private onSelectionChanged(selection: { id: string; type: GitGraphRowType }[]) {
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

	private refresh(state: State) {
		this.callback?.(state);
	}
}

new GraphApp();
