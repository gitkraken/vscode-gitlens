'use strict';
import { Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { GitCommit, GitLogCommit, GitProvider, GitUri } from '../gitProvider';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, OpenFileCommandQuickPickItem } from './quickPicks';
import * as moment from 'moment';
import * as path from 'path';

export class OpenCommitFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(commit: GitCommit, item?: QuickPickItem) {
        const uri = GitProvider.toGitContentUri(commit);
        super(uri, item || {
            label: `$(file-symlink-file) Open File`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${path.basename(commit.fileName)} in \u00a0$(git-commit) ${commit.sha}`
        });
    }
}

export class OpenCommitWorkingTreeFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(commit: GitCommit, item?: QuickPickItem) {
        const uri = Uri.file(path.resolve(commit.repoPath, commit.fileName));
        super(uri, item || {
            label: `$(file-symlink-file) Open Working File`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${path.basename(commit.fileName)}`
        });
    }
}

export class CommitFileDetailsQuickPick {

    static async show(git: GitProvider, commit: GitCommit | GitLogCommit, workingFileName: string, uri: Uri, goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem, options: { showFileHistory?: boolean } = {}): Promise<CommandQuickPickItem | undefined> {
        const items: CommandQuickPickItem[] = [];

        const workingName = (workingFileName && path.basename(workingFileName)) || path.basename(commit.fileName);

        const isUncommitted = commit.isUncommitted;
        if (isUncommitted) {
            // Since we can't trust the previous sha on an uncommitted commit, find the last commit for this file
            const log = await git.getLogForFile(commit.uri.fsPath, undefined, undefined, undefined, 2);
            if (!log) return undefined;

            commit = Iterables.first(log.commits.values());
        }

        if (!options.showFileHistory) {
            items.push(new CommandQuickPickItem({
                label: `$(git-commit) Show Commit Details`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha}`
            }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), commit.sha, commit, currentCommand]));
        }

        if (commit.previousSha) {
            items.push(new CommandQuickPickItem({
                label: `$(git-compare) Compare with Previous Commit`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.previousSha} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.sha}`
            }, Commands.DiffWithPrevious, [commit.uri, commit]));
        }

        items.push(new CommandQuickPickItem({
            label: `$(git-compare) Compare with Working Tree`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha} \u00a0 $(git-compare) \u00a0 $(file-text) ${workingName}`
        }, Commands.DiffWithWorking, [uri, commit]));

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Sha to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.sha}`
        }, Commands.CopyShaToClipboard, [uri, commit.sha]));

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Message to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.message}`
        }, Commands.CopyMessageToClipboard, [uri, commit.sha, commit.message]));

        items.push(new OpenCommitFileCommandQuickPickItem(commit));
        items.push(new OpenCommitWorkingTreeFileCommandQuickPickItem(commit));

        if (workingFileName && options.showFileHistory) {
            items.push(new CommandQuickPickItem({
                label: `$(history) Show File History`,
                description: `\u00a0 \u2014 \u00a0\u00a0 of ${path.basename(commit.fileName)}`
            }, Commands.ShowQuickFileHistory, [commit.uri, undefined, currentCommand]));
        }

        items.push(new CommandQuickPickItem({
            label: `$(history) Show ${workingFileName && options.showFileHistory ? 'Previous ' : ''}File History`,
            description: `\u00a0 \u2014 \u00a0\u00a0 of ${path.basename(commit.fileName)} \u00a0\u2022\u00a0 starting from \u00a0$(git-commit) ${commit.sha}`
        }, Commands.ShowQuickFileHistory, [new GitUri(commit.uri, commit), undefined, currentCommand]));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        await Keyboard.instance.enterScope(['left', goBackCommand]);

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: `${commit.getFormattedPath()} \u2022 ${isUncommitted ? 'Uncommitted \u21E8 ' : '' }${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()} \u2022 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                Keyboard.instance.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await Keyboard.instance.exitScope();

        return pick;
    }
}