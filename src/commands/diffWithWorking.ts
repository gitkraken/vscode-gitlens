'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { BuiltInCommands, GlyphChars } from '../constants';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import * as path from 'path';

export interface DiffWithWorkingCommandArgs {
    commit?: GitCommit;
    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithWorkingCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffWithWorking);
    }

    async execute(editor: TextEditor, uri?: Uri, args: DiffWithWorkingCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args.line = args.line || (editor === undefined ? 0 : editor.selection.active.line);

        if (args.commit === undefined || GitService.isUncommitted(args.commit.sha)) {
            const gitUri = await GitUri.fromUri(uri, this.git);
            // If the sha is missing, just let the user know the file matches
            if (gitUri.sha === undefined) return window.showInformationMessage(`File matches the working tree`);

            try {
                args.commit = await this.git.getLogCommit(gitUri.repoPath, gitUri.fsPath, gitUri.sha, { firstIfMissing: true });
                if (args.commit === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithWorkingCommand', `getLogCommit(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        const workingFileName = await this.git.findWorkingFileName(gitUri.repoPath, gitUri.fsPath);
        if (workingFileName === undefined) return undefined;

        try {
            const compare = await this.git.getVersionedFile(args.commit.repoPath, args.commit.uri.fsPath, args.commit.sha);

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(compare),
                Uri.file(path.resolve(gitUri.repoPath, workingFileName)),
                `${path.basename(args.commit.uri.fsPath)} (${args.commit.shortSha}) ${GlyphChars.ArrowLeftRight} ${path.basename(workingFileName)}`,
                args.showOptions);

            if (args.line === undefined || args.line === 0) return undefined;

            // TODO: Figure out how to focus the left pane
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: args.line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithWorkingCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
    }
}
