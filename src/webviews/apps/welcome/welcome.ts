/*global*/
import './welcome.scss';
import type { Disposable } from 'vscode';
import type { IpcMessage } from '../../protocol';
import type { State } from '../../welcome/protocol';
import { DidChangeNotification, DidChangeOrgSettings, UpdateConfigurationCommand } from '../../welcome/protocol';
import { App } from '../shared/appBase';
import type { GlFeatureBadge } from '../shared/components/feature-badge';
import { DOM } from '../shared/dom';
import type { BlameSvg } from './components/svg-blame';
// import { Snow } from '../shared/snow';
import '../shared/components/code-icon';
import '../shared/components/button';
import '../shared/components/feature-badge';
import '../shared/components/overlays/tooltip';
import './components/card';
import './components/gitlens-logo';
import './components/svg-annotations';
import './components/svg-blame';
import './components/svg-editor-toolbar';
import './components/svg-focus';
import './components/svg-graph';
import './components/svg-launchpad';
import './components/svg-revision-navigation';
import './components/svg-timeline';
import './components/svg-workspaces';
import './components/video-button';
import '../shared/components/indicators/indicator';

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
			DOM.on('[data-requires="repo"]', 'click', (e, target: HTMLElement) => this.onRepoFeatureClicked(e, target)),
		];
		return disposables;
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (true) {
			case DidChangeNotification.is(msg):
				this.state = msg.params.state;
				this.setState(this.state);
				this.updateState();
				break;

			case DidChangeOrgSettings.is(msg):
				this.state.orgSettings = msg.params.orgSettings;
				this.setState(this.state);
				this.updateOrgSettings();
				break;

			default:
				super.onMessageReceived?.(msg);
				break;
		}
	}

	private onRepoFeatureClicked(e: MouseEvent, _target: HTMLElement) {
		if (this.state.repoFeaturesBlocked ?? false) {
			e.preventDefault();
			e.stopPropagation();
			return false;
		}

		return true;
	}

	private onFeatureToggled(_e: Event, target: HTMLElement) {
		const feature = target.dataset.feature;
		if (!feature) return;

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
		this.sendCommand(UpdateConfigurationCommand, { type: type, value: enabled });
		this.updateFeatures();
	}

	private updateState() {
		this.updateVersion();
		this.updateFeatures();
		this.updateRepoState();
		this.updateAccountState();
		this.updatePromo();
		this.updateSource();
		this.updateOrgSettings();
	}

	private updateOrgSettings() {
		const {
			orgSettings: { drafts, ai },
		} = this.state;

		document.body.dataset.orgDrafts = drafts ? 'allowed' : 'blocked';
		document.body.dataset.orgAi = ai ? 'allowed' : 'blocked';
	}

	private updatePromo() {
		const { canShowPromo } = this.state;
		document.getElementById('promo')!.hidden = !(canShowPromo ?? false);
	}

	private updateSource() {
		const els = document.querySelectorAll<GlFeatureBadge>('gl-feature-badge');
		for (const el of els) {
			el.source = { source: 'welcome', detail: 'badge' };
		}
	}

	private updateVersion() {
		document.getElementById('version')!.textContent = this.state.version;
	}

	private updateFeatures() {
		const { config } = this.state;

		const $el = document.getElementById('blame') as BlameSvg;
		$el.inline = config.currentLine ?? false;
		$el.codelens = config.codeLens ?? false;

		let $input = document.getElementById('inline-blame') as HTMLInputElement;
		$input.checked = config.currentLine ?? false;

		$input = document.getElementById('codelens') as HTMLInputElement;
		$input.checked = config.codeLens ?? false;
	}

	private updateRepoState() {
		const { repoFeaturesBlocked } = this.state;
		document.body.dataset.repos = repoFeaturesBlocked ? 'blocked' : 'allowed';
	}

	private updateAccountState() {
		const { isTrialOrPaid } = this.state;
		for (const el of document.querySelectorAll('[data-visible="try-pro"]')) {
			(el as HTMLElement).hidden = isTrialOrPaid ?? false;
		}
		// document.getElementById('try-pro')!.hidden = isTrialOrPaid ?? false;
	}
}

new WelcomeApp();
// requestAnimationFrame(() => new Snow());
