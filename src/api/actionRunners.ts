import type { Event, QuickPickItem } from 'vscode';
import { Disposable, EventEmitter, window } from 'vscode';
import type { Config } from '../config';
import { actionCommandPrefix } from '../constants.commands';
import type { Container } from '../container';
import { getScopedCounter } from '../system/counter';
import { sortCompare } from '../system/string';
import { registerCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import { getQuickPickIgnoreFocusOut } from '../system/vscode/utils';
import type { Action, ActionContext, ActionRunner } from './gitlens';

type Actions = ActionContext['type'];
const actions: Actions[] = ['createPullRequest', 'openPullRequest', 'hover.commands'];

// The order here determines the sorting of these actions when shown to the user
export const enum ActionRunnerType {
	BuiltIn = 0,
	BuiltInPartner = 1,
	Partner = 2,
	BuiltInPartnerInstaller = 3,
}

export const builtInActionRunnerName = 'Built In';

class ActionRunnerQuickPickItem implements QuickPickItem {
	private readonly _label: string;

	constructor(
		public readonly runner: RegisteredActionRunner,
		context: ActionContext,
	) {
		this._label = typeof runner.label === 'string' ? runner.label : runner.label(context);
	}

	get label(): string {
		return this._label;
	}

	get detail(): string | undefined {
		return this.runner.name;
	}
}

class NoActionRunnersQuickPickItem implements QuickPickItem {
	public readonly runner: RegisteredActionRunner | undefined;

	get label(): string {
		return 'No actions were found';
	}

	get detail(): string | undefined {
		return undefined;
	}
}

const runnerIdGenerator = getScopedCounter();

class RegisteredActionRunner<T extends ActionContext = ActionContext> implements ActionRunner<T>, Disposable {
	readonly id: number;

	constructor(
		public readonly type: ActionRunnerType,
		private readonly runner: ActionRunner<T>,
		private readonly unregister: () => void,
	) {
		this.id = runnerIdGenerator.next();
	}

	dispose() {
		this.unregister();
	}

	get name(): string {
		return this.runner.name;
	}

	get label(): string | ((context: T) => string) {
		return this.runner.label;
	}

	get order(): number {
		switch (this.type) {
			case ActionRunnerType.BuiltIn:
				return 0;

			case ActionRunnerType.BuiltInPartner:
				return 1;

			case ActionRunnerType.Partner:
				// Sort built-in partners and partners with ids the same
				return this.partnerId ? 1 : 2;

			case ActionRunnerType.BuiltInPartnerInstaller:
				return 3;

			default:
				return 100;
		}
	}

	get partnerId(): string {
		return this.runner.partnerId;
	}

	run(context: T): void | Promise<void> {
		return this.runner.run(context);
	}

	// when(context: ActionContext): boolean {
	// 	try {
	// 		return this.runner.when?.(context) ?? true;
	// 	} catch {
	// 		return false;
	// 	}
	// }
}

export class ActionRunners implements Disposable {
	private _onDidChange = new EventEmitter<Actions | undefined>();
	get onDidChange(): Event<Actions | undefined> {
		return this._onDidChange.event;
	}

	private readonly _actionRunners = new Map<Actions, RegisteredActionRunner<any>[]>();
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		const subscriptions: Disposable[] = [
			configuration.onDidChange(e => {
				if (!configuration.changed(e, 'partners')) return;

				void this._updateAllContextKeys();
			}),
		];

		for (const action of actions) {
			subscriptions.push(
				registerCommand(`${actionCommandPrefix}${action}`, (context: ActionContext, runnerId?: number) =>
					this.run(context, runnerId),
				),
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

	count(action: Actions): number {
		return this.get(action)?.length ?? 0;
	}

	get(action: Actions): RegisteredActionRunner[] | undefined {
		return filterOnlyEnabledRunners(configuration.get('partners'), this._actionRunners.get(action));
	}

	has(action: Actions): boolean {
		return this.count(action) > 0;
	}

	register<T extends ActionContext>(
		action: Action<T>,
		runner: ActionRunner<T>,
		type: ActionRunnerType = ActionRunnerType.Partner,
	): Disposable {
		let runners = this._actionRunners.get(action);
		if (runners == null) {
			runners = [];
			this._actionRunners.set(action, runners);
		}

		const onChanged = (action: Actions) => {
			void this._updateContextKeys(action);
			this._onDidChange.fire(action);
		};

		const runnersMap = this._actionRunners;

		const registeredRunner = new RegisteredActionRunner(type, runner, function (this: RegisteredActionRunner) {
			if (runners.length === 1) {
				runnersMap.delete(action);
				onChanged(action);
			} else {
				const index = runners.indexOf(this);
				if (index !== -1) {
					runners.splice(index, 1);
				}
			}
		});

		runners.push(registeredRunner);
		onChanged(action);

		return {
			dispose: () => registeredRunner.dispose(),
		};
	}

	registerBuiltIn<T extends ActionContext>(
		action: Action<T>,
		runner: Omit<ActionRunner<T>, 'partnerId' | 'name'>,
	): Disposable {
		return this.register(
			action,
			{ ...runner, partnerId: undefined!, name: builtInActionRunnerName },
			ActionRunnerType.BuiltIn,
		);
	}

	registerBuiltInPartner<T extends ActionContext>(
		partnerId: string,
		action: Action<T>,
		runner: Omit<ActionRunner<T>, 'partnerId'>,
	): Disposable {
		return this.register(action, { ...runner, partnerId: partnerId }, ActionRunnerType.BuiltInPartner);
	}

	registerBuiltInPartnerInstaller<T extends ActionContext>(
		partnerId: string,
		action: Action<T>,
		runner: Omit<ActionRunner<T>, 'partnerId'>,
	): Disposable {
		return this.register(
			action,
			{ ...runner, partnerId: partnerId, name: `${runner.name} (Not Installed)` },
			ActionRunnerType.BuiltInPartnerInstaller,
		);
	}

	async run<T extends ActionContext>(context: T, runnerId?: number) {
		let runners = this.get(context.type);
		if (runners == null || runners.length === 0) return;

		if (runnerId != null) {
			runners = runners.filter(r => r.id === runnerId);
		}
		if (runners.length === 0) return;

		let runner;

		if (runners.length > 1 || runners.every(r => r.type !== ActionRunnerType.BuiltIn)) {
			const items: (ActionRunnerQuickPickItem | NoActionRunnersQuickPickItem)[] = runners
				// .filter(r => r.when(context))
				.sort((a, b) => a.order - b.order || sortCompare(a.name, b.name))
				.map(r => new ActionRunnerQuickPickItem(r, context));

			if (items.length === 0) {
				items.push(new NoActionRunnersQuickPickItem());
			}

			const quickpick = window.createQuickPick<ActionRunnerQuickPickItem | NoActionRunnersQuickPickItem>();
			quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();

			const disposables: Disposable[] = [];

			try {
				const pick = await new Promise<ActionRunnerQuickPickItem | NoActionRunnersQuickPickItem | undefined>(
					resolve => {
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
								placeholder = 'Choose how to create a pull request';
								break;
							case 'openPullRequest':
								title = 'Open Pull Request';
								placeholder = 'Choose how to open the pull request';
								break;
							case 'hover.commands':
								title = 'Need Help or Want to Collaborate?';
								placeholder = 'Choose what you would like to do';
								break;
							default:
								debugger;
								break;
						}

						quickpick.title = title;
						quickpick.placeholder = placeholder;
						quickpick.matchOnDetail = true;
						quickpick.items = items;

						quickpick.show();
					},
				);
				if (pick == null) return;

				runner = pick.runner;
			} finally {
				quickpick.dispose();
				disposables.forEach(d => void d.dispose());
			}
		} else {
			[runner] = runners;
		}

		await runner?.run(context);
	}

	private async _updateContextKeys(action: Actions) {
		await setContext(`gitlens:action:${action}`, this.count(action));
	}

	private async _updateAllContextKeys() {
		for (const action of actions) {
			await this._updateContextKeys(action);
		}
	}
}

function filterOnlyEnabledRunners(partners: Config['partners'], runners: RegisteredActionRunner[] | undefined) {
	if (runners == null || runners.length === 0) return undefined;
	if (partners == null) return runners;

	return runners.filter(
		r => r.partnerId == null || (r.partnerId != null && partners[r.partnerId]?.enabled !== false),
	);
}
