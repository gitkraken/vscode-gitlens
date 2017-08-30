'use strict';
import { Arrays, Iterables, Strings } from '../system';
import { commands, QuickPickOptions, TextDocumentShowOptions, Uri, window } from 'vscode';
import { Commands, CopyMessageToClipboardCommandArgs, CopyShaToClipboardCommandArgs, DiffDirectoryCommandCommandArgs, DiffWithPreviousCommandArgs, ShowQuickCommitDetailsCommandArgs, StashApplyCommandArgs, StashDeleteCommandArgs } from '../commands';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, KeyCommandQuickPickItem, OpenFileCommandQuickPickItem, OpenFilesCommandQuickPickItem, QuickPickItem } from './common';
import { GlyphChars } from '../constants';
import { getGitStatusOcticon, GitCommit, GitLog, GitLogCommit, GitService, GitStashCommit, GitStatusFile, GitStatusFileStatus, GitUri, IGitCommitInfo, IGitStatusFile, RemoteResource } from '../gitService';
import { Keyboard, KeyCommand, KeyNoopCommand, Keys } from '../keyboard';
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
        const octicon = getGitStatusOcticon(status.status);
        const description = GitStatusFile.getFormattedDirectory(status, true);

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
            label: `${Strings.pad(octicon, 4, 2)} ${path.basename(status.fileName)}`,
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

    constructor(commit: GitLogCommit, versioned: boolean = false, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = commit.fileStatuses
            .filter(s => s.status !== 'D')
            .map(s => GitUri.fromFileStatus(s, repoPath));

        super(uris, item || {
            label: `$(file-symlink-file) Open Changed Files`,
            description: ''
            // detail: `Opens all of the changed file in the working tree`
        });
    }
}

export class OpenCommitFileRevisionsCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, item?: QuickPickItem) {
        const uris = commit.fileStatuses
            .filter(s => s.status !== 'D')
            .map(s => GitService.toGitContentUri(commit.sha, commit.shortSha, s.fileName, commit.repoPath, s.originalFileName));

        super(uris, item || {
            label: `$(file-symlink-file) Open Changed Revisions`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} in ${GlyphChars.Space}$(git-commit) ${commit.shortSha}`
            // detail: `Opens all of the changed files in $(git-commit) ${commit.shortSha}`
        });
    }
}

export class CommitDetailsQuickPick {

    static async show(git: GitService, commit: GitLogCommit, uri: Uri, goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem, repoLog?: GitLog): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
        const items: (CommitWithFileStatusQuickPickItem | CommandQuickPickItem)[] = commit.fileStatuses.map(fs => new CommitWithFileStatusQuickPickItem(commit, fs));

        const stash = commit.type === 'stash';

        let index = 0;

        if (stash) {
            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(git-pull-request) Apply Stashed Changes`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.message}`
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
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.message}`
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
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.shortSha}`
            }, Commands.CopyShaToClipboard, [
                    uri,
                    {
                        sha: commit.sha
                    } as CopyShaToClipboardCommandArgs
                ]));
        }

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Message to Clipboard`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.message}`
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
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.previousShortSha || `${commit.shortSha}^`} ${GlyphChars.Space} $(git-compare) ${GlyphChars.Space} $(git-commit) ${commit.shortSha}`
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
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.shortSha} ${GlyphChars.Space} $(git-compare) ${GlyphChars.Space} $(file-directory) Working Tree`
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
            items.push(new OpenCommitFileRevisionsCommandQuickPickItem(commit));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        let previousCommand: KeyCommand | (() => Promise<KeyCommand>) | undefined = undefined;
        let nextCommand: KeyCommand | (() => Promise<KeyCommand>) | undefined = undefined;
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
            placeHolder: `${commit.shortSha} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.author ? `${commit.author}, ` : ''}${moment(commit.date).fromNow()} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.message}`,
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