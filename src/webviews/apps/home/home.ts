/*global*/
import './home.scss';
import type { Disposable } from 'vscode';
import { getApplicablePromo } from '../../../plus/gk/account/promos';
import type { OnboardingItem, OnboardingState, State } from '../../home/protocol';
import {
	DidChangeCodeLensState,
	DidChangeIntegrationsConnections,
	DidChangeOnboardingEditor,
	DidChangeOnboardingIntegration,
	DidChangeOnboardingState,
	DidChangeOrgSettings,
	DidChangeRepositories,
	DidChangeSubscription,
} from '../../home/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommand } from '../../protocol';
import { App } from '../shared/appBase';
import type { GlFeatureBadge } from '../shared/components/feature-badge';
import type { GlOnboarding as _GlOnboarding } from '../shared/components/onboarding/onboarding';
import type { GlPromo } from '../shared/components/promo';
import { DOM } from '../shared/dom';
import '../shared/components/button';
import '../shared/components/code-icon';
import '../shared/components/feature-badge';
import '../shared/components/overlays/tooltip';
import '../shared/components/promo';
import '../shared/components/onboarding/onboarding';
import { getOnboardingConfiguration } from './model/gitlens-onboarding';

type GlOnboarding = _GlOnboarding<OnboardingState, OnboardingItem>;
export class HomeApp extends App<State> {
	constructor() {
		super('HomeApp');
	}

	private _component?: GlOnboarding;
	private get component() {
		if (this._component == null) {
			this._component = (document.querySelector('gl-onboarding') as GlOnboarding)!;
		}
		return this._component;
	}

	attachState() {
		this.component.state = this.state.onboardingState;
		this.component.disabled = this.blockRepoFeatures;
		this.component.onboardingConfiguration = getOnboardingConfiguration(
			this.state.editorPreviewEnabled,
			this.state.repoHostConnected,
			this.state.canEnableCodeLens,
		);
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
		this.attachState();
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
		switch (true) {
			case DidChangeOnboardingState.is(msg):
				this.state.onboardingState = msg.params;
				this.state.timestamp = Date.now();
				this.setState(this.state);
				this.attachState();
				break;

			case DidChangeOnboardingEditor.is(msg):
				this.state.editorPreviewEnabled = msg.params.editorPreviewEnabled;
				this.state.timestamp = Date.now();
				this.setState(this.state);
				this.attachState();
				break;

			case DidChangeCodeLensState.is(msg):
				this.state.canEnableCodeLens = msg.params.canBeEnabled;
				this.state.timestamp = Date.now();
				this.setState(this.state);
				this.attachState();
				break;

			case DidChangeOnboardingIntegration.is(msg):
				this.state.onboardingState = msg.params.onboardingState;
				this.state.repoHostConnected = msg.params.repoHostConnected;
				this.state.timestamp = Date.now();
				this.setState(this.state);
				this.attachState();
				break;

			case DidChangeRepositories.is(msg):
				this.state.repositories = msg.params;
				this.state.timestamp = Date.now();
				this.setState(this.state);
				this.updateNoRepo();
				break;

			case DidChangeSubscription.is(msg):
				this.state.subscription = msg.params.subscription;
				this.setState(this.state);
				this.updatePromos();
				this.updateSourceAndSubscription();

				break;

			case DidChangeOrgSettings.is(msg):
				this.state.orgSettings = msg.params.orgSettings;
				this.setState(this.state);
				this.updateOrgSettings();
				break;

			case DidChangeIntegrationsConnections.is(msg):
				this.state.hasAnyIntegrationConnected = msg.params.hasAnyIntegrationConnected;
				this.setState(this.state);
				this.updateIntegrations();
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
			this.sendCommand(ExecuteCommand, { command: action.slice(8) });
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
		const promo = getApplicablePromo(this.state.subscription.state);

		const $promo = document.getElementById('promo') as GlPromo;
		$promo.promo = promo;
	}

	private updateOrgSettings() {
		const {
			orgSettings: { drafts },
		} = this.state;

		for (const el of document.querySelectorAll<HTMLElement>('[data-org-requires="drafts"]')) {
			setElementVisibility(el, drafts);
		}
	}

	private updateSourceAndSubscription() {
		const { subscription } = this.state;
		const els = document.querySelectorAll<GlFeatureBadge>('gl-feature-badge');
		for (const el of els) {
			el.source = { source: 'home', detail: 'badge' };
			el.subscription = subscription;
		}
	}

	private updateIntegrations() {
		const { hasAnyIntegrationConnected } = this.state;
		const els = document.querySelectorAll<HTMLElement>('[data-integrations]');
		const dataValue = hasAnyIntegrationConnected ? 'connected' : 'none';
		for (const el of els) {
			setElementVisibility(el, el.dataset.integrations === dataValue);
		}
	}

	private updateState() {
		this.updateNoRepo();
		this.updatePromos();
		this.updateSourceAndSubscription();
		this.updateOrgSettings();
		this.updateIntegrations();
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
