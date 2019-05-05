'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, CommandContext, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { UriComparer } from '../comparers';

export interface DiffWithWorkingCommandArgs {
    commit?: GitCommit;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithWorkingCommand extends ActiveEditorCommand {
    constructor() {
        super([Commands.DiffWithWorking, Commands.DiffWithWorkingInDiff]);
    }

    protected preExecute(context: CommandContext, args: DiffWithWorkingCommandArgs = {}) {
        if (
            context.command === Commands.DiffWithWorkingInDiff
            // || (context.editor !== undefined && context.editor.viewColumn === undefined)
        ) {
            // HACK: If in a diff, try to determine if we are on the right or left side
            // If there is a context uri and it doesn't match the editor uri, assume we are on the left
            // If on the left, use the editor uri and pretend we aren't in a diff
            if (context.uri !== undefined && context.editor !== undefined && context.editor.document !== undefined) {
                if (!UriComparer.equals(context.uri, context.editor.document.uri, { exact: true })) {
                    return this.execute(context.editor, context.editor.document.uri, args);
                }
            }
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithWorkingCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        const gitUri = await GitUri.fromUri(uri);

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || args.commit.isUncommitted) {
            // If the sha is missing, just let the user know the file matches
            if (gitUri.sha === undefined) return window.showInformationMessage('File matches the working tree');
            if (gitUri.sha === GitService.deletedOrMissingSha) {
                return window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');
            }

            // If we are a fake "staged" sha, check the status
            let ref: string | undefined = gitUri.sha;
            if (gitUri.isUncommittedStaged) {
                ref = undefined;

                const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
                if (status !== undefined && status.indexStatus !== undefined) {
                    const diffArgs: DiffWithCommandArgs = {
                        repoPath: gitUri.repoPath,
                        lhs: {
                            sha: GitService.uncommittedStagedSha,
                            uri: gitUri.documentUri()
                        },
                        rhs: {
                            sha: '',
                            uri: gitUri.documentUri()
                        },
                        line: args.line,
                        showOptions: args.showOptions
                    };

                    return commands.executeCommand(Commands.DiffWith, diffArgs);
                }
            }

            try {
                args.commit = await Container.git.getCommitForFile(gitUri.repoPath, gitUri.fsPath, {
                    ref: ref,
                    firstIfNotFound: true
                });
                if (args.commit === undefined) {
                    return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
                }
            }
            catch (ex) {
                Logger.error(
                    ex,
                    'DiffWithWorkingCommand',
                    `getLogCommit(${gitUri.repoPath}, ${gitUri.fsPath}, ${ref})`
                );
                return Messages.showGenericErrorMessage('Unable to open compare');
            }
        }

        const workingUri = await args.commit.getWorkingUri();
        if (workingUri === undefined) {
            return window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');
        }

        const diffArgs: DiffWithCommandArgs = {
            repoPath: args.commit.repoPath,
            lhs: {
                sha: args.commit.sha,
                uri: args.commit.uri
            },
            rhs: {
                sha: '',
                uri: workingUri
            },
            line: args.line,
            showOptions: args.showOptions
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }
}
