'use strict';
import { Iterables } from '../system';
import { CancellationTokenSource, QuickPickOptions, window } from 'vscode';
import { Container } from '../container';
import { GitLog } from '../gitService';
import { KeyNoopCommand } from '../keyboard';
import {
    CommandQuickPickItem,
    CommitQuickPickItem,
    getQuickPickIgnoreFocusOut,
    MessageQuickPickItem,
    showQuickPickProgress
} from '../quickPicks/quickPicks';

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
            showInResultsExplorerCommand?: CommandQuickPickItem;
        }
    ): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = ((log && [...Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))]) || [
            new MessageQuickPickItem('No results found')
        ]) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (options.showInResultsExplorerCommand !== undefined) {
            items.splice(0, 0, options.showInResultsExplorerCommand);
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
