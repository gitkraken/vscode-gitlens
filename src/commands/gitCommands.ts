'use strict';
import { Disposable, QuickInputButtons, QuickPickItem, window } from 'vscode';
import { command, Command, Commands } from './common';
import { log } from '../system';
import { CherryPickQuickCommand } from './quick/cherry-pick';
import { QuickCommandBase, QuickPickStep } from './quick/quickCommand';
import { FetchQuickCommand } from './quick/fetch';
import { MergeQuickCommand } from './quick/merge';
import { PushQuickCommand } from './quick/push';
import { PullQuickCommand } from './quick/pull';
import { CheckoutQuickCommand } from './quick/checkout';
import { RebaseQuickCommand } from './quick/rebase';

const sanitizeLabel = /\$\(.+?\)|\W/g;

@command()
export class GitCommandsCommand extends Command {
    constructor() {
        super(Commands.GitCommands);
    }

    @log({ args: false, correlate: true, singleLine: true, timed: false })
    async execute() {
        const commands: QuickCommandBase[] = [
            new CheckoutQuickCommand(),
            new CherryPickQuickCommand(),
            new MergeQuickCommand(),
            new FetchQuickCommand(),
            new PullQuickCommand(),
            new PushQuickCommand(),
            new RebaseQuickCommand()
        ];

        const quickpick = window.createQuickPick();
        quickpick.ignoreFocusOut = true;

        let inCommand: QuickCommandBase | undefined;

        function showCommand(command: QuickPickStep | undefined) {
            if (command === undefined) {
                const previousLabel = inCommand && inCommand.label;
                inCommand = undefined;

                quickpick.buttons = [];
                quickpick.title = 'GitLens';
                quickpick.placeholder = 'Select command...';
                quickpick.canSelectMany = false;
                quickpick.items = commands;

                if (previousLabel) {
                    const active = quickpick.items.find(i => i.label === previousLabel);
                    if (active) {
                        quickpick.activeItems = [active];
                    }
                }
            }
            else {
                quickpick.buttons = command.buttons || [QuickInputButtons.Back];
                quickpick.title = command.title;
                quickpick.placeholder = command.placeholder;
                quickpick.canSelectMany = Boolean(command.multiselect);

                quickpick.items = command.items;

                if (quickpick.canSelectMany) {
                    quickpick.selectedItems = command.selectedItems || quickpick.items.filter(i => i.picked);
                    quickpick.activeItems = quickpick.selectedItems;
                }
                else {
                    quickpick.activeItems = command.selectedItems || quickpick.items.filter(i => i.picked);
                }

                // // BUG: https://github.com/microsoft/vscode/issues/75046
                // // If we can multiselect, then ensure the selectedItems gets reset (otherwise it could end up included the current selected items)
                // if (quickpick.canSelectMany && quickpick.selectedItems.length !== 0) {
                //     quickpick.selectedItems = [];
                // }
            }
        }

        async function next(command: QuickCommandBase, items: QuickPickItem[] | undefined) {
            quickpick.busy = true;
            // quickpick.enabled = false;

            const next = await command.next(items);
            if (next.done) {
                return false;
            }

            quickpick.value = '';
            showCommand(next.value);

            // quickpick.enabled = true;
            quickpick.busy = false;

            return true;
        }

        showCommand(undefined);

        const disposables: Disposable[] = [];

        try {
            void (await new Promise<void>(resolve => {
                disposables.push(
                    quickpick.onDidHide(() => resolve()),
                    quickpick.onDidTriggerButton(async e => {
                        if (e === QuickInputButtons.Back) {
                            quickpick.value = '';
                            if (inCommand !== undefined) {
                                showCommand(await inCommand.previous());
                            }

                            return;
                        }

                        const step = inCommand && inCommand.value;
                        if (step === undefined || step.onDidClickButton === undefined) return;

                        step.onDidClickButton(quickpick, e);
                    }),
                    quickpick.onDidChangeValue(async e => {
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

                            const cmd = quickpick.value.toLowerCase().trim();

                            let items;
                            if (inCommand === undefined) {
                                const command = commands.find(
                                    c => c.label.replace(sanitizeLabel, '').toLowerCase() === cmd
                                );
                                if (command === undefined) return;

                                inCommand = command;
                            }
                            else {
                                const step = inCommand.value;
                                if (step === undefined) return;

                                const item = step.items.find(
                                    i => i.label.replace(sanitizeLabel, '').toLowerCase() === cmd
                                );
                                if (item === undefined) return;

                                items = [item];
                            }

                            if (!(await next(inCommand, items))) {
                                resolve();
                            }
                        }
                    }),
                    quickpick.onDidAccept(async () => {
                        let items = quickpick.selectedItems;
                        if (items.length === 0) {
                            if (!quickpick.canSelectMany || quickpick.activeItems.length === 0) return;

                            items = quickpick.activeItems;
                        }

                        if (inCommand === undefined) {
                            const command = items[0];
                            if (!QuickCommandBase.is(command)) return;

                            inCommand = command;
                        }

                        if (!(await next(inCommand, items as QuickPickItem[]))) {
                            resolve();
                        }
                    })
                );

                quickpick.show();
            }));

            quickpick.hide();
        }
        finally {
            quickpick.dispose();
            disposables.forEach(d => d.dispose());
        }
    }
}
