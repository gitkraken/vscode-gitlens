'use strict';
import * as paths from 'path';
import { commands, QuickPickOptions, TextDocumentShowOptions, window } from 'vscode';
import {
    Commands,
    DiffWithPreviousCommandArgs,
    OpenChangedFilesCommandArgs,
    ShowQuickBranchHistoryCommandArgs,
    ShowQuickRepoStatusCommandArgs,
    ShowQuickStashListCommandArgs
} from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
    GitCommitType,
    GitFileStatus,
    GitLogCommit,
    GitService,
    GitStatus,
    GitStatusFile,
    GitUri
} from '../git/gitService';
import { Keys } from '../keyboard';
import { Iterables, Strings } from '../system';
import {
    CommandQuickPickItem,
    getQuickPickIgnoreFocusOut,
    OpenFileCommandQuickPickItem,
    QuickPickItem
} from './commonQuickPicks';

export class OpenStatusFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {
    public readonly status: GitStatusFile;
    private readonly commit: GitLogCommit;

    constructor(status: GitStatusFile, realIndexStatus?: GitFileStatus, item?: QuickPickItem) {
        const octicon = status.getOcticon();
        const description = status.getFormattedDirectory(true);

        super(
            status.uri,
            item || {
                label: `${status.staged ? '$(check)' : GlyphChars.Space.repeat(3)}${Strings.pad(
                    octicon,
                    2,
                    2
                )} ${paths.basename(status.fileName)}`,
                description: description
            }
        );

        this.status = status;
        if (status.indexStatus !== undefined) {
            this.commit = new GitLogCommit(
                GitCommitType.File,
                status.repoPath,
                GitService.stagedUncommittedSha,
                'You',
                undefined,
                new Date(),
                new Date(),
                '',
                status.fileName,
                [status],
                status.status,
                status.originalFileName,
                'HEAD',
                status.fileName
            );
        }
        else {
            this.commit = new GitLogCommit(
                GitCommitType.File,
                status.repoPath,
                GitService.uncommittedSha,
                'You',
                undefined,
                new Date(),
                new Date(),
                '',
                status.fileName,
                [status],
                status.status,
                status.originalFileName,
                realIndexStatus !== undefined ? GitService.stagedUncommittedSha : 'HEAD',
                status.fileName
            );
        }
    }

    onDidPressKey(key: Keys): Promise<{} | undefined> {
        return commands.executeCommand(Commands.DiffWithPrevious, GitUri.fromFile(this.status, this.status.repoPath), {
            commit: this.commit,
            line: 0,
            showOptions: {
                preserveFocus: true,
                preview: false
            } as TextDocumentShowOptions
        } as DiffWithPreviousCommandArgs) as Promise<{} | undefined>;
    }
}

export class OpenStatusFilesCommandQuickPickItem extends CommandQuickPickItem {
    constructor(files: GitStatusFile[], item?: QuickPickItem) {
        const uris = files.map(f => f.uri);

        super(
            item || {
                label: `$(file-symlink-file) Open Changed Files`,
                description: ''
                // detail: `Opens all of the changed files in the repository`
            },
            Commands.OpenChangedFiles,
            [
                undefined,
                {
                    uris
                } as OpenChangedFilesCommandArgs
            ]
        );
    }
}

interface ComputedStatus {
    staged: number;
    stagedAddsAndChanges: GitStatusFile[];
    stagedStatus: string;

    unstaged: number;
    unstagedAddsAndChanges: GitStatusFile[];
    unstagedStatus: string;
}

