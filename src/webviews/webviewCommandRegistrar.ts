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

						const handler = handlers.get(item.webview);
						if (handler == null) {
							throw new Error(
								`Unable to find Command '${command}' registration for Webview '${item.webview}'`,
							);
						}

						handler.callback.call(handler.thisArg, item);
					},
					this,
				),
				handlers: handlers,
			};
			this._commandRegistrations.set(command, registration);
		}

		if (registration.handlers.has(id)) {
			throw new Error(`Command '${command}' has already been registered for Webview '${id}'`);
		}

		registration.handlers.set(id, { callback: callback, thisArg: provider });

		return {
			dispose: () => {
				registration!.handlers.delete(id);
				if (registration!.handlers.size === 0) {
					this._commandRegistrations.delete(command);
					registration!.subscription.dispose();
				}
			},
		};
	}
}
