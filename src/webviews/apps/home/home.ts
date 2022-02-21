/*global*/
import './home.scss';
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDivider } from '@vscode/webview-ui-toolkit';
import { Disposable } from 'vscode';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../subscription';
import { DidChangeSubscriptionNotificationType, State } from '../../home/protocol';
import { ExecuteCommandType, IpcMessage, onIpc } from '../../protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';

export class HomeApp extends App<State> {
	private $slot1!: HTMLDivElement;
	private $slot2!: HTMLDivElement;

	constructor() {
		super('HomeApp');
	}

	protected override onInitialize() {
		provideVSCodeDesignSystem().register({
			register: function (container: any, context: any) {
				vsCodeButton().register(container, context);
				vsCodeDivider().register(container, context);
			},
		});

		this.$slot1 = document.getElementById('slot1') as HTMLDivElement;
		this.$slot2 = document.getElementById('slot2') as HTMLDivElement;

		this.updateState();
	}

	protected override onBind(): Disposable[] {
		const disposables = super.onBind?.() ?? [];

		disposables.push(DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onActionClicked(e, target)));

		return disposables;
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case DidChangeSubscriptionNotificationType.method:
				this.log(`${this.appName}.onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeSubscriptionNotificationType, msg, params => {
					this.state = params;
					this.updateState();
				});
				break;

			default:
				super.onMessageReceived?.(e);
				break;
		}
	}

	private onActionClicked(e: MouseEvent, target: HTMLElement) {
		const action = target.dataset.action;
		if (action?.startsWith('command:')) {
			this.sendCommand(ExecuteCommandType, { command: action.slice(8) });
		}
	}

	private updateState() {
		const { subscription, welcomeVisible } = this.state;
		if (subscription.account?.verified === false) {
			DOM.insertTemplate('state:verify-email', this.$slot1);
			DOM.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);

			return;
		}

		const $container = document.getElementById('container') as HTMLDivElement;
		$container.classList.toggle('welcome', welcomeVisible);

		switch (subscription.state) {
			case SubscriptionState.Free:
				if (welcomeVisible) {
					DOM.insertTemplate('welcome', this.$slot1);
					DOM.insertTemplate('state:free', this.$slot2);
				} else {
					DOM.insertTemplate('state:free', this.$slot1);
					DOM.insertTemplate('links', this.$slot2);
				}
				break;
			case SubscriptionState.FreeInPreview: {
				const remaining = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
				DOM.insertTemplate('state:free-preview', this.$slot1, {
					bindings: {
						previewDays: `${remaining === 1 ? `${remaining} more day` : `${remaining} more days`}`,
					},
				});
				DOM.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
			}
			case SubscriptionState.FreePreviewExpired:
				DOM.insertTemplate('state:free-preview-expired', this.$slot1);
				DOM.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
			case SubscriptionState.FreePlusInTrial: {
				const remaining = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
				DOM.insertTemplate('state:plus-trial', this.$slot1, {
					bindings: {
						trialDays: `${remaining === 1 ? `${remaining} day` : `${remaining} days`}`,
					},
				});
				DOM.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
			}
			case SubscriptionState.FreePlusTrialExpired:
				DOM.insertTemplate('state:plus-trial-expired', this.$slot1);
				DOM.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
			case SubscriptionState.Paid:
				DOM.insertTemplate('state:paid', this.$slot1);
				DOM.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
		}
	}
}

new HomeApp();
