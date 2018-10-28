'use strict';
import * as paths from 'path';
import { CancellationTokenSource, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, ShowQuickCurrentBranchHistoryCommandArgs, ShowQuickFileHistoryCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitUri, RemoteResource } from '../git/gitService';
import { KeyNoopCommand } from '../keyboard';
import { Iterables, Strings } from '../system';
import {
    ChooseFromBranchesAndTagsQuickPickItem,
    CommandQuickPickItem,
    CommitQuickPickItem,
    getQuickPickIgnoreFocusOut,
    showQuickPickProgress
} from './commonQuickPicks';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';

export class FileHistoryQuickPick {
    static showProgress(placeHolder: string) {
        return showQuickPickProgress(placeHolder, {
            left: KeyNoopCommand,
            ',': KeyNoopCommand,
            '.': KeyNoopCommand
        });
    }

    static async show(
        log: GitLog,
        uri: GitUri,
        placeHolder: string,
        options: {
            currentCommand?: CommandQuickPickItem;
            goBackCommand?: CommandQuickPickItem;
            nextPageCommand?: CommandQuickPickItem;
            previousPageCommand?: CommandQuickPickItem;
            pickerOnly?: boolean;
            progressCancellation?: CancellationTokenSource;
            showAllCommand?: CommandQuickPickItem;
            showInResultsCommand?: CommandQuickPickItem;
        } = {}
    ): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        options = { pickerOnly: false, ...options };

        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (
            | CommitQuickPickItem
            | CommandQuickPickItem)[];

        let index = 0;

        index++;
        items.splice(
            0,
            0,
            new ChooseFromBranchesAndTagsQuickPickItem(log.repoPath, placeHolder, options.currentCommand)
        );

        if (options.showInResultsCommand !== undefined) {
            index++;
            items.splice(0, 0, options.showInResultsCommand);
        }

        if (log.truncated || log.sha) {
            if (options.showAllCommand !== undefined) {
                index++;
                items.splice(0, 0, options.showAllCommand);
            }
            else if (!options.pickerOnly) {
                const [workingFileName] = await Container.git.findWorkingFileName(
                    paths.relative(log.repoPath, uri.fsPath),
                    log.repoPath
                );
                if (workingFileName) {
                    index++;
                    items.splice(
                        0,
                        0,
                        new CommandQuickPickItem(
                            {
                                label: `$(history) Show File History`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} of ${paths.basename(
                                    workingFileName
                                )}`
                            },
                            Commands.ShowQuickFileHistory,
                            [
                                Uri.file(paths.resolve(log.repoPath, workingFileName)),
                                {
                                    goBackCommand: new CommandQuickPickItem(
                                        {
                                            label: `go back ${GlyphChars.ArrowBack}`,
                                            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to history of ${
                                                GlyphChars.Space
                                            }$(file-text) ${paths.basename(uri.fsPath)}${
                                                uri.sha ? ` from ${GlyphChars.Space}$(git-commit) ${uri.shortSha}` : ''
                                            }`
                                        },
                                        Commands.ShowQuickFileHistory,
                                        [
                                            uri,
                                            {
                                                log: log,
                                                maxCount: log.maxCount,
                                                range: log.range,
                                                goBackCommand: options.goBackCommand
                                            } as ShowQuickFileHistoryCommandArgs
                                        ]
                                    )
                                } as ShowQuickFileHistoryCommandArgs
                            ]
                        )
                    );
                }
            }

            if (options.nextPageCommand !== undefined) {
                index++;
                items.splice(0, 0, options.nextPageCommand);
            }

            if (options.previousPageCommand !== undefined) {
                index++;
                items.splice(0, 0, options.previousPageCommand);
            }
        }

        if (!options.pickerOnly) {
            const branch = await Container.git.getBranch(uri.repoPath!);

            if (branch !== undefined) {
                const currentCommand = new CommandQuickPickItem(
                    {
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to history of ${
                            GlyphChars.Space
                        }$(file-text) ${paths.basename(uri.fsPath)}${
                            uri.sha ? ` from ${GlyphChars.Space}$(git-commit) ${uri.shortSha}` : ''
                        }`
                    },
                    Commands.ShowQuickFileHistory,
                    [
                        uri,
                        {
                            log,
                            maxCount: log.maxCount,
                            range: log.range
                        } as ShowQuickFileHistoryCommandArgs
                    ]
                );

                // Only show the full repo option if we are the root
                if (options.goBackCommand === undefined) {
                    items.splice(
                        index++,
                        0,
                        new CommandQuickPickItem(
                            {
                                label: `$(history) Show Branch History`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows  ${
                                    GlyphChars.Space
                                }$(git-branch) ${branch.name} history`
                            },
                            Commands.ShowQuickCurrentBranchHistory,
                            [
                                undefined,
                                {
                                    goBackCommand: currentCommand
                                } as ShowQuickCurrentBranchHistoryCommandArgs
                            ]
                        )
                    );
                }

                const remotes = await Container.git.getRemotes(uri.repoPath!);
                if (remotes.length) {
                    const resource =
                        uri.sha !== undefined
                            ? ({
                                  type: 'revision',
                                  branch: branch.name,
                                  fileName: uri.getRelativePath(),
                                  sha: uri.sha
                              } as RemoteResource)
                            : ({
                                  type: 'file',
                                  branch: branch.name,
                                  fileName: uri.getRelativePath()
                              } as RemoteResource);
                    items.splice(index++, 0, new OpenRemotesCommandQuickPickItem(remotes, resource, currentCommand));
                }
            }

            if (options.goBackCommand) {
                items.splice(0, 0, options.goBackCommand);
            }
        }

        if (options.progressCancellation !== undefined && options.progressCancellation.token.isCancellationRequested) {
            return undefined;
        }

        const scope = await Container.keyboard.beginScope({
            left: options.goBackCommand,
            ',': options.previousPageCommand,
            '.': options.nextPageCommand
        });

        options.progressCancellation && options.progressCancellation.cancel();

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}
