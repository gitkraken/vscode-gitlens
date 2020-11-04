'use strict';
import { Disposable, InputBox, QuickInputButton, QuickInputButtons, QuickPick, QuickPickItem, window } from 'vscode';
import { command, Command, Commands } from './common';
import { configuration } from '../configuration';
import { Container } from '../container';
import { BranchGitCommand, BranchGitCommandArgs } from './git/branch';
import { CherryPickGitCommand, CherryPickGitCommandArgs } from './git/cherry-pick';
import { CoAuthorsGitCommand, CoAuthorsGitCommandArgs } from './git/coauthors';
import { FetchGitCommand, FetchGitCommandArgs } from './git/fetch';
import { LogGitCommand, LogGitCommandArgs } from './git/log';
import { MergeGitCommand, MergeGitCommandArgs } from './git/merge';
import { PullGitCommand, PullGitCommandArgs } from './git/pull';
import { PushGitCommand, PushGitCommandArgs } from './git/push';
import { RebaseGitCommand, RebaseGitCommandArgs } from './git/rebase';
import { ResetGitCommand, ResetGitCommandArgs } from './git/reset';
import { RevertGitCommand, RevertGitCommandArgs } from './git/revert';
import { SearchGitCommand, SearchGitCommandArgs } from './git/search';
import { ShowGitCommand, ShowGitCommandArgs } from './git/show';
import { StashGitCommand, StashGitCommandArgs } from './git/stash';
import { StatusGitCommand, StatusGitCommandArgs } from './git/status';
import { SwitchGitCommand, SwitchGitCommandArgs } from './git/switch';
import { TagGitCommand, TagGitCommandArgs } from './git/tag';
import { KeyMapping } from '../keyboard';
import {
	isQuickInputStep,
	isQuickPickStep,
	QuickCommand,
	QuickInputStep,
	QuickPickStep,
	StepGenerator,
	StepSelection,
} from './quickCommand';
import { QuickCommandButtons, ToggleQuickInputButton } from './quickCommand.buttons';
import { Directive, DirectiveQuickPickItem } from '../quickpicks';
import { log, Promises } from '../system';

export * from './gitCommands.actions';

const sanitizeLabel = /\$\(.+?\)|\s/g;
const showLoadingSymbol = Symbol('ShowLoading');

export type GitCommandsCommandArgs =
	| BranchGitCommandArgs
	| CherryPickGitCommandArgs
	| CoAuthorsGitCommandArgs
	| FetchGitCommandArgs
	| LogGitCommandArgs
	| MergeGitCommandArgs
	| PullGitCommandArgs
	| PushGitCommandArgs
	| RebaseGitCommandArgs
	| ResetGitCommandArgs
	| RevertGitCommandArgs
	| SearchGitCommandArgs
	| ShowGitCommandArgs
	| StashGitCommandArgs
	| StatusGitCommandArgs
	| SwitchGitCommandArgs
	| TagGitCommandArgs;

function* nullSteps(): StepGenerator {
	/* noop */
}

@command()
export class GitCommandsCommand extends Command {
	static getSteps(args: GitCommandsCommandArgs, pickedVia: 'menu' | 'command'): StepGenerator {
		const commandsStep = new PickCommandStep(args);

		const command = commandsStep.find(args.command);
		if (command == null) return nullSteps();

		commandsStep.setCommand(command, pickedVia);

		return command.executeSteps();
	}

	private startedWith: 'menu' | 'command' = 'menu';

	constructor() {
		super(Commands.GitCommands);
	}

