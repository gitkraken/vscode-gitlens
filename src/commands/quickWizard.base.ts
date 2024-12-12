import type { Disposable, InputBox, QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import { InputBoxValidationSeverity, QuickInputButtons, window } from 'vscode';
import type { GlCommands } from '../constants.commands';
import { Container } from '../container';
import { Directive, isDirective, isDirectiveQuickPickItem } from '../quickpicks/items/directive';
import { log } from '../system/decorators/log';
import type { Deferred } from '../system/promise';
import { isPromise } from '../system/promise';
import { configuration } from '../system/vscode/configuration';
import type { KeyMapping } from '../system/vscode/keyboard';
import { GlCommandBase } from './base';
import type { GitWizardCommandArgs } from './gitWizard';
import type { CustomStep, QuickCommand, QuickInputStep, QuickPickStep, StepSelection } from './quickCommand';
import { isCustomStep, isQuickCommand, isQuickInputStep, isQuickPickStep, StepResultBreak } from './quickCommand';
import {
	LoadMoreQuickInputButton,
	ToggleQuickInputButton,
	WillConfirmForcedQuickInputButton,
	WillConfirmToggleQuickInputButton,
} from './quickCommand.buttons';
import type { QuickWizardCommandArgs } from './quickWizard';
import { QuickWizardRootStep } from './quickWizard.utils';

const sanitizeLabel = /\$\(.+?\)|\s/g;
const showLoadingSymbol = Symbol('ShowLoading');

export type AnyQuickWizardCommandArgs = QuickWizardCommandArgs | GitWizardCommandArgs;

export type QuickWizardCommandArgsWithCompletion<T extends AnyQuickWizardCommandArgs = AnyQuickWizardCommandArgs> =
	T & { completion?: Deferred<void> };

export abstract class QuickWizardCommandBase extends GlCommandBase {
	private startedWith: 'menu' | 'command' = 'menu';

	constructor(
		protected readonly container: Container,
		command: GlCommands | GlCommands[],
	) {
		super(command);
	}

	@log({ args: false, scoped: true, singleLine: true, timed: false })
	async execute(args?: QuickWizardCommandArgsWithCompletion) {
		const rootStep = new QuickWizardRootStep(this.container, args);

		const command = args?.command != null ? rootStep.find(args.command) : undefined;
		this.startedWith = command != null ? 'command' : 'menu';

		let ignoreFocusOut;

		let step: QuickPickStep | QuickInputStep | CustomStep | undefined;
		if (command == null) {
			step = rootStep;
		} else {
			step = await this.showLoadingIfNeeded(command, this.getCommandStep(command, rootStep));
		}

		// If this is the first step, don't honor the step's setting
		if (step?.ignoreFocusOut === true) {
			step.ignoreFocusOut = undefined;
		}

		while (step != null) {
			// If we are trying to back up to the menu and have a starting command, then just reset to the starting command
			if (step === rootStep && command != null) {
				step = await this.getCommandStep(command, rootStep);
				continue;
			}

			if (ignoreFocusOut && step.ignoreFocusOut == null) {
				step.ignoreFocusOut = true;
			}

			if (isQuickPickStep(step)) {
				step = await this.showPickStep(step, rootStep);
				if (step?.ignoreFocusOut === true) {
					ignoreFocusOut = true;
				}

				continue;
			}

			if (isQuickInputStep(step)) {
				step = await this.showInputStep(step, rootStep);
				if (step?.ignoreFocusOut === true) {
					ignoreFocusOut = true;
				}

				continue;
			}

			if (isCustomStep(step)) {
				step = await this.showCustomStep(step, rootStep);
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
		command: QuickCommand,
		stepPromise: Promise<QuickPickStep | QuickInputStep | CustomStep | undefined>,
	): Promise<QuickPickStep | QuickInputStep | CustomStep | undefined> {
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

		let step: QuickPickStep | QuickInputStep | CustomStep | undefined;
		try {
			return await new Promise<QuickPickStep | QuickInputStep | CustomStep | undefined>(
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

			if (step.disallowBack !== true) {
				buttons.push(QuickInputButtons.Back);
			}

			if (step.additionalButtons != null) {
				buttons.push(...step.additionalButtons);
			}
		}

		if (command?.canConfirm) {
			if (command.canSkipConfirm) {
				const willConfirmToggle = new WillConfirmToggleQuickInputButton(
					command.confirm(),
					step?.isConfirmationStep ?? false,
					async () => {
						if (command?.skipConfirmKey == null) return;

						const skipConfirmations = configuration.get('gitCommands.skipConfirmations') ?? [];

						const index = skipConfirmations.indexOf(command.skipConfirmKey);
						if (index !== -1) {
							skipConfirmations.splice(index, 1);
						} else {
							skipConfirmations.push(command.skipConfirmKey);
						}

						await configuration.updateEffective('gitCommands.skipConfirmations', skipConfirmations);
					},
				);
				buttons.push(willConfirmToggle);
			} else if (!step?.isConfirmationStep) {
				buttons.push(WillConfirmForcedQuickInputButton);
			}
		}

		return buttons;
	}

	private async getCommandStep(command: QuickCommand, rootStep: QuickWizardRootStep) {
		rootStep.setCommand(command, 'command');

		// Ensure we've finished discovering repositories before continuing
		if (this.container.git.isDiscoveringRepositories != null) {
			await this.container.git.isDiscoveringRepositories;
		}

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

	private async showCustomStep(step: CustomStep, rootStep: QuickWizardRootStep) {
		const result = await step.show(step);
		if (result === StepResultBreak) return undefined;

		if (isDirective(result)) {
			switch (result) {
				case Directive.Back:
					return (await rootStep?.command?.previous()) ?? rootStep;
				case Directive.Noop:
				case Directive.Reload:
					return rootStep.command?.retry();
				case Directive.Cancel:
				default:
					return undefined;
			}
		} else {
			return this.nextStep(rootStep.command!, result);
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

	private async showInputStep(step: QuickInputStep, rootStep: QuickWizardRootStep) {
		const input = window.createInputBox();
		input.ignoreFocusOut = !configuration.get('gitCommands.closeOnFocusOut') ? true : step.ignoreFocusOut ?? false;

		const disposables: Disposable[] = [];

		try {
			// eslint-disable-next-line no-async-promise-executor
			return await new Promise<QuickPickStep | QuickInputStep | CustomStep | undefined>(async resolve => {
				const goBack = async () => {
					if (step.disallowBack === true) return;

					input.value = '';
					if (rootStep.command != null) {
						input.busy = true;
						resolve((await rootStep.command.previous()) ?? rootStep);
					}
				};

				const mapping: KeyMapping = {};
				if (step.onDidPressKey != null && step.keys != null && step.keys.length !== 0) {
					for (const key of step.keys) {
						mapping[key] = {
							onDidPressKey: key => step.onDidPressKey!(input, key),
						};
					}
				}

				const scope = this.container.keyboard.createScope(mapping);
				void scope.start();
				if (step.value != null) {
					void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
				}

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

							input.buttons = this.getButtons(step, rootStep.command);

							if ((await result) === true) {
								resolve(rootStep.command?.retry());
								return;
							}

							if (isPromise(result)) {
								input.buttons = this.getButtons(step, rootStep.command);
							}

							return;
						}

						if (step.onDidClickButton != null) {
							const result = step.onDidClickButton(input, e);
							input.buttons = this.getButtons(step, rootStep.command);
							if ((await result) === true) {
								resolve(rootStep.command?.retry());
							}
						}
					}),
					input.onDidChangeValue(async e => {
						if (!input.ignoreFocusOut) {
							input.ignoreFocusOut = true;
						}

						if (scope != null) {
							// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
							if (e.length !== 0) {
								void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
							} else {
								void scope.resume();
							}
						}

						if (step.validate == null) return;

						const [, message] = await step.validate(e);
						input.validationMessage = message;
					}),
					input.onDidAccept(async () => {
						resolve(await this.nextStep(rootStep.command!, input.value, input));
					}),
				);

				input.buttons = this.getButtons(step, rootStep.command);
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

	private async showPickStep(step: QuickPickStep, rootStep: QuickWizardRootStep) {
		const quickpick = window.createQuickPick();
		quickpick.ignoreFocusOut = !configuration.get('gitCommands.closeOnFocusOut')
			? true
			: step.ignoreFocusOut ?? false;

		const disposables: Disposable[] = [];

		try {
			// eslint-disable-next-line no-async-promise-executor
			return await new Promise<QuickPickStep | QuickInputStep | CustomStep | undefined>(async resolve => {
				async function goBack() {
					if (step.disallowBack === true) return;

					quickpick.value = '';
					if (rootStep.command != null) {
						quickpick.busy = true;
						resolve((await rootStep.command.previous()) ?? rootStep);
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
				if (step.onDidPressKey != null && step.keys?.length) {
					for (const key of step.keys) {
						mapping[key] = {
							onDidPressKey: key => {
								if (!quickpick.activeItems.length) return;

								const item = quickpick.activeItems[0];
								if (isDirectiveQuickPickItem(item)) return;

								return step.onDidPressKey!(quickpick, key, item);
							},
						};
					}
				}

				const scope = this.container.keyboard.createScope(mapping);
				void scope.start();
				if (step.value != null) {
					void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
				}

				let firstActiveChange = true;
				let overrideItems = false;

				disposables.push(
					scope,
					quickpick.onDidHide(() => {
						if (step.frozen) return;

						resolve(undefined);
					}),
					quickpick.onDidTriggerItemButton(async e => {
						if ((await step.onDidClickItemButton?.(quickpick, e.button, e.item)) === true) {
							resolve(await this.nextStep(rootStep.command!, [e.item], quickpick));
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
							let activeCommand: QuickCommand | undefined;
							if (rootStep.command == null && quickpick.activeItems.length !== 0) {
								const active = quickpick.activeItems[0];
								if (isQuickCommand(active)) {
									activeCommand = active;
								}
							}

							const result = e.onDidClick(quickpick);

							quickpick.buttons = this.getButtons(
								activeCommand?.value && !isCustomStep(activeCommand.value) ? activeCommand.value : step,
								activeCommand ?? rootStep.command,
							);

							if ((await result) === true) {
								resolve(rootStep.command?.retry());
								return;
							}

							if (isPromise(result)) {
								quickpick.buttons = this.getButtons(
									activeCommand?.value && !isCustomStep(activeCommand.value)
										? activeCommand.value
										: step,
									activeCommand ?? rootStep.command,
								);
							}

							return;
						}

						if (step.onDidClickButton != null) {
							const resultPromise = step.onDidClickButton(quickpick, e);
							quickpick.buttons = this.getButtons(step, rootStep.command);
							const result = await resultPromise;
							if (result === true) {
								resolve(rootStep.command?.retry());
							} else if (result !== false && result != null) {
								resolve(result.value);
							}
						}
					}),
					quickpick.onDidChangeValue(async e => {
						// If something was typed, keep the quick pick open on focus loss
						if (!quickpick.ignoreFocusOut) {
							quickpick.ignoreFocusOut = true;
							step.ignoreFocusOut = true;
						}

						if (scope != null) {
							// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
							if (e.length !== 0) {
								void scope.pause(['left', 'ctrl+left', 'right', 'ctrl+right']);
							} else {
								void scope.resume();
							}
						}

						if (step.onDidChangeValue != null) {
							const cancel = await step.onDidChangeValue(quickpick);
							if (cancel) return;
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
								if (rootStep.command == null) {
									const command = rootStep.find(quickpick.value.trim(), true);
									if (command == null) return;

									rootStep.setCommand(command, this.startedWith);
								} else {
									const cmd = quickpick.value.trim().toLowerCase();
									const item = (await step.items).find(
										i => i.label.replace(sanitizeLabel, '').toLowerCase() === cmd,
									);
									if (item == null) return;

									items = [item];
								}

								resolve(await this.nextStep(rootStep.command!, items, quickpick));
								return;
							}
						}

						// Assume there is no matches (since there is no activeItems)
						if (
							!quickpick.canSelectMany &&
							rootStep.command != null &&
							e.trim().length !== 0 &&
							(overrideItems || quickpick.activeItems.length === 0)
						) {
							if (step.onValidateValue == null) return;

							overrideItems = await step.onValidateValue(quickpick, e.trim(), await step.items);
						} else {
							overrideItems = false;
						}

						// If we are no longer overriding the items, put them back (only if we need to)
						if (!overrideItems) {
							step.items = await step.items;
							if (quickpick.items.length !== step.items.length) {
								quickpick.items = step.items;
							}
						}
					}),
					quickpick.onDidChangeActive(() => {
						// If something changed (after the first time which happens on open), keep the quick pick open on focus loss
						if (!firstActiveChange && !quickpick.ignoreFocusOut) {
							quickpick.ignoreFocusOut = true;
							step.ignoreFocusOut = true;
						}

						if (firstActiveChange) {
							firstActiveChange = false;
						}

						if (rootStep.command != null || quickpick.activeItems.length === 0) return;

						const command = quickpick.activeItems[0];
						if (!isQuickCommand(command)) return;

						quickpick.buttons = this.getButtons(undefined, command);
					}),
					quickpick.onDidChangeSelection(e => {
						if (!quickpick.canSelectMany) return;

						// If something is selected, keep the quick pick open on focus loss
						if (!quickpick.ignoreFocusOut) {
							quickpick.ignoreFocusOut = true;
							step.ignoreFocusOut = true;
						}

						step.onDidChangeSelection?.(quickpick, e);
					}),
					quickpick.onDidAccept(async () => {
						let items = quickpick.selectedItems;
						if (items.length === 0) {
							if (!quickpick.canSelectMany || quickpick.activeItems.length === 0) {
								const value = quickpick.value.trim();
								if (value.length === 0 && !step.allowEmpty) return;

								if (step.onDidAccept == null) {
									if (step.allowEmpty) {
										resolve(await this.nextStep(rootStep.command!, [], quickpick));
									}

									return;
								}

								quickpick.busy = true;

								if (await step.onDidAccept(quickpick)) {
									resolve(await this.nextStep(rootStep.command!, value, quickpick));
								}

								quickpick.busy = false;
								return;
							}

							items = quickpick.activeItems;
						}

						if (items.length === 1) {
							const [item] = items;
							if (isDirectiveQuickPickItem(item)) {
								await item.onDidSelect?.();

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

									case Directive.Noop:
										return;

									case Directive.Reload:
										resolve(await rootStep.command?.retry());
										return;

									case Directive.SignIn: {
										const result = await Container.instance.subscription.loginOrSignUp(false, {
											source: 'quick-wizard',
											detail: {
												action: rootStep.command?.key,
												'step.title': step.title,
											},
										});
										resolve(result ? await rootStep.command?.retry() : undefined);
										return;
									}

									case Directive.StartPreview:
										await Container.instance.subscription.startPreviewTrial({
											source: 'quick-wizard',
											detail: {
												action: rootStep.command?.key,
												'step.title': step.title,
											},
										});
										resolve(await rootStep.command?.retry());
										return;

									case Directive.RequiresVerification: {
										const result = await Container.instance.subscription.resendVerification({
											source: 'quick-wizard',
											detail: {
												action: rootStep.command?.key,
												'step.title': step.title,
											},
										});
										resolve(result ? await rootStep.command?.retry() : undefined);
										return;
									}

									case Directive.StartProTrial: {
										const result = await Container.instance.subscription.loginOrSignUp(true, {
											source: 'quick-wizard',
											detail: {
												action: rootStep.command?.key,
												'step.title': step.title,
											},
										});
										resolve(result ? await rootStep.command?.retry() : undefined);
										return;
									}

									case Directive.RequiresPaidSubscription:
										void Container.instance.subscription.upgrade({
											source: 'quick-wizard',
											detail: {
												action: rootStep.command?.key,
												'step.title': step.title,
											},
										});
										resolve(undefined);
										return;
								}
							}
						}

						if (rootStep.command == null) {
							const [command] = items;
							if (!isQuickCommand(command)) return;

							rootStep.setCommand(command, this.startedWith);
						}

						if (!quickpick.canSelectMany) {
							if (step.onDidAccept != null) {
								quickpick.busy = true;

								const next = await step.onDidAccept(quickpick);

								quickpick.busy = false;

								if (!next) return;
							}
						}

						resolve(await this.nextStep(rootStep.command!, items as QuickPickItem[], quickpick));
					}),
				);

				quickpick.title = step.title;
				quickpick.matchOnDescription = Boolean(step.matchOnDescription);
				quickpick.matchOnDetail = Boolean(step.matchOnDetail);

				const selectValueWhenShown = step.selectValueWhenShown ?? true;

				let items;
				let shown = false;
				if (isPromise(step.items)) {
					quickpick.placeholder = 'Loading...';

					quickpick.busy = true;

					// If we set the value before showing the quickpick, VS Code will select the entire value
					if (step.value != null && selectValueWhenShown) {
						quickpick.value = step.value;
					}

					quickpick.show();

					shown = true;
					items = await step.items;
				} else {
					items = step.items;
				}

				quickpick.canSelectMany =
					Boolean(step.multiselect) && items.filter(i => !isDirectiveQuickPickItem(i)).length > 1;
				quickpick.placeholder =
					typeof step.placeholder === 'function' ? step.placeholder(items.length) : step.placeholder;
				quickpick.items = items;
				quickpick.busy = false;

				if (quickpick.canSelectMany) {
					quickpick.selectedItems = step.selectedItems ?? quickpick.items.filter(i => i.picked);
				} else {
					quickpick.activeItems = step.selectedItems ?? quickpick.items.filter(i => i.picked);
				}

				// If we are starting over clear the previously active command
				if (rootStep.command != null && step === rootStep) {
					rootStep.setCommand(undefined, 'menu');
				}

				// Needs to be after we reset the command
				quickpick.buttons = this.getButtons(step, rootStep.command);

				if (!shown) {
					// If we set the value before showing the quickpick, VS Code will select the entire value
					if (step.value != null && selectValueWhenShown) {
						quickpick.value = step.value;
					}

					quickpick.show();
				}

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

				step.onDidActivate?.(quickpick);
			});
		} finally {
			quickpick.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}
}
