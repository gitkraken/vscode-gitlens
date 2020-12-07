'use strict';
import { commands, Disposable, QuickPickItem, window } from 'vscode';
import { ContextKeys, setContext } from '../constants';
import { getQuickPickIgnoreFocusOut } from '../quickpicks';
import { Action, ActionContext, ActionRunner } from './gitlens';

type Actions = ActionContext['type'];
const actions: Actions[] = ['createPullRequest', 'openPullRequest'];

export class ActionRunnerQuickPickItem implements QuickPickItem {
	constructor(public readonly runner: ActionRunner) {}

	get label(): string {
		return this.runner.label;
	}
}

class RegisteredActionRunner implements ActionRunner, Disposable {
	constructor(private readonly runner: ActionRunner, private readonly unregister: () => void) {}

	dispose() {
		this.unregister();
	}

	get label(): string {
		return this.runner.label;
	}

	run(context: ActionContext): void | Promise<void> {
		return this.runner.run(context);
	}
}

export class ActionRunners implements Disposable {
	private readonly _actionRunners = new Map<Actions, RegisteredActionRunner[]>();
	private readonly _disposable: Disposable;
	constructor() {
		const subscriptions: Disposable[] = [];

		for (const action of actions) {
			subscriptions.push(
				commands.registerCommand(`gitlens.action.${action}`, (context: ActionContext) => this.run(context)),
			);
		}

		this._disposable = Disposable.from(...subscriptions);
	}

	dispose() {
		this._disposable.dispose();

		for (const runners of this._actionRunners.values()) {
			for (const runner of runners) {
				runner.dispose();
			}
		}
		this._actionRunners.clear();
	}

	has(action: Actions): boolean {
		return (this._actionRunners.get(action)?.length ?? 0) > 0;
	}

	register<T extends ActionContext>(action: Action<T>, runner: ActionRunner): Disposable {
		let runners = this._actionRunners.get(action);
		if (runners == null) {
			runners = [];
			this._actionRunners.set(action, runners);
		}

		const runnersMap = this._actionRunners;
		const updateContextKeys = this._updateContextKeys.bind(this);
		const registeredRunner = new RegisteredActionRunner(runner, function (this: RegisteredActionRunner) {
			if (runners!.length === 1) {
				runnersMap.delete(action);
				void updateContextKeys(action);
			} else {
				const index = runners!.indexOf(this);
				if (index !== -1) {
					runners!.splice(index, 1);
				}
			}
		});
		runners.push(registeredRunner);

		void this._updateContextKeys(action);

		return {
			dispose: () => registeredRunner.dispose(),
		};
	}

	async run<T extends ActionContext>(context: T) {
		const runners = this._actionRunners.get(context.type);
		if (runners == null || runners.length === 0) return;

		let runner;

		if (runners.length > 1) {
			const items = runners.map(r => new ActionRunnerQuickPickItem(r));

			const quickpick = window.createQuickPick<ActionRunnerQuickPickItem>();
			quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

			const disposables: Disposable[] = [];

			try {
				const pick = await new Promise<ActionRunnerQuickPickItem | undefined>(resolve => {
					disposables.push(
						quickpick.onDidHide(() => resolve(undefined)),
						quickpick.onDidAccept(() => {
							if (quickpick.activeItems.length !== 0) {
								resolve(quickpick.activeItems[0]);
							}
						}),
					);

					let title;
					let placeholder;
					switch (context.type) {
						case 'createPullRequest':
							title = 'Create Pull Request';
							placeholder = 'Choose which provider to use to create a pull request';
							break;
						case 'openPullRequest':
							title = 'Open Pull Request';
							placeholder = 'Choose which provider to use to open the pull request';
							break;
					}

					quickpick.title = title;
					quickpick.placeholder = placeholder;
					quickpick.matchOnDetail = true;
					quickpick.items = items;

					quickpick.show();
				});
				if (pick == null) return;

				runner = pick.runner;
			} finally {
				quickpick.dispose();
				disposables.forEach(d => d.dispose());
			}
		} else {
			[runner] = runners;
		}

		await runner.run(context);
	}

	private async _updateContextKeys(action: Actions) {
		await setContext(`${ContextKeys.ActionPrefix}${action}`, this.has(action));
	}
}
