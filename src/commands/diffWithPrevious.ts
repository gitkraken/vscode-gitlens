'use strict';
import { Iterables } from '../system';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { Container } from '../container';
import { DiffWithCommandArgs } from './diffWith';
import { DiffWithWorkingCommandArgs } from './diffWithWorking';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface DiffWithPreviousCommandArgs {
    commit?: GitCommit;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithPreviousCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.DiffWithPrevious);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithPreviousCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || !args.commit.isFile) {
            const gitUri = await GitUri.fromUri(uri);

            try {
                let sha = args.commit === undefined ? gitUri.sha : args.commit.sha;
                if (sha === GitService.deletedSha) return Messages.showCommitHasNoPreviousCommitWarningMessage();

                // If we are a fake "staged" sha, remove it
                let isStagedUncommitted = false;
                if (GitService.isStagedUncommitted(sha!)) {
                    gitUri.sha = sha = undefined;
                    isStagedUncommitted = true;
                }

                const log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { maxCount: 2, ref: sha, skipMerges: true });
                if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

                args.commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());

                // If the sha is missing and the file is uncommitted, then treat it as a DiffWithWorking
                if (gitUri.sha === undefined) {
                    const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
                    if (status !== undefined) {
                        if (isStagedUncommitted) {
                            const diffArgs: DiffWithCommandArgs = {
                                repoPath: args.commit.repoPath,
                                lhs: {
                                    sha: args.commit.sha,
                                    uri: args.commit.uri
                                },
                                rhs: {
                                    sha: GitService.stagedUncommittedSha,
                                    uri: args.commit.uri
                                },
                                line: args.line,
                                showOptions: args.showOptions
                            };
                            return commands.executeCommand(Commands.DiffWith, diffArgs);
                        }

                        // Check if the file is staged
                        if (status.indexStatus !== undefined) {
                            const diffArgs: DiffWithCommandArgs = {
                                repoPath: args.commit.repoPath,
                                lhs: {
                                    sha: GitService.stagedUncommittedSha,
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

                        return commands.executeCommand(Commands.DiffWithWorking, uri, { commit: args.commit, showOptions: args.showOptions } as DiffWithWorkingCommandArgs);
                    }
                }
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithPreviousCommand', `getLogForFile(${gitUri.repoPath}, ${gitUri.fsPath})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        const diffArgs: DiffWithCommandArgs = {
            repoPath: args.commit.repoPath,
            lhs: {
                sha: args.commit.previousSha !== undefined ? args.commit.previousSha : GitService.deletedSha,
                uri: args.commit.previousUri
            },
            rhs: {
                sha: args.commit.sha,
                uri: args.commit.uri
            },
            line: args.line,
            showOptions: args.showOptions
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }
}