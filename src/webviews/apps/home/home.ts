/*global*/
import './home.scss';
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import type { Disposable } from 'vscode';
// import { RepositoriesVisibility } from '../../../git/gitProviderService';
import { getSubscriptionTimeRemaining, isSubscriptionTrial, SubscriptionState } from '../../../subscription';
import { pluralize } from '../../../system/string';
import type { State } from '../../home/protocol';
import {
	CompleteStepCommandType,
	DidChangeSubscriptionNotificationType,
	DismissSectionCommandType,
} from '../../home/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommandType, onIpc } from '../../protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';
import type { CardSection } from './components/card-section';
import type { SteppedSection } from './components/stepped-section';
import '../shared/components/codicon';
import './components/card-section';
import './components/stepped-section';

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

		disposables.push(DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onActionClicked(e, target)));
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
					this.updateState();
				});
				break;

			default:
				super.onMessageReceived?.(e);
				break;
		}
	}

	private onStepComplete(e: CustomEvent<boolean>, target: HTMLElement) {
		const id = target.id;
		console.log('onStepComplete', id, e.detail);
		this.sendCommand(CompleteStepCommandType, { id: id, completed: e.detail ?? false });
	}

	private onCardDismissed(e: CustomEvent<undefined>, target: HTMLElement) {
		const id = target.id;
		console.log('onCardDismissed', id);
		this.sendCommand(DismissSectionCommandType, { id: id });
		target.remove();
	}

	private onActionClicked(e: MouseEvent, target: HTMLElement) {
		const action = target.dataset.action;
		if (action?.startsWith('command:')) {
			this.sendCommand(ExecuteCommandType, { command: action.slice(8) });
		}
	}

	private updateState() {
		const { subscription, completedSteps, dismissedSections, plusEnabled, visibility } = this.state;

		// banner
		document.getElementById('plus')?.classList.toggle('hide', !plusEnabled);
		document.getElementById('restore-plus')?.classList.toggle('hide', plusEnabled);
		document.getElementById('plus-sections')?.classList.toggle('hide', !plusEnabled);

		const showRestoreWelcome = completedSteps?.length || dismissedSections?.length;
		document.getElementById('restore-welcome')?.classList.toggle('hide', !showRestoreWelcome);

		// TODO: RepositoriesVisibility causes errors during the build
		// const alwaysFree = [RepositoriesVisibility.Local, RepositoriesVisibility.Public].includes(visibility);
		const alwaysFree = ['local', 'public'].includes(visibility);
		const needsAccount = ['mixed', 'private'].includes(visibility);

		console.log('updateState', alwaysFree, needsAccount, this.state);

		let days = 0;
		if ([SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(subscription.state)) {
			days = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
		}

		const timeRemaining = days < 1 ? 'less than one day' : pluralize('day', days);
		const shortTimeRemaining = days < 1 ? '<1 day' : pluralize('day', days);

		let plan = subscription.plan.effective.name;
		let content;
		let actions;
		let forcePlus = false;
		// switch (-1 as SubscriptionState) {
		switch (subscription.state) {
			case SubscriptionState.Free:
				plan = 'Free';
				break;
			case SubscriptionState.Paid:
				break;
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial: {
				plan = 'Trial';
				content = `
					<h3>GitLens+ Trial</h3>
					<p class="mb-0">
						You have ${timeRemaining} left in your&nbsp;
						<a title="Learn more about GitLens+ features" href="command:gitlens.plus.learn">
							GitLens+ trial </a
						>. Once your trial ends, you'll need a paid plan to continue to use GitLens+ features on this
						and other private repos.
					</p>
				`;
				actions = shortTimeRemaining;
				break;
			}
			case SubscriptionState.FreePreviewTrialExpired:
				forcePlus = true;
				plan = 'Free Trial (0 days)';
				content = `
					<h3>Extend Your GitLens+ Trial</h3>
					<p>
						Your free trial has ended, please sign in to extend your trial of GitLens+ features on private
						repos by an additional 7-days.
					</p>
					<p class="mb-1">
						<vscode-button data-action="command:gitlens.plus.loginOrSignUp">Extend Trial</vscode-button>
					</p>
				`;
				actions = `
					<a href="command:gitlens.plus.loginOrSignUp">
						Extend Trial
					</a>
				`;
				break;
			case SubscriptionState.FreePlusTrialExpired:
				forcePlus = true;
				plan = 'GitLens+ Trial (0 days)';
				content = `
					<h3>GitLens+ Trial Expired</h3>
					<p>
						Your free trial has ended, please upgrade your account to continue to use GitLens+ features,
						including the Commit Graph, on this and other private repos.
					</p>
					<p class="mb-1">
						<vscode-button data-action="command:gitlens.plus.purchase">Upgrade Your Account</vscode-button>
					</p>
				`;
				actions = `
					<a href="command:gitlens.plus.purchase">
						Upgrade Your Account
					</a>
				`;
				break;
			case SubscriptionState.VerificationRequired:
				forcePlus = true;
				plan = 'Unverified';
				content = `
					<h3>Please verify your email</h3>
					<p class="alert__message">Please verify the email for the account you created.</p>
					<p class="mb-1">
						<vscode-button data-action="command:gitlens.plus.resendVerification"
							>Resend Verification Email</vscode-button
						>
					</p>
					<p class="mb-1">
						<vscode-button data-action="command:gitlens.plus.validate"
							>Refresh Verification Status</vscode-button
						>
					</p>
				`;
				actions = `
					<a href="command:gitlens.plus.resendVerification" title="Resend Verification Email" aria-label="Resend Verification Email">Verify</a>&nbsp;<a
						href="command:gitlens.plus.validate"
						title="Refresh Verification Status"
						aria-label="Refresh Verification Status"
						><span class="codicon codicon-sync"></span
					></a>
				`;
				break;
		}

		if (content) {
			const $plusContent = document.getElementById('plus-content');
			if ($plusContent) {
				$plusContent.innerHTML = content;
			}
		}

		const $headerContent = document.getElementById('header-content');
		if ($headerContent) {
			$headerContent.innerHTML = plan ?? '';
		}
		const $headerActions = document.getElementById('header-actions');
		if ($headerActions) {
			$headerActions.innerHTML = actions ?? '';
		}

		this.$steps?.forEach(el => {
			el.setAttribute(
				'completed',
				(el.id === 'plus' && forcePlus) || completedSteps?.includes(el.id) !== true ? 'false' : 'true',
			);
		});

		this.$cards?.forEach(el => {
			if (dismissedSections?.includes(el.id)) {
				el.remove();
			}
		});
	}
}

new HomeApp();