export class RepoStatusQuickPick {
    private static computeStatus(files: GitStatusFile[]): ComputedStatus {
        let stagedAdds = 0;
        let unstagedAdds = 0;
        let stagedChanges = 0;
        let unstagedChanges = 0;
        let stagedDeletes = 0;
        let unstagedDeletes = 0;

        const stagedAddsAndChanges: GitStatusFile[] = [];
        const unstagedAddsAndChanges: GitStatusFile[] = [];

        for (const f of files) {
            switch (f.indexStatus) {
                case 'A':
                case '?':
                    stagedAdds++;
                    stagedAddsAndChanges.push(f);
                    break;

                case 'D':
                    stagedDeletes++;
                    break;

                case undefined:
                    break;

                default:
                    stagedChanges++;
                    stagedAddsAndChanges.push(f);
                    break;
            }

            switch (f.workingTreeStatus) {
                case 'A':
                case '?':
                    unstagedAdds++;
                    unstagedAddsAndChanges.push(f);
                    break;

                case 'D':
                    unstagedDeletes++;
                    break;

                case undefined:
                    break;

                default:
                    unstagedChanges++;
                    unstagedAddsAndChanges.push(f);
                    break;
            }
        }

        const staged = stagedAdds + stagedChanges + stagedDeletes;
        const unstaged = unstagedAdds + unstagedChanges + unstagedDeletes;

        return {
            staged: staged,
            stagedStatus: staged > 0 ? `+${stagedAdds} ~${stagedChanges} -${stagedDeletes}` : '',
            stagedAddsAndChanges: stagedAddsAndChanges,
            unstaged: unstaged,
            unstagedStatus: unstaged > 0 ? `+${unstagedAdds} ~${unstagedChanges} -${unstagedDeletes}` : '',
            unstagedAddsAndChanges: unstagedAddsAndChanges
        };
    }

    static async show(
        status: GitStatus,
        goBackCommand?: CommandQuickPickItem
    ): Promise<
        OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem | undefined
    > {
        const items = [
            ...Iterables.flatMap(status.files, s => {
                if (s.workingTreeStatus !== undefined && s.indexStatus !== undefined) {
                    return [
                        new OpenStatusFileCommandQuickPickItem(s.with({ indexStatus: null }), s.indexStatus),
                        new OpenStatusFileCommandQuickPickItem(s.with({ workTreeStatus: null }))
                    ];
                }
                else {
                    return [new OpenStatusFileCommandQuickPickItem(s)];
                }
            })
        ] as (OpenStatusFileCommandQuickPickItem | OpenStatusFilesCommandQuickPickItem | CommandQuickPickItem)[];

        // Sort the status by staged and then filename
        items.sort(
            (a, b) =>
                ((a as OpenStatusFileCommandQuickPickItem).status.staged ? -1 : 1) -
                    ((b as OpenStatusFileCommandQuickPickItem).status.staged ? -1 : 1) ||
                (a as OpenStatusFileCommandQuickPickItem).status.fileName.localeCompare(
                    (b as OpenStatusFileCommandQuickPickItem).status.fileName,
                    undefined,
                    { numeric: true, sensitivity: 'base' }
                )
        );

        const currentCommand = new CommandQuickPickItem(
            {
                label: `go back ${GlyphChars.ArrowBack}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to ${GlyphChars.Space}$(git-branch) ${
                    status.branch
                } status`
            },
            Commands.ShowQuickRepoStatus,
            [
                undefined,
                {
                    goBackCommand
                } as ShowQuickRepoStatusCommandArgs
            ]
        );

        const computed = this.computeStatus(status.files);
        if (computed.staged > 0) {
            let index = 0;
            const unstagedIndex = computed.unstaged > 0 ? status.files.findIndex(f => !f.staged) : -1;
            if (unstagedIndex > -1) {
                items.splice(
                    unstagedIndex,
                    0,
                    new CommandQuickPickItem(
                        {
                            label: `Unstaged Files`,
                            description: computed.unstagedStatus
                        },
                        Commands.ShowQuickRepoStatus,
                        [
                            undefined,
                            {
                                goBackCommand
                            } as ShowQuickRepoStatusCommandArgs
                        ]
                    )
                );

                items.splice(
                    unstagedIndex,
                    0,
                    new OpenStatusFilesCommandQuickPickItem(computed.stagedAddsAndChanges, {
                        label: `${GlyphChars.Space.repeat(4)} $(file-symlink-file) Open Staged Files`,
                        description: ''
                    })
                );

                items.push(
                    new OpenStatusFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, {
                        label: `${GlyphChars.Space.repeat(4)} $(file-symlink-file) Open Unstaged Files`,
                        description: ''
                    })
                );
            }

            items.splice(
                index++,
                0,
                new CommandQuickPickItem(
                    {
                        label: `Staged Files`,
                        description: computed.stagedStatus
                    },
                    Commands.ShowQuickRepoStatus,
                    [
                        undefined,
                        {
                            goBackCommand
                        } as ShowQuickRepoStatusCommandArgs
                    ]
                )
            );
        }
        else if (status.files.some(f => !f.staged)) {
            items.splice(
                0,
                0,
                new CommandQuickPickItem(
                    {
                        label: `Unstaged Files`,
                        description: computed.unstagedStatus
                    },
                    Commands.ShowQuickRepoStatus,
                    [
                        undefined,
                        {
                            goBackCommand
                        } as ShowQuickRepoStatusCommandArgs
                    ]
                )
            );
        }

