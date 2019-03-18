'use strict';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { Iterables } from '../system';

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

        const gitUri = await GitUri.fromUri(uri);

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || GitService.isUncommitted(args.commit.sha)) {
            if (args.line < 0) return undefined;

            try {
                if (!GitService.isStagedUncommitted(gitUri.sha)) {
                    const blame =
                        editor && editor.document && editor.document.isDirty
                            ? await Container.git.getBlameForLineContents(gitUri, args.line, editor.document.getText())
                            : await Container.git.getBlameForLine(gitUri, args.line);
                    if (blame === undefined) {
                        return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
                    }

                    // If the line is uncommitted, change the previous commit
                    if (blame.commit.isUncommitted) {
                        const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
                        if (status !== undefined && status.indexStatus !== undefined) {
                            args.commit = blame.commit.with({
                                sha: GitService.stagedUncommittedSha
                            });
                        }
                    }
                }

                if (args.commit === undefined) {
                    const log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, {
                        maxCount: 2,
                        range: new Range(args.line, 0, args.line, 0),
                        ref:
                            gitUri.sha === undefined || GitService.isStagedUncommitted(gitUri.sha)
                                ? undefined
                                : `${gitUri.sha}^`,
                        renames: true
                    });
                    if (log === undefined) {
                        return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
                    }

                    args.commit = (gitUri.sha && log.commits.get(gitUri.sha)) || Iterables.first(log.commits.values());
                }
            }
            catch (ex) {
                Logger.error(ex, 'DiffLineWithPreviousCommand', `getLogForFile(${args.line})`);
                return Messages.showGenericErrorMessage('Unable to open compare');
            }
        }

        const diffArgs: DiffWithCommandArgs = {
            repoPath: args.commit.repoPath,
            lhs: {
                sha: args.commit.sha,
                uri: args.commit.uri
            },
            rhs: {
                sha: gitUri.sha || '',
                uri: gitUri
            },
            line: args.line,
            showOptions: args.showOptions
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }
}
