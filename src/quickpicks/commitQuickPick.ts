'use strict';
import * as paths from 'path';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import {
    Commands,
    CopyMessageToClipboardCommandArgs,
    CopyRemoteFileUrlToClipboardCommandArgs,
    CopyShaToClipboardCommandArgs,
    DiffDirectoryCommandArgs,
    DiffWithPreviousCommandArgs,
    openEditor,
    OpenWorkingFileCommandArgs,
    ShowQuickCommitDetailsCommandArgs,
    StashApplyCommandArgs,
    StashDeleteCommandArgs
} from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
    GitFile,
    GitLog,
    GitLogCommit,
    GitService,
    GitStashCommit,
    GitUri,
    RemoteResourceType
} from '../git/gitService';
import { KeyNoopCommand, Keys } from '../keyboard';
import { Arrays, Iterables, Strings } from '../system';
import {
    CommandQuickPickItem,
    getQuickPickIgnoreFocusOut,
    KeyCommandQuickPickItem,
    QuickPickItem,
    ShowCommitInViewQuickPickItem
} from './commonQuickPicks';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';

export class CommitWithFileStatusQuickPickItem extends CommandQuickPickItem {
    constructor(public readonly commit: GitLogCommit, private readonly _file: GitFile) {
        super({
            label: `${Strings.pad(GitFile.getStatusOcticon(_file.status), 4, 2)} ${paths.basename(_file.fileName)}`,
            description: GitFile.getFormattedDirectory(_file, true)
        });

        this.commit = commit.toFileCommit(_file);
    }

    get sha(): string {
        return this.commit.sha;
    }

    execute(options?: TextDocumentShowOptions): Thenable<TextEditor | undefined> {
        return openEditor(GitUri.toRevisionUri(this.commit.sha, this._file, this.commit.repoPath), options);
    }

    onDidPressKey(key: Keys): Thenable<{} | undefined> {
        if (this.commit.previousSha === undefined) return super.onDidPressKey(key);

        const commandArgs: DiffWithPreviousCommandArgs = {
            commit: this.commit,
            showOptions: {
                preserveFocus: true,
                preview: false
            }
        };
        return commands.executeCommand(Commands.DiffWithPrevious, this.commit.toGitUri(), commandArgs);
    }
}

export class OpenCommitFilesCommandQuickPickItem extends CommandQuickPickItem {
    constructor(private readonly _commit: GitLogCommit, item?: QuickPickItem) {
        super(
            item || {
                label: '$(file-symlink-file) Open Files',
                description: ''
                // detail: `Opens all of the changed file in the working tree`
            }
        );
    }

    async execute(
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ): Promise<{} | undefined> {
        const uris = Arrays.filterMap(this._commit.files, f =>
            GitUri.fromFile(f, this._commit.repoPath, this._commit.sha)
        );
        for (const uri of uris) {
            const args: OpenWorkingFileCommandArgs = {
                uri: uri,
                showOptions: options
            };
            await commands.executeCommand(Commands.OpenWorkingFile, undefined, args);
        }

        return undefined;
    }

    onDidPressKey(key: Keys): Thenable<{} | undefined> {
        return this.execute({
            preserveFocus: true,
            preview: false
        });
    }
}

export class OpenCommitFileRevisionsCommandQuickPickItem extends CommandQuickPickItem {
    constructor(private readonly _commit: GitLogCommit, item?: QuickPickItem) {
        super(
            item || {
                label: '$(file-symlink-file) Open Revisions',
                description: `from ${GlyphChars.Space}$(git-commit) ${_commit.shortSha}`
                // detail: `Opens all of the changed files in $(git-commit) ${commit.shortSha}`
            }
        );
    }

    async execute(
        options: TextDocumentShowOptions = { preserveFocus: false, preview: false }
    ): Promise<{} | undefined> {
        const uris = Arrays.filterMap(this._commit.files, f =>
            GitUri.toRevisionUri(
                f.status === 'D' ? this._commit.previousFileSha : this._commit.sha,
                f,
                this._commit.repoPath
            )
        );

        for (const uri of uris) {
            await openEditor(uri, options);
        }
        return undefined;
    }

    onDidPressKey(key: Keys): Thenable<{} | undefined> {
        return this.execute({
            preserveFocus: true,
            preview: false
        });
    }
}

