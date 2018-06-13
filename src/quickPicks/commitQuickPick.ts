'use strict';
import { Arrays, Iterables, Strings } from '../system';
import { commands, QuickPickOptions, TextDocumentShowOptions, Uri, window } from 'vscode';
import { Commands, CopyMessageToClipboardCommandArgs, CopyShaToClipboardCommandArgs, DiffDirectoryCommandArgs, DiffWithPreviousCommandArgs, ShowQuickCommitDetailsCommandArgs, StashApplyCommandArgs, StashDeleteCommandArgs } from '../commands';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, KeyCommandQuickPickItem, OpenFileCommandQuickPickItem, OpenFilesCommandQuickPickItem, QuickPickItem, ShowCommitInResultsQuickPickItem } from './commonQuickPicks';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { getGitStatusOcticon, GitLog, GitLogCommit, GitStashCommit, GitStatusFile, GitStatusFileStatus, GitUri, IGitStatusFile, RemoteResource } from '../gitService';
import { KeyCommand, KeyNoopCommand, Keys } from '../keyboard';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';
import * as path from 'path';

export class CommitWithFileStatusQuickPickItem extends OpenFileCommandQuickPickItem {

    readonly status: GitStatusFileStatus;

    readonly commit: GitLogCommit;

    constructor(
        commit: GitLogCommit,
        status: IGitStatusFile
    ) {
        const octicon = getGitStatusOcticon(status.status);
        const description = GitStatusFile.getFormattedDirectory(status, true);

        super(GitUri.toRevisionUri(commit.sha, status, commit.repoPath), {
            label: `${Strings.pad(octicon, 4, 2)} ${path.basename(status.fileName)}`,
            description: description
        });

        this.commit = commit.toFileCommit(status);
        this.status = status.status;
    }

    get sha(): string {
        return this.commit.sha;
    }

    onDidPressKey(key: Keys): Promise<{} | undefined> {
        if (this.commit.previousSha === undefined) return super.onDidPressKey(key);

        return commands.executeCommand(Commands.DiffWithPrevious,
            this.commit.toGitUri(),
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

    constructor(
        commit: GitLogCommit,
        versioned: boolean = false,
        item?: QuickPickItem
    ) {
        const repoPath = commit.repoPath;
        const uris = Arrays.filterMap(commit.fileStatuses,
            f => GitUri.fromFileStatus(f, repoPath));

        super(uris, item || {
            label: `$(file-symlink-file) Open Files`,
            description: ''
            // detail: `Opens all of the changed file in the working tree`
        });
    }
}

export class OpenCommitFileRevisionsCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(
        commit: GitLogCommit,
        item?: QuickPickItem
    ) {
        const uris = Arrays.filterMap(commit.fileStatuses,
            f => GitUri.toRevisionUri(f.status === 'D' ? commit.previousFileSha : commit.sha, f, commit.repoPath));

        super(uris, item || {
            label: `$(file-symlink-file) Open Revisions`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} in ${GlyphChars.Space}$(git-commit) ${commit.shortSha}`
            // detail: `Opens all of the changed files in $(git-commit) ${commit.shortSha}`
        });
    }
}

export class CommitQuickPick {

    static async show(commit: GitLogCommit, uri: Uri, goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem, repoLog?: GitLog): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
        await commit.resolvePreviousFileSha();

        const items: (CommitWithFileStatusQuickPickItem | CommandQuickPickItem)[] = commit.fileStatuses.map(fs => new CommitWithFileStatusQuickPickItem(commit, fs));

        const stash = commit.isStash;

        let index = 0;

        if (stash) {
            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(git-pull-request) Apply Stashed Changes`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.getShortMessage()}`
            }, Commands.StashApply, [
                    {
                        confirm: true,
                        deleteAfter: false,
                        stashItem: commit as GitStashCommit,
                        goBackCommand: currentCommand
                    } as StashApplyCommandArgs
                ])
            );

            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(x) Delete Stashed Changes`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.getShortMessage()}`
            }, Commands.StashDelete, [
                    {
                        confirm: true,
                        stashItem: commit as GitStashCommit,
                        goBackCommand: currentCommand
                    } as StashDeleteCommandArgs
                ])
            );

            items.splice(index++, 0, new ShowCommitInResultsQuickPickItem(commit));
        }
        else {
            items.splice(index++, 0, new ShowCommitInResultsQuickPickItem(commit));

            const remotes = await Container.git.getRemotes(commit.repoPath);
            if (remotes.length) {
                items.splice(index++, 0, new OpenRemotesCommandQuickPickItem(remotes, {
                    type: 'commit',
                    sha: commit.sha
                } as RemoteResource, currentCommand));
            }
        }

        items.splice(index++, 0, new OpenCommitFilesCommandQuickPickItem(commit));
        items.splice(index++, 0, new OpenCommitFileRevisionsCommandQuickPickItem(commit));

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(git-compare) Open Directory Compare with Previous Revision`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.previousFileShortSha} ${GlyphChars.Space} $(git-compare) ${GlyphChars.Space} $(git-commit) ${commit.shortSha}`
        }, Commands.DiffDirectory, [
                commit.uri,
                {
                    ref1: commit.previousFileSha,
                    ref2: commit.sha
                } as DiffDirectoryCommandArgs
            ])
        );

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(git-compare) Open Directory Compare with Working Tree`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.shortSha} ${GlyphChars.Space} $(git-compare) ${GlyphChars.Space} $(file-directory) Working Tree`
        }, Commands.DiffDirectory, [
                uri,
                {
                    ref1: commit.sha
                } as DiffDirectoryCommandArgs
            ])
        );

        if (!stash) {
            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(clippy) Copy Commit ID to Clipboard`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.shortSha}`
            }, Commands.CopyShaToClipboard, [
                    uri,
                    {
                        sha: commit.sha
                    } as CopyShaToClipboardCommandArgs
                ])
            );
        }

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Message to Clipboard`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.getShortMessage()}`
        }, Commands.CopyMessageToClipboard, [
                uri,
                {
                    message: commit.message,
                    sha: commit.sha
                } as CopyMessageToClipboardCommandArgs
            ])
        );

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
            ])
        );

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
                        log = await Container.git.getLog(commit.repoPath, { maxCount: Container.config.advanced.maxListItems, ref: commit.sha });
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
                        const nextLog = await Container.git.getLog(commit.repoPath, { maxCount: 1, reverse: true, ref: commit.sha });
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

        const scope = await Container.keyboard.beginScope({
            left: goBackCommand,
            ',': previousCommand,
            '.': nextCommand
        });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.shortSha} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.author ? `${commit.author}, ` : ''}${commit.formattedDate} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.getShortMessage()}`,
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