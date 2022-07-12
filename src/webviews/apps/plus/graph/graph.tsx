/*global document window*/
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import {
	ColumnChangeCommandType,
	CommitListCallback,
	DidChangeNotificationType,
	GraphColumnConfig,
	MoreCommitsCommandType,
	State,
} from '../../../../plus/webviews/graph/protocol';
import { onIpc } from '../../../../webviews/protocol';
import { App } from '../../shared/appBase';
import { GraphWrapper } from './GraphWrapper';
import './graph.scss';

export class GraphApp extends App<State> {
	private callback?: CommitListCallback;
	private $menu?: HTMLElement;

	constructor() {
		super('GraphApp');
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

		console.log('GraphApp onBind log', this.state.log);

		const $root = document.getElementById('root');
		if ($root != null) {
			render(
				<GraphWrapper
					subscriber={(callback: CommitListCallback) => this.registerEvents(callback)}
					onColumnChange={(...params) => this.onColumnChanged(...params)}
					onMoreCommits={(...params) => this.onMoreCommits(...params)}
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
		console.log('onMessageReceived', e);

		const msg = e.data;
		switch (msg.method) {
			case DidChangeNotificationType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeNotificationType, msg, params => {
					this.setState({ ...this.state, ...params.state });
					this.refresh(this.state);
				});
				break;

			default:
				super.onMessageReceived?.(e);
		}
	}

	private onColumnChanged(name: string, settings: GraphColumnConfig) {
		this.sendCommand(ColumnChangeCommandType, {
			name: name,
			config: settings,
		});
	}

	private onMoreCommits(limit?: number) {
		this.sendCommand(MoreCommitsCommandType, {
			limit: limit,
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
