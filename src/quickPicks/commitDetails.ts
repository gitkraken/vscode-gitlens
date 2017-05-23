'use strict';
import { Arrays, Iterables } from '../system';
import { commands, QuickPickOptions, TextDocumentShowOptions, Uri, window } from 'vscode';
import { Commands, CopyMessageToClipboardCommandArgs, CopyShaToClipboardCommandArgs, DiffDirectoryCommandCommandArgs, DiffWithPreviousCommandArgs, Keyboard, KeyNoopCommand, Keys, ShowQuickCommitDetailsCommandArgs, StashApplyCommandArgs, StashDeleteCommandArgs } from '../commands';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, KeyCommandQuickPickItem, OpenFileCommandQuickPickItem, OpenFilesCommandQuickPickItem, QuickPickItem } from './common';
import { getGitStatusIcon, GitCommit, GitLogCommit, GitService, GitStashCommit, GitStatusFileStatus, GitUri, IGitCommitInfo, IGitLog, IGitStatusFile, RemoteResource } from '../gitService';
import { OpenRemotesCommandQuickPickItem } from './remotes';
import * as moment from 'moment';
import * as path from 'path';

export class CommitWithFileStatusQuickPickItem extends OpenFileCommandQuickPickItem {

    private commit: GitCommit;
    fileName: string;
    gitUri: GitUri;
    sha: string;
    shortSha: string;
    status: GitStatusFileStatus;

    constructor(commit: GitCommit, status: IGitStatusFile) {
        const icon = getGitStatusIcon(status.status);

        let directory: string | undefined = GitService.normalizePath(path.dirname(status.fileName));
        if (!directory || directory === '.') {
            directory = '';
        }

        const description = (status.status === 'R' && status.originalFileName)
            ? `${directory} \u00a0\u2190\u00a0 ${status.originalFileName}`
            : directory;

        let sha;
        let shortSha;
        if (status.status === 'D') {
            sha = commit.previousSha!;
            shortSha = commit.previousShortSha!;
        }
        else {
            sha = commit.sha;
            shortSha = commit.shortSha;
        }

        super(GitService.toGitContentUri(sha, shortSha, status.fileName, commit.repoPath, status.originalFileName), {
            label: `\u00a0\u00a0\u00a0\u00a0${icon}\u00a0\u00a0 ${path.basename(status.fileName)}`,
            description: description
        });

        this.commit = commit;
        this.fileName = status.fileName;
        this.gitUri = GitUri.fromFileStatus(status, {
            fileName: status.fileName,
            repoPath: commit.repoPath,
            sha: commit.sha,
            originalFileName: status.originalFileName
        } as IGitCommitInfo);
        this.sha = sha;
        this.shortSha = shortSha;
        this.status = status.status;
    }

    onDidPressKey(key: Keys): Promise<{} | undefined> {
        if (this.commit.previousSha === undefined) return super.onDidPressKey(key);

        return commands.executeCommand(Commands.DiffWithPrevious,
            this.gitUri,
            {
                commit: this.commit,
                showOptions: {
                    preserveFocus: true,
                    preview: false
                } as TextDocumentShowOptions
            } as DiffWithPreviousCommandArgs) as Promise<{} | undefined>;
    }
}

export class OpenCommitFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, item?: QuickPickItem) {
        const uris = commit.fileStatuses.map(s => (s.status === 'D')
            ? GitService.toGitContentUri(commit.previousSha!, commit.previousShortSha!, s.fileName, commit.repoPath, s.originalFileName)
            : GitService.toGitContentUri(commit.sha, commit.shortSha, s.fileName, commit.repoPath, s.originalFileName));

        super(uris, item || {
            label: `$(file-symlink-file) Open Changed Files`,
            description: `\u00a0 \u2014 \u00a0\u00a0 in \u00a0$(git-commit) ${commit.shortSha}`
            // detail: `Opens all of the changed files in $(git-commit) ${commit.shortSha}`
        });
    }
}

export class OpenCommitWorkingTreeFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, versioned: boolean = false, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = commit.fileStatuses.filter(_ => _.status !== 'D').map(_ => GitUri.fromFileStatus(_, repoPath));
        super(uris, item || {
            label: `$(file-symlink-file) Open Changed Working Files`,
            description: ''
            // detail: `Opens all of the changed file in the working tree`
        });
    }
}

export class CommitDetailsQuickPick {

    static async show(git: GitService, commit: GitLogCommit, uri: Uri, goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem, repoLog?: IGitLog): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
        const items: (CommitWithFileStatusQuickPickItem | CommandQuickPickItem)[] = commit.fileStatuses.map(fs => new CommitWithFileStatusQuickPickItem(commit, fs));

        const stash = commit.type === 'stash';

        let index = 0;

