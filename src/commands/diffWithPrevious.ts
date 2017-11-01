'use strict';
import { Iterables } from '../system';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { DiffWithWorkingCommandArgs } from './diffWithWorking';
import { GitCommit, GitCommitType, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface DiffWithPreviousCommandArgs {
    commit?: GitCommit;
    range?: Range;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithPreviousCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.DiffWithPrevious);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithPreviousCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || args.commit.type !== GitCommitType.File || args.range !== undefined) {
            const gitUri = await GitUri.fromUri(uri, this.git);

            try {
                const sha = args.commit === undefined ? gitUri.sha : args.commit.sha;
                if (sha === GitService.fakeSha) return Messages.showCommitHasNoPreviousCommitWarningMessage();

                const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, sha, { maxCount: 2, range: args.range!, skipMerges: true });
                if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

                args.commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());

                // If the sha is missing and the file is uncommitted, then treat it as a DiffWithWorking
                if (gitUri.sha === undefined && await this.git.isFileUncommitted(gitUri)) {
                    return commands.executeCommand(Commands.DiffWithWorking, uri, { commit: args.commit, showOptions: args.showOptions } as DiffWithWorkingCommandArgs);
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
                sha: args.commit.previousSha !== undefined ? args.commit.previousSha : GitService.fakeSha,
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