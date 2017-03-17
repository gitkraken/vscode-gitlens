'use strict';
import { Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { getGitStatusIcon, GitFileStatusItem } from '../gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, OpenFileCommandQuickPickItem } from './quickPicks';
import * as path from 'path';

export class OpenStatusFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(status: GitFileStatusItem, item?: QuickPickItem) {
        const uri = Uri.file(path.resolve(status.repoPath, status.fileName));
        const icon = getGitStatusIcon(status.status);

        let directory = path.dirname(status.fileName);
        if (!directory || directory === '.') {
            directory = undefined;
        }

        super(uri, item || {
            label: `${status.staged ? '$(check)' : '\u00a0\u00a0\u00a0'}\u00a0\u00a0${icon}\u00a0\u00a0\u00a0${path.basename(status.fileName)}`,
            description: directory
        });
    }
}

export class OpenStatusFilesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(statuses: GitFileStatusItem[], item?: QuickPickItem) {
        const repoPath = statuses.length && statuses[0].repoPath;
        const uris = statuses.map(_ => Uri.file(path.resolve(repoPath, _.fileName)));

        super(item || {
            label: `$(file-symlink-file) Open Changed Files`,
            description: undefined
            //detail: `Opens all of the changed files in the repository`
        }, Commands.OpenChangedFiles, [undefined, uris]);
    }
}

export class RepoStatusQuickPick {

    static async show(statuses: GitFileStatusItem[], goBackCommand?: CommandQuickPickItem): Promise<OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem | undefined> {
        // Sort the status by staged and then filename
        statuses.sort((a, b) => (a.staged ? -1 : 1) - (b.staged ? -1 : 1) || a.fileName.localeCompare(b.fileName));

        const items = Array.from(Iterables.map(statuses, s => new OpenStatusFileCommandQuickPickItem(s))) as (OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem)[];

        if (statuses.some(_ => _.staged)) {
            let index = 0;
            const unstagedIndex = statuses.findIndex(_ => !_.staged);
            if (unstagedIndex > -1) {
                items.splice(unstagedIndex, 0, new CommandQuickPickItem({
                    label: `Unstaged Files`,
                    description: undefined
                }, Commands.ShowQuickRepoStatus, [goBackCommand]));

                items.splice(index++, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== 'D' && _.staged), {
                    label: `$(file-symlink-file) Open Staged Files`,
                    description: undefined
                }));

                items.splice(index++, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== 'D' && !_.staged), {
                    label: `$(file-symlink-file) Open Unstaged Files`,
                    description: undefined
                }));
            }

            items.splice(index++, 0, new CommandQuickPickItem({
                label: `Staged Files`,
                description: undefined
            }, Commands.ShowQuickRepoStatus, [goBackCommand]));
        }
        else if (statuses.some(_ => !_.staged)) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `Unstaged Files`,
                description: undefined
            }, Commands.ShowQuickRepoStatus, [goBackCommand]));
        }

        if (statuses.length) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: '$(x) Close Unchanged Files',
                description: null
            }, Commands.CloseUnchangedFiles));
            items.splice(0, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== 'D')));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: statuses.length ? 'Repository has changes' : 'Repository has no changes',
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                scope.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}