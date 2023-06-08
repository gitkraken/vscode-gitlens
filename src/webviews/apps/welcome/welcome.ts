/*global*/
import './welcome.scss';
import type { Disposable } from 'vscode';
import type { IpcMessage } from '../../protocol';
import { onIpc } from '../../protocol';
import type { State } from '../../welcome/protocol';
import { DidChangeNotificationType, UpdateConfigurationCommandType } from '../../welcome/protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';
import type { AnnotationsSvg } from './components/svg-annotations';
import type { BlameSvg } from './components/svg-blame';
import type { RevisionNavigationSvg } from './components/svg-revision-navigation';
// import { Snow } from '../shared/snow';
import '../shared/components/code-icon';
import '../shared/components/button';
import './components/card';
import './components/gitlens-logo';
import './components/svg-annotations';
import './components/svg-blame';
import './components/svg-graph';
import './components/svg-revision-navigation';
import './components/svg-timeline';

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
			DOM.on('[data-requires="repo"]', 'click', (e, target: HTMLElement) => this.onRepoFeatureClicked(e, target)),
		];
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

	private onFeatureToggled(e: Event, target: HTMLElement) {
		const feature = target.dataset.feature;
		if (!feature) return;

		if (e.type !== 'change') {
			if (feature === 'revision') {
				const $el = document.getElementById('revision') as RevisionNavigationSvg;
				$el.toggled = !$el.toggled;
			} else if (feature === 'annotations') {
				const $el = document.getElementById('annotations') as AnnotationsSvg;
				$el.toggled = !$el.toggled;
			}

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
		this.updateRepoState();
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
}

new WelcomeApp();
// requestAnimationFrame(() => new Snow());
