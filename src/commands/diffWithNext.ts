'use strict';
import { Iterables } from '../system';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { BuiltInCommands } from '../constants';
import { GitLogCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import * as path from 'path';

export interface DiffWithNextCommandArgs {
    commit?: GitLogCommit;
    line?: number;
    range?: Range;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithNextCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffWithNext);
    }

    async execute(editor: TextEditor, uri?: Uri, args: DiffWithNextCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args.line = args.line || (editor === undefined ? 0 : editor.selection.active.line);

        if (args.commit === undefined || !(args.commit instanceof GitLogCommit) || args.range !== undefined) {
            const gitUri = await GitUri.fromUri(uri, this.git);

            try {
                // If the sha is missing or the file is uncommitted, treat it as a DiffWithWorking
                if (gitUri.sha === undefined && await this.git.isFileUncommitted(gitUri)) {
                    return commands.executeCommand(Commands.DiffWithWorking, uri);
                }

                const sha = args.commit === undefined ? gitUri.sha : args.commit.sha;

                const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, undefined, sha !== undefined ? undefined : 2, args.range!);
                if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

                args.commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithNextCommand', `getLogForFile(${gitUri.repoPath}, ${gitUri.fsPath})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        if (args.commit.nextSha === undefined) return commands.executeCommand(Commands.DiffWithWorking, uri);

        try {
            const [rhs, lhs] = await Promise.all([
                this.git.getVersionedFile(args.commit.repoPath, args.commit.nextUri.fsPath, args.commit.nextSha),
                this.git.getVersionedFile(args.commit.repoPath, args.commit.uri.fsPath, args.commit.sha)
            ]);

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(lhs),
                Uri.file(rhs),
                `${path.basename(args.commit.uri.fsPath)} (${args.commit.shortSha}) \u2194 ${path.basename(args.commit.nextUri.fsPath)} (${args.commit.nextShortSha})`,
                args.showOptions);

            // TODO: Figure out how to focus the left pane
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: args.line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithNextCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
    }
}