'use strict';
import { Disposable } from 'vscode';
import { Container } from '../container';
import { Logger } from '../logger';
import { Action, ActionContext, ActionRunner, GitLensApi } from './gitlens';

const emptyDisposable = Object.freeze({
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	dispose: () => {},
});

export class Api implements GitLensApi {
	@preview()
	registerActionRunner<T extends ActionContext>(action: Action<T>, runner: ActionRunner): Disposable {
		return Container.actionRunners.register(action, runner);
	}

	// registerAutolinkProvider(provider: RemoteProvider): Disposable;
	// registerPullRequestProvider(provider: RemoteProvider): Disposable;
	// registerRemoteProvider(matcher: string | RegExp, provider: RemoteProvider | RichRemoteProvider): Disposable;
}

export function preview() {
	return (target: any, key: string, descriptor: PropertyDescriptor) => {
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn == null) throw new Error('Not supported');

		descriptor.value = function (this: any, ...args: any[]) {
			if (Container.insiders || Logger.isDebugging) return fn!.apply(this, args);

			console.error('GitLens preview APIs are only available in the Insiders edition');
			return emptyDisposable;
		};
	};
}
