'use strict';
import { Iterables } from '../system';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { BuiltInCommands, GlyphChars } from '../constants';
import { DiffWithWorkingCommandArgs } from './diffWithWorking';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import * as path from 'path';

export interface DiffWithPreviousCommandArgs {
    commit?: GitCommit;
    line?: number;
    range?: Range;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithPreviousCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffWithPrevious);
    }

    async execute(editor: TextEditor, uri?: Uri, args: DiffWithPreviousCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        if (args.commit !== undefined && args.commit.type !== 'file') {
            args.line = 0;
        }
        else {
            args.line = args.line || (editor === undefined ? 0 : editor.selection.active.line);
        }

        if (args.commit === undefined || args.commit.type !== 'file' || args.range !== undefined) {
            const gitUri = await GitUri.fromUri(uri, this.git);

            try {
                const sha = args.commit === undefined ? gitUri.sha : args.commit.sha;

                const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, undefined, sha !== undefined ? undefined : 2, args.range!);
                if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

                args.commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());

                // If the sha is missing and the file is uncommitted, then treat it as a DiffWithWorking
                if (gitUri.sha === undefined && await this.git.isFileUncommitted(gitUri)) return commands.executeCommand(Commands.DiffWithWorking, uri, { commit: args.commit, showOptions: args.showOptions } as DiffWithWorkingCommandArgs);
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithPreviousCommand', `getLogForFile(${gitUri.repoPath}, ${gitUri.fsPath})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        if (args.commit.previousSha === undefined) return Messages.showCommitHasNoPreviousCommitWarningMessage(args.commit);

        try {
            const [rhs, lhs] = await Promise.all([
                this.git.getVersionedFile(args.commit.repoPath, args.commit.uri.fsPath, args.commit.sha),
                this.git.getVersionedFile(args.commit.repoPath, args.commit.previousUri.fsPath, args.commit.previousSha)
            ]);

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(lhs),
                Uri.file(rhs),
                `${path.basename(args.commit.previousUri.fsPath)} (${args.commit.previousShortSha}) ${GlyphChars.ArrowLeftRight} ${path.basename(args.commit.uri.fsPath)} (${args.commit.shortSha})`,
                args.showOptions);

            if (args.line === undefined || args.line === 0) return undefined;

            // TODO: Figure out how to focus the left pane
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: args.line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithPreviousCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
    }
}