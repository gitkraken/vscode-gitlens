'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { BuiltInCommands, GlyphChars } from '../constants';
import { DiffWithPreviousCommandArgs } from './diffWithPrevious';
import { DiffWithWorkingCommandArgs } from './diffWithWorking';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import * as path from 'path';

export interface DiffLineWithPreviousCommandArgs {
    commit?: GitCommit;
    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffLineWithPreviousCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffLineWithPrevious);
    }

    async execute(editor: TextEditor, uri?: Uri, args: DiffLineWithPreviousCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);
        args.line = args.line || (editor === undefined ? gitUri.offset : editor.selection.active.line);

        if (args.commit === undefined || GitService.isUncommitted(args.commit.sha)) {
            if (editor !== undefined && editor.document !== undefined && editor.document.isDirty) return undefined;

            const blameline = args.line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri, blameline);
                if (blame === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

                args.commit = blame.commit;

                // If we don't have a sha or the current commit matches the blame, show the previous
                if (gitUri.sha === undefined || gitUri.sha === args.commit.sha) {
                    return commands.executeCommand(Commands.DiffWithPrevious, new GitUri(uri, args.commit), {
                        line: args.line,
                        showOptions: args.showOptions
                    } as DiffWithPreviousCommandArgs);
                }

                // If the line is uncommitted, find the previous commit and treat it as a DiffWithWorking
                if (args.commit.isUncommitted) {
                    uri = args.commit.uri;
                    args.commit = new GitCommit(args.commit.type, args.commit.repoPath, args.commit.previousSha!, args.commit.previousFileName!, args.commit.author, args.commit.date, args.commit.message);
                    args.line = (blame.line.line + 1) + gitUri.offset;

                    return commands.executeCommand(Commands.DiffWithWorking, uri, {
                        commit: args.commit,
                        line: args.line,
                        showOptions: args.showOptions
                    } as DiffWithWorkingCommandArgs);
                }
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithPreviousLineCommand', `getBlameForLine(${blameline})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        try {
            const [rhs, lhs] = await Promise.all([
                this.git.getVersionedFile(gitUri.repoPath, gitUri.fsPath, gitUri.sha!),
                this.git.getVersionedFile(args.commit.repoPath, args.commit.uri.fsPath, args.commit.sha)
            ]);

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(lhs),
                Uri.file(rhs),
                `${path.basename(args.commit.uri.fsPath)} (${args.commit.shortSha}) ${GlyphChars.ArrowLeftRight} ${path.basename(gitUri.fsPath)} (${gitUri.shortSha})`,
                args.showOptions);

            if (args.line === undefined || args.line === 0) return undefined;

            // TODO: Figure out how to focus the left pane
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: args.line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithPreviousLineCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
    }
}