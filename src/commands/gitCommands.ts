'use strict';
import {
	Disposable,
	InputBox,
	QuickInputButton,
	QuickInputButtons,
	QuickPick,
	QuickPickItem,
	Uri,
	window
} from 'vscode';
import { command, Command, Commands } from './common';
import { log } from '../system';
import {
	isQuickInputStep,
	isQuickPickStep,
	QuickCommandBase,
	QuickInputStep,
	QuickPickStep,
	StepSelection
} from './quickCommand';
import { Directive, DirectiveQuickPickItem } from '../quickpicks';
import { CherryPickGitCommand, CherryPickGitCommandArgs } from './git/cherry-pick';
import { FetchGitCommand, FetchGitCommandArgs } from './git/fetch';
import { MergeGitCommand, MergeGitCommandArgs } from './git/merge';
import { PullGitCommand, PullGitCommandArgs } from './git/pull';
import { PushGitCommand, PushGitCommandArgs } from './git/push';
import { RebaseGitCommand, RebaseGitCommandArgs } from './git/rebase';
import { ResetGitCommand, ResetGitCommandArgs } from './git/reset';
import { RevertGitCommand, RevertGitCommandArgs } from './git/revert';
import { SearchGitCommand, SearchGitCommandArgs } from './git/search';
import { StashGitCommand, StashGitCommandArgs } from './git/stash';
import { SwitchGitCommand, SwitchGitCommandArgs } from './git/switch';
import { Container } from '../container';
import { configuration } from '../configuration';
import { KeyMapping } from '../keyboard';

const sanitizeLabel = /\$\(.+?\)|\s/g;

export type GitCommandsCommandArgs =
	| CherryPickGitCommandArgs
	| FetchGitCommandArgs
	| MergeGitCommandArgs
	| PullGitCommandArgs
	| PushGitCommandArgs
	| RebaseGitCommandArgs
	| ResetGitCommandArgs
	| RevertGitCommandArgs
	| SearchGitCommandArgs
	| StashGitCommandArgs
	| SwitchGitCommandArgs;

