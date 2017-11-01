'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Messages } from '../messages';
import { Logger } from '../logger';

export interface DiffLineWithWorkingCommandArgs {
    commit?: GitCommit;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffLineWithWorkingCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.DiffLineWithWorking);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffLineWithWorkingCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || GitService.isUncommitted(args.commit.sha)) {
            if (editor !== undefined && editor.document !== undefined && editor.document.isDirty) return undefined;

            const blameline = args.line;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri, blameline);
                if (blame === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

                args.commit = blame.commit;
                // If the line is uncommitted, find the previous commit
                if (args.commit.isUncommitted) {
                    args.commit = args.commit.with({
                        sha: args.commit.previousSha!,
                        fileName: args.commit.previousFileName!,
                        originalFileName: null,
                        previousSha: null,
                        previousFileName: null
                    });
                    args.line = blame.line.line + 1;
                }
            }
            catch (ex) {
                Logger.error(ex, 'DiffLineWithWorkingCommand', `getBlameForLine(${blameline})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

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
