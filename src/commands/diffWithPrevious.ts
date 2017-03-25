'use strict';
import { Iterables } from '../system';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { BuiltInCommands } from '../constants';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import * as moment from 'moment';
import * as path from 'path';

export class DiffWithPreviousCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffWithPrevious);
    }

    async execute(editor: TextEditor): Promise<any>;
    async execute(editor: TextEditor, uri: Uri): Promise<any>;
    async execute(editor: TextEditor, uri: Uri, commit: GitCommit, range?: Range): Promise<any>;
    async execute(editor: TextEditor, uri: Uri, commit: GitCommit, line?: number): Promise<any>;
    async execute(editor: TextEditor, uri?: Uri, commit?: GitCommit, rangeOrLine?: Range | number): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        let line = (editor && editor.selection.active.line) || 0;
        if (typeof rangeOrLine === 'number') {
            line = rangeOrLine || line;
            rangeOrLine = undefined;
        }

        if (!commit || rangeOrLine instanceof Range) {
            const gitUri = await GitUri.fromUri(uri, this.git);

            try {
                if (!gitUri.sha) {
                    // If the file is uncommitted, treat it as a DiffWithWorking
                    if (await this.git.isFileUncommitted(gitUri)) {
                        return commands.executeCommand(Commands.DiffWithWorking, uri);
                    }
                }

                const sha = (commit && commit.sha) || gitUri.sha;

                const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, undefined, sha ? undefined : 2, rangeOrLine as Range);
                if (!log) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());
            }
            catch (ex) {
                Logger.error('[GitLens.DiffWithPreviousCommand]', `getLogForFile(${gitUri.repoPath}, ${gitUri.fsPath})`, ex);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        if (!commit.previousSha) {
            return window.showInformationMessage(`Commit ${commit.shortSha} (${commit.author}, ${moment(commit.date).fromNow()}) has no previous commit`);
        }

        try {
            const [rhs, lhs] = await Promise.all([
                this.git.getVersionedFile(commit.repoPath, commit.uri.fsPath, commit.sha),
                this.git.getVersionedFile(commit.repoPath, commit.previousUri.fsPath, commit.previousSha)
            ]);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(lhs), Uri.file(rhs), `${path.basename(commit.previousUri.fsPath)} (${commit.previousShortSha}) ↔ ${path.basename(commit.uri.fsPath)} (${commit.shortSha})`);
            // TODO: Figure out how to focus the left pane
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error('[GitLens.DiffWithPreviousCommand]', 'getVersionedFile', ex);
            return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
        }
    }
}