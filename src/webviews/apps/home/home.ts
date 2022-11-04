/*global*/
import './home.scss';
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import type { Disposable } from 'vscode';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../subscription';
import type { State } from '../../home/protocol';
import {
	CompleteStepCommandType,
	DidChangeConfigurationType,
	DidChangeExtensionEnabledType,
	DidChangeLayoutType,
	DidChangeSubscriptionNotificationType,
	DismissSectionCommandType,
} from '../../home/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommandType, onIpc } from '../../protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';
import type { CardSection } from './components/card-section';
import type { PlusBanner } from './components/plus-banner';
import type { SteppedSection } from './components/stepped-section';
import '../shared/components/code-icon';
import '../shared/components/overlays/pop-over';
import './components/card-section';
import './components/stepped-section';
import './components/plus-banner';
import './components/plus-content';
import './components/header-card';

export class HomeApp extends App<State> {
	private $steps!: SteppedSection[];
	private $cards!: CardSection[];

	constructor() {
		super('HomeApp');
	}

	protected override onInitialize() {
		provideVSCodeDesignSystem().register(vsCodeButton());

		this.$steps = [...document.querySelectorAll<SteppedSection>('stepped-section[id]')];
		this.$cards = [...document.querySelectorAll<CardSection>('card-section[id]')];

		this.updateState();
	}

