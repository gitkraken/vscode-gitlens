'use strict';
import { CancellationTokenSource, commands, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitTag, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ChooseFromBranchesAndTagsQuickPickItem, CommandQuickPickItem, FileHistoryQuickPick } from '../quickpicks';
import { Iterables, Strings } from '../system';
import { ActiveEditorCommand, Commands, getCommandUri, openEditor } from './common';

export interface OpenFileRevisionCommandArgs {
    branchOrTag?: GitBranch | GitTag;
    uri?: Uri;
    maxCount?: number;

    line?: number;
    showOptions?: TextDocumentShowOptions;
    annotationType?: FileAnnotationType;
    nextPageCommand?: CommandQuickPickItem;
}

export class OpenFileRevisionCommand extends ActiveEditorCommand {
    static getMarkdownCommandArgs(args: OpenFileRevisionCommandArgs): string;
    static getMarkdownCommandArgs(uri: Uri, annotationType?: FileAnnotationType, line?: number): string;
    static getMarkdownCommandArgs(
        argsOrUri: OpenFileRevisionCommandArgs | Uri,
        annotationType?: FileAnnotationType,
        line?: number
    ): string {
        let args: OpenFileRevisionCommandArgs | Uri;
        if (argsOrUri instanceof Uri) {
            const uri = argsOrUri;

            args = {
                uri: uri,
                line: line,
                annotationType: annotationType
            };
        }
        else {
            args = argsOrUri;
        }

        return super.getMarkdownCommandArgsCore<OpenFileRevisionCommandArgs>(Commands.OpenFileRevision, args);
    }

    constructor() {
        super(Commands.OpenFileRevision);
    }

    async execute(editor: TextEditor, uri?: Uri, args: OpenFileRevisionCommandArgs = {}) {
        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        let progressCancellation: CancellationTokenSource | undefined;

        try {
            if (args.uri == null) {
                uri = getCommandUri(uri, editor);
                if (uri == null) return undefined;

                const gitUri = await GitUri.fromUri(uri);

                const placeHolder = `Open revision of ${gitUri.getFormattedPath({
                    suffix: args.branchOrTag ? ` (${args.branchOrTag.name})` : undefined
                })}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''}${
                    GlyphChars.Ellipsis
                }`;

                progressCancellation = FileHistoryQuickPick.showProgress(placeHolder);

                const log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, {
                    maxCount: args.maxCount,
                    ref: (args.branchOrTag && args.branchOrTag.ref) || gitUri.sha
                });
                if (log === undefined) {
                    if (args.branchOrTag) {
                        return window.showWarningMessage(`The file could not be found in ${args.branchOrTag.name}`);
                    }
                    return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open history compare');
                }

                if (progressCancellation.token.isCancellationRequested) return undefined;

                let previousPageCommand: CommandQuickPickItem | undefined = undefined;

                if (log.truncated) {
                    const npc = new CommandQuickPickItem(
                        {
                            label: `$(arrow-right) Show Next Commits`,
                            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} newer commits`
                        },
                        Commands.OpenFileRevision,
                        [uri, { ...args } as OpenFileRevisionCommandArgs]
                    );

                    const last = Iterables.last(log.commits.values());
                    if (last != null) {
                        previousPageCommand = new CommandQuickPickItem(
                            {
                                label: `$(arrow-left) Show Previous Commits`,
                                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} older commits`
                            },
                            Commands.OpenFileRevision,
                            [new GitUri(uri, last), { ...args, nextPageCommand: npc } as OpenFileRevisionCommandArgs]
                        );
                    }
                }

                const currentCommand = new CommandQuickPickItem(
                    {
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to history of ${
                            GlyphChars.Space
                        }$(file-text) ${gitUri.getFormattedPath()}${
                            args.branchOrTag
                                ? ` from ${GlyphChars.Space}${
                                      args.branchOrTag instanceof GitTag ? '$(tag)' : '$(git-branch)'
                                  } ${args.branchOrTag.name}`
                                : gitUri.sha
                                    ? ` from ${GlyphChars.Space}$(git-commit) ${gitUri.shortSha}`
                                    : ''
                        }`
                    },
                    Commands.OpenFileRevision,
                    [uri, { ...args }]
                );

                const pick = await FileHistoryQuickPick.show(log, gitUri, placeHolder, {
                    pickerOnly: true,
                    progressCancellation: progressCancellation,
                    currentCommand: currentCommand,
                    nextPageCommand: args.nextPageCommand,
                    previousPageCommand: previousPageCommand,
                    showAllCommand:
                        log !== undefined && log.truncated
                            ? new CommandQuickPickItem(
                                  {
                                      label: `$(sync) Show All Commits`,
                                      description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                                  },
                                  Commands.OpenFileRevision,
                                  [uri, { ...args, maxCount: 0 } as OpenFileRevisionCommandArgs]
                              )
                            : undefined
                });
                if (pick === undefined) return undefined;

                if (pick instanceof ChooseFromBranchesAndTagsQuickPickItem) {
                    const branchOrTag = await pick.execute();
                    if (branchOrTag === undefined) return undefined;
                    if (branchOrTag instanceof CommandQuickPickItem) return branchOrTag.execute();

                    return commands.executeCommand(Commands.OpenFileRevision, gitUri, {
                        ...args,
                        branchOrTag: branchOrTag.branchOrTag,
                        goBackCommand: currentCommand
                    } as OpenFileRevisionCommandArgs);
                }
                else {
                    if (pick instanceof CommandQuickPickItem) return pick.execute();

                    args.uri = GitUri.toRevisionUri(pick.commit.sha, pick.commit.uri.fsPath, pick.commit.repoPath);
                }
            }

            if (args.line !== undefined && args.line !== 0) {
                if (args.showOptions === undefined) {
                    args.showOptions = {};
                }
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            const e = await openEditor(args.uri!, { ...args.showOptions, rethrow: true });
            if (args.annotationType === undefined) return e;

            return Container.fileAnnotations.show(e!, args.annotationType, args.line);
        }
        catch (ex) {
            Logger.error(ex, 'OpenFileRevisionCommand');
            return window.showErrorMessage(`Unable to open file revision. See output channel for more details`);
        }
        finally {
            progressCancellation && progressCancellation.cancel();
        }
    }
}
