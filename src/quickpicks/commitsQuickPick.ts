'use strict';
import { CancellationTokenSource, QuickPickOptions, window } from 'vscode';
import { Container } from '../container';
import { GitLog } from '../git/gitService';
import { KeyNoopCommand } from '../keyboard';
import { Iterables } from '../system';
import {
    CommandQuickPickItem,
    CommitQuickPickItem,
    getQuickPickIgnoreFocusOut,
    MessageQuickPickItem,
    showQuickPickProgress
} from './commonQuickPicks';

export class CommitsQuickPick {
    static showProgress(message: string) {
        return showQuickPickProgress(message, {
            left: KeyNoopCommand,
            ',': KeyNoopCommand,
            '.': KeyNoopCommand
        });
    }

    static async show(
        log: GitLog | undefined,
        placeHolder: string,
        progressCancellation: CancellationTokenSource,
        options: {
            goBackCommand?: CommandQuickPickItem;
            showAllCommand?: CommandQuickPickItem;
            showInResultsCommand?: CommandQuickPickItem;
        }
    ): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = ((log && [...Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))]) || [
            new MessageQuickPickItem('No results found')
        ]) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (options.showInResultsCommand !== undefined) {
            items.splice(0, 0, options.showInResultsCommand);
        }

        if (options.showAllCommand !== undefined) {
            items.splice(0, 0, options.showAllCommand);
        }

        if (options.goBackCommand !== undefined) {
            items.splice(0, 0, options.goBackCommand);
        }

        if (progressCancellation.token.isCancellationRequested) return undefined;

        const scope = await Container.keyboard.beginScope({ left: options.goBackCommand });

        progressCancellation.cancel();

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}