        if (status.files.length) {
            items.push(
                new OpenStatusFilesCommandQuickPickItem(
                    computed.stagedAddsAndChanges.concat(computed.unstagedAddsAndChanges)
                )
            );
            items.push(
                new CommandQuickPickItem(
                    {
                        label: '$(x) Close Unchanged Files',
                        description: ''
                    },
                    Commands.CloseUnchangedFiles
                )
            );
        }
        else {
            items.push(
                new CommandQuickPickItem(
                    {
                        label: `No changes in the working tree`,
                        description: ''
                    },
                    Commands.ShowQuickRepoStatus,
                    [
                        undefined,
                        {
                            goBackCommand
                        } as ShowQuickRepoStatusCommandArgs
                    ]
                )
            );
        }

        items.splice(
            0,
            0,
            new CommandQuickPickItem(
                {
                    label: `$(inbox) Show Stashed Changes`,
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows stashed changes in the repository`
                },
                Commands.ShowQuickStashList,
                [
                    GitUri.fromRepoPath(status.repoPath),
                    {
                        goBackCommand: currentCommand
                    } as ShowQuickStashListCommandArgs
                ]
            )
        );

        if (status.upstream && status.state.ahead) {
            items.splice(
                0,
                0,
                new CommandQuickPickItem(
                    {
                        label: `$(cloud-upload)${GlyphChars.Space} ${status.state.ahead} Commit${
                            status.state.ahead > 1 ? 's' : ''
                        } ahead of ${GlyphChars.Space}$(git-branch) ${status.upstream}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows commits in ${
                            GlyphChars.Space
                        }$(git-branch) ${status.branch} but not ${GlyphChars.Space}$(git-branch) ${status.upstream}`
                    },
                    Commands.ShowQuickBranchHistory,
                    [
                        GitUri.fromRepoPath(status.repoPath, `${status.upstream}..${status.ref}`),
                        {
                            branch: status.ref,
                            maxCount: 0,
                            goBackCommand: currentCommand
                        } as ShowQuickBranchHistoryCommandArgs
                    ]
                )
            );
        }

        if (status.upstream && status.state.behind) {
            items.splice(
                0,
                0,
                new CommandQuickPickItem(
                    {
                        label: `$(cloud-download)${GlyphChars.Space} ${status.state.behind} Commit${
                            status.state.behind > 1 ? 's' : ''
                        } behind ${GlyphChars.Space}$(git-branch) ${status.upstream}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows commits in ${
                            GlyphChars.Space
                        }$(git-branch) ${status.upstream} but not ${GlyphChars.Space}$(git-branch) ${status.branch}${
                            status.sha
                                ? ` (since ${GlyphChars.Space}$(git-commit) ${GitService.shortenSha(status.sha)})`
                                : ''
                        }`
                    },
                    Commands.ShowQuickBranchHistory,
                    [
                        GitUri.fromRepoPath(status.repoPath, `${status.ref}..${status.upstream}`),
                        {
                            branch: status.upstream,
                            maxCount: 0,
                            goBackCommand: currentCommand
                        } as ShowQuickBranchHistoryCommandArgs
                    ]
                )
            );
        }

        if (status.upstream && !status.state.ahead && !status.state.behind) {
            items.splice(
                0,
                0,
                new CommandQuickPickItem(
                    {
                        label: `$(git-branch) ${status.branch} is up-to-date with ${GlyphChars.Space}$(git-branch) ${
                            status.upstream
                        }`,
                        description: ''
                    },
                    Commands.ShowQuickRepoStatus,
                    [
                        undefined,
                        {
                            goBackCommand
                        } as ShowQuickRepoStatusCommandArgs
                    ]
                )
            );
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const scope = await Container.keyboard.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: `status of ${status.branch}${
                status.upstream ? ` ${Strings.pad(GlyphChars.ArrowLeftRightLong, 1, 1)} ${status.upstream}` : ''
            }`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                void scope.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}
