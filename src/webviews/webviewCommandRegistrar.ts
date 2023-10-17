import type { Disposable } from 'vscode';
import type { CommandCallback } from '../system/command';
import { registerWebviewCommand } from '../system/command';
import type { WebviewContext } from '../system/webview';
import { isWebviewContext } from '../system/webview';
import type { WebviewProvider } from './webviewController';

export type WebviewCommandCallback<T extends Partial<WebviewContext>> = (arg?: T | undefined) => any;
export class WebviewCommandRegistrar implements Disposable {
	private readonly _commandRegistrations = new Map<
		string,
		{ handlers: Map<string, { callback: CommandCallback; thisArg: any }>; subscription: Disposable }
	>();

	dispose() {
		this._commandRegistrations.forEach(({ subscription }) => void subscription.dispose());
	}

	registerCommand<T extends WebviewProvider<any>>(
		provider: T,
		id: string,
		instanceId: string | undefined,
		command: string,
		callback: CommandCallback,
	) {
		let registration = this._commandRegistrations.get(command);
		if (registration == null) {
			const handlers = new Map();
			registration = {
				subscription: registerWebviewCommand(
					command,
					(...args: any[]) => {
						const item = args[0];
						if (!isWebviewContext(item)) {
							debugger;
							return;
						}

						const key = item.webviewInstance ? `${item.webview}:${item.webviewInstance}` : item.webview;

						const handler = handlers.get(key);
						if (handler == null) {
							throw new Error(`Unable to find Command '${command}' registration for Webview '${key}'`);
						}

						handler.callback.call(handler.thisArg, item);
					},
					this,
				),
				handlers: handlers,
			};
			this._commandRegistrations.set(command, registration);
		}

		const key = instanceId ? `${id}:${instanceId}` : id;

		if (registration.handlers.has(key)) {
			throw new Error(`Command '${command}' has already been registered for Webview '${key}'`);
		}

		registration.handlers.set(key, { callback: callback, thisArg: provider });

		return {
			dispose: () => {
				registration!.handlers.delete(key);
				if (registration!.handlers.size === 0) {
					this._commandRegistrations.delete(command);
					registration!.subscription.dispose();
				}
			},
		};
	}
}
