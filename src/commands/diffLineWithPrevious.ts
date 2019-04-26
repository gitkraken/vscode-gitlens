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

            // Since there could be a change in the line number, update it
            args.line = blame.line.originalLine - 1;

            // If the line is uncommitted, change the previous commit
            if (blame.commit.isUncommitted) {
                try {
                    const previous = await Container.git.getPreviousRevisionUri(
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
                        `getPreviousRevisionUri(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`
                    );
                    return Messages.showGenericErrorMessage('Unable to open compare');
                }
            }
        }

        try {
            const diffWith = await Container.git.getDiffWithPreviousForFile(
                gitUri.repoPath!,
                gitUri,
                gitUri.sha,
                0,
                args.line
            );

            if (diffWith === undefined || diffWith.previous === undefined) {
                return Messages.showCommitHasNoPreviousCommitWarningMessage();
            }

            const diffArgs: DiffWithCommandArgs = {
                repoPath: diffWith.current.repoPath,
                lhs: {
                    sha: diffWith.previous.sha || '',
                    uri: diffWith.previous.documentUri()
                },
                rhs: {
                    sha: diffWith.current.sha || '',
                    uri: diffWith.current.documentUri()
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
                `getDiffWithPreviousForFile(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`
            );
            return Messages.showGenericErrorMessage('Unable to open compare');
        }
    }
}