	@log({ args: false, correlate: true, singleLine: true, timed: false })
	async execute(args?: GitCommandsCommandArgs) {
		const commandsStep = new PickCommandStep(args);

		const command = args?.command != null ? commandsStep.find(args.command) : undefined;
		this.startedWith = command != null ? 'command' : 'menu';

		let ignoreFocusOut;

		let step;
		if (command == null) {
			step = commandsStep;
		} else {
			step = await this.showLoadingIfNeeded(command, this.getCommandStep(command, commandsStep));
		}

		// If this is the first step, don't honor the step's setting
		if (step?.ignoreFocusOut === true) {
			step.ignoreFocusOut = undefined;
		}

		while (step != null) {
			// If we are trying to back up to the menu and have a starting command, then just reset to the starting command
			if (step === commandsStep && command != null) {
				step = await this.getCommandStep(command, commandsStep);
				continue;
			}

			if (ignoreFocusOut && step.ignoreFocusOut == null) {
				step.ignoreFocusOut = true;
			}

			if (isQuickPickStep(step)) {
				step = await this.showPickStep(step, commandsStep);
				if (step?.ignoreFocusOut === true) {
					ignoreFocusOut = true;
				}

				continue;
			}

			if (isQuickInputStep(step)) {
				step = await this.showInputStep(step, commandsStep);
				if (step?.ignoreFocusOut === true) {
					ignoreFocusOut = true;
				}

				continue;
			}

			break;
		}
	}

	private async showLoadingIfNeeded(
		command: QuickCommand<any>,
		stepPromise: Promise<QuickPickStep<QuickPickItem> | QuickInputStep | undefined>,
	): Promise<QuickPickStep<QuickPickItem> | QuickInputStep | undefined> {
		const stepOrTimeout = await Promise.race<
			Promise<QuickPickStep<QuickPickItem> | QuickInputStep | undefined | typeof showLoadingSymbol>
		>([stepPromise, new Promise(resolve => setTimeout(() => resolve(showLoadingSymbol), 250))]);

		if (stepOrTimeout !== showLoadingSymbol) {
			return stepOrTimeout;
		}

		const quickpick = window.createQuickPick();
		quickpick.ignoreFocusOut = false;

		const disposables: Disposable[] = [];

		let step: QuickPickStep<QuickPickItem> | QuickInputStep | undefined;
		try {
			// eslint-disable-next-line no-async-promise-executor
			return await new Promise<QuickPickStep<QuickPickItem> | QuickInputStep | undefined>(async resolve => {
				disposables.push(quickpick.onDidHide(() => resolve(step)));

				quickpick.title = command.title;
				quickpick.placeholder = 'Loading...';
				quickpick.busy = true;
				quickpick.enabled = false;

				quickpick.show();

				step = await stepPromise;

				quickpick.hide();
			});
		} finally {
			quickpick.dispose();
			disposables.forEach(d => d.dispose());
		}
	}

	private getButtons(step: QuickInputStep | QuickPickStep | undefined, command?: QuickCommand) {
		const buttons: QuickInputButton[] = [];

		if (step != null) {
			if (step.buttons != null) {
				buttons.push(...step.buttons);
				return buttons;
			}

			buttons.push(QuickInputButtons.Back);

			if (step.additionalButtons != null) {
				buttons.push(...step.additionalButtons);
			}
		}

		if (command?.canConfirm) {
			if (command.canSkipConfirm) {
				const willConfirmToggle = new QuickCommandButtons.WillConfirmToggle(command.confirm(), async () => {
					if (command?.skipConfirmKey == null) return;

					const skipConfirmations = configuration.get('gitCommands', 'skipConfirmations') ?? [];

					const index = skipConfirmations.indexOf(command.skipConfirmKey);
					if (index !== -1) {
						skipConfirmations.splice(index, 1);
					} else {
						skipConfirmations.push(command.skipConfirmKey);
					}

					void (await configuration.updateEffective('gitCommands', 'skipConfirmations', skipConfirmations));
				});
				buttons.push(willConfirmToggle);
			} else {
				buttons.push(QuickCommandButtons.WillConfirmForced);
			}
		}

		return buttons;
	}

	private async getCommandStep(command: QuickCommand, commandsStep: PickCommandStep) {
		commandsStep.setCommand(command, 'command');

		const next = await command.next();
		if (next.done) return undefined;

		return next.value;
	}