	protected override onBind(): Disposable[] {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onDataActionClicked(e, target)),
		);
		disposables.push(
			DOM.on<PlusBanner, string>('plus-banner', 'action', (e, target: HTMLElement) =>
				this.onPlusActionClicked(e, target),
			),
		);
		disposables.push(
			DOM.on<SteppedSection, boolean>('stepped-section', 'complete', (e, target: HTMLElement) =>
				this.onStepComplete(e, target),
			),
		);
		disposables.push(
			DOM.on<CardSection, undefined>('card-section', 'dismiss', (e, target: HTMLElement) =>
				this.onCardDismissed(e, target),
			),
		);

		return disposables;
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case DidChangeSubscriptionNotificationType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeSubscriptionNotificationType, msg, params => {
					this.state.subscription = params.subscription;
					this.state.completedActions = params.completedActions;
					this.state.avatar = params.avatar;
					this.updateState();
				});
				break;
			case DidChangeExtensionEnabledType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeExtensionEnabledType, msg, params => {
					this.state.extensionEnabled = params.extensionEnabled;
					this.updateNoRepo();
				});
				break;
			case DidChangeConfigurationType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeConfigurationType, msg, params => {
					this.state.plusEnabled = params.plusEnabled;
					this.updatePlusContent();
				});
				break;
			case DidChangeLayoutType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeLayoutType, msg, params => {
					this.state.layout = params.layout;
					this.updateLayout();
				});
				break;

			default:
				super.onMessageReceived?.(e);
				break;
		}
	}

	private onStepComplete(e: CustomEvent<boolean>, target: HTMLElement) {
		const id = target.id;
		const isComplete = e.detail ?? false;
		this.state.completedSteps = toggleArrayItem(this.state.completedSteps, id, isComplete);
		this.sendCommand(CompleteStepCommandType, { id: id, completed: isComplete });
		this.updateState();
	}

	private onCardDismissed(e: CustomEvent<undefined>, target: HTMLElement) {
		const id = target.id;
		this.state.dismissedSections = toggleArrayItem(this.state.dismissedSections, id);
		this.sendCommand(DismissSectionCommandType, { id: id });
		this.updateState();
	}

	private onDataActionClicked(e: MouseEvent, target: HTMLElement) {
		const action = target.dataset.action;
		this.onActionClickedCore(action);
	}

	private onPlusActionClicked(e: CustomEvent<string>, _target: HTMLElement) {
		this.onActionClickedCore(e.detail);
	}

	private onActionClickedCore(action?: string) {
		if (action?.startsWith('command:')) {
			this.sendCommand(ExecuteCommandType, { command: action.slice(8) });
		}
	}

	private getDaysRemaining() {
		if (
			![SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(
				this.state.subscription.state,
			)
		) {
			return 0;
		}

		return getSubscriptionTimeRemaining(this.state.subscription, 'days') ?? 0;
	}

	private forceShowPlus() {
		return [
			SubscriptionState.FreePreviewTrialExpired,
			SubscriptionState.FreePlusTrialExpired,
			SubscriptionState.VerificationRequired,
		].includes(this.state.subscription.state);
	}

	private updateHeader(days = this.getDaysRemaining(), forceShowPlus = this.forceShowPlus()) {
		const { subscription, completedSteps, avatar } = this.state;

		const $headerContent = document.getElementById('header-card');
		if ($headerContent) {
			if (avatar) {
				$headerContent.setAttribute('image', avatar);
			}
			$headerContent.setAttribute('name', subscription.account?.name ?? '');

			const steps = this.$steps?.length ?? 0;
			let completed = completedSteps?.length ?? 0;
			if (steps > 0 && completed > 0) {
				const stepIds = this.$steps.map(el => el.id);
				const availableCompleted = completedSteps!.filter(name => stepIds.includes(name));
				completed = availableCompleted.length;

				if (forceShowPlus && availableCompleted.includes('plus')) {
					completed -= 1;
				}
			}

			$headerContent.setAttribute('steps', steps.toString());
			$headerContent.setAttribute('completed', completed.toString());
			$headerContent.setAttribute('state', subscription.state.toString());
			$headerContent.setAttribute('plan', subscription.plan.effective.name);
			$headerContent.setAttribute('days', days.toString());
		}
	}

	private updateNoRepo() {
		const { extensionEnabled } = this.state;

		const $el = document.getElementById('no-repo');
		if ($el) {
			$el.setAttribute('aria-hidden', extensionEnabled ? 'true' : 'false');
		}
	}

	private updateLayout() {
		const { layout } = this.state;

		const $els = [...document.querySelectorAll('[data-gitlens-layout]')];
		$els.forEach(el => {
			const attr = el.getAttribute('data-gitlens-layout');
			el.classList.toggle('is-active', attr === layout);
		});
	}

	private updatePlusContent(days = this.getDaysRemaining()) {
		const { subscription, visibility, plusEnabled } = this.state;

		let $plusContent = document.getElementById('plus-banner');
		if ($plusContent) {
			$plusContent.setAttribute('days', days.toString());
			$plusContent.setAttribute('state', subscription.state.toString());
			$plusContent.setAttribute('visibility', visibility);
			$plusContent.setAttribute('plan', subscription.plan.effective.name);
			$plusContent.setAttribute('plus', plusEnabled.toString());
		}

		$plusContent = document.getElementById('plus-content');
		if ($plusContent) {
			$plusContent.setAttribute('days', days.toString());
			$plusContent.setAttribute('state', subscription.state.toString());
			$plusContent.setAttribute('visibility', visibility);
			$plusContent.setAttribute('plan', subscription.plan.effective.name);
		}
	}

	private updateSteps(forceShowPlus = this.forceShowPlus()) {
		if (
			this.$steps == null ||
			this.$steps.length === 0 ||
			this.state.completedSteps == null ||
			this.state.completedSteps.length === 0
		) {
			return;
		}

		this.$steps.forEach(el => {
			el.setAttribute(
				'completed',
				(el.id === 'plus' && forceShowPlus) || this.state.completedSteps?.includes(el.id) !== true
					? 'false'
					: 'true',
			);
		});
	}

	private updateSections() {
		if (
			this.$cards == null ||
			this.$cards.length === 0 ||
			this.state.dismissedSections == null ||
			this.state.dismissedSections.length === 0
		) {
			return;
		}

		this.state.dismissedSections.forEach(id => {
			const found = this.$cards.findIndex(el => el.id === id);
			if (found > -1) {
				this.$cards[found].remove();
				this.$cards.splice(found, 1);
			}
		});
	}

	private updateState() {
		const { completedSteps, dismissedSections } = this.state;

		this.updateNoRepo();
		this.updateLayout();

		const showRestoreWelcome = completedSteps?.length || dismissedSections?.length;
		document.getElementById('restore-welcome')?.classList.toggle('hide', !showRestoreWelcome);

		const forceShowPlus = this.forceShowPlus();
		const days = this.getDaysRemaining();
		this.updateHeader(days, forceShowPlus);
		this.updatePlusContent(days);

		this.updateSteps(forceShowPlus);

		this.updateSections();
	}
}

function toggleArrayItem(list: string[] = [], item: string, add = true) {
	const hasStep = list.includes(item);
	if (!hasStep && add) {
		list.push(item);
	} else if (hasStep && !add) {
		list.splice(list.indexOf(item), 1);
	}

	return list;
}

new HomeApp();
