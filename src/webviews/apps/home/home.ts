/*global*/
import './home.scss';
import type { Disposable } from 'vscode';
import type { State } from '../../home/protocol';
import { DidChangeRepositoriesType } from '../../home/protocol';
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

	protected override onInitialize() {
		this.state = this.getState() ?? this.state;
		this.updateState();
	}

	protected override onBind(): Disposable[] {
		const disposables = super.onBind?.() ?? [];

		disposables.push(
			DOM.on('[data-action]', 'click', (e, target: HTMLElement) => this.onDataActionClicked(e, target)),
		);

		return disposables;
	}

	protected override onMessageReceived(e: MessageEvent) {
		const msg = e.data as IpcMessage;

		switch (msg.method) {
			case DidChangeRepositoriesType.method:
				this.log(`onMessageReceived(${msg.id}): name=${msg.method}`);

				onIpc(DidChangeRepositoriesType, msg, params => {
					this.state.repositories = { ...params };
					this.setState(this.state);
					this.updateNoRepo();
				});
				break;
			default:
				super.onMessageReceived?.(e);
				break;
		}
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

	private updateState() {
		this.updateNoRepo();
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
		el.setAttribute('aria-hidden', 'false');
		el.removeAttribute('hidden');
	} else {
		el.setAttribute('aria-hidden', 'true');
		el?.setAttribute('hidden', 'true');
	}
}

new HomeApp();
