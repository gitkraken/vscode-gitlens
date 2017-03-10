'use strict';
import { Iterables } from '../system';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { BuiltInCommands } from '../constants';
import { GitLogCommit, GitProvider, GitUri } from '../gitProvider';
import { Logger } from '../logger';
// import * as moment from 'moment';
import * as path from 'path';

export class DiffWithNextCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.DiffWithNext);
    }

    async execute(editor: TextEditor): Promise<any>;
    async execute(editor: TextEditor, uri: Uri): Promise<any>;
    async execute(editor: TextEditor, uri: Uri, commit: GitLogCommit, range?: Range): Promise<any>;
    async execute(editor: TextEditor, uri: Uri, commit: GitLogCommit, line?: number): Promise<any>;
    async execute(editor: TextEditor, uri?: Uri, commit?: GitLogCommit, rangeOrLine?: Range | number): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        let line = (editor && editor.selection.active.line) || 0;
        if (typeof rangeOrLine === 'number') {
            line = rangeOrLine || line;
            rangeOrLine = undefined;
        }

        if (!commit || !(commit instanceof GitLogCommit) || rangeOrLine instanceof Range) {
            const gitUri = await GitUri.fromUri(uri, this.git);

            try {
                if (!gitUri.sha) {
                    // If the file is uncommitted, treat it as a DiffWithWorking
                    if (await this.git.isFileUncommitted(gitUri.fsPath, gitUri.repoPath)) {
                        return commands.executeCommand(Commands.DiffWithWorking, uri);
                    }
                }

                const sha = (commit && commit.sha) || gitUri.sha;

                const log = await this.git.getLogForFile(gitUri.fsPath, undefined, gitUri.repoPath, rangeOrLine as Range, sha ? undefined : 2);
                if (!log) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());
            }
            catch (ex) {
                Logger.error('[GitLens.DiffWithNextCommand]', `getLogForFile(${gitUri.fsPath})`, ex);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        if (!commit.nextSha) {
            return commands.executeCommand(Commands.DiffWithWorking, uri);
        }

        try {
            const [rhs, lhs] = await Promise.all([
                this.git.getVersionedFile(commit.nextUri.fsPath, commit.repoPath, commit.nextSha),
                this.git.getVersionedFile(commit.uri.fsPath, commit.repoPath, commit.sha)
            ]);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(lhs), Uri.file(rhs), `${path.basename(commit.uri.fsPath)} (${commit.sha}) ↔ ${path.basename(commit.nextUri.fsPath)} (${commit.nextSha})`);
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error('[GitLens.DiffWithNextCommand]', 'getVersionedFile', ex);
            return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
        }
    }
}