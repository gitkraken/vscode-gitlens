/*global*/
import './welcome.scss';
import type { Disposable } from 'vscode';
import type { State } from '../../welcome/protocol';
import { UpdateConfigurationCommandType } from '../../welcome/protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';
// import { Snow } from '../shared/snow';
import '../shared/components/code-icon';
import '../shared/components/button';
import './components/card';
import './components/gitlens-logo';
import './components/gitlens-plus-logo';

export class WelcomeApp extends App<State> {
	constructor() {
		super('WelcomeApp');
	}

	protected override onInitialize() {
		this.updateState();
	}

	protected override onBind(): Disposable[] {
		const disposables = [
			...(super.onBind?.() ?? []),
			DOM.on('[data-feature]', 'change', (e, target: HTMLInputElement) => this.onFeatureToggled(e, target)),
			DOM.on('[data-feature]', 'click', (e, target: HTMLElement) => this.onFeatureToggled(e, target)),
		];
		return disposables;
	}

	private onFeatureToggled(e: Event, target: HTMLElement) {
		const feature = target.dataset.feature;
		if (!feature) return;

		if (e.type !== 'change') {
			this.toggleFeatureState(feature);

			return;
		}

		let type: keyof State['config'];
		switch (feature) {
			case 'blame':
				type = 'currentLine';
				break;
			case 'codelens':
				type = 'codeLens';
				break;
			default:
				return;
		}

		const enabled = (target as HTMLInputElement).checked;
		this.state.config[type] = enabled;
		this.sendCommand(UpdateConfigurationCommandType, { type: type, value: enabled });
		this.updateFeatures();
	}

	private updateState() {
		this.updateVersion();
		this.updateFeatures();
	}

	private updateVersion() {
		const { version } = this.state;
		document.getElementById('version')!.textContent = version;
	}

	private updateFeatures() {
		const { config } = this.state;

		this.setFeatureState('blame', config.currentLine ?? false);
		this.setFeatureState('codelens', config.codeLens ?? false);
	}

	private setFeatureState(feature: string, on: boolean) {
		document.body.setAttribute(`data-feature-${feature}`, on ? 'on' : 'off');
	}

	private toggleFeatureState(feature: string) {
		const state = document.body.getAttribute(`data-feature-${feature}`);
		this.setFeatureState(feature, state === 'off');
	}
}

new WelcomeApp();
// requestAnimationFrame(() => new Snow());

function gitlens(code: string) {
	return supercharged(code);
}

gitlens('');

function supercharged(code: string) {
	return code;
}
