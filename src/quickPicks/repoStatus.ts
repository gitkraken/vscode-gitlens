'use strict';
import { Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { getGitStatusIcon, GitFileStatusItem } from '../gitProvider';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, OpenFileCommandQuickPickItem, OpenFilesCommandQuickPickItem } from './quickPicks';
import * as path from 'path';

export { CommandQuickPickItem };

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

export class OpenStatusFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(statuses: GitFileStatusItem[], item?: QuickPickItem) {
        const repoPath = statuses.length && statuses[0].repoPath;
        const uris = statuses.map(_ => Uri.file(path.resolve(repoPath, _.fileName)));

        super(uris, item || {
            label: `$(file-symlink-file) Open Files`,
            description: undefined,
            detail: `Opens all of the changed files in the repository`
        });
    }
}

export class RepoStatusQuickPick {

    static async show(statuses: GitFileStatusItem[], goBackCommand?: CommandQuickPickItem): Promise<OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem | undefined> {
        // Sort the status by staged and then filename
        statuses.sort((a, b) => (a.staged ? -1 : 1) - (b.staged ? -1 : 1) || a.fileName.localeCompare(b.fileName));

        const items = Array.from(Iterables.map(statuses, s => new OpenStatusFileCommandQuickPickItem(s))) as (OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem)[];

        if (statuses.some(_ => _.staged)) {
            const index = statuses.findIndex(_ => !_.staged);
            if (index > -1) {
                items.splice(index, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== 'D' && !_.staged), {
                    label: `$(file-symlink-file) Open Unstaged Files`,
                    description: undefined,
                    detail: `Opens all of the unstaged files in the repository`
                }));

                items.splice(0, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== 'D' && _.staged), {
                    label: `$(file-symlink-file) Open Staged Files`,
                    description: undefined,
                    detail: `Opens all of the staged files in the repository`
                }));
            }
        }

        if (statuses.length) {
            items.splice(0, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== 'D')));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        return await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: statuses.length ? 'Repository has changes' : 'Repository has no changes',
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);
    }
}