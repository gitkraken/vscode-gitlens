'use strict';
import { Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard, KeyNoopCommand } from '../commands';
import { GitCommit, GitLogCommit, GitService, GitUri, IGitLog } from '../gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, KeyCommandQuickPickItem, OpenFileCommandQuickPickItem } from './quickPicks';
import * as moment from 'moment';
import * as path from 'path';

export class OpenCommitFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(commit: GitCommit, item?: QuickPickItem) {
        const uri = GitService.toGitContentUri(commit);
        super(uri, item || {
            label: `$(file-symlink-file) Open File`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${path.basename(commit.fileName)} in \u00a0$(git-commit) ${commit.shortSha}`
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

    static async show(git: GitService, commit: GitLogCommit, workingFileName: string, uri: Uri, goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem, options: { showFileHistory?: boolean } = {}, fileLog?: IGitLog): Promise<CommandQuickPickItem | undefined> {
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
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.shortSha}`
            }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), commit.sha, commit, currentCommand]));
        }

        if (commit.previousSha) {
            items.push(new CommandQuickPickItem({
                label: `$(git-compare) Compare with Previous Commit`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.previousShortSha} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.shortSha}`
            }, Commands.DiffWithPrevious, [commit.uri, commit]));
        }

        items.push(new CommandQuickPickItem({
            label: `$(git-compare) Compare with Working Tree`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.shortSha} \u00a0 $(git-compare) \u00a0 $(file-text) ${workingName}`
        }, Commands.DiffWithWorking, [uri, commit]));

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Sha to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.shortSha}`
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
            }, Commands.ShowQuickFileHistory, [commit.uri, undefined, currentCommand, fileLog]));
        }

        items.push(new CommandQuickPickItem({
            label: `$(history) Show ${workingFileName && options.showFileHistory ? 'Previous ' : ''}File History`,
            description: `\u00a0 \u2014 \u00a0\u00a0 of ${path.basename(commit.fileName)} \u00a0\u2022\u00a0 starting from \u00a0$(git-commit) ${commit.shortSha}`
        }, Commands.ShowQuickFileHistory, [new GitUri(commit.uri, commit), undefined, currentCommand]));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        let previousCommand: CommandQuickPickItem | (() => Promise<CommandQuickPickItem>);
        let nextCommand: CommandQuickPickItem | (() => Promise<CommandQuickPickItem>);
        // If we have the full history, we are good
        if (fileLog && !fileLog.truncated) {
            previousCommand = commit.previousSha && new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [commit.previousUri, commit.previousSha, undefined, goBackCommand, options, fileLog]);
            nextCommand = commit.nextSha && new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [commit.nextUri, commit.nextSha, undefined, goBackCommand, options, fileLog]);
        }
        else {
            previousCommand = async () => {
                let log = fileLog;
                let c = log && log.commits.get(commit.sha);

                // If we can't find the commit or the previous commit isn't available (since it isn't trustworthy)
                if (!c || !c.previousSha) {
                    log = await git.getLogForFile(uri.fsPath, commit.sha, commit.repoPath, undefined, git.config.advanced.maxQuickHistory);
                    c = log && log.commits.get(commit.sha);

                    if (c) {
                        // Copy over next info, since it is trustworthy at this point
                        c.nextSha = commit.nextSha;
                        c.nextFileName = commit.nextFileName;
                    }
                }
                if (!c) return KeyNoopCommand;
                return new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [c.previousUri, c.previousSha, undefined, goBackCommand, options, log]);
            };

            nextCommand = async () => {
                let log = fileLog;
                let c = log && log.commits.get(commit.sha);

                // If we can't find the commit or the next commit isn't available (since it isn't trustworthy)
                if (!c || !c.nextSha) {
                    log = undefined;
                    c = undefined;

                    // Try to find the next commit
                    const nextLog = await git.getLogForFile(uri.fsPath, commit.sha, commit.repoPath, undefined, 1, true);
                    const next = nextLog && Iterables.first(nextLog.commits.values());
                    if (next && next.sha !== commit.sha) {
                        c = commit;
                        c.nextSha = next.sha;
                        c.nextFileName = next.originalFileName || next.fileName;
                    }
                }
                if (!c) return KeyNoopCommand;
                return new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [c.nextUri, c.nextSha, undefined, goBackCommand, options, log]);
            };
        }

        const scope = await Keyboard.instance.beginScope({
            left: goBackCommand,
            ',': previousCommand,
            '.': nextCommand
        });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: `${commit.getFormattedPath()} \u2022 ${isUncommitted ? 'Uncommitted \u21E8 ' : '' }${commit.shortSha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()} \u2022 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                scope.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}