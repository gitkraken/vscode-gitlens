'use strict';
import * as paths from 'path';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitLog, GitReference, GitTag, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import {
    CommandQuickPickItem,
    FileHistoryQuickPick,
    ShowFileHistoryFromQuickPickItem,
    ShowFileHistoryInViewQuickPickItem
} from '../quickpicks';
import { Iterables, Strings } from '../system';
import { ActiveEditorCachedCommand, command, CommandContext, Commands, getCommandUri } from './common';
import { ShowQuickCommitFileDetailsCommandArgs } from './showQuickCommitFileDetails';

export interface ShowQuickFileHistoryCommandArgs {
    reference?: GitBranch | GitTag | GitReference;
    log?: GitLog;
    maxCount?: number;
    range?: Range;
    showInView?: boolean;

    goBackCommand?: CommandQuickPickItem;
    nextPageCommand?: CommandQuickPickItem;
}

@command()
export class ShowQuickFileHistoryCommand extends ActiveEditorCachedCommand {
    constructor() {
        super([Commands.ShowFileHistoryInView, Commands.ShowQuickFileHistory]);
    }

    protected preExecute(context: CommandContext, args: ShowQuickFileHistoryCommandArgs = {}) {
        if (context.command === Commands.ShowFileHistoryInView) {
            args = { ...args };
            args.showInView = true;
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowQuickFileHistoryCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri == null) return commands.executeCommand(Commands.ShowQuickCurrentBranchHistory);

        const gitUri = await GitUri.fromUri(uri);

        if (args.showInView) {
            await Container.fileHistoryView.showHistoryForUri(gitUri);

            return undefined;
        }

        args = { ...args };

        const placeHolder = `${gitUri.getFormattedPath({
            suffix: args.reference ? ` (${args.reference.name})` : undefined
        })}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''}`;

        const progressCancellation = FileHistoryQuickPick.showProgress(placeHolder);

        try {
            if (args.log === undefined) {
                args.log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, {
                    maxCount: args.maxCount,
                    range: args.range,
                    ref: (args.reference && args.reference.ref) || gitUri.sha
                });
                if (args.log === undefined) {
                    if (args.reference) {
                        return window.showWarningMessage(`The file could not be found in ${args.reference.name}`);
                    }
                    return Messages.showFileNotUnderSourceControlWarningMessage('Unable to show file history');
                }
            }

            if (progressCancellation !== undefined && progressCancellation.token.isCancellationRequested) {
                return undefined;
            }

            let previousPageCommand: CommandQuickPickItem | undefined = undefined;

            if (args.log.truncated) {
                let commandArgs: ShowQuickFileHistoryCommandArgs;
                commandArgs = { ...args, log: undefined };
                const npc = new CommandQuickPickItem(
                    {
                        label: '$(arrow-right) Show Next Commits',
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${args.log.maxCount} newer commits`
                    },
                    Commands.ShowQuickFileHistory,
                    [gitUri, commandArgs]
                );

                const last = Iterables.last(args.log.commits.values());
                if (last != null) {
                    commandArgs = { ...args, log: undefined, nextPageCommand: npc };
                    previousPageCommand = new CommandQuickPickItem(
                        {
                            label: '$(arrow-left) Show Previous Commits',
                            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${
                                args.log.maxCount
                            } older commits`
                        },
                        Commands.ShowQuickFileHistory,
                        [new GitUri(uri, last), commandArgs]
                    );
                }
            }

            const icon =
                args.reference instanceof GitTag
                    ? '$(tag) '
                    : args.reference instanceof GitBranch
                    ? '$(git-branch) '
                    : '';
            // Create a command to get back to where we are right now
            const currentCommand = new CommandQuickPickItem(
                {
                    label: `go back ${GlyphChars.ArrowBack}`,
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to history of ${
                        GlyphChars.Space
                    }$(file-text) ${paths.basename(gitUri.fsPath)}${
                        args.reference
                            ? ` from ${GlyphChars.Space}${icon}${args.reference.name}`
                            : gitUri.sha
                            ? ` from ${GlyphChars.Space}$(git-commit) ${gitUri.shortSha}`
                            : ''
                    }`
                },
                Commands.ShowQuickFileHistory,
                [uri, args]
            );

            const pick = await FileHistoryQuickPick.show(args.log, gitUri, placeHolder, {
                progressCancellation: progressCancellation,
                currentCommand: currentCommand,
                goBackCommand: args.goBackCommand,
                nextPageCommand: args.nextPageCommand,
                previousPageCommand: previousPageCommand,
                showAllCommand:
                    args.log !== undefined && args.log.truncated
                        ? new CommandQuickPickItem(
                              {
                                  label: '$(sync) Show All Commits',
                                  description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                              },
                              Commands.ShowQuickFileHistory,
                              [uri, { ...args, log: undefined, maxCount: 0 }]
                          )
                        : undefined,
                showInViewCommand:
                    args.log !== undefined
                        ? new ShowFileHistoryInViewQuickPickItem(
                              gitUri,
                              (args.reference && args.reference.ref) || gitUri.sha
                          )
                        : undefined
            });
            if (pick === undefined) return undefined;

            if (pick instanceof ShowFileHistoryFromQuickPickItem) {
                const reference = await pick.execute();
                if (reference === undefined) return undefined;
                if (reference instanceof CommandQuickPickItem) return reference.execute();

                const commandArgs: ShowQuickFileHistoryCommandArgs = {
                    ...args,
                    log: undefined,
                    reference: reference.item,
                    goBackCommand: currentCommand
                };
                return commands.executeCommand(Commands.ShowQuickFileHistory, gitUri, commandArgs);
            }

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            const commandArgs: ShowQuickCommitFileDetailsCommandArgs = {
                commit: pick.commit,
                fileLog: args.log,
                sha: pick.commit.sha,
                goBackCommand: currentCommand
            };

            return commands.executeCommand(Commands.ShowQuickCommitFileDetails, pick.commit.toGitUri(), commandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickFileHistoryCommand');
            return Messages.showGenericErrorMessage('Unable to show file history');
        }
        finally {
            progressCancellation && progressCancellation.cancel();
        }
    }
}
