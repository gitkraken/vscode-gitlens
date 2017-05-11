'use strict';
import { Iterables } from '../system';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { BuiltInCommands } from '../constants';
import { GitLogCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import * as path from 'path';

export class DiffWithNextCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
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
                    if (await this.git.isFileUncommitted(gitUri)) {
                        return commands.executeCommand(Commands.DiffWithWorking, uri);
                    }
                }

                const sha = (commit && commit.sha) || gitUri.sha;

                const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, undefined, sha ? undefined : 2, rangeOrLine!);
                if (!log) return window.showWarningMessage(`Unable to open compare. File is probably not under source control`);

                commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithNextCommand', `getLogForFile(${gitUri.repoPath}, ${gitUri.fsPath})`);
                return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
            }
        }

        if (!commit.nextSha) {
            return commands.executeCommand(Commands.DiffWithWorking, uri);
        }

        try {
            const [rhs, lhs] = await Promise.all([
                this.git.getVersionedFile(commit.repoPath, commit.nextUri.fsPath, commit.nextSha),
                this.git.getVersionedFile(commit.repoPath, commit.uri.fsPath, commit.sha)
            ]);
            await commands.executeCommand(BuiltInCommands.Diff, Uri.file(lhs), Uri.file(rhs), `${path.basename(commit.uri.fsPath)} (${commit.shortSha}) \u2194 ${path.basename(commit.nextUri.fsPath)} (${commit.nextShortSha})`);
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithNextCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
    }
}