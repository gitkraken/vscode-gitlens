/*global*/
import './timeline.scss';
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDropdown, vsCodeOption } from '@vscode/webview-ui-toolkit';
import { GlyphChars } from '../../../../constants';
import type { State } from '../../../../plus/webviews/timeline/protocol';
import {
	DidChangeNotificationType,
	OpenDataPointCommandType,
	UpdatePeriodCommandType,
} from '../../../../plus/webviews/timeline/protocol';
import { SubscriptionPlanId, SubscriptionState } from '../../../../subscription';
import type { IpcMessage } from '../../../protocol';
import { ExecuteCommandType, onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import { DOM } from '../../shared/dom';
import type { DataPointClickEvent } from './chart';
import { TimelineChart } from './chart';
import '../../shared/components/code-icon';

export class TimelineApp extends App<State> {
	private _chart: TimelineChart | undefined;

	constructor() {
		super('TimelineApp');
	}

	protected override onInitialize() {
		provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeDropdown(), vsCodeOption());

		this.updateState();
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onActionClicked(e, target)),
			DOM.on(document, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e)),
			DOM.on(document.getElementById('periods')! as HTMLSelectElement, 'change', (e, target) =>
				this.onPeriodChanged(e, target),
			),
		);

		return disposables;
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case DidChangeNotificationType.method:
				this.log(`onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeNotificationType, msg, params => {
					this.state = params.state;
					this.updateState();
				});
				break;

			default:
				super.onMessageReceived?.(e);
		}
	}

	private onActionClicked(e: MouseEvent, target: HTMLElement) {
		const action = target.dataset.action;
		if (action?.startsWith('command:')) {
			this.sendCommand(ExecuteCommandType, { command: action.slice(8) });
		}
	}

	private onChartDataPointClicked(e: DataPointClickEvent) {
		this.sendCommand(OpenDataPointCommandType, e);
	}

	private onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Esc') {
			this._chart?.reset();
		}
	}

	private onPeriodChanged(_e: Event, element: HTMLSelectElement) {
		const value = element.options[element.selectedIndex].value;
		assertPeriod(value);

		this.log(`onPeriodChanged(): name=${element.name}, value=${value}`);

		this.sendCommand(UpdatePeriodCommandType, { period: value });
	}

	private updateState(): void {
		const $overlay = document.getElementById('overlay') as HTMLDivElement;
		$overlay.classList.toggle('hidden', this.state.access.allowed === true);

		const $slot = document.getElementById('overlay-slot') as HTMLDivElement;

		if (this.state.access.allowed === false) {
			const { current: subscription, required } = this.state.access.subscription;

			const requiresPublic = required === SubscriptionPlanId.FreePlus;
			const options = { visible: { public: requiresPublic, private: !requiresPublic } };

			if (subscription.account?.verified === false) {
				DOM.insertTemplate('state:verify-email', $slot, options);
				return;
			}

			switch (subscription.state) {
				case SubscriptionState.Free:
					DOM.insertTemplate('state:free', $slot, options);
					break;
				case SubscriptionState.FreePreviewTrialExpired:
					DOM.insertTemplate('state:free-preview-trial-expired', $slot, options);
					break;
				case SubscriptionState.FreePlusTrialExpired:
					DOM.insertTemplate('state:plus-trial-expired', $slot, options);
					break;
			}

			if (this.state.dataset == null) return;
		} else {
			$slot.innerHTML = '';
		}

		if (this._chart == null) {
			this._chart = new TimelineChart('#chart');
			this._chart.onDidClickDataPoint(this.onChartDataPointClicked, this);
		}

		let { title, sha } = this.state;

		let description = '';
		const index = title.lastIndexOf('/');
		if (index >= 0) {
			const name = title.substring(index + 1);
			description = title.substring(0, index);
			title = name;
		}

		function updateBoundData(
			key: string,
			value: string | undefined,
			options?: { hideIfEmpty?: boolean; html?: boolean },
		) {
			const $el = document.querySelector(`[data-bind="${key}"]`);
			if ($el != null) {
				const empty = value == null || value.length === 0;
				if (options?.hideIfEmpty) {
					$el.classList.toggle('hidden', empty);
				}
				if (options?.html && !empty) {
					$el.innerHTML = value;
				} else {
					$el.textContent = String(value) || GlyphChars.Space;
				}
			}
		}

		updateBoundData('title', title);
		updateBoundData('description', description);
		updateBoundData(
			'sha',
			sha
				? /*html*/ `<code-icon icon="git-commit" size="16"></code-icon><span class="sha">${sha}</span>`
				: undefined,
			{
				hideIfEmpty: true,
				html: true,
			},
		);

		const $periods = document.getElementById('periods') as HTMLSelectElement;
		if ($periods != null) {
			const period = this.state?.period;
			for (let i = 0, len = $periods.options.length; i < len; ++i) {
				if ($periods.options[i].value === period) {
					$periods.selectedIndex = i;
					break;
				}
			}
		}

		this._chart.updateChart(this.state);
	}
}

function assertPeriod(period: string): asserts period is `${number}|${'D' | 'M' | 'Y'}` {
	const [value, unit] = period.split('|');
	if (isNaN(Number(value)) || (unit !== 'D' && unit !== 'M' && unit !== 'Y')) {
		throw new Error(`Invalid period: ${period}`);
	}
}

new TimelineApp();
