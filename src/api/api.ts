import type { Disposable } from 'vscode';
import { Container } from '../container';
import { builtInActionRunnerName } from './actionRunners';
import type { Action, ActionContext, ActionRunner, GitLensApi } from './gitlens';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class Api implements GitLensApi {
	readonly #container: Container;
	constructor(container: Container) {
		this.#container = container;
	}

	registerActionRunner<T extends ActionContext>(action: Action<T>, runner: ActionRunner): Disposable {
		if (runner.name === builtInActionRunnerName) {
			throw new Error(`Cannot use the reserved name '${builtInActionRunnerName}'`);
		}

		if ((action as string) === 'hover.commandHelp') {
			action = 'hover.commands';
		}
		return this.#container.actionRunners.register(action, runner);
	}

	// registerAutolinkProvider(provider: RemoteProvider): Disposable;
	// registerPullRequestProvider(provider: RemoteProvider): Disposable;
	// registerRemoteProvider(matcher: string | RegExp, provider: RemoteProvider | RichRemoteProvider): Disposable;
}

export function preview() {
	return (_target: any, _key: string, descriptor: PropertyDescriptor) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn == null) throw new Error('Not supported');

		descriptor.value = function (this: any, ...args: any[]) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			if (Container.instance.prereleaseOrDebugging) return fn.apply(this, args);

			console.error('GitLens preview APIs are only available in the pre-release edition');
			return emptyDisposable;
		};
	};
}
