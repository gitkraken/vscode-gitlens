'use strict';
// import { Iterables } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { BuiltInCommands } from '../constants';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import * as path from 'path';

export class DiffWithWorkingCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffWithWorking);
    }

    async execute(editor: TextEditor): Promise<any>;
    async execute(editor: TextEditor, uri: Uri): Promise<any>;
    async execute(editor: TextEditor, uri?: Uri, commit?: GitCommit, line?: number): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        line = line || (editor && editor.selection.active.line) || 0;

        if (!commit || GitService.isUncommitted(commit.sha)) {
            const gitUri = await GitUri.fromUri(uri, this.git);

            try {
                commit = await this.git.getLogCommit(gitUri.repoPath, gitUri.fsPath, gitUri.sha, { firstIfMissing: true });
                if (!commit) return window.showWarningMessage(`Unable to open compare. File is probably not under source control`);
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
            const compare = await this.git.getVersionedFile(commit.repoPath, commit.uri.fsPath, commit.sha);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(compare), Uri.file(path.resolve(gitUri.repoPath, workingFileName)), `${path.basename(commit.uri.fsPath)} (${commit.shortSha}) \u2194 ${path.basename(workingFileName)}`);
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithWorkingCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
    }
}
