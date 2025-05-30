/*global*/
import './home.scss';
import type { Disposable } from 'vscode';
import type { State } from '../../home/protocol';
import { DidChangeOrgSettingsType, DidChangeRepositoriesType, DidChangeSubscriptionType } from '../../home/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommandType, onIpc } from '../../protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';
import '../shared/components/button';
import '../shared/components/code-icon';

export class HomeApp extends App<State> {
	constructor() {
		super('HomeApp');
	}

	private get blockRepoFeatures() {
		const {
			repositories: { openCount, hasUnsafe, trusted },
		} = this.state;
		return !trusted || openCount === 0 || hasUnsafe;
	}

	protected override onInitialize() {
		this.state = this.getState() ?? this.state;
		this.updateState();
	}

	protected override onBind(): Disposable[] {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onDataActionClicked(e, target)),
			DOM.on('[data-requires="repo"]', 'click', (e, target: HTMLElement) => this.onRepoFeatureClicked(e, target)),
		);

		return disposables;
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (msg.method) {
			case DidChangeRepositoriesType.method:
				onIpc(DidChangeRepositoriesType, msg, params => {
					this.state.repositories = params;
					this.state.timestamp = Date.now();
					this.setState(this.state);
					this.updateNoRepo();
				});
				break;
			case DidChangeSubscriptionType.method:
				onIpc(DidChangeSubscriptionType, msg, params => {
					this.state.promoStates = params.promoStates;
					this.setState(this.state);
					this.updatePromos();
				});
				break;
			case DidChangeOrgSettingsType.method:
				onIpc(DidChangeOrgSettingsType, msg, params => {
					this.state.orgSettings = params.orgSettings;
					this.setState(this.state);
					this.updateOrgSettings();
				});
				break;
			default:
				super.onMessageReceived?.(msg);
				break;
		}
	}

	private onRepoFeatureClicked(e: MouseEvent, _target: HTMLElement) {
		if (this.blockRepoFeatures) {
			e.preventDefault();
			e.stopPropagation();
			return false;
		}

		return true;
	}

	private onDataActionClicked(_e: MouseEvent, target: HTMLElement) {
		const action = target.dataset.action;
		this.onActionClickedCore(action);
	}

	private onActionClickedCore(action?: string) {
		if (action?.startsWith('command:')) {
			this.sendCommand(ExecuteCommandType, { command: action.slice(8) });
		}
	}

	private updateNoRepo() {
		const {
			repositories: { openCount, hasUnsafe, trusted },
		} = this.state;

		const header = document.getElementById('header')!;
		if (!trusted) {
			header.hidden = false;
			setElementVisibility('untrusted-alert', true);
			setElementVisibility('no-repo-alert', false);
			setElementVisibility('unsafe-repo-alert', false);

			return;
		}

		setElementVisibility('untrusted-alert', false);

		const noRepos = openCount === 0;
		setElementVisibility('no-repo-alert', noRepos && !hasUnsafe);
		setElementVisibility('unsafe-repo-alert', hasUnsafe);
		header.hidden = !noRepos && !hasUnsafe;
	}

	private updatePromos() {
		const {
			promoStates: { hs2023, pro50 },
		} = this.state;

		setElementVisibility('promo-hs2023', hs2023);
		setElementVisibility('promo-pro50', pro50);
	}

	private updateOrgSettings() {
		const {
			orgSettings: { drafts },
		} = this.state;

		setElementVisibility('org-settings-drafts', drafts);
	}

	private updateState() {
		this.updateNoRepo();
		this.updatePromos();
		this.updateOrgSettings();
	}
}

function setElementVisibility(elementOrId: string | HTMLElement | null | undefined, visible: boolean) {
	let el;
	if (typeof elementOrId === 'string') {
		el = document.getElementById(elementOrId);
	} else {
		el = elementOrId;
	}
	if (el == null) return;

	if (visible) {
		el.removeAttribute('aria-hidden');
		el.removeAttribute('hidden');
	} else {
		el.setAttribute('aria-hidden', '');
		el?.setAttribute('hidden', '');
	}
}

new HomeApp();
