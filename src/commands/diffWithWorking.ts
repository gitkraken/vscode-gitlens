'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface DiffWithWorkingCommandArgs {
    commit?: GitCommit;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithWorkingCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.DiffWithWorking);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithWorkingCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || GitService.isUncommitted(args.commit.sha)) {
            // If the sha is missing, just let the user know the file matches
            if (gitUri.sha === undefined) return window.showInformationMessage(`File matches the working tree`);

            // If we are a fake "staged" sha, check the status
            if (GitService.isStagedUncommitted(gitUri.sha!)) {
                gitUri.sha = undefined;

                const status = await this.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
                if (status !== undefined && status.indexStatus !== undefined) {
                    const diffArgs: DiffWithCommandArgs = {
                        repoPath: gitUri.repoPath,
                        lhs: {
                            sha: GitService.stagedUncommittedSha,
                            uri: gitUri.fileUri()
                        },
                        rhs: {
                            sha: '',
                            uri: gitUri.fileUri()
                        },
                        line: args.line,
                        showOptions: args.showOptions
                    };

                    return commands.executeCommand(Commands.DiffWith, diffArgs);
                }
            }

            try {
                args.commit = await this.git.getLogCommit(gitUri.repoPath, gitUri.fsPath, gitUri.sha, { firstIfMissing: true });
                if (args.commit === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithWorkingCommand', `getLogCommit(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        const workingFileName = await this.git.findWorkingFileName(gitUri.repoPath, gitUri.fsPath);
        if (workingFileName === undefined) return undefined;

        const diffArgs: DiffWithCommandArgs = {
            repoPath: args.commit.repoPath,
            lhs: {
                sha: args.commit.sha,
                uri: args.commit.uri
            },
            rhs: {
                sha: '',
                uri: args.commit.uri
            },
            line: args.line,
            showOptions: args.showOptions
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }
}