@command()
export class GitCommandsCommand extends Command {
	private readonly Buttons = class {
		static readonly CloseOnFocusOut: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-pin-small.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-pin-small.svg'))
			},
			tooltip: 'Keep Open'
		};

		static readonly KeepOpen: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-pin-small-selected.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-pin-small-selected.svg'))
			},
			tooltip: 'Keep Open'
		};

		static readonly WillConfirm: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-check.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-check.svg'))
			},
			tooltip: 'Will confirm'
		};

		static readonly WillConfirmForced: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-check.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-check.svg'))
			},
			tooltip: 'Will always confirm'
		};

		static readonly WillSkipConfirm: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-no-check.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-no-check.svg'))
			},
			tooltip: 'Skips confirm'
		};
	};

	private _pickedVia: 'menu' | 'command' = 'menu';

	constructor() {
		super(Commands.GitCommands);
	}

	@log({ args: false, correlate: true, singleLine: true, timed: false })
	async execute(args?: GitCommandsCommandArgs) {
		const commandsStep = new PickCommandStep(args);

		let step: QuickPickStep | QuickInputStep | undefined = commandsStep;

		if (args) {
			const command = commandsStep.find(args.command);
			if (command !== undefined) {
				this._pickedVia = 'command';
				commandsStep.setCommand(command, this._pickedVia);

				const next = await command.next();
				if (next.done) return;

				step = next.value;
			}
		}

		while (step !== undefined) {
			if (isQuickPickStep(step)) {
				step = await this.showPickStep(step, commandsStep);
				continue;
			}

			if (isQuickInputStep(step)) {
				step = await this.showInputStep(step, commandsStep);
				continue;
			}

			break;
		}
	}

	private async showInputStep(step: QuickInputStep, commandsStep: PickCommandStep) {
		const input = window.createInputBox();
		input.ignoreFocusOut = !configuration.get('gitCommands', 'closeOnFocusOut');

		const disposables: Disposable[] = [];

		try {
			return await new Promise<QuickPickStep | QuickInputStep | undefined>(resolve => {
				const goBack = async () => {
					input.value = '';
					if (commandsStep.command !== undefined) {
						input.busy = true;
						resolve((await commandsStep.command.previous()) || commandsStep);
					}
				};

				const mapping: KeyMapping = {
					left: { onDidPressKey: goBack }
				};
				if (step.onDidPressKey !== undefined && step.keys !== undefined && step.keys.length !== 0) {
					for (const key of step.keys) {
						mapping[key] = {
							onDidPressKey: key => step.onDidPressKey!(input, key)
						};
					}
				}

				const scope = Container.keyboard.createScope(mapping);
				scope.start();

				disposables.push(
					scope,
					input.onDidHide(() => resolve()),
					input.onDidTriggerButton(async e => {
						if (e === QuickInputButtons.Back) {
							input.value = '';
							if (commandsStep.command !== undefined) {
								input.busy = true;
								resolve((await commandsStep.command.previous()) || commandsStep);
							}

							return;
						}

						if (e === this.Buttons.WillConfirmForced) return;
						if (e === this.Buttons.WillConfirm || e === this.Buttons.WillSkipConfirm) {
							await this.toggleConfirmation(input, commandsStep.command);

							return;
						}

						if (e === this.Buttons.CloseOnFocusOut || e === this.Buttons.KeepOpen) {
							await this.toggleKeepOpen(input, commandsStep.command);

							return;
						}

						if (step.onDidClickButton !== undefined) {
							step.onDidClickButton(input, e);
							input.buttons = this.getButtons(step, commandsStep.command);
						}
					}),
					input.onDidChangeValue(async e => {
						if (scope !== undefined) {
							// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
							if (e.length !== 0) {
								await scope.pause(['left', 'right']);
							} else {
								await scope.resume();
							}
						}

						if (step.validate === undefined) return;

						const [, message] = await step.validate(e);
						input.validationMessage = message;
					}),
					input.onDidAccept(async () => {
						resolve(await this.nextStep(input, commandsStep.command!, input.value));
					})
				);

				input.buttons = this.getButtons(step, commandsStep.command);
				input.title = step.title;
				input.placeholder = step.placeholder;
				if (step.value !== undefined) {
					input.value = step.value;
				}

				// If we are starting over clear the previously active command
				if (commandsStep.command !== undefined && step === commandsStep) {
					this._pickedVia = 'menu';
					commandsStep.setCommand(undefined, this._pickedVia);
				}

				input.show();

				// Manually trigger `onDidChangeValue`, because the InputBox seems to fail to call it properly
				if (step.value !== undefined) {
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
		const quickpick = window.createQuickPick();
		quickpick.ignoreFocusOut = !configuration.get('gitCommands', 'closeOnFocusOut');

		const disposables: Disposable[] = [];

		try {
			return await new Promise<QuickPickStep | QuickInputStep | undefined>(resolve => {
				const goBack = async () => {
					quickpick.value = '';
					if (commandsStep.command !== undefined) {
						quickpick.busy = true;
						resolve((await commandsStep.command.previous()) || commandsStep);
					}
				};

				const mapping: KeyMapping = {
					left: { onDidPressKey: goBack }
				};
				if (step.onDidPressKey !== undefined && step.keys !== undefined && step.keys.length !== 0) {
					for (const key of step.keys) {
						mapping[key] = {
							onDidPressKey: key => step.onDidPressKey!(quickpick, key)
						};
					}
				}

				const scope = Container.keyboard.createScope(mapping);
				scope.start();

				let overrideItems = false;

				disposables.push(
					scope,
					quickpick.onDidHide(() => resolve()),
					quickpick.onDidTriggerButton(async e => {
						if (e === QuickInputButtons.Back) {
							goBack();

							return;
						}

						if (e === this.Buttons.WillConfirmForced) return;
						if (
							e === this.Buttons.CloseOnFocusOut ||
							e === this.Buttons.KeepOpen ||
							e === this.Buttons.WillConfirm ||
							e === this.Buttons.WillSkipConfirm
						) {
							let command = commandsStep.command;
							if (command === undefined && quickpick.activeItems.length !== 0) {
								const active = quickpick.activeItems[0];
								if (!QuickCommandBase.is(active)) return;

								command = active;
							}

							if (e === this.Buttons.WillConfirm || e === this.Buttons.WillSkipConfirm) {
								await this.toggleConfirmation(quickpick, command);
							}

							if (e === this.Buttons.CloseOnFocusOut || e === this.Buttons.KeepOpen) {
								await this.toggleKeepOpen(quickpick, command);
							}

							return;
						}

						if (step.onDidClickButton !== undefined) {
							step.onDidClickButton(quickpick, e);
							quickpick.buttons = this.getButtons(step, commandsStep.command);
						}
					}),
					quickpick.onDidChangeValue(async e => {
						if (scope !== undefined) {
							// Pause the left/right keyboard commands if there is a value, otherwise the left/right arrows won't work in the input properly
							if (e.length !== 0) {
								await scope.pause(['left', 'right']);
							} else {
								await scope.resume();
							}
						}

						if (step.onDidChangeValue !== undefined) {
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
								if (commandsStep.command === undefined) {
									const command = commandsStep.find(quickpick.value.trim(), true);
									if (command === undefined) return;

									commandsStep.setCommand(command, this._pickedVia);
								} else {
									const cmd = quickpick.value.trim().toLowerCase();
									const item = step.items.find(
										i => i.label.replace(sanitizeLabel, '').toLowerCase() === cmd
									);
									if (item === undefined) return;

									items = [item];
								}

								resolve(await this.nextStep(quickpick, commandsStep.command!, items));

								return;
							}
						}

						// Assume there is no matches (since there is no activeItems)
						if (
							!quickpick.canSelectMany &&
							commandsStep.command !== undefined &&
							e.trim().length !== 0 &&
							(overrideItems || quickpick.activeItems.length === 0)
						) {
							if (step.onValidateValue === undefined) return;

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
						if (commandsStep.command !== undefined || quickpick.activeItems.length === 0) return;

						const command = quickpick.activeItems[0];
						if (!QuickCommandBase.is(command)) return;

						quickpick.buttons = this.getButtons(undefined, command);
					}),
					quickpick.onDidAccept(async () => {
						let items = quickpick.selectedItems;
						if (items.length === 0) {
							if (!quickpick.canSelectMany || quickpick.activeItems.length === 0) {
								const value = quickpick.value.trim();
								if (value.length === 0) return;

								if (step.onDidAccept === undefined) return;

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
							const item = items[0];
							if (DirectiveQuickPickItem.is(item)) {
								switch (item.directive) {
									case Directive.Cancel:
										resolve();
										return;

									case Directive.Back:
										quickpick.value = '';
										if (commandsStep.command !== undefined) {
											quickpick.busy = true;
											resolve((await commandsStep.command.previous()) || commandsStep);
										}
										return;
								}
							}
						}

						if (commandsStep.command === undefined) {
							const command = items[0];
							if (!QuickCommandBase.is(command)) return;

							commandsStep.setCommand(command, this._pickedVia);
						}

						if (!quickpick.canSelectMany) {
							if (step.onDidAccept !== undefined) {
								quickpick.busy = true;

								const next = await step.onDidAccept(quickpick);

								quickpick.busy = false;

								if (!next) {
									return;
								}
							}
						}

						resolve(await this.nextStep(quickpick, commandsStep.command!, items as QuickPickItem[]));
					})
				);

				quickpick.title = step.title;
				quickpick.placeholder = step.placeholder;
				quickpick.matchOnDescription = Boolean(step.matchOnDescription);
				quickpick.matchOnDetail = Boolean(step.matchOnDetail);
				quickpick.canSelectMany = Boolean(step.multiselect);

				quickpick.items = step.items;

				if (quickpick.canSelectMany) {
					quickpick.selectedItems = step.selectedItems || quickpick.items.filter(i => i.picked);
					quickpick.activeItems = quickpick.selectedItems;
				} else {
					quickpick.activeItems = step.selectedItems || quickpick.items.filter(i => i.picked);
				}

				// If we are starting over clear the previously active command
				if (commandsStep.command !== undefined && step === commandsStep) {
					this._pickedVia = 'menu';
					commandsStep.setCommand(undefined, this._pickedVia);
				}

				// Needs to be after we reset the command
				quickpick.buttons = this.getButtons(step, commandsStep.command);

				if (step.value !== undefined) {
					quickpick.value = step.value;
				}

				quickpick.show();

				// Manually trigger `onDidChangeValue`, because the QuickPick seems to fail to call it properly
				if (step.value !== undefined) {
					// HACK: This is fragile!
					(quickpick as any)._onDidChangeValueEmitter.fire(quickpick.value);
				}
			});
		} finally {
			quickpick.dispose();
			disposables.forEach(d => d.dispose());
		}
	}

	private getButtons(step: QuickInputStep | QuickPickStep | undefined, command?: QuickCommandBase) {
		const buttons: QuickInputButton[] = [];

		if (step !== undefined) {
			if (step.buttons !== undefined) {
				buttons.push(
					...step.buttons,
					configuration.get('gitCommands', 'closeOnFocusOut')
						? this.Buttons.CloseOnFocusOut
						: this.Buttons.KeepOpen
				);
				return buttons;
			}

			buttons.push(QuickInputButtons.Back);

			if (step.additionalButtons !== undefined) {
				buttons.push(...step.additionalButtons);
			}
		}

		if (command !== undefined && command.canConfirm) {
			if (command.canSkipConfirm) {
				buttons.push(command.confirm() ? this.Buttons.WillConfirm : this.Buttons.WillSkipConfirm);
			} else {
				buttons.push(this.Buttons.WillConfirmForced);
			}
		}

		buttons.push(
			configuration.get('gitCommands', 'closeOnFocusOut') ? this.Buttons.CloseOnFocusOut : this.Buttons.KeepOpen
		);

		return buttons;
	}

	private async nextStep(
		quickInput: InputBox | QuickPick<QuickPickItem>,
		command: QuickCommandBase,
		value: StepSelection<any> | undefined
	) {
		quickInput.busy = true;
		// quickInput.enabled = false;

		const next = await command.next(value);
		if (next.done) return undefined;

		quickInput.value = '';
		return next.value;
	}

	private async toggleConfirmation(
		input: InputBox | QuickPick<QuickPickItem>,
		command: QuickCommandBase | undefined
	) {
		if (command === undefined || command.skipConfirmKey === undefined) return;

		const skipConfirmations = configuration.get('gitCommands', 'skipConfirmations') || [];

		const index = skipConfirmations.indexOf(command.skipConfirmKey);
		if (index !== -1) {
			skipConfirmations.splice(index, 1);
		} else {
			skipConfirmations.push(command.skipConfirmKey);
		}

		void (await configuration.updateEffective('gitCommands', 'skipConfirmations', skipConfirmations));

		input.buttons = this.getButtons(command.value, command);
	}

	private async toggleKeepOpen(input: InputBox | QuickPick<QuickPickItem>, command: QuickCommandBase | undefined) {
		const closeOnFocusOut = !configuration.get('gitCommands', 'closeOnFocusOut');

		input.ignoreFocusOut = !closeOnFocusOut;
		void (await configuration.updateEffective('gitCommands', 'closeOnFocusOut', closeOnFocusOut));

		input.buttons = this.getButtons(command && command.value, command);
	}
}

class PickCommandStep implements QuickPickStep {
	readonly buttons = [];
	readonly items: QuickCommandBase[];
	readonly matchOnDescription = true;
	readonly placeholder = 'Choose a git command';
	readonly title = 'GitLens';

	constructor(args?: GitCommandsCommandArgs) {
		this.items = [
			new CherryPickGitCommand(args && args.command === 'cherry-pick' ? args : undefined),
			new MergeGitCommand(args && args.command === 'merge' ? args : undefined),
			new FetchGitCommand(args && args.command === 'fetch' ? args : undefined),
			new PullGitCommand(args && args.command === 'pull' ? args : undefined),
			new PushGitCommand(args && args.command === 'push' ? args : undefined),
			new RebaseGitCommand(args && args.command === 'rebase' ? args : undefined),
			new ResetGitCommand(args && args.command === 'reset' ? args : undefined),
			new RevertGitCommand(args && args.command === 'revert' ? args : undefined),
			new SearchGitCommand(args && args.command === 'search' ? args : undefined),
			new StashGitCommand(args && args.command === 'stash' ? args : undefined),
			new SwitchGitCommand(args && args.command === 'switch' ? args : undefined)
		];
	}

	private _active: QuickCommandBase | undefined;
	get command(): QuickCommandBase | undefined {
		return this._active;
	}

	find(commandName: string, fuzzy: boolean = false) {
		if (fuzzy) {
			const cmd = commandName.toLowerCase();
			return this.items.find(c => c.isMatch(cmd));
		}

		return this.items.find(c => c.key === commandName);
	}

	setCommand(value: QuickCommandBase | undefined, reason: 'menu' | 'command'): void {
		if (this._active !== undefined) {
			this._active.picked = false;
		}

		this._active = value;

		if (this._active !== undefined) {
			this._active.picked = true;
			this._active.pickedVia = reason;
		}
	}
}
