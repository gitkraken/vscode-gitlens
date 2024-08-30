/*global*/
import './home.scss';
import { html } from 'lit';
import type { Disposable } from 'vscode';
import { getApplicablePromo } from '../../../plus/gk/account/promos';
import type { State } from '../../home/protocol';
import {
	CollapseSectionCommand,
	DidChangeIntegrationsConnections,
	DidChangeOrgSettings,
	DidChangeRepositories,
	DidChangeSubscription,
} from '../../home/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommand } from '../../protocol';
import type { AccountContent } from '../plus/account/components/account-content';
import { GlApp } from '../shared/app';
import { App } from '../shared/appBase';
import type { GlFeatureBadge } from '../shared/components/feature-badge';
import type { GlPromo } from '../shared/components/promo';
import { DOM } from '../shared/dom';
import type { HostIpc } from '../shared/ipc';
import { HomeStateProvider } from './stateProvider';
import '../shared/components/button';
import '../shared/components/code-icon';
import '../shared/components/feature-badge';
import '../shared/components/overlays/tooltip';
import '../shared/components/promo';
import '../plus/account/components/account-content';

export class GlHomeApp extends GlApp<State> {
	protected override createStateProvider(state: State, ipc: HostIpc) {
		return new HomeStateProvider(this, state, ipc);
	}

	override render() {
		return html`<account-content id="account-content"></account-content>`;
	}
}

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
			DOM.on('[data-section-toggle]', 'click', (e, target: HTMLElement) =>
				this.onSectionToggleClicked(e, target),
			),
			DOM.on('[data-section-expand]', 'click', (e, target: HTMLElement) =>
				this.onSectionExpandClicked(e, target),
			),
		);

		return disposables;
	}

	protected override onMessageReceived(msg: IpcMessage) {
		switch (true) {
			case DidChangeRepositories.is(msg):
				this.state.repositories = msg.params;
				this.state.timestamp = Date.now();
				this.setState(this.state);
				this.updateNoRepo();
				break;

			case DidChangeSubscription.is(msg):
				this.state.subscription = msg.params.subscription;
				this.state.avatar = msg.params.avatar;
				this.state.organizationsCount = msg.params.organizationsCount;
				this.state.timestamp = Date.now();
				this.setState(this.state);
				this.updatePromos();
				this.updateSourceAndSubscription();
				this.updateAccountSection();

				break;

			case DidChangeOrgSettings.is(msg):
				this.state.orgSettings = msg.params.orgSettings;
				this.state.timestamp = Date.now();
				this.setState(this.state);
				this.updateOrgSettings();
				break;

			case DidChangeIntegrationsConnections.is(msg):
				this.state.hasAnyIntegrationConnected = msg.params.hasAnyIntegrationConnected;
				this.state.timestamp = Date.now();
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

	private onSectionToggleClicked(e: MouseEvent, target: HTMLElement) {
		e.stopImmediatePropagation();
		const section = target.dataset.sectionToggle;
		if (section !== 'walkthrough') {
			return;
		}

		this.updateCollapsedSections(!this.state.walkthroughCollapsed);
	}

	private onSectionExpandClicked(_e: MouseEvent, target: HTMLElement) {
		const section = target.dataset.sectionExpand;
		if (section !== 'walkthrough') {
			return;
		}
		this.updateCollapsedSections(false);
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

	private updateCollapsedSections(toggle = this.state.walkthroughCollapsed) {
		this.state.walkthroughCollapsed = toggle;
		this.setState({ walkthroughCollapsed: toggle });
		document.getElementById('section-walkthrough')!.classList.toggle('is-collapsed', toggle);
		this.sendCommand(CollapseSectionCommand, {
			section: 'walkthrough',
			collapsed: toggle,
		});
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
		this.updateCollapsedSections();
		this.updateIntegrations();
		this.updateAccountSection();
	}

	private updateAccountSection() {
		const { subscription, avatar, organizationsCount } = this.state;

		const $content = document.getElementById('account-content')! as AccountContent;

		$content.image = avatar ?? '';
		$content.subscription = subscription;
		$content.organizationsCount = organizationsCount ?? 0;
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
