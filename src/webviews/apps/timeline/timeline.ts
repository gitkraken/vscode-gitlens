'use strict';
/*global*/
import '../scss/timeline.scss';
import {
	IpcMessage,
	onIpcNotification,
	TimelineClickCommandType,
	TimelineDidChangeDataNotificationType,
} from '../../protocol';
import { App } from '../shared/appBase';
import { ClickedEvent, TimelineChart } from './chart';

export class TimelineApp extends App {
	private _chart: TimelineChart | undefined;

	constructor() {
		super('TimelineApp', undefined);
	}

	protected onInitialize() {
		this._chart = new TimelineChart('#chart');
		this._chart.onDidClick(this.onChartClicked, this);
	}

	private onChartClicked(e: ClickedEvent) {
		this.sendCommand(TimelineClickCommandType, e);
	}

	protected onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case TimelineDidChangeDataNotificationType.method:
				onIpcNotification(TimelineDidChangeDataNotificationType, msg, params => {
					this._chart!.updateChart(params.data);
				});
				break;

			default:
				if (super.onMessageReceived !== undefined) {
					super.onMessageReceived(e);
				}
		}
	}
}

new TimelineApp();
