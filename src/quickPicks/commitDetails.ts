'use strict';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { GitLogCommit, GitProvider } from '../gitProvider';
import { CommitWithFileStatusQuickPickItem } from './gitQuickPicks';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, OpenFilesCommandQuickPickItem } from './quickPicks';
import * as moment from 'moment';
import * as path from 'path';

export class OpenCommitFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = commit.fileStatuses.map(_ => GitProvider.toGitContentUri(commit.sha, _.fileName, repoPath, commit.originalFileName));
        super(uris, item || {
            label: `$(file-symlink-file) Open Changed Files`,
            description: `\u00a0 \u2014 \u00a0\u00a0 in \u00a0$(git-commit) ${commit.sha}`
            //detail: `Opens all of the changed files in $(git-commit) ${commit.sha}`
        });
    }
}

export class OpenCommitWorkingTreeFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, versioned: boolean = false, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = commit.fileStatuses.map(_ => Uri.file(path.resolve(repoPath, _.fileName)));
        super(uris, item || {
            label: `$(file-symlink-file) Open Changed Working Files`,
            description: undefined
            //detail: `Opens all of the changed file in the working tree`
        });
    }
}

export class CommitDetailsQuickPick {

    static async show(commit: GitLogCommit, uri: Uri, goBackCommand?: CommandQuickPickItem): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
        const items: (CommitWithFileStatusQuickPickItem | CommandQuickPickItem)[] = commit.fileStatuses.map(fs => new CommitWithFileStatusQuickPickItem(commit, fs.fileName, fs.status));

        let index = 0;

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Sha to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.sha}`
        }, Commands.CopyShaToClipboard, [uri, commit.sha]));

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Message to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.message}`
        }, Commands.CopyMessageToClipboard, [uri, commit.sha, commit.message]));

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(git-compare) Directory Compare with Previous Commit`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.previousSha || `${commit.sha}^`} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.sha}`
        }, Commands.DiffDirectory, [commit.uri, commit.previousSha || `${commit.sha}^`, commit.sha]));

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(git-compare) Directory Compare with Working Tree`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha} \u00a0 $(git-compare) \u00a0 $(file-directory) Working Tree`
        }, Commands.DiffDirectory, [uri, commit.sha]));

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `Changed Files`,
            description: null
        }, Commands.ShowQuickCommitDetails, [uri, commit.sha, commit, goBackCommand]));

        items.push(new OpenCommitFilesCommandQuickPickItem(commit));
        items.push(new OpenCommitWorkingTreeFilesCommandQuickPickItem(commit));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        await Keyboard.instance.enterScope(['left', goBackCommand]);

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()} \u2022 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                Keyboard.instance.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await Keyboard.instance.exitScope();

        return pick;
    }
}