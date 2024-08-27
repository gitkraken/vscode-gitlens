/*global*/
import './timeline.scss';
import { isSubscriptionPaid } from '../../../../plus/gk/account/subscription';
import type { Period, State } from '../../../../plus/webviews/timeline/protocol';
import {
	DidChangeNotification,
	OpenDataPointCommand,
	UpdatePeriodCommand,
} from '../../../../plus/webviews/timeline/protocol';
import type { IpcMessage } from '../../../protocol';
import { App } from '../../shared/appBase';
import type { GlFeatureBadge } from '../../shared/components/feature-badge';
import type { GlFeatureGate } from '../../shared/components/feature-gate';
import { DOM } from '../../shared/dom';
import type { DataPointClickEvent } from './chart';
import { TimelineChart } from './chart';
import '../../shared/components/code-icon';
import '../../shared/components/progress';
import '../../shared/components/button';
import '../../shared/components/feature-gate';
import '../../shared/components/feature-badge';

export class TimelineApp extends App<State> {
	private _chart: TimelineChart | undefined;

	constructor() {
		super('TimelineApp');
	}

	protected override onInitialize() {
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

	protected override onMessageReceived(msg: IpcMessage) {
		switch (true) {
			case DidChangeNotification.is(msg):
				this.state = msg.params.state;
				this.setState(this.state);
				this.updateState();
				break;

			default:
				super.onMessageReceived?.(msg);
		}
	}

	private onChartDataPointClicked(e: DataPointClickEvent) {
		this.sendCommand(OpenDataPointCommand, e);
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
		this.sendCommand(UpdatePeriodCommand, { period: value });
	}

	private updateState() {
		const $gate = document.getElementById('subscription-gate')! as GlFeatureGate;
		if ($gate != null) {
			$gate.source = { source: 'timeline', detail: 'gate' };
			$gate.state = this.state.access.subscription.current.state;
			$gate.visible = this.state.access.allowed !== true; // && this.state.uri != null;
		}

		const showBadge =
			this.state.access.subscription?.current == null ||
			!isSubscriptionPaid(this.state.access.subscription?.current);

		const els = document.querySelectorAll<GlFeatureBadge>('gl-feature-badge');
		for (const el of els) {
			el.source = { source: 'timeline', detail: 'badge' };
			el.subscription = this.state.access.subscription.current;
			el.hidden = !showBadge;
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

			const $periodOptions = $periods.getElementsByTagName('option');
			for (const $option of $periodOptions) {
				if (period === $option.getAttribute('value')) {
					$option.setAttribute('selected', '');
				} else {
					$option.removeAttribute('selected');
				}
			}
		}

		void this._chart.updateChart(this.state).finally(() => this.updateLoading(false));
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