	private async nextStep(
		quickInput: InputBox | QuickPick<QuickPickItem>,
		command: QuickCommand,
		value: StepSelection<any> | undefined,
	) {
		quickInput.busy = true;
		// quickInput.enabled = false;

		const next = await command.next(value);
		if (next.done) return undefined;

		quickInput.value = '';
		return next.value;
	}

	private async showInputStep(step: QuickInputStep, commandsStep: PickCommandStep) {
		const input = window.createInputBox();
		input.ignoreFocusOut = !configuration.get('gitCommands', 'closeOnFocusOut')
			? true
			: step.ignoreFocusOut ?? false;

		const disposables: Disposable[] = [];

		try {
			return await new Promise<QuickPickStep | QuickInputStep | undefined>(resolve => {
				const goBack = async () => {
					input.value = '';
					if (commandsStep.command != null) {
						input.busy = true;
						resolve((await commandsStep.command.previous()) ?? commandsStep);
					}
				};

				const mapping: KeyMapping = {
					left: { onDidPressKey: goBack },
				};
				if (step.onDidPressKey != null && step.keys != null && step.keys.length !== 0) {
					for (const key of step.keys) {
						mapping[key] = {
							onDidPressKey: key => step.onDidPressKey!(input, key),
						};
					}
				}

				const scope = Container.keyboard.createScope(mapping);
				void scope.start();

				disposables.push(
					scope,
					input.onDidHide(() => resolve(undefined)),
					input.onDidTriggerButton(async e => {
						if (e === QuickInputButtons.Back) {
							void goBack();
							return;
						}

						if (e === QuickCommandButtons.WillConfirmForced) return;

						if (e instanceof ToggleQuickInputButton && e.onDidClick != null) {
							const result = e.onDidClick(input);

							input.buttons = this.getButtons(step, commandsStep.command);

							if ((await result) === true) {
								resolve(commandsStep.command?.retry());
								return;
							}

							if (Promises.is(result)) {
								input.buttons = this.getButtons(step, commandsStep.command);
							}

							return;
						}

						if (step.onDidClickButton != null) {
							const result = step.onDidClickButton(input, e);
							input.buttons = this.getButtons(step, commandsStep.command);
							if ((await result) === true) {
								resolve(commandsStep.command?.retry());
							}
						}
					}),
					input.onDidChangeValue(async e => {
						if (scope != null) {
							// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
							if (e.length !== 0) {
								await scope.pause(['left', 'right']);
							} else {
								await scope.resume();
							}
						}

						if (step.validate == null) return;

						const [, message] = await step.validate(e);
						input.validationMessage = message;
					}),
					input.onDidAccept(async () => {
						resolve(await this.nextStep(input, commandsStep.command!, input.value));
					}),
				);

				input.buttons = this.getButtons(step, commandsStep.command);
				input.title = step.title;
				input.placeholder = step.placeholder;
				input.prompt = step.prompt;
				if (step.value != null) {
					input.value = step.value;
				}

				// If we are starting over clear the previously active command
				if (commandsStep.command != null && step === commandsStep) {
					commandsStep.setCommand(undefined, 'menu');
				}

				input.show();

				// Manually trigger `onDidChangeValue`, because the InputBox seems to fail to call it properly
				if (step.value != null) {
					// HACK: This is fragile!
					(input as any)._onDidChangeValueEmitter.fire(input.value);
				}
			});
		} finally {
			input.dispose();
			disposables.forEach(d => d.dispose());
		}
	}

