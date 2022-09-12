/*global*/
import './home.scss';
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import type { Disposable } from 'vscode';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../subscription';
import type { State } from '../../home/protocol';
import { CompletedActions, DidChangeSubscriptionNotificationType } from '../../home/protocol';
import type { IpcMessage } from '../../protocol';
import { ExecuteCommandType, onIpc } from '../../protocol';
import { App } from '../shared/appBase';
import { DOM } from '../shared/dom';

export class HomeApp extends App<State> {
	private $slots!: HTMLElement[];
	private $footer!: HTMLElement;

	constructor() {
		super('HomeApp');
	}

	protected override onInitialize() {
		provideVSCodeDesignSystem().register(vsCodeButton());

		this.$slots = [
			document.getElementById('slot1') as HTMLDivElement,
			document.getElementById('slot2') as HTMLDivElement,
			document.getElementById('slot3') as HTMLDivElement,
		];
		this.$footer = document.getElementById('slot-footer') as HTMLDivElement;

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
		const { subscription, completedActions } = this.state;

		const viewsVisible = !completedActions.includes(CompletedActions.OpenedSCM);
		const welcomeVisible = !completedActions.includes(CompletedActions.DismissedWelcome);

		let index = 0;

		if (subscription.account?.verified === false) {
			DOM.insertTemplate('state:verify-email', this.$slots[index++]);
			DOM.insertTemplate(welcomeVisible ? 'welcome' : 'links', this.$slots[index++]);
		} else {
			switch (subscription.state) {
				case SubscriptionState.Free:
					if (welcomeVisible) {
						DOM.insertTemplate('welcome', this.$slots[index++]);
						DOM.resetSlot(this.$footer);
					} else {
						DOM.insertTemplate('links', this.$footer);
					}

					if (viewsVisible) {
						DOM.insertTemplate('views', this.$slots[index++]);
					}

					DOM.insertTemplate('state:free', this.$slots[index++]);

					break;
				case SubscriptionState.FreeInPreviewTrial: {
					if (viewsVisible) {
						DOM.insertTemplate('views', this.$slots[index++]);
					}

					const remaining = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
					DOM.insertTemplate('state:free-preview-trial', this.$slots[index++], {
						bindings: {
							previewDays: `${
								remaining < 1
									? 'less than one day'
									: remaining === 1
									? `${remaining} day`
									: `${remaining} days`
							}`,
						},
					});

					break;
				}
				case SubscriptionState.FreePreviewTrialExpired:
					if (viewsVisible) {
						DOM.insertTemplate('views', this.$slots[index++]);
					}

					DOM.insertTemplate('state:free-preview-trial-expired', this.$slots[index++]);

					break;
				case SubscriptionState.FreePlusInTrial: {
					if (viewsVisible) {
						DOM.insertTemplate('views', this.$slots[index++]);
					}

					const remaining = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
					DOM.insertTemplate('state:plus-trial', this.$slots[index++], {
						bindings: {
							plan: subscription.plan.effective.name,
							trialDays: `${
								remaining < 1
									? 'less than one day'
									: remaining === 1
									? `${remaining} day`
									: `${remaining} days`
							}`,
						},
					});

					break;
				}
				case SubscriptionState.FreePlusTrialExpired:
					if (viewsVisible) {
						DOM.insertTemplate('views', this.$slots[index++]);
					}

					DOM.insertTemplate('state:plus-trial-expired', this.$slots[index++]);

					break;
				case SubscriptionState.Paid:
					if (viewsVisible) {
						DOM.insertTemplate('views', this.$slots[index++]);
					}

					DOM.insertTemplate('state:paid', this.$slots[index++], {
						bindings: { plan: subscription.plan.effective.name },
					});

					break;
			}

			if (subscription.state !== SubscriptionState.Free) {
				if (welcomeVisible) {
					DOM.insertTemplate('welcome', this.$slots[index++]);
					DOM.resetSlot(this.$footer);
				} else {
					DOM.insertTemplate('links', this.$footer);
				}
			}
		}

		for (let i = 1; i < index; i++) {
			this.$slots[i].classList.add('divider');
		}

		for (let i = index; i < this.$slots.length; i++) {
			DOM.resetSlot(this.$slots[i]);
		}
	}
}

new HomeApp();
