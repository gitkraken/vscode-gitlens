'use strict';
import { Iterables, Strings } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, CopyMessageToClipboardCommandArgs, CopyShaToClipboardCommandArgs, DiffWithPreviousCommandArgs, DiffWithWorkingCommandArgs, openEditor, ShowQuickCommitDetailsCommandArgs, ShowQuickCommitFileDetailsCommandArgs, ShowQuickFileHistoryCommandArgs } from '../commands';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, KeyCommandQuickPickItem, OpenFileCommandQuickPickItem } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitLogCommit, GitUri, RemoteResource } from '../gitService';
import { KeyCommand, KeyNoopCommand } from '../keyboard';
import { OpenRemotesCommandQuickPickItem } from './remotes';
import * as path from 'path';

export class ApplyCommitFileChangesCommandQuickPickItem extends CommandQuickPickItem {
    constructor(
        private readonly commit: GitLogCommit,
        item?: QuickPickItem
    ) {
        super(item || {
            label: `$(git-pull-request) Apply Changes`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(file-text) ${path.basename(commit.fileName)} in ${GlyphChars.Space}$(git-commit) ${commit.shortSha}`
        }, undefined, undefined);
    }

    async execute(): Promise<{} | undefined> {
        const uri = this.commit.toGitUri();
        await Container.git.checkoutFile(uri);
        return openEditor(uri, { preserveFocus: true, preview: false });
    }
}

export class OpenCommitFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(
        commit: GitLogCommit,
        item?: QuickPickItem
    ) {
        const uri = Uri.file(path.resolve(commit.repoPath, commit.fileName));
        super(uri, item || {
            label: `$(file-symlink-file) Open File`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${path.basename(commit.fileName)}`
        });
    }
}

export class OpenCommitFileRevisionCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(
        commit: GitLogCommit,
        item?: QuickPickItem
    ) {
        let description: string;
        let uri: Uri;
        if (commit.status === 'D') {
            uri = GitUri.toRevisionUri(commit.previousFileSha, commit.previousUri.fsPath, commit.repoPath);
            description = `${Strings.pad(GlyphChars.Dash, 2, 3)} ${path.basename(commit.fileName)} in ${GlyphChars.Space}$(git-commit) ${commit.previousShortSha} (deleted in ${GlyphChars.Space}$(git-commit) ${commit.shortSha})`;
        }
        else {
            uri = GitUri.toRevisionUri(commit.sha, commit.uri.fsPath, commit.repoPath);
            description = `${Strings.pad(GlyphChars.Dash, 2, 3)} ${path.basename(commit.fileName)} in ${GlyphChars.Space}$(git-commit) ${commit.shortSha}`;
        }
        super(uri, item || {
            label: `$(file-symlink-file) Open Revision`,
            description: description
        });
    }
}

export class CommitFileDetailsQuickPick {

    static async show(commit: GitLogCommit, uri: Uri, goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem, fileLog?: GitLog): Promise<CommandQuickPickItem | undefined> {
        const items: CommandQuickPickItem[] = [];

        const stash = commit.isStash;

        const workingName = (commit.workingFileName && path.basename(commit.workingFileName)) || path.basename(commit.fileName);

        const isUncommitted = commit.isUncommitted;
        if (isUncommitted) {
            // Since we can't trust the previous sha on an uncommitted commit, find the last commit for this file
            const c = await Container.git.getLogCommit(undefined, commit.uri.fsPath, { previous: true });
            if (c === undefined) return undefined;

            commit = c;
        }

        await commit.resolvePreviousFileSha();

        if (stash) {
            items.push(new ApplyCommitFileChangesCommandQuickPickItem(commit));
        }

        if (commit.previousFileShortSha) {
            items.push(new CommandQuickPickItem({
                label: `$(git-compare) Open Changes`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.previousFileShortSha} ${GlyphChars.Space} $(git-compare) ${GlyphChars.Space} $(git-commit) ${commit.shortSha}`
            }, Commands.DiffWithPrevious, [
                    commit.uri,
                    {
                        commit
                    } as DiffWithPreviousCommandArgs
                ])
            );
        }

        if (commit.workingFileName) {
            items.push(new CommandQuickPickItem({
                label: `$(git-compare) Open Changes with Working Tree`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.shortSha} ${GlyphChars.Space} $(git-compare) ${GlyphChars.Space} $(file-text) ${workingName}`
            }, Commands.DiffWithWorking, [
                    Uri.file(path.resolve(commit.repoPath, commit.workingFileName)),
                    {
                        commit
                    } as DiffWithWorkingCommandArgs
                ])
            );
        }

        if (commit.workingFileName && commit.status !== 'D') {
            items.push(new OpenCommitFileCommandQuickPickItem(commit));
        }
        items.push(new OpenCommitFileRevisionCommandQuickPickItem(commit));

        const remotes = (await Container.git.getRemotes(commit.repoPath)).filter(r => r.provider !== undefined);
        if (remotes.length) {
            if (commit.workingFileName && commit.status !== 'D') {
                const branch = await Container.git.getBranch(commit.repoPath);
                items.push(new OpenRemotesCommandQuickPickItem(remotes, {
                    type: 'file',
                    fileName: commit.workingFileName,
                    branch: branch!.name
                } as RemoteResource, currentCommand));
            }

            if (!stash) {
                items.push(new OpenRemotesCommandQuickPickItem(remotes, {
                    type: 'revision',
                    fileName: commit.fileName,
                    commit
                } as RemoteResource, currentCommand));
            }
        }

