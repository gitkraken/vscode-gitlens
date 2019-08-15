'use strict';
import { Disposable, InputBox, QuickInputButtons, QuickPick, QuickPickItem, window } from 'vscode';
import { command, Command, Commands } from './common';
import { log } from '../system';
import { isQuickInputStep, isQuickPickStep, QuickCommandBase, QuickInputStep, QuickPickStep } from './quickCommand';
import { Directive, DirectiveQuickPickItem } from '../quickpicks';
import { CommandArgs as CheckoutCommandArgs, CheckoutGitCommand } from './git/checkout';
import { CherryPickGitCommand } from './git/cherry-pick';
import { CommandArgs as FetchCommandArgs, FetchGitCommand } from './git/fetch';
import { MergeGitCommand } from './git/merge';
import { CommandArgs as PullCommandArgs, PullGitCommand } from './git/pull';
import { CommandArgs as PushCommandArgs, PushGitCommand } from './git/push';
import { RebaseGitCommand } from './git/rebase';
import { CommandArgs as StashCommandArgs, StashGitCommand } from './git/stash';

const sanitizeLabel = /\$\(.+?\)|\W/g;

export type GitCommandsCommandArgs =
    | CheckoutCommandArgs
    | FetchCommandArgs
    | PullCommandArgs
    | PushCommandArgs
    | StashCommandArgs;

class PickCommandStep implements QuickPickStep {
    readonly buttons = [];
    readonly items: QuickCommandBase[];
    readonly placeholder = 'Choose a git command';
    readonly title = 'GitLens';

    constructor(args?: GitCommandsCommandArgs) {
        this.items = [
            new CheckoutGitCommand(args && args.command === 'checkout' ? args : undefined),
            new CherryPickGitCommand(),
            new MergeGitCommand(),
            new FetchGitCommand(args && args.command === 'fetch' ? args : undefined),
            new PullGitCommand(args && args.command === 'pull' ? args : undefined),
            new PushGitCommand(args && args.command === 'push' ? args : undefined),
            new RebaseGitCommand(),
            new StashGitCommand(args && args.command === 'stash' ? args : undefined)
        ];
    }

    private _active: QuickCommandBase | undefined;
    get command(): QuickCommandBase | undefined {
        return this._active;
    }
    set command(value: QuickCommandBase | undefined) {
        if (this._active !== undefined) {
            this._active.picked = false;
        }

        this._active = value;

        if (this._active !== undefined) {
            this._active.picked = true;
        }
    }

    find(commandName: string) {
        const cmd = commandName.toLowerCase();
        return this.items.find(c => c.label.replace(sanitizeLabel, '').toLowerCase() === cmd);
    }
}

@command()
export class GitCommandsCommand extends Command {
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
                commandsStep.command = command;

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
        input.ignoreFocusOut = true;

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

                        const step = commandsStep.command && commandsStep.command.value;
                        if (step === undefined || !isQuickInputStep(step) || step.onDidClickButton === undefined)
                            return;

                        step.onDidClickButton(input, e);
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

                input.buttons = step.buttons || [QuickInputButtons.Back];
                input.title = step.title;
                input.placeholder = step.placeholder;
                if (step.value !== undefined) {
                    input.value = step.value;
                }

                // If we are starting over clear the previously active command
                if (commandsStep.command !== undefined && step === commandsStep) {
                    commandsStep.command = undefined;
                }

                input.show();
            });
        }
        finally {
            input.dispose();
            disposables.forEach(d => d.dispose());
        }
    }

    private async showPickStep(step: QuickPickStep, commandsStep: PickCommandStep) {
        const quickpick = window.createQuickPick();
        quickpick.ignoreFocusOut = true;

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

                        const step = commandsStep.command && commandsStep.command.value;
                        if (step === undefined || !isQuickPickStep(step) || step.onDidClickButton === undefined) return;

                        step.onDidClickButton(quickpick, e);
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
                                    const command = commandsStep.find(quickpick.value.trim());
                                    if (command === undefined) return;

                                    commandsStep.command = command;
                                }
                                else {
                                    const step = commandsStep.command.value;
                                    if (step === undefined || !isQuickPickStep(step)) return;

                                    const cmd = quickpick.value.trim().toLowerCase();
                                    const item = step.items.find(
                                        i => i.label.replace(sanitizeLabel, '').toLowerCase() === cmd
                                    );
                                    if (item === undefined) return;

                                    items = [item];
                                }

                                resolve(await this.nextStep(quickpick, commandsStep.command, items));

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
                        }
                        else {
                            overrideItems = false;
                        }

                        // If we are no longer overriding the items, put them back (only if we need to)
                        if (!overrideItems && quickpick.items.length !== step.items.length) {
                            quickpick.items = step.items;
                        }
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

                            commandsStep.command = command;
                        }

                        resolve(await this.nextStep(quickpick, commandsStep.command, items as QuickPickItem[]));
                    })
                );

                quickpick.buttons = step.buttons || [QuickInputButtons.Back];
                quickpick.title = step.title;
                quickpick.placeholder = step.placeholder;
                quickpick.matchOnDescription = Boolean(step.matchOnDescription);
                quickpick.matchOnDetail = Boolean(step.matchOnDetail);
                quickpick.canSelectMany = Boolean(step.multiselect);

                quickpick.items = step.items;

                if (quickpick.canSelectMany) {
                    quickpick.selectedItems = step.selectedItems || quickpick.items.filter(i => i.picked);
                    quickpick.activeItems = quickpick.selectedItems;
                }
                else {
                    quickpick.activeItems = step.selectedItems || quickpick.items.filter(i => i.picked);
                }

                // If we are starting over clear the previously active command
                if (commandsStep.command !== undefined && step === commandsStep) {
                    commandsStep.command = undefined;
                }

                if (step.value !== undefined) {
                    quickpick.value = step.value;
                }

                quickpick.show();
            });
        }
        finally {
            quickpick.dispose();
            disposables.forEach(d => d.dispose());
        }
    }

    private async nextStep(
        quickInput: QuickPick<QuickPickItem> | InputBox,
        command: QuickCommandBase,
        value: QuickPickItem[] | string | undefined
    ) {
        quickInput.busy = true;
        // quickInput.enabled = false;

        const next = await command.next(value);
        if (next.done) return undefined;

        quickInput.value = '';
        return next.value;
    }
}