        if (stash && git.config.insiders) {
            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(git-pull-request) Apply Stashed Changes`,
                description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.message}`
            }, Commands.StashApply, [
                    {
                        confirm: true,
                        deleteAfter: false,
                        stashItem: commit as GitStashCommit,
                        goBackCommand: currentCommand
                    } as StashApplyCommandArgs
                ]));

            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(x) Delete Stashed Changes`,
                description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.message}`
            }, Commands.StashDelete, [
                    {
                        confirm: true,
                        stashItem: commit as GitStashCommit,
                        goBackCommand: currentCommand
                    } as StashDeleteCommandArgs
                ]));
        }

        if (!stash) {
            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(clippy) Copy Commit ID to Clipboard`,
                description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.shortSha}`
            }, Commands.CopyShaToClipboard, [
                    uri,
                    {
                        sha: commit.sha
                    } as CopyShaToClipboardCommandArgs
                ]));
        }

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Message to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.message}`
        }, Commands.CopyMessageToClipboard, [
                uri,
                {
                    message: commit.message,
                    sha: commit.sha
                } as CopyMessageToClipboardCommandArgs
            ]));

        if (!stash) {
            const remotes = Arrays.uniqueBy(await git.getRemotes(commit.repoPath), _ => _.url, _ => !!_.provider);
            if (remotes.length) {
                items.splice(index++, 0, new OpenRemotesCommandQuickPickItem(remotes, {
                    type: 'commit',
                    sha: commit.sha
                } as RemoteResource, currentCommand));
            }

            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(git-compare) Directory Compare with Previous Commit`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.previousShortSha || `${commit.shortSha}^`} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.shortSha}`
            }, Commands.DiffDirectory, [
                    commit.uri,
                    {
                        shaOrBranch1: commit.previousSha || `${commit.sha}^`,
                        shaOrBranch2: commit.sha
                    } as DiffDirectoryCommandCommandArgs
                ]));
        }

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(git-compare) Directory Compare with Working Tree`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.shortSha} \u00a0 $(git-compare) \u00a0 $(file-directory) Working Tree`
        }, Commands.DiffDirectory, [
                uri,
                {
                    shaOrBranch1: commit.sha
                } as DiffDirectoryCommandCommandArgs
            ]));

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `Changed Files`,
            description: commit.getDiffStatus()
        }, Commands.ShowQuickCommitDetails, [
                uri,
                {
                    commit,
                    repoLog,
                    sha: commit.sha,
                    goBackCommand
                } as ShowQuickCommitDetailsCommandArgs
            ]));

        items.push(new OpenCommitFilesCommandQuickPickItem(commit));
        items.push(new OpenCommitWorkingTreeFilesCommandQuickPickItem(commit));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        let previousCommand: CommandQuickPickItem | (() => Promise<CommandQuickPickItem>) | undefined = undefined;
        let nextCommand: CommandQuickPickItem | (() => Promise<CommandQuickPickItem>) | undefined = undefined;
        if (!stash) {
            // If we have the full history, we are good
            if (repoLog !== undefined && !repoLog.truncated && repoLog.sha === undefined) {
                previousCommand = commit.previousSha === undefined
                    ? undefined
                    : new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                        commit.previousUri,
                        {
                            repoLog,
                            sha: commit.previousSha,
                            goBackCommand
                        } as ShowQuickCommitDetailsCommandArgs
                    ]);

                nextCommand = commit.nextSha === undefined
                    ? undefined
                    : new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                        commit.nextUri,
                        {
                            repoLog,
                            sha: commit.nextSha,
                            goBackCommand
                        } as ShowQuickCommitDetailsCommandArgs
                    ]);
            }
            else {
                previousCommand = async () => {
                    let log = repoLog;
                    let c = log && log.commits.get(commit.sha);

                    // If we can't find the commit or the previous commit isn't available (since it isn't trustworthy)
                    if (c === undefined || c.previousSha === undefined) {
                        log = await git.getLogForRepo(commit.repoPath, commit.sha, git.config.advanced.maxQuickHistory);
                        c = log && log.commits.get(commit.sha);

                        if (c) {
                            // Copy over next info, since it is trustworthy at this point
                            c.nextSha = commit.nextSha;
                        }
                    }

                    if (c === undefined || c.previousSha === undefined) return KeyNoopCommand;

                    return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                        c.previousUri,
                        {
                            repoLog: log,
                            sha: c.previousSha,
                            goBackCommand
                        } as ShowQuickCommitDetailsCommandArgs
                    ]);
                };

                nextCommand = async () => {
                    let log = repoLog;
                    let c = log && log.commits.get(commit.sha);

                    // If we can't find the commit or the next commit isn't available (since it isn't trustworthy)
                    if (c === undefined || c.nextSha === undefined) {
                        log = undefined;
                        c = undefined;

                        // Try to find the next commit
                        const nextLog = await git.getLogForRepo(commit.repoPath, commit.sha, 1, true);
                        const next = nextLog && Iterables.first(nextLog.commits.values());
                        if (next !== undefined && next.sha !== commit.sha) {
                            c = commit;
                            c.nextSha = next.sha;
                        }
                    }

                    if (c === undefined || c.nextSha === undefined) return KeyNoopCommand;

                    return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                        c.nextUri,
                        {
                            repoLog: log,
                            sha: c.nextSha,
                            goBackCommand
                        } as ShowQuickCommitDetailsCommandArgs
                    ]);
                };
            }
        }

        const scope = await Keyboard.instance.beginScope({
            left: goBackCommand,
            ',': previousCommand,
            '.': nextCommand
        });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.shortSha} \u00a0\u2022\u00a0 ${commit.author ? `${commit.author}, ` : ''}${moment(commit.date).fromNow()} \u00a0\u2022\u00a0 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                scope.setKeyCommand('right', item);
                if (typeof item.onDidSelect === 'function') {
                    item.onDidSelect();
                }
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}