/*global document window*/
import type { CssVariables } from '@gitkraken/gitkraken-components';
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import type { GraphColumnConfig } from '../../../../config';
import type { CommitListCallback, GraphCommit, GraphRepository, State } from '../../../../plus/webviews/graph/protocol';
import {
	DidChangeCommitsNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeNotificationType,
	DismissPreviewCommandType,
	GetMoreCommitsCommandType,
	UpdateColumnCommandType,
	UpdateSelectedRepositoryCommandType,
	UpdateSelectionCommandType,
} from '../../../../plus/webviews/graph/protocol';
import { debounce } from '../../../../system/function';
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
	private callback?: CommitListCallback;
	private $menu?: HTMLElement;

	constructor() {
		super('GraphApp');
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

		this.log('GraphApp onBind log', this.state.log);

		const $root = document.getElementById('root');
		if ($root != null) {
			render(
				<GraphWrapper
					subscriber={(callback: CommitListCallback) => this.registerEvents(callback)}
					onColumnChange={debounce(
						(name: string, settings: GraphColumnConfig) => this.onColumnChanged(name, settings),
						250,
					)}
					onSelectRepository={debounce((path: GraphRepository) => this.onRepositoryChanged(path), 250)}
					onMoreCommits={(...params) => this.onMoreCommits(...params)}
					onSelectionChange={debounce((selection: GraphCommit[]) => this.onSelectionChanged(selection), 250)}
					onDismissPreview={() => this.onDismissPreview()}
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
		this.log('onMessageReceived', e);

		const msg = e.data;
		switch (msg.method) {
			case DidChangeNotificationType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeNotificationType, msg, params => {
					this.setState({ ...this.state, ...params.state });
					this.refresh(this.state);
				});
				break;

			case DidChangeCommitsNotificationType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeCommitsNotificationType, msg, params => {
					this.setState({
						...this.state,
						commits: params.commits,
						log: params.log,
					});
					this.refresh(this.state);
				});
				break;

			case DidChangeGraphConfigurationNotificationType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeGraphConfigurationNotificationType, msg, params => {
					this.setState({
						...this.state,
						config: params.config,
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

	private onDismissPreview() {
		this.sendCommand(DismissPreviewCommandType, undefined);
	}

	private onColumnChanged(name: string, settings: GraphColumnConfig) {
		this.sendCommand(UpdateColumnCommandType, {
			name: name,
			config: settings,
		});
	}

	private onRepositoryChanged(repo: GraphRepository) {
		this.sendCommand(UpdateSelectedRepositoryCommandType, {
			path: repo.path,
		});
	}

	private onMoreCommits(limit?: number) {
		this.sendCommand(GetMoreCommitsCommandType, {
			limit: limit,
		});
	}

	private onSelectionChanged(selection: GraphCommit[]) {
		this.sendCommand(UpdateSelectionCommandType, {
			selection: selection,
		});
	}

	private registerEvents(callback: CommitListCallback): () => void {
		this.callback = callback;

		return () => {
			this.callback = undefined;
		};
	}

	private refresh(state: State) {
		if (this.callback !== undefined) {
			this.callback(state);
		}
	}
}

new GraphApp();
