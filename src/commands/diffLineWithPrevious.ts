'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffLineWithPreviousCommandArgs {
    commit?: GitCommit;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffLineWithPreviousCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.DiffLineWithPrevious);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffLineWithPreviousCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        const gitUri = await GitUri.fromUri(uri);

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || GitService.isUncommitted(args.commit.sha)) {
            const blameline = args.line;
            if (blameline < 0) return undefined;

            try {
                const blame =
                    editor && editor.document && editor.document.isDirty
                        ? await Container.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
                        : await Container.git.getBlameForLine(gitUri, blameline);
                if (blame === undefined) {
                    return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
                }

                args.commit = blame.commit;

                // If the line is uncommitted, change the previous commit
                if (args.commit.isUncommitted) {
                    const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
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
