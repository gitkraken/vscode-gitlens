'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithWorkingCommandArgs {
    commit?: GitCommit;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithWorkingCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.DiffWithWorking);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithWorkingCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        const gitUri = await GitUri.fromUri(uri);

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || GitService.isUncommitted(args.commit.sha)) {
            // If the sha is missing, just let the user know the file matches
            if (gitUri.sha === undefined) return window.showInformationMessage(`File matches the working tree`);

            // If we are a fake "staged" sha, check the status
            if (GitService.isStagedUncommitted(gitUri.sha!)) {
                gitUri.sha = undefined;

                const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
                if (status !== undefined && status.indexStatus !== undefined) {
                    const diffArgs: DiffWithCommandArgs = {
                        repoPath: gitUri.repoPath,
                        lhs: {
                            sha: GitService.stagedUncommittedSha,
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
                args.commit = await Container.git.getLogCommitForFile(gitUri.repoPath, gitUri.fsPath, {
                    ref: gitUri.sha,
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
                    `getLogCommit(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`
                );
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        const [workingFileName] = await Container.git.findWorkingFileName(gitUri.fsPath, gitUri.repoPath);
        if (workingFileName === undefined) return undefined;

        args.commit.workingFileName = workingFileName;

        const diffArgs: DiffWithCommandArgs = {
            repoPath: args.commit.repoPath,
            lhs: {
                sha: args.commit.sha,
                uri: args.commit.uri
            },
            rhs: {
                sha: '',
                uri: args.commit.workingUri
            },
            line: args.line,
            showOptions: args.showOptions
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }
}
