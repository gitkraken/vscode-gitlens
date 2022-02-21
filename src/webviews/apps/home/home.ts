/*global window*/
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
		super('HomeApp', (window as any).bootstrap);
		(window as any).bootstrap = undefined;
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

		disposables.push(DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onClicked(e, target)));

		return disposables;
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case DidChangeSubscriptionNotificationType.method:
				this.log(`${this.appName}.onMessageReceived: name=${msg.method}`);

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

	private onClicked(e: MouseEvent, target: HTMLElement) {
		const action = target.dataset.action;
		if (action?.startsWith('command:')) {
			this.sendCommand(ExecuteCommandType, { command: action.slice(8) });
		}
	}

	private updateState() {
		const { subscription, welcomeVisible } = this.state;
		if (subscription.account?.verified === false) {
			this.insertTemplate('state:verify-email', this.$slot1);
			this.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);

			return;
		}

		const $container = document.getElementById('container') as HTMLDivElement;
		$container.classList.toggle('welcome', welcomeVisible);

		switch (subscription.state) {
			case SubscriptionState.Free:
				if (welcomeVisible) {
					this.insertTemplate('welcome', this.$slot1);
					this.insertTemplate('state:free', this.$slot2);
				} else {
					this.insertTemplate('state:free', this.$slot1);
					this.insertTemplate('links', this.$slot2);
				}
				break;
			case SubscriptionState.FreeInPreview: {
				const remaining = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
				this.insertTemplate('state:free-preview', this.$slot1, {
					previewDays: `${remaining === 1 ? `${remaining} more day` : `${remaining} more days`}`,
				});
				this.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
			}
			case SubscriptionState.FreePreviewExpired:
				this.insertTemplate('state:free-preview-expired', this.$slot1);
				this.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
			case SubscriptionState.FreePlusInTrial: {
				const remaining = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
				this.insertTemplate('state:plus-trial', this.$slot1, {
					trialDays: `${remaining === 1 ? `${remaining} day` : `${remaining} days`}`,
				});
				this.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
			}
			case SubscriptionState.FreePlusTrialExpired:
				this.insertTemplate('state:plus-trial-expired', this.$slot1);
				this.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
			case SubscriptionState.Paid:
				this.insertTemplate('state:paid', this.$slot1);
				this.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slot2);
				break;
		}
	}

	private insertTemplate(id: string, $slot: HTMLDivElement, bindings?: Record<string, unknown>): void {
		const $template = (document.getElementById(id) as HTMLTemplateElement)?.content.cloneNode(true);
		$slot.replaceChildren($template);

		if (bindings != null) {
			for (const [key, value] of Object.entries(bindings)) {
				const $el = $slot.querySelector(`[data-bind="${key}"]`);
				if ($el != null) {
					$el.textContent = String(value);
				}
			}
		}
	}
}

new HomeApp();
