'use strict';
import { Arrays, Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard, KeyNoopCommand } from '../commands';
import { GitCommit, GitLogCommit, GitService, GitUri, IGitLog } from '../gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, KeyCommandQuickPickItem, OpenFileCommandQuickPickItem, OpenRemotesCommandQuickPickItem } from '../quickPicks';
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

    static async show(git: GitService, commit: GitLogCommit, uri: Uri, goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem, fileLog?: IGitLog): Promise<CommandQuickPickItem | undefined> {
        const items: CommandQuickPickItem[] = [];

        const workingName = (commit.workingFileName && path.basename(commit.workingFileName)) || path.basename(commit.fileName);

        const isUncommitted = commit.isUncommitted;
        if (isUncommitted) {
            // Since we can't trust the previous sha on an uncommitted commit, find the last commit for this file
            commit = await git.getLogCommit(undefined, commit.uri.fsPath, { previous: true });
            if (!commit) return undefined;
        }

        items.push(new CommandQuickPickItem({
            label: `$(git-commit) Show Commit Details`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.shortSha}`
        }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), commit.sha, commit, currentCommand]));

        if (commit.previousSha) {
            items.push(new CommandQuickPickItem({
                label: `$(git-compare) Compare with Previous Commit`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.previousShortSha} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.shortSha}`
            }, Commands.DiffWithPrevious, [commit.uri, commit]));
        }

        if (commit.workingFileName) {
            items.push(new CommandQuickPickItem({
                label: `$(git-compare) Compare with Working Tree`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.shortSha} \u00a0 $(git-compare) \u00a0 $(file-text) ${workingName}`
            }, Commands.DiffWithWorking, [Uri.file(path.resolve(commit.repoPath, commit.workingFileName)), commit]));
        }

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Sha to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.shortSha}`
        }, Commands.CopyShaToClipboard, [uri, commit.sha]));

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Message to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.message}`
        }, Commands.CopyMessageToClipboard, [uri, commit.sha, commit.message]));

        items.push(new OpenCommitFileCommandQuickPickItem(commit));
        if (commit.workingFileName) {
            items.push(new OpenCommitWorkingTreeFileCommandQuickPickItem(commit));
        }

        const remotes = Arrays.uniqueBy(await git.getRemotes(git.repoPath), _ => _.url, _ => !!_.provider);
        if (remotes.length) {
            items.push(new OpenRemotesCommandQuickPickItem(remotes, 'file', commit.fileName, undefined, commit.sha, currentCommand));
            if (commit.workingFileName) {
                const branch = await git.getBranch(commit.repoPath || git.repoPath);
                items.push(new OpenRemotesCommandQuickPickItem(remotes, 'working-file', commit.workingFileName, branch.name, undefined, currentCommand));
            }
        }

        if (commit.workingFileName) {
            items.push(new CommandQuickPickItem({
                label: `$(history) Show File History`,
                description: `\u00a0 \u2014 \u00a0\u00a0 of ${path.basename(commit.fileName)}`
            }, Commands.ShowQuickFileHistory, [Uri.file(path.resolve(commit.repoPath, commit.workingFileName)), undefined, undefined, currentCommand, fileLog]));
        }

        items.push(new CommandQuickPickItem({
            label: `$(history) Show ${commit.workingFileName ? 'Previous ' : ''}File History`,
            description: `\u00a0 \u2014 \u00a0\u00a0 of ${path.basename(commit.fileName)} \u00a0\u2022\u00a0 from \u00a0$(git-commit) ${commit.shortSha}`
        }, Commands.ShowQuickFileHistory, [new GitUri(commit.uri, commit), undefined, undefined, currentCommand]));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        let previousCommand: CommandQuickPickItem | (() => Promise<CommandQuickPickItem>);
        let nextCommand: CommandQuickPickItem | (() => Promise<CommandQuickPickItem>);
        // If we have the full history, we are good
        if (fileLog && !fileLog.truncated) {
            previousCommand = commit.previousSha && new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [commit.previousUri, commit.previousSha, undefined, goBackCommand, fileLog]);
            nextCommand = commit.nextSha && new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [commit.nextUri, commit.nextSha, undefined, goBackCommand, fileLog]);
        }
        else {
            previousCommand = async () => {
                let log = fileLog;
                let c = log && log.commits.get(commit.sha);

                // If we can't find the commit or the previous commit isn't available (since it isn't trustworthy)
                if (!c || !c.previousSha) {
                    log = await git.getLogForFile(commit.repoPath, uri.fsPath, commit.sha, undefined, git.config.advanced.maxQuickHistory);
                    c = log && log.commits.get(commit.sha);

                    if (c) {
                        // Copy over next info, since it is trustworthy at this point
                        c.nextSha = commit.nextSha;
                        c.nextFileName = commit.nextFileName;
                    }
                }
                if (!c) return KeyNoopCommand;
                return new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [c.previousUri, c.previousSha, undefined, goBackCommand, log]);
            };

            nextCommand = async () => {
                let log = fileLog;
                let c = log && log.commits.get(commit.sha);

                // If we can't find the commit or the next commit isn't available (since it isn't trustworthy)
                if (!c || !c.nextSha) {
                    log = undefined;
                    c = undefined;

                    // Try to find the next commit
                    const nextLog = await git.getLogForFile(commit.repoPath, uri.fsPath, commit.sha, undefined, 1, true, true);
                    const next = nextLog && Iterables.first(nextLog.commits.values());
                    if (next && next.sha !== commit.sha) {
                        c = commit;
                        c.nextSha = next.sha;
                        c.nextFileName = next.originalFileName || next.fileName;
                    }
                }
                if (!c) return KeyNoopCommand;
                return new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [c.nextUri, c.nextSha, undefined, goBackCommand, log]);
            };
        }

        const scope = await Keyboard.instance.beginScope({
            left: goBackCommand,
            ',': previousCommand,
            '.': nextCommand
        });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: `${commit.getFormattedPath()} \u00a0\u2022\u00a0 ${isUncommitted ? 'Uncommitted \u21E8 ' : '' }${commit.shortSha} \u00a0\u2022\u00a0 ${commit.author}, ${moment(commit.date).fromNow()} \u00a0\u2022\u00a0 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                scope.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}