'use strict';
import { Iterables } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
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
                const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, gitUri.sha, undefined, gitUri.sha ? undefined : 1);
                if (!log) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                commit = (gitUri.sha && log.commits.get(gitUri.sha)) || Iterables.first(log.commits.values());
            }
            catch (ex) {
                Logger.error('[GitLens.DiffWithWorkingCommand]', `getLogForFile(${gitUri.repoPath}, ${gitUri.fsPath})`, ex);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        try {
            const compare = await this.git.getVersionedFile(commit.repoPath, commit.uri.fsPath, commit.sha);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(compare), gitUri.fileUri(), `${path.basename(commit.uri.fsPath)} (${commit.shortSha}) ↔ ${path.basename(gitUri.fsPath)}`);
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error('[GitLens.DiffWithWorkingCommand]', 'getVersionedFile', ex);
            return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
        }
    }
}
