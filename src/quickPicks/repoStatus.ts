'use strict';
import { Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { GitStatusFile, IGitStatus } from '../gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, OpenFileCommandQuickPickItem } from './quickPicks';
import * as path from 'path';

export class OpenStatusFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(status: GitStatusFile, item?: QuickPickItem) {
        const uri = Uri.file(path.resolve(status.repoPath, status.fileName));
        const icon = status.getIcon();

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

    constructor(statuses: GitStatusFile[], item?: QuickPickItem) {
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

    static async show(status: IGitStatus, goBackCommand?: CommandQuickPickItem): Promise<OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem | undefined> {
        // Sort the status by staged and then filename
        const files = status.files;
        files.sort((a, b) => (a.staged ? -1 : 1) - (b.staged ? -1 : 1) || a.fileName.localeCompare(b.fileName));

        const added = files.filter(_ => _.status === 'A' || _.status === '?');
        const deleted = files.filter(_ => _.status === 'D');
        const changed = files.filter(_ => _.status !== 'A' && _.status !== '?' && _.status !== 'D');

        const hasStaged = files.some(_ => _.staged);

        let stagedStatus = '';
        let unstagedStatus = '';
        if (hasStaged) {
            const stagedAdded = added.filter(_ => _.staged).length;
            const stagedChanged = changed.filter(_ => _.staged).length;
            const stagedDeleted = deleted.filter(_ => _.staged).length;

            stagedStatus = `+${stagedAdded} ~${stagedChanged} -${stagedDeleted}`;
            unstagedStatus = `+${added.length - stagedAdded} ~${changed.length - stagedChanged} -${deleted.length - stagedDeleted}`;
        }
        else {
            unstagedStatus = `+${added.length} ~${changed.length} -${deleted.length}`;
        }

        const items = Array.from(Iterables.map(files, s => new OpenStatusFileCommandQuickPickItem(s))) as (OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem)[];

        if (hasStaged) {
            let index = 0;
            const unstagedIndex = files.findIndex(_ => !_.staged);
            if (unstagedIndex > -1) {
                items.splice(unstagedIndex, 0, new CommandQuickPickItem({
                    label: `Unstaged Files`,
                    description: unstagedStatus
                }, Commands.ShowQuickRepoStatus, [goBackCommand]));

                items.splice(unstagedIndex, 0, new OpenStatusFilesCommandQuickPickItem(files.filter(_ => _.status !== 'D' && _.staged), {
                    label: `\u00a0\u00a0\u00a0\u00a0 $(file-symlink-file) Open Staged Files`,
                    description: undefined
                }));

                items.push(new OpenStatusFilesCommandQuickPickItem(files.filter(_ => _.status !== 'D' && !_.staged), {
                    label: `\u00a0\u00a0\u00a0\u00a0 $(file-symlink-file) Open Unstaged Files`,
                    description: undefined
                }));
            }

            items.splice(index++, 0, new CommandQuickPickItem({
                label: `Staged Files`,
                description: stagedStatus
            }, Commands.ShowQuickRepoStatus, [goBackCommand]));
        }
        else if (files.some(_ => !_.staged)) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `Unstaged Files`,
                description: unstagedStatus
            }, Commands.ShowQuickRepoStatus, [goBackCommand]));
        }

        if (files.length) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: '$(x) Close Unchanged Files',
                description: null
            }, Commands.CloseUnchangedFiles));
            items.splice(0, 0, new OpenStatusFilesCommandQuickPickItem(files.filter(_ => _.status !== 'D')));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        let syncStatus = '';
        if (status.upstream) {
            syncStatus = status.state.ahead || status.state.behind
                ? `..${status.upstream} ${status.state.behind}\u2193 ${status.state.ahead}\u2191`
                : `..${status.upstream} \u27F3`;
        }
        else {
        }

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: `${status.branch}${syncStatus}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                scope.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}