import type { Disposable, InputBox, QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { InputBoxValidationSeverity, QuickInputButtons, window } from 'vscode';
import { Commands } from '../constants';
import { Container } from '../container';
import { Directive, isDirective, isDirectiveQuickPickItem } from '../quickpicks/items/directive';
import { command } from '../system/command';
import { configuration } from '../system/configuration';
import { log } from '../system/decorators/log';
import type { KeyMapping } from '../system/keyboard';
import type { Deferred } from '../system/promise';
import { isPromise } from '../system/promise';
import type { CommandContext } from './base';
import { Command } from './base';
import type { BranchGitCommandArgs } from './git/branch';
import type { CherryPickGitCommandArgs } from './git/cherry-pick';
import type { CoAuthorsGitCommandArgs } from './git/coauthors';
import type { FetchGitCommandArgs } from './git/fetch';
import type { LogGitCommandArgs } from './git/log';
import type { MergeGitCommandArgs } from './git/merge';
import type { PullGitCommandArgs } from './git/pull';
import type { PushGitCommandArgs } from './git/push';
import type { RebaseGitCommandArgs } from './git/rebase';
import type { RemoteGitCommandArgs } from './git/remote';
import type { ResetGitCommandArgs } from './git/reset';
import type { RevertGitCommandArgs } from './git/revert';
import type { SearchGitCommandArgs } from './git/search';
import type { ShowGitCommandArgs } from './git/show';
import type { StashGitCommandArgs } from './git/stash';
import type { StatusGitCommandArgs } from './git/status';
import type { SwitchGitCommandArgs } from './git/switch';
import type { TagGitCommandArgs } from './git/tag';
import type { WorktreeGitCommandArgs } from './git/worktree';
import { PickCommandStep } from './gitCommands.utils';
import type { CustomStep, QuickCommand, QuickInputStep, QuickPickStep, StepSelection } from './quickCommand';
import { isCustomStep, isQuickCommand, isQuickInputStep, isQuickPickStep, StepResultBreak } from './quickCommand';
import {
	LoadMoreQuickInputButton,
	ToggleQuickInputButton,
	WillConfirmForcedQuickInputButton,
	WillConfirmToggleQuickInputButton,
} from './quickCommand.buttons';

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
	| RemoteGitCommandArgs
	| ResetGitCommandArgs
	| RevertGitCommandArgs
	| SearchGitCommandArgs
	| ShowGitCommandArgs
	| StashGitCommandArgs
	| StatusGitCommandArgs
	| SwitchGitCommandArgs
	| TagGitCommandArgs
	| WorktreeGitCommandArgs;

export type GitCommandsCommandArgsWithCompletion = GitCommandsCommandArgs & { completion?: Deferred<void> };

@command()
export class GitCommandsCommand extends Command {
	private startedWith: 'menu' | 'command' = 'menu';

	constructor(private readonly container: Container) {
		super([
			Commands.GitCommands,
			Commands.GitCommandsBranch,
			Commands.GitCommandsCherryPick,
			Commands.GitCommandsMerge,
			Commands.GitCommandsRebase,
			Commands.GitCommandsReset,
			Commands.GitCommandsRevert,
			Commands.GitCommandsSwitch,
			Commands.GitCommandsTag,
			Commands.GitCommandsWorktree,
		]);
	}

	protected override preExecute(context: CommandContext, args?: GitCommandsCommandArgsWithCompletion) {
		switch (context.command) {
			case Commands.GitCommandsBranch:
				args = { command: 'branch' };
				break;
			case Commands.GitCommandsCherryPick:
				args = { command: 'cherry-pick' };
				break;
			case Commands.GitCommandsMerge:
				args = { command: 'merge' };
				break;
			case Commands.GitCommandsRebase:
				args = { command: 'rebase' };
				break;
			case Commands.GitCommandsReset:
				args = { command: 'reset' };
				break;
			case Commands.GitCommandsRevert:
				args = { command: 'revert' };
				break;
			case Commands.GitCommandsSwitch:
				args = { command: 'switch' };
				break;
			case Commands.GitCommandsTag:
				args = { command: 'tag' };
				break;
			case Commands.GitCommandsWorktree:
				args = { command: 'worktree' };
				break;
		}

		return this.execute(args);
	}

	@log({ args: false, scoped: true, singleLine: true, timed: false })
	async execute(args?: GitCommandsCommandArgsWithCompletion) {
		const commandsStep = new PickCommandStep(this.container, args);

		const command = args?.command != null ? commandsStep.find(args.command) : undefined;
		this.startedWith = command != null ? 'command' : 'menu';

		let ignoreFocusOut;

		let step: QuickPickStep<QuickPickItem> | QuickInputStep | CustomStep | undefined;
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

			if (isCustomStep(step)) {
				step = await this.showCustomStep(step, commandsStep);
				if (step?.ignoreFocusOut === true) {
					ignoreFocusOut = true;
				}

				continue;
			}

			break;
		}

		args?.completion?.fulfill();
	}

	private async showLoadingIfNeeded(
		command: QuickCommand<any>,
		stepPromise: Promise<QuickPickStep<QuickPickItem> | QuickInputStep | CustomStep | undefined>,
	): Promise<QuickPickStep<QuickPickItem> | QuickInputStep | CustomStep | undefined> {
		const stepOrTimeout = await Promise.race([
			stepPromise,
			new Promise<typeof showLoadingSymbol>(resolve => setTimeout(resolve, 250, showLoadingSymbol)),
		]);

		if (stepOrTimeout !== showLoadingSymbol) {
			return stepOrTimeout;
		}

		const quickpick = window.createQuickPick();
		quickpick.ignoreFocusOut = false;

		const disposables: Disposable[] = [];

		let step: QuickPickStep<QuickPickItem> | QuickInputStep | CustomStep | undefined;
		try {
			return await new Promise<QuickPickStep<QuickPickItem> | QuickInputStep | CustomStep | undefined>(
				// eslint-disable-next-line no-async-promise-executor
				async resolve => {
					disposables.push(quickpick.onDidHide(() => resolve(step)));

					quickpick.title = command.title;
					quickpick.placeholder = 'Loading...';
					quickpick.busy = true;
					quickpick.enabled = false;

					quickpick.show();

					step = await stepPromise;

					quickpick.hide();
				},
			);
		} finally {
			quickpick.dispose();
			disposables.forEach(d => void d.dispose());
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
				const willConfirmToggle = new WillConfirmToggleQuickInputButton(command.confirm(), async () => {
					if (command?.skipConfirmKey == null) return;

					const skipConfirmations = configuration.get('gitCommands.skipConfirmations') ?? [];

					const index = skipConfirmations.indexOf(command.skipConfirmKey);
					if (index !== -1) {
						skipConfirmations.splice(index, 1);
					} else {
						skipConfirmations.push(command.skipConfirmKey);
					}

					await configuration.updateEffective('gitCommands.skipConfirmations', skipConfirmations);
				});
				buttons.push(willConfirmToggle);
			} else {
				buttons.push(WillConfirmForcedQuickInputButton);
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
		command: QuickCommand,
		value: StepSelection<any> | undefined,
		quickInput?: InputBox | QuickPick<QuickPickItem>,
	) {
		if (quickInput != null) {
			quickInput.busy = true;
			// quickInput.enabled = false;
		}

		const next = await command.next(value);
		if (next.done) return undefined;

		if (quickInput != null) {
			quickInput.value = '';
		}
		return next.value;
	}

	private async showCustomStep(step: CustomStep, commandsStep: PickCommandStep) {
		const result = await step.show(step);
		if (result === StepResultBreak) return undefined;

		if (isDirective(result)) {
			switch (result) {
				case Directive.Back:
					return (await commandsStep?.command?.previous()) ?? commandsStep;
				case Directive.Noop:
					return commandsStep.command?.retry();
				case Directive.Cancel:
				default:
					return undefined;
			}
		} else {
			return this.nextStep(commandsStep.command!, result);
		}
		// switch (result.directive) {
		// 	case 'back':
		// 		return (await commandsStep?.command?.previous()) ?? commandsStep;
		// 	case 'cancel':
		// 		return undefined;
		// 	case 'next':
		// 		return this.nextStep(commandsStep.command!, result.value);
		// 	case 'retry':
		// 		return commandsStep.command?.retry();
		// 	default:
		// 		return undefined;
		// }
	}

	private async showInputStep(step: QuickInputStep, commandsStep: PickCommandStep) {
		const input = window.createInputBox();
		input.ignoreFocusOut = !configuration.get('gitCommands.closeOnFocusOut') ? true : step.ignoreFocusOut ?? false;

		const disposables: Disposable[] = [];

		try {
			// eslint-disable-next-line no-async-promise-executor
			return await new Promise<QuickPickStep | QuickInputStep | undefined>(async resolve => {
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

				const scope = this.container.keyboard.createScope(mapping);
				void scope.start();

				disposables.push(
					scope,
					input.onDidHide(() => resolve(undefined)),
					input.onDidTriggerButton(async e => {
						if (e === QuickInputButtons.Back) {
							void goBack();
							return;
						}

						if (e === WillConfirmForcedQuickInputButton) return;

						if (e instanceof ToggleQuickInputButton && e.onDidClick != null) {
							const result = e.onDidClick(input);

							input.buttons = this.getButtons(step, commandsStep.command);

							if ((await result) === true) {
								resolve(commandsStep.command?.retry());
								return;
							}

							if (isPromise(result)) {
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
						resolve(await this.nextStep(commandsStep.command!, input.value, input));
					}),
				);

				input.buttons = this.getButtons(step, commandsStep.command);
				input.title = step.title;
				input.placeholder = step.placeholder;
				input.prompt = step.prompt;
				if (step.value != null) {
					input.value = step.value;

					if (step.validate != null) {
						const [valid, message] = await step.validate(step.value);
						if (!valid && message != null) {
							input.validationMessage = { severity: InputBoxValidationSeverity.Error, message: message };
						}
					}
				}

				// If we are starting over clear the previously active command
				if (commandsStep.command != null && step === commandsStep) {
					commandsStep.setCommand(undefined, 'menu');
				}

				input.show();

				// Manually trigger `onDidChangeValue`, because the InputBox fails to call it if the value is set before it is shown
				if (step.value != null) {
					// HACK: This is fragile!
					try {
						(input as any)._onDidChangeValueEmitter?.fire(input.value);
					} catch {
						debugger;
					}
				}
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}

	private async showPickStep(step: QuickPickStep, commandsStep: PickCommandStep) {
		const originalIgnoreFocusOut = !configuration.get('gitCommands.closeOnFocusOut')
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

					try {
						const items = await step.onDidLoadMore?.(quickpick);

						let activeIndex = -1;
						if (quickpick.activeItems.length !== 0) {
							const active = quickpick.activeItems[0];
							activeIndex = quickpick.items.indexOf(active);

							// If the active item is the "Load more" directive, then select the previous item
							if (isDirectiveQuickPickItem(active)) {
								activeIndex--;
							}
						}

						quickpick.items = step.items = items;

						if (activeIndex) {
							quickpick.activeItems = [quickpick.items[activeIndex]];
						}
					} finally {
						quickpick.busy = false;
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

				const scope = this.container.keyboard.createScope(mapping);
				void scope.start();

				let overrideItems = false;

				disposables.push(
					scope,
					quickpick.onDidHide(() => resolve(undefined)),
					quickpick.onDidTriggerItemButton(async e => {
						if ((await step.onDidClickItemButton?.(quickpick, e.button, e.item)) === true) {
							resolve(await this.nextStep(commandsStep.command!, [e.item], quickpick));
						}
					}),
					quickpick.onDidTriggerButton(async e => {
						if (e === QuickInputButtons.Back) {
							void goBack();
							return;
						}

						if (e === WillConfirmForcedQuickInputButton) return;

						if (e === LoadMoreQuickInputButton) {
							void loadMore();
							return;
						}

						if (e instanceof ToggleQuickInputButton && e.onDidClick != null) {
							let activeCommand;
							if (commandsStep.command == null && quickpick.activeItems.length !== 0) {
								const active = quickpick.activeItems[0];
								if (isQuickCommand(active)) {
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

							if (isPromise(result)) {
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

								resolve(await this.nextStep(commandsStep.command!, items, quickpick));
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
						if (!isQuickCommand(command)) return;

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
										resolve(await this.nextStep(commandsStep.command!, [], quickpick));
									}

									return;
								}

								quickpick.busy = true;

								if (await step.onDidAccept(quickpick)) {
									resolve(await this.nextStep(commandsStep.command!, value, quickpick));
								}

								quickpick.busy = false;
								return;
							}

							items = quickpick.activeItems;
						}

						if (items.length === 1) {
							const [item] = items;
							if (isDirectiveQuickPickItem(item)) {
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

									case Directive.StartPreviewTrial:
										void Container.instance.subscription.startPreviewTrial();
										resolve(undefined);
										return;

									case Directive.RequiresVerification:
										void Container.instance.subscription.resendVerification();
										resolve(undefined);
										return;

									case Directive.ExtendTrial:
										void Container.instance.subscription.loginOrSignUp();
										resolve(undefined);
										return;

									case Directive.RequiresPaidSubscription:
										void Container.instance.subscription.purchase();
										resolve(undefined);
										return;
								}
							}
						}

						if (commandsStep.command == null) {
							const [command] = items;
							if (!isQuickCommand(command)) return;

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

						resolve(await this.nextStep(commandsStep.command!, items as QuickPickItem[], quickpick));
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

				const selectValueWhenShown = step.selectValueWhenShown ?? true;
				if (step.value != null && selectValueWhenShown) {
					quickpick.value = step.value;
				}

				quickpick.show();

				if (step.value != null && !selectValueWhenShown) {
					quickpick.value = step.value;
				}

				// Manually trigger `onDidChangeValue`, because the QuickPick fails to call it if the value is set before it is shown
				if (step.value != null && selectValueWhenShown) {
					// HACK: This is fragile!
					try {
						(quickpick as any)._onDidChangeValueEmitter?.fire(quickpick.value);
					} catch {
						debugger;
					}
				}
			});
		} finally {
			quickpick.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}
}