        if (!stash) {
            items.push(new ApplyCommitFileChangesCommandQuickPickItem(commit));

            items.push(new CommandQuickPickItem({
                label: `$(clippy) Copy Commit ID to Clipboard`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.shortSha}`
            }, Commands.CopyShaToClipboard, [
                    uri,
                    {
                        sha: commit.sha
                    } as CopyShaToClipboardCommandArgs
                ])
            );

            items.push(new CommandQuickPickItem({
                label: `$(clippy) Copy Commit Message to Clipboard`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${commit.message}`
            }, Commands.CopyMessageToClipboard, [
                    uri,
                    {
                        message: commit.message,
                        sha: commit.sha
                    } as CopyMessageToClipboardCommandArgs
                ]));
        }

        if (commit.workingFileName) {
            items.push(new CommandQuickPickItem({
                label: `$(history) Show File History`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} of ${path.basename(commit.fileName)}`
            }, Commands.ShowQuickFileHistory, [
                    Uri.file(path.resolve(commit.repoPath, commit.workingFileName)),
                    {
                        fileLog,
                        goBackCommand: currentCommand
                    } as ShowQuickFileHistoryCommandArgs
                ]));
        }

        if (!stash) {
            items.push(new CommandQuickPickItem({
                label: `$(history) Show ${commit.workingFileName ? 'Previous ' : ''}File History`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} of ${path.basename(commit.fileName)} ${Strings.pad(GlyphChars.Dot, 1, 1)} from ${GlyphChars.Space}$(git-commit) ${commit.shortSha}`
            }, Commands.ShowQuickFileHistory, [
                    commit.toGitUri(),
                    {
                        goBackCommand: currentCommand
                    } as ShowQuickFileHistoryCommandArgs
                ]));

            items.push(new CommandQuickPickItem({
                label: `$(git-commit) Show Commit Details`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(git-commit) ${commit.shortSha}`
            }, Commands.ShowQuickCommitDetails, [
                    commit.toGitUri(),
                    {
                        commit,
                        sha: commit.sha,
                        goBackCommand: currentCommand
                    } as ShowQuickCommitDetailsCommandArgs
                ])
            );
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        let previousCommand: KeyCommand | (() => Promise<KeyCommand>) | undefined = undefined;
        let nextCommand: KeyCommand | (() => Promise<KeyCommand>) | undefined = undefined;
        if (!stash) {
            // If we have the full history, we are good
            if (fileLog !== undefined && !fileLog.truncated && fileLog.sha === undefined) {
                previousCommand = commit.previousSha === undefined
                    ? undefined
                    : new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [
                        commit.previousUri,
                        {
                            fileLog,
                            sha: commit.previousSha,
                            goBackCommand
                        } as ShowQuickCommitFileDetailsCommandArgs
                    ]);

                nextCommand = commit.nextSha === undefined
                    ? undefined
                    : new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [
                        commit.nextUri,
                        {
                            fileLog,
                            sha: commit.nextSha,
                            goBackCommand
                        } as ShowQuickCommitFileDetailsCommandArgs
                    ]);
            }
            else {
                previousCommand = async () => {
                    let log = fileLog;
                    let c = log && log.commits.get(commit.sha);

                    // If we can't find the commit or the previous commit isn't available (since it isn't trustworthy)
                    if (c === undefined || c.previousSha === undefined) {
                        log = await Container.git.getLogForFile(commit.repoPath, uri.fsPath, { maxCount: Container.config.advanced.maxListItems, ref: commit.sha });
                        if (log === undefined) return KeyNoopCommand;

                        c = log && log.commits.get(commit.sha);
                        // Since we exclude merge commits in file log, just grab the first returned commit
                        if (c === undefined && commit.isMerge) {
                            c = Iterables.first(log.commits.values());
                        }

                        if (c) {
                            // Copy over next info, since it is trustworthy at this point
                            c.nextSha = commit.nextSha;
                            c.nextFileName = commit.nextFileName;
                        }
                    }

                    if (c === undefined || c.previousSha === undefined) return KeyNoopCommand;

                    return new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [
                        c.previousUri,
                        {
                            fileLog: log,
                            sha: c.previousSha,
                            goBackCommand
                        } as ShowQuickCommitFileDetailsCommandArgs
                    ]);
                };

                nextCommand = async () => {
                    let log = fileLog;
                    let c = log && log.commits.get(commit.sha);

                    // If we can't find the commit or the next commit isn't available (since it isn't trustworthy)
                    if (c === undefined || c.nextSha === undefined) {
                        log = undefined;
                        c = undefined;

                        // Try to find the next commit
                        const next = await Container.git.findNextCommit(commit.repoPath, uri.fsPath, commit.sha);
                        if (next !== undefined && next.sha !== commit.sha) {
                            c = commit;
                            c.nextSha = next.sha;
                            c.nextFileName = next.originalFileName || next.fileName;
                        }
                    }

                    if (c === undefined || c.nextSha === undefined) return KeyNoopCommand;

                    return new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [
                        c.nextUri,
                        {
                            fileLog: log,
                            sha: c.nextSha,
                            goBackCommand
                        } as ShowQuickCommitFileDetailsCommandArgs
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
            placeHolder: `${commit.getFormattedPath()} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${isUncommitted ? `Uncommitted ${GlyphChars.ArrowRightHollow} ` : ''}${commit.shortSha} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.author}, ${commit.formattedDate} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                scope.setKeyCommand('right', item as KeyCommand);
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}