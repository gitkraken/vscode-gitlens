'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface DiffLineWithPreviousCommandArgs {
    commit?: GitCommit;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffLineWithPreviousCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.DiffLineWithPrevious);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffLineWithPreviousCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || GitService.isUncommitted(args.commit.sha)) {
            const blameline = args.line;
            if (blameline < 0) return undefined;

            try {
                const blame = editor && editor.document && editor.document.isDirty
                    ? await this.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
                    : await this.git.getBlameForLine(gitUri, blameline);
                if (blame === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

                args.commit = blame.commit;

                // If the line is uncommitted, change the previous commit
                if (args.commit.isUncommitted) {
                    const status = await this.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
                    if (status !== undefined && status.indexStatus !== undefined) {
                        args.commit = args.commit.with({
                            sha: GitService.stagedUncommittedSha
                        });
                    }
                }
            }
            catch (ex) {
                Logger.error(ex, 'DiffLineWithPreviousCommand', `getBlameForLine(${blameline})`);
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