	private async showPickStep(step: QuickPickStep, commandsStep: PickCommandStep) {
		const originalIgnoreFocusOut = !configuration.get('gitCommands', 'closeOnFocusOut')
			? true
			: step.ignoreFocusOut ?? false;
		const originalStepIgnoreFocusOut = step.ignoreFocusOut;

		const quickpick = window.createQuickPick();
		quickpick.ignoreFocusOut = originalIgnoreFocusOut;

		const disposables: Disposable[] = [];

		try {
			return await new Promise<QuickPickStep | QuickInputStep | undefined>(resolve => {
				async function goBack() {
					quickpick.value = '';
					if (commandsStep.command != null) {
						quickpick.busy = true;
						resolve((await commandsStep.command.previous()) ?? commandsStep);
					}
				}

				async function loadMore() {
					if (step.onDidLoadMore == null) return;

					quickpick.busy = true;
					quickpick.enabled = false;

					try {
						const items = await step.onDidLoadMore?.(quickpick);

						let activeIndex = -1;
						if (quickpick.activeItems.length !== 0) {
							const active = quickpick.activeItems[0];
							activeIndex = quickpick.items.indexOf(active);

							// If the active item is the "Load more" directive, then select the previous item
							if (DirectiveQuickPickItem.is(active)) {
								activeIndex--;
							}
						}

						quickpick.items = step.items = items;

						if (activeIndex) {
							quickpick.activeItems = [quickpick.items[activeIndex]];
						}
					} finally {
						quickpick.busy = false;
						quickpick.enabled = true;
					}
				}

				const mapping: KeyMapping = {
					left: { onDidPressKey: goBack },
				};
				if (step.onDidPressKey != null && step.keys != null && step.keys.length !== 0) {
					for (const key of step.keys) {
						mapping[key] = {
							onDidPressKey: key => step.onDidPressKey!(quickpick, key),
						};
					}
				}

				const scope = Container.keyboard.createScope(mapping);
				void scope.start();

				let overrideItems = false;

				disposables.push(
					scope,
					quickpick.onDidHide(() => resolve(undefined)),

					quickpick.onDidTriggerButton(async e => {
						if (e === QuickInputButtons.Back) {
							void goBack();
							return;
						}

						if (e === QuickCommandButtons.WillConfirmForced) return;

						if (e === QuickCommandButtons.LoadMore) {
							void loadMore();
							return;
						}

						if (e instanceof ToggleQuickInputButton && e.onDidClick != null) {
							let activeCommand;
							if (commandsStep.command == null && quickpick.activeItems.length !== 0) {
								const active = quickpick.activeItems[0];
								if (QuickCommand.is(active)) {
									activeCommand = active;
								}
							}

							const result = e.onDidClick(quickpick);

							quickpick.buttons = this.getButtons(
								activeCommand != null ? activeCommand.value : step,
								activeCommand ?? commandsStep.command,
							);

							if ((await result) === true) {
								resolve(commandsStep.command?.retry());
								return;
							}

							if (Promises.is(result)) {
								quickpick.buttons = this.getButtons(
									activeCommand != null ? activeCommand.value : step,
									activeCommand ?? commandsStep.command,
								);
							}

							return;
						}

						if (step.onDidClickButton != null) {
							const result = step.onDidClickButton(quickpick, e);
							quickpick.buttons = this.getButtons(step, commandsStep.command);
							if ((await result) === true) {
								resolve(commandsStep.command?.retry());
							}
						}
					}),
					quickpick.onDidChangeValue(async e => {
						if (scope != null) {
							// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
							if (e.length !== 0) {
								await scope.pause(['left', 'right']);
							} else {
								await scope.resume();
							}
						}

						if (step.onDidChangeValue != null) {
							const cancel = await step.onDidChangeValue(quickpick);
							if (cancel) return;
						}

						// If something was typed, keep the quick pick open on focus loss
						if (e.length !== 0 && !quickpick.ignoreFocusOut) {
							quickpick.ignoreFocusOut = true;
							step.ignoreFocusOut = true;
						}
						// If something typed was cleared, and we changed the behavior, then allow the quick pick close on focus loss
						else if (e.length === 0 && quickpick.ignoreFocusOut && !originalIgnoreFocusOut) {
							quickpick.ignoreFocusOut = originalIgnoreFocusOut;
							step.ignoreFocusOut = originalStepIgnoreFocusOut;
						}

						if (!overrideItems) {
							if (quickpick.canSelectMany && e === ' ') {
								quickpick.value = '';
								quickpick.selectedItems =
									quickpick.selectedItems.length === quickpick.items.length ? [] : quickpick.items;

								return;
							}

							if (e.endsWith(' ')) {
								if (quickpick.canSelectMany && quickpick.selectedItems.length !== 0) {
									return;
								}

								let items;
								if (commandsStep.command == null) {
									const command = commandsStep.find(quickpick.value.trim(), true);
									if (command == null) return;

									commandsStep.setCommand(command, this.startedWith);
								} else {
									const cmd = quickpick.value.trim().toLowerCase();
									const item = step.items.find(
										i => i.label.replace(sanitizeLabel, '').toLowerCase() === cmd,
									);
									if (item == null) return;

									items = [item];
								}

								resolve(await this.nextStep(quickpick, commandsStep.command!, items));
								return;
							}
						}

						// Assume there is no matches (since there is no activeItems)
						if (
							!quickpick.canSelectMany &&
							commandsStep.command != null &&
							e.trim().length !== 0 &&
							(overrideItems || quickpick.activeItems.length === 0)
						) {
							if (step.onValidateValue == null) return;

							overrideItems = await step.onValidateValue(quickpick, e.trim(), step.items);
						} else {
							overrideItems = false;
						}

						// If we are no longer overriding the items, put them back (only if we need to)
						if (!overrideItems && quickpick.items.length !== step.items.length) {
							quickpick.items = step.items;
						}
					}),
					quickpick.onDidChangeActive(() => {
						if (commandsStep.command != null || quickpick.activeItems.length === 0) return;

						const command = quickpick.activeItems[0];
						if (!QuickCommand.is(command)) return;

						quickpick.buttons = this.getButtons(undefined, command);
					}),
					quickpick.onDidChangeSelection(e => {
						if (!quickpick.canSelectMany) return;

						// If something was selected, keep the quick pick open on focus loss
						if (e.length !== 0 && !quickpick.ignoreFocusOut) {
							quickpick.ignoreFocusOut = true;
							step.ignoreFocusOut = true;
						}
						// If the selection was cleared, and we changed the behavior, then allow the quick pick close on focus loss
						else if (e?.length === 0 && quickpick.ignoreFocusOut && !originalIgnoreFocusOut) {
							quickpick.ignoreFocusOut = originalIgnoreFocusOut;
							step.ignoreFocusOut = originalStepIgnoreFocusOut;
						}
					}),
					quickpick.onDidAccept(async () => {
						let items = quickpick.selectedItems;
						if (items.length === 0) {
							if (!quickpick.canSelectMany || quickpick.activeItems.length === 0) {
								const value = quickpick.value.trim();
								if (value.length === 0 && !step.allowEmpty) return;

								if (step.onDidAccept == null) {
									if (step.allowEmpty) {
										resolve(await this.nextStep(quickpick, commandsStep.command!, []));
									}

									return;
								}

								quickpick.busy = true;

								if (await step.onDidAccept(quickpick)) {
									resolve(await this.nextStep(quickpick, commandsStep.command!, value));
								}

								quickpick.busy = false;
								return;
							}

							items = quickpick.activeItems;
						}

						if (items.length === 1) {
							const [item] = items;
							if (DirectiveQuickPickItem.is(item)) {
								switch (item.directive) {
									case Directive.Cancel:
										resolve(undefined);
										return;

									case Directive.Back:
										void goBack();
										return;

									case Directive.LoadMore:
										void loadMore();
										return;
								}
							}
						}

						if (commandsStep.command == null) {
							const [command] = items;
							if (!QuickCommand.is(command)) return;

							commandsStep.setCommand(command, this.startedWith);
						}

						if (!quickpick.canSelectMany) {
							if (step.onDidAccept != null) {
								quickpick.busy = true;

								const next = await step.onDidAccept(quickpick);

								quickpick.busy = false;

								if (!next) return;
							}
						}

						resolve(await this.nextStep(quickpick, commandsStep.command!, items as QuickPickItem[]));
					}),
				);

				quickpick.title = step.title;
				quickpick.placeholder = step.placeholder;
				quickpick.matchOnDescription = Boolean(step.matchOnDescription);
				quickpick.matchOnDetail = Boolean(step.matchOnDetail);
				quickpick.canSelectMany = Boolean(step.multiselect);

				quickpick.items = step.items;

				if (quickpick.canSelectMany) {
					quickpick.selectedItems = step.selectedItems ?? quickpick.items.filter(i => i.picked);
					quickpick.activeItems = quickpick.selectedItems;
				} else {
					quickpick.activeItems = step.selectedItems ?? quickpick.items.filter(i => i.picked);
				}

				// If we are starting over clear the previously active command
				if (commandsStep.command != null && step === commandsStep) {
					commandsStep.setCommand(undefined, 'menu');
				}

				// Needs to be after we reset the command
				quickpick.buttons = this.getButtons(step, commandsStep.command);

				if (step.value != null) {
					quickpick.value = step.value;
				}

				quickpick.show();

				// Manually trigger `onDidChangeValue`, because the QuickPick seems to fail to call it properly
				if (step.value != null) {
					// HACK: This is fragile!
					(quickpick as any)._onDidChangeValueEmitter.fire(quickpick.value);
				}
			});
		} finally {
			quickpick.dispose();
			disposables.forEach(d => d.dispose());
		}
	}
}

class PickCommandStep implements QuickPickStep {
	readonly buttons = [];
	private readonly hiddenItems: QuickCommand[];
	ignoreFocusOut = false;
	readonly items: QuickCommand[];
	readonly matchOnDescription = true;
	readonly placeholder = 'Choose a git command';
	readonly title = 'GitLens';

	constructor(args?: GitCommandsCommandArgs) {
		this.items = [
			new BranchGitCommand(args?.command === 'branch' ? args : undefined),
			new CherryPickGitCommand(args?.command === 'cherry-pick' ? args : undefined),
			new CoAuthorsGitCommand(args?.command === 'co-authors' ? args : undefined),
			new FetchGitCommand(args?.command === 'fetch' ? args : undefined),
			new LogGitCommand(args?.command === 'log' ? args : undefined),
			new MergeGitCommand(args?.command === 'merge' ? args : undefined),
			new PullGitCommand(args?.command === 'pull' ? args : undefined),
			new PushGitCommand(args?.command === 'push' ? args : undefined),
			new RebaseGitCommand(args?.command === 'rebase' ? args : undefined),
			new ResetGitCommand(args?.command === 'reset' ? args : undefined),
			new RevertGitCommand(args?.command === 'revert' ? args : undefined),
			new SearchGitCommand(args?.command === 'search' ? args : undefined),
			new ShowGitCommand(args?.command === 'show' ? args : undefined),
			new StashGitCommand(args?.command === 'stash' ? args : undefined),
			new StatusGitCommand(args?.command === 'status' ? args : undefined),
			new SwitchGitCommand(args?.command === 'switch' ? args : undefined),
			new TagGitCommand(args?.command === 'tag' ? args : undefined),
		];

		this.hiddenItems = [];
	}

	private _command: QuickCommand | undefined;
	get command(): QuickCommand | undefined {
		return this._command;
	}

	find(commandName: string, fuzzy: boolean = false) {
		if (fuzzy) {
			const cmd = commandName.toLowerCase();
			return this.items.find(c => c.isMatch(cmd)) ?? this.hiddenItems.find(c => c.isMatch(cmd));
		}

		return this.items.find(c => c.key === commandName) ?? this.hiddenItems.find(c => c.key === commandName);
	}

	setCommand(command: QuickCommand | undefined, via: 'menu' | 'command'): void {
		if (this._command != null) {
			this._command.picked = false;
		}

		if (command != null) {
			command.picked = true;
			command.pickedVia = via;
		}

		this._command = command;
	}
}
