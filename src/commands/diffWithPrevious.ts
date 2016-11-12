'use strict';
import { Iterables } from '../system';
import { commands, Range, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { BuiltInCommands, Commands } from '../constants';
import GitProvider, { GitCommit, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import * as moment from 'moment';
import * as path from 'path';

export default class DiffWithPreviousCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithPrevious);
    }

    async execute(editor: TextEditor): Promise<any>;
    async execute(editor: TextEditor, edit: TextEditorEdit, uri: Uri): Promise<any>;
    async execute(editor: TextEditor, edit: TextEditorEdit, uri: Uri, commit: GitCommit, range?: Range): Promise<any>;
    async execute(editor: TextEditor, edit: TextEditorEdit, uri: Uri, commit: GitCommit, line?: number): Promise<any>;
    async execute(editor: TextEditor, edit?: TextEditorEdit, uri?: Uri, commit?: GitCommit, rangeOrLine?: Range | number): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        let line = editor.selection.active.line;
        if (typeof rangeOrLine === 'number') {
            line = rangeOrLine || line;
        }

        if (!commit || rangeOrLine instanceof Range) {
            const gitUri = GitUri.fromUri(uri);

            try {
                const log = await this.git.getLogForFile(gitUri.fsPath, gitUri.sha, gitUri.repoPath, <Range>rangeOrLine);
                if (!log) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                const sha = (commit && commit.sha) || gitUri.sha;
                commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());
            }
            catch (ex) {
                Logger.error('[GitLens.DiffWithPreviousCommand]', `getLogForFile(${gitUri.fsPath})`, ex);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        if (!commit.previousSha) {
            return window.showInformationMessage(`Commit ${commit.sha} (${commit.author}, ${moment(commit.date).fromNow()}) has no previous commit`);
        }

        try {
            const values = await Promise.all([
                this.git.getVersionedFile(commit.uri.fsPath, commit.repoPath, commit.sha),
                this.git.getVersionedFile(commit.previousUri.fsPath, commit.repoPath, commit.previousSha)
            ]);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(values[1]), Uri.file(values[0]), `${path.basename(commit.previousUri.fsPath)} (${commit.previousSha}) ↔ ${path.basename(commit.uri.fsPath)} (${commit.sha})`);
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error('[GitLens.DiffWithPreviousCommand]', 'getVersionedFile', ex);
            return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
        }
    }
}