'use strict';
import { Iterables } from '../system';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { GitLogCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface DiffWithNextCommandArgs {
    commit?: GitLogCommit;
    range?: Range;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithNextCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.DiffWithNext);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithNextCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || !(args.commit instanceof GitLogCommit) || args.range !== undefined) {
            const gitUri = await GitUri.fromUri(uri, this.git);

            try {
                // If the sha is missing or the file is uncommitted, treat it as a DiffWithWorking
                if (gitUri.sha === undefined && await this.git.isFileUncommitted(gitUri)) {
                    return commands.executeCommand(Commands.DiffWithWorking, uri);
                }

                const sha = args.commit === undefined ? gitUri.sha : args.commit.sha;

                const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, undefined, { maxCount: sha !== undefined ? undefined : 2, range: args.range! });
                if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

                args.commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithNextCommand', `getLogForFile(${gitUri.repoPath}, ${gitUri.fsPath})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        if (args.commit.nextSha === undefined) return commands.executeCommand(Commands.DiffWithWorking, uri);

        const diffArgs: DiffWithCommandArgs = {
            repoPath: args.commit.repoPath,
            lhs: {
                sha: args.commit.sha,
                uri: args.commit.uri
            },
            rhs: {
                sha: args.commit.nextSha,
                uri: args.commit.nextUri
            },
            line: args.line,
            showOptions: args.showOptions
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }
}