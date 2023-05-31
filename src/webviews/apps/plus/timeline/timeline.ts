/*global*/
import './timeline.scss';
import { provideVSCodeDesignSystem, vsCodeDropdown, vsCodeOption } from '@vscode/webview-ui-toolkit';
import type { Period, State } from '../../../../plus/webviews/timeline/protocol';
import {
	DidChangeNotificationType,
	OpenDataPointCommandType,
	UpdatePeriodCommandType,
} from '../../../../plus/webviews/timeline/protocol';
import type { IpcMessage } from '../../../protocol';
import { onIpc } from '../../../protocol';
import { App } from '../../shared/appBase';
import { DOM } from '../../shared/dom';
import type { PlusFeatureWelcome } from '../shared/components/plus-feature-welcome';
import type { DataPointClickEvent } from './chart';
import { TimelineChart } from './chart';
import '../../shared/components/code-icon';
import '../../shared/components/progress';
import '../../shared/components/button';
import '../shared/components/plus-feature-welcome';

export class TimelineApp extends App<State> {
	private _chart: TimelineChart | undefined;

	constructor() {
		super('TimelineApp');
	}

	protected override onInitialize() {
		provideVSCodeDesignSystem().register(vsCodeDropdown(), vsCodeOption());

		this.updateState();
	}

	protected override onBind() {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on(document, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e)),
			DOM.on(document.getElementById('periods')! as HTMLSelectElement, 'change', (e, target) =>
				this.onPeriodChanged(e, target),
			),
			{ dispose: () => this._chart?.dispose() },
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
					this.setState(this.state);
					this.updateState();
				});
				break;

			default:
				super.onMessageReceived?.(e);
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

		this.updateLoading(true);
		this.sendCommand(UpdatePeriodCommandType, { period: value });
	}

	private updateState(): void {
		const $welcome = document.getElementsByTagName('plus-feature-welcome')?.[0] as PlusFeatureWelcome;
		if ($welcome != null) {
			$welcome.state = this.state.access.subscription.current.state;
			$welcome.allowed = this.state.access.allowed === true || this.state.uri == null;
		}

		if (this._chart == null) {
			this._chart = new TimelineChart('#chart', this.placement);
			this._chart.onDidClickDataPoint(this.onChartDataPointClicked, this);
		}

		let { title, sha } = this.state;

		let description = '';
		if (title != null) {
			const index = title.lastIndexOf('/');
			if (index >= 0) {
				const name = title.substring(index + 1);
				description = title.substring(0, index);
				title = name;
			}
		} else if (this.placement === 'editor' && this.state.dataset == null && !this.state.access.allowed) {
			title = 'index.ts';
			description = 'src/app';
		}

		function updateBoundData(key: string, value: string | undefined, options?: { html?: boolean }) {
			const $el = document.querySelector(`[data-bind="${key}"]`);
			if ($el != null) {
				if (options?.html) {
					$el.innerHTML = value ?? '';
				} else {
					$el.textContent = value ?? '';
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
				html: true,
			},
		);

		const $periods = document.getElementById('periods') as HTMLSelectElement;
		if ($periods != null) {
			const period = this.state?.period;

			const $periodOptions = $periods.getElementsByTagName('vscode-option');
			for (const $option of $periodOptions) {
				if (period === $option.getAttribute('value')) {
					$option.setAttribute('selected', '');
				} else {
					$option.removeAttribute('selected');
				}
			}
		}

		this._chart.updateChart(this.state);
		setTimeout(() => this.updateLoading(false), 250);
	}

	private updateLoading(loading: boolean) {
		document.getElementById('spinner')?.setAttribute('active', loading ? 'true' : 'false');
	}
}

function assertPeriod(period: string): asserts period is Period {
	if (period === 'all') return;

	const [value, unit] = period.split('|');
	if (isNaN(Number(value)) || (unit !== 'D' && unit !== 'M' && unit !== 'Y')) {
		throw new Error(`Invalid period: ${period}`);
	}
}

new TimelineApp();
