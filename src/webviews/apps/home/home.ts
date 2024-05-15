/*global*/
import './home.scss';
import type { Disposable } from 'vscode';
import type { State } from '../../home/protocol';
import {
	CollapseSectionCommand,
	DidChangeOrgSettings,
	DidChangeRepositories,
	DidChangeSubscription,
} from '../../home/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommand } from '../../protocol';
import { App } from '../shared/appBase';
import type { GlFeatureBadge } from '../shared/components/feature-badge';
import { DOM } from '../shared/dom';
import '../shared/components/button';
import '../shared/components/code-icon';
import '../shared/components/feature-badge';
import '../shared/components/overlays/tooltip';

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
				this.state.promoStates = msg.params.promoStates;
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

	private onSectionToggleClicked(_e: MouseEvent, _target: HTMLElement) {
		// const section = target.dataset.sectionToggle;
		// if (section === 'walkthrough') {
		this.state.walkthroughCollapsed = !this.state.walkthroughCollapsed;
		this.setState(this.state);
		this.updateCollapsedSections(this.state.walkthroughCollapsed);
		this.sendCommand(CollapseSectionCommand, {
			section: 'walkthrough',
			collapsed: this.state.walkthroughCollapsed,
		});
		// }
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
		document.getElementById('section-walkthrough')!.classList.toggle('is-collapsed', toggle);
	}

	private updateState() {
		this.updateNoRepo();
		this.updatePromos();
		this.updateSourceAndSubscription();
		this.updateOrgSettings();
		this.updateCollapsedSections();
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
