'use strict';
/*global*/
import '../scss/timeline.scss';
import {
	IpcMessage,
	onIpcNotification,
	TimelineDataPointClickCommandType,
	TimelineDidChangeDataNotificationType,
	TimelinePeriodUpdateCommandType,
} from '../../protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';
import { DataPointClickEvent, TimelineChart } from './chart';

export class TimelineApp extends App {
	private _chart!: TimelineChart;

	constructor() {
		super('TimelineApp', undefined);
	}

	protected onInitialize() {
		this._chart = new TimelineChart('#chart');
		this._chart.onDidClickDataPoint(this.onChartDataPointClicked, this);
	}

	protected onBind() {
		const disposables = super.onBind?.() ?? [];

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const me = this;

		disposables.push(
			DOM.on('#periods', 'change', function (this: HTMLSelectElement) {
				return me.onChartPeriodChanged(this);
			}),

			DOM.on(document, 'keydown', function (this: Document, e: KeyboardEvent) {
				return me.onKeyDown(this, e);
			}),
		);

		return disposables;
	}

	protected onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case TimelineDidChangeDataNotificationType.method:
				onIpcNotification(TimelineDidChangeDataNotificationType, msg, params => {
					const periods = document.getElementById('periods') as HTMLSelectElement;
					if (periods != null) {
						for (let i = 0, len = periods.options.length; i < len; ++i) {
							if (periods.options[i].innerHTML === params.data?.period) {
								periods.selectedIndex = i;
								break;
							}
						}
					}

					this._chart.updateChart(params.data);
				});
				break;

			default:
				if (super.onMessageReceived !== undefined) {
					super.onMessageReceived(e);
				}
		}
	}

	private onKeyDown(document: Document, e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Esc') {
			this._chart.reset();
		}
	}

	private onChartDataPointClicked(e: DataPointClickEvent) {
		this.sendCommand(TimelineDataPointClickCommandType, e);
	}

	private onChartPeriodChanged(element: HTMLSelectElement) {
		const value = element.options[element.selectedIndex].value;

		this.log(`${this.appName}.onPeriodChanged: name=${element.name}, value=${value}`);

		this.sendCommand(TimelinePeriodUpdateCommandType, { data: { period: value } });
	}
}

new TimelineApp();
