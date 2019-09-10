'use strict';
import { Disposable, InputBox, QuickInputButton, QuickInputButtons, QuickPick, QuickPickItem, window } from 'vscode';
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
import { StashGitCommand, StashGitCommandArgs } from './git/stash';
import { SwitchGitCommand, SwitchGitCommandArgs } from './git/switch';
import { Container } from '../container';
import { configuration } from '../configuration';

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
	| StashGitCommandArgs
	| SwitchGitCommandArgs;

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

@command()
export class GitCommandsCommand extends Command {
	private readonly GitQuickInputButtons = class {
		static readonly WillConfirm: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-check.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-check.svg') as any
			},
			tooltip: 'Will confirm'
		};

		static readonly WillConfirmForced: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-check.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-check.svg') as any
			},
			tooltip: 'Will always confirm'
		};

		static readonly WillSkipConfirm: QuickInputButton = {
			iconPath: {
				dark: Container.context.asAbsolutePath('images/dark/icon-no-check.svg') as any,
				light: Container.context.asAbsolutePath('images/light/icon-no-check.svg') as any
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
				disposables.push(
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

						if (e === this.GitQuickInputButtons.WillConfirmForced) return;
						if (
							e === this.GitQuickInputButtons.WillConfirm ||
							e === this.GitQuickInputButtons.WillSkipConfirm
						) {
							await this.toggleConfirmation(input, commandsStep.command);

							return;
						}

						const step = commandsStep.command && commandsStep.command.value;
						if (step !== undefined && isQuickInputStep(step) && step.onDidClickButton !== undefined) {
							step.onDidClickButton(input, e);
							input.buttons = this.getButtons(step, commandsStep.command);
						}
					}),
					input.onDidChangeValue(async e => {
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
				let overrideItems = false;

				disposables.push(
					quickpick.onDidHide(() => resolve()),
					quickpick.onDidTriggerButton(async e => {
						if (e === QuickInputButtons.Back) {
							quickpick.value = '';
							if (commandsStep.command !== undefined) {
								quickpick.busy = true;
								resolve((await commandsStep.command.previous()) || commandsStep);
							}

							return;
						}

						if (e === this.GitQuickInputButtons.WillConfirmForced) return;
						if (
							e === this.GitQuickInputButtons.WillConfirm ||
							e === this.GitQuickInputButtons.WillSkipConfirm
						) {
							let command = commandsStep.command;
							if (command === undefined && quickpick.activeItems.length !== 0) {
								const active = quickpick.activeItems[0];
								if (!QuickCommandBase.is(active)) return;

								command = active;
							}

							await this.toggleConfirmation(quickpick, command);

							return;
						}

						const step = commandsStep.command && commandsStep.command.value;
						if (step !== undefined && isQuickPickStep(step) && step.onDidClickButton !== undefined) {
							step.onDidClickButton(quickpick, e);
							quickpick.buttons = this.getButtons(step, commandsStep.command);
						}
					}),
					quickpick.onDidChangeValue(async e => {
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
									const step = commandsStep.command.value;
									if (step === undefined || !isQuickPickStep(step)) return;

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
							const step = commandsStep.command.value;
							if (step === undefined || !isQuickPickStep(step) || step.onValidateValue === undefined) {
								return;
							}

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

						const buttons: QuickInputButton[] = [];
						if (command.canSkipConfirm) {
							if (command.skipConfirmKey !== undefined) {
								buttons.push(
									command.confirm()
										? this.GitQuickInputButtons.WillConfirm
										: this.GitQuickInputButtons.WillSkipConfirm
								);
							}
						} else {
							buttons.push(this.GitQuickInputButtons.WillConfirmForced);
						}

						quickpick.buttons = buttons;
					}),
					quickpick.onDidAccept(async () => {
						let items = quickpick.selectedItems;
						if (items.length === 0) {
							if (!quickpick.canSelectMany || quickpick.activeItems.length === 0) {
								const value = quickpick.value.trim();
								if (value.length === 0) return;

								const step = commandsStep.command && commandsStep.command.value;
								if (step === undefined || !isQuickPickStep(step) || step.onDidAccept === undefined) {
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
			});
		} finally {
			quickpick.dispose();
			disposables.forEach(d => d.dispose());
		}
	}

	private getButtons(step: QuickInputStep | QuickPickStep | undefined, command?: QuickCommandBase) {
		if (command === undefined) return [];

		const buttons: QuickInputButton[] = [];

		if (step !== undefined) {
			if (step.buttons !== undefined) return step.buttons;

			buttons.push(QuickInputButtons.Back);

			if (step.additionalButtons !== undefined) {
				buttons.push(...step.additionalButtons);
			}
		}

		if (!command.canConfirm) return buttons;
		if (command.canSkipConfirm) {
			buttons.push(
				command.confirm() ? this.GitQuickInputButtons.WillConfirm : this.GitQuickInputButtons.WillSkipConfirm
			);
		} else {
			buttons.push(this.GitQuickInputButtons.WillConfirmForced);
		}

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
}