export interface CommitQuickPickOptions {
    currentCommand?: CommandQuickPickItem;
    goBackCommand?: CommandQuickPickItem;
    repoLog?: GitLog;
}

export class CommitQuickPick {
    constructor(public readonly repoPath: string | undefined) {}

    async show(
        commit: GitLogCommit,
        uri: Uri,
        options: CommitQuickPickOptions = {}
    ): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
        let previousCommand: (() => Promise<KeyCommandQuickPickItem | typeof KeyNoopCommand>) | undefined = undefined;
        let nextCommand: (() => Promise<KeyCommandQuickPickItem | typeof KeyNoopCommand>) | undefined = undefined;
        if (!commit.isStash) {
            previousCommand = async () => {
                const previousRef =
                    commit.previousSha === undefined || GitService.isShaParent(commit.previousSha)
                        ? await Container.git.resolveReference(commit.repoPath, commit.previousSha || commit.sha)
                        : commit.previousSha;
                if (previousRef === undefined) return KeyNoopCommand;

                const previousCommandArgs: ShowQuickCommitDetailsCommandArgs = {
                    repoLog: options.repoLog,
                    sha: previousRef,
                    goBackCommand: options.goBackCommand
                };
                return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                    Uri.file(commit.repoPath),
                    previousCommandArgs
                ]);
            };

            nextCommand = async () => {
                let log = options.repoLog;
                let c = log && log.commits.get(commit.sha);

                // If we can't find the commit or the next commit isn't available (since it isn't trustworthy)
                if (c === undefined || c.nextSha === undefined) {
                    log = undefined;
                    c = undefined;

                    // Try to find the next commit
                    const nextLog = await Container.git.getLog(commit.repoPath, {
                        maxCount: 1,
                        reverse: true,
                        ref: commit.sha
                    });

                    const next = nextLog && Iterables.first(nextLog.commits.values());
                    if (next !== undefined && next.sha !== commit.sha) {
                        c = commit;
                        c.nextSha = next.sha;
                    }
                }

                if (c === undefined || c.nextSha === undefined) return KeyNoopCommand;

                const nextCommandArgs: ShowQuickCommitDetailsCommandArgs = {
                    repoLog: log,
                    sha: c.nextSha,
                    goBackCommand: options.goBackCommand
                };
                return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [
                    Uri.file(commit.repoPath),
                    nextCommandArgs
                ]);
            };
        }

        const scope = await Container.keyboard.beginScope({
            left: options.goBackCommand,
            ',': previousCommand,
            '.': nextCommand
        });

        const pick = await window.showQuickPick(this.getItems(commit, uri, options), {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.shortSha} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
                commit.author ? `${commit.author}, ` : ''
            }${commit.formattedDate} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.getShortMessage()}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                void scope.setKeyCommand('right', item);
                if (typeof item.onDidSelect === 'function') {
                    item.onDidSelect();
                }
            }
        });

        await scope.dispose();

        return pick;
    }

    private async getItems(commit: GitLogCommit, uri: Uri, options: CommitQuickPickOptions = {}) {
        const items: (CommitWithFileStatusQuickPickItem | CommandQuickPickItem)[] = commit.files.map(
            fs => new CommitWithFileStatusQuickPickItem(commit, fs)
        );

        const stash = commit.isStash;

        let index = 0;

        let remotes;
        if (stash) {
            const stashApplyCommmandArgs: StashApplyCommandArgs = {
                confirm: true,
                deleteAfter: false,
                stashItem: commit as GitStashCommit,
                goBackCommand: options.currentCommand
            };
            items.splice(
                index++,
                0,
                new CommandQuickPickItem(
                    {
                        label: '$(git-pull-request) Apply Stashed Changes',
                        description: `${commit.getShortMessage()}`
                    },
                    Commands.StashApply,
                    [stashApplyCommmandArgs]
                )
            );

            const stashDeleteCommmandArgs: StashDeleteCommandArgs = {
                confirm: true,
                stashItem: commit as GitStashCommit,
                goBackCommand: options.currentCommand
            };
            items.splice(
                index++,
                0,
                new CommandQuickPickItem(
                    {
                        label: '$(x) Delete Stashed Changes',
                        description: `${commit.getShortMessage()}`
                    },
                    Commands.StashDelete,
                    [stashDeleteCommmandArgs]
                )
            );

            items.splice(index++, 0, new ShowCommitInViewQuickPickItem(commit));
        }
        else {
            items.splice(index++, 0, new ShowCommitInViewQuickPickItem(commit));

            remotes = await Container.git.getRemotes(commit.repoPath, { sort: true });
            if (remotes.length) {
                items.splice(
                    index++,
                    0,
                    new OpenRemotesCommandQuickPickItem(
                        remotes,
                        {
                            type: RemoteResourceType.Commit,
                            sha: commit.sha
                        },
                        options.currentCommand
                    )
                );
            }
        }

        items.splice(index++, 0, new OpenCommitFilesCommandQuickPickItem(commit));
        items.splice(index++, 0, new OpenCommitFileRevisionsCommandQuickPickItem(commit));

        const previousSha = await Container.git.resolveReference(commit.repoPath, commit.previousFileSha);

        let diffDirectoryCommmandArgs: DiffDirectoryCommandArgs = {
            ref1: previousSha,
            ref2: commit.sha
        };
        items.splice(
            index++,
            0,
            new CommandQuickPickItem(
                {
                    label: '$(git-compare) Open Directory Compare with Previous Revision',
                    description: `$(git-commit) ${GitService.shortenSha(previousSha)} ${
                        GlyphChars.Space
                    } $(git-compare) ${GlyphChars.Space} $(git-commit) ${commit.shortSha}`
                },
                Commands.DiffDirectory,
                [commit.uri, diffDirectoryCommmandArgs]
            )
        );

        diffDirectoryCommmandArgs = {
            ref1: commit.sha
        };
        items.splice(
            index++,
            0,
            new CommandQuickPickItem(
                {
                    label: '$(git-compare) Open Directory Compare with Working Tree',
                    description: `$(git-commit) ${commit.shortSha} ${GlyphChars.Space} $(git-compare) ${GlyphChars.Space} Working Tree`
                },
                Commands.DiffDirectory,
                [uri, diffDirectoryCommmandArgs]
            )
        );

        if (!stash) {
            const copyShaCommandArgs: CopyShaToClipboardCommandArgs = {
                sha: commit.sha
            };
            items.splice(
                index++,
                0,
                new CommandQuickPickItem(
                    {
                        label: '$(clippy) Copy Commit ID to Clipboard',
                        description: `${commit.shortSha}`
                    },
                    Commands.CopyShaToClipboard,
                    [uri, copyShaCommandArgs]
                )
            );
        }

        const copyMessageCommandArgs: CopyMessageToClipboardCommandArgs = {
            message: commit.message,
            sha: commit.sha
        };
        items.splice(
            index++,
            0,
            new CommandQuickPickItem(
                {
                    label: '$(clippy) Copy Commit Message to Clipboard',
                    description: `${commit.getShortMessage()}`
                },
                Commands.CopyMessageToClipboard,
                [uri, copyMessageCommandArgs]
            )
        );

        if (!stash) {
            if (remotes !== undefined && remotes.length) {
                const copyRemoteUrlCommandArgs: CopyRemoteFileUrlToClipboardCommandArgs = {
                    sha: commit.sha
                };
                items.splice(
                    index++,
                    0,
                    new CommandQuickPickItem(
                        {
                            label: '$(clippy) Copy Remote Url to Clipboard'
                        },
                        Commands.CopyRemoteFileUrlToClipboard,
                        [uri, copyRemoteUrlCommandArgs]
                    )
                );
            }
        }

        const commitDetailsCommandArgs: ShowQuickCommitDetailsCommandArgs = {
            commit: commit,
            repoLog: options.repoLog,
            sha: commit.sha,
            goBackCommand: options.goBackCommand
        };
        items.splice(
            index++,
            0,
            new CommandQuickPickItem(
                {
                    label: 'Changed Files',
                    description: commit.getFormattedDiffStatus()
                },
                Commands.ShowQuickCommitDetails,
                [uri, commitDetailsCommandArgs]
            )
        );

        if (options.goBackCommand) {
            items.splice(0, 0, options.goBackCommand);
        }

        return items;
    }
}
