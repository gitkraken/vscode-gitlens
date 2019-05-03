'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffLineWithPreviousCommandArgs {
    commit?: GitCommit;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffLineWithPreviousCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.DiffLineWithPrevious);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffLineWithPreviousCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        const gitUri = args.commit !== undefined ? GitUri.fromCommit(args.commit) : await GitUri.fromUri(uri);

        if (gitUri.sha === undefined || GitService.isUncommitted(gitUri.sha)) {
            const blame =
                editor && editor.document.isDirty
                    ? await Container.git.getBlameForLineContents(gitUri, args.line, editor.document.getText())
                    : await Container.git.getBlameForLine(gitUri, args.line);
            if (blame === undefined) {
                return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
            }

            // If the line is uncommitted, change the previous commit
            if (blame.commit.isUncommitted) {
                // Since there could be a change in the line number, update it
                args.line = blame.line.originalLine - 1;

                try {
                    const previous = await Container.git.getPreviousUri(
                        gitUri.repoPath!,
                        gitUri,
                        gitUri.sha,
                        0,
                        args.line
                    );

                    if (previous === undefined) {
                        return Messages.showCommitHasNoPreviousCommitWarningMessage();
                    }

                    const diffArgs: DiffWithCommandArgs = {
                        repoPath: gitUri.repoPath!,
                        lhs: {
                            sha: previous.sha || '',
                            uri: previous.documentUri()
                        },
                        rhs: {
                            sha: gitUri.sha || '',
                            uri: gitUri.documentUri()
                        },
                        line: args.line,
                        showOptions: args.showOptions
                    };
                    return commands.executeCommand(Commands.DiffWith, diffArgs);
                }
                catch (ex) {
                    Logger.error(
                        ex,
                        'DiffLineWithPreviousCommand',
                        `getPreviousUri(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`
                    );
                    return Messages.showGenericErrorMessage('Unable to open compare');
                }
            }
        }

        try {
            const diffUris = await Container.git.getPreviousDiffUris(
                gitUri.repoPath!,
                gitUri,
                gitUri.sha,
                0,
                args.line
            );

            if (diffUris === undefined || diffUris.previous === undefined) {
                return Messages.showCommitHasNoPreviousCommitWarningMessage();
            }

            const diffArgs: DiffWithCommandArgs = {
                repoPath: diffUris.current.repoPath,
                lhs: {
                    sha: diffUris.previous.sha || '',
                    uri: diffUris.previous.documentUri()
                },
                rhs: {
                    sha: diffUris.current.sha || '',
                    uri: diffUris.current.documentUri()
                },
                line: args.line,
                showOptions: args.showOptions
            };
            return commands.executeCommand(Commands.DiffWith, diffArgs);
        }
        catch (ex) {
            Logger.error(
                ex,
                'DiffLineWithPreviousCommand',
                `getPreviousDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`
            );
            return Messages.showGenericErrorMessage('Unable to open compare');
        }
    }
}
