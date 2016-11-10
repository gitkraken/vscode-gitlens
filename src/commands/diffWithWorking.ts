'use strict';
import { Iterables } from '../system';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { BuiltInCommands, Commands } from '../constants';
import GitProvider, { GitCommit } from '../gitProvider';
import { Logger } from '../logger';
import * as path from 'path';

export default class DiffWithWorkingCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithWorking);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit): Promise<any>;
    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, commit?: GitCommit, line?: number): Promise<any> {
        line = line || editor.selection.active.line;

        if (!commit || GitProvider.isUncommitted(commit.sha)) {
            if (!(uri instanceof Uri)) {
                if (!editor.document) return undefined;
                uri = editor.document.uri;
            }

            try {
                const log = await this.git.getLogForFile(uri.fsPath);
                if (!log) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                commit = Iterables.first(log.commits.values());
            }
            catch (ex) {
                Logger.error('[GitLens.DiffWithWorkingCommand]', `getLogForFile(${uri.fsPath})`, ex);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        try {
            const compare = await this.git.getVersionedFile(commit.uri.fsPath, commit.repoPath, commit.sha);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(compare), uri, `${path.basename(commit.uri.fsPath)} (${commit.sha}) ↔ ${path.basename(uri.fsPath)}`);
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error('[GitLens.DiffWithWorkingCommand]', 'getVersionedFile', ex);
            return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
        }
    }
}
