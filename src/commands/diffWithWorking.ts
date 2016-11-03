'use strict';
import { Iterables } from '../system';
import { commands, TextEditor, TextEditorEdit, Uri } from 'vscode';
import { EditorCommand } from './commands';
import { BuiltInCommands, Commands } from '../constants';
import BlameAnnotationController from '../blameAnnotationController';
import GitProvider from '../gitProvider';
import * as path from 'path';

export default class DiffWithWorkingCommand extends EditorCommand {
    constructor(private git: GitProvider, private annotationController: BlameAnnotationController) {
        super(Commands.DiffWithWorking);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, repoPath?: string, sha?: string, shaUri?: Uri, line?: number) {
        line = line || editor.selection.active.line;
        if (sha && !GitProvider.isUncommitted(sha)) {
            return this.git.getVersionedFile(shaUri.fsPath, repoPath, sha)
                .then(compare => commands.executeCommand(BuiltInCommands.Diff, Uri.file(compare), uri, `${path.basename(shaUri.fsPath)} (${sha}) ↔ ${path.basename(uri.fsPath)}`))
                .then(() => commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' }))
                .catch(ex => console.error('[GitLens.DiffWithWorkingCommand]', 'getVersionedFile', ex));
        }

        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        if (this.annotationController.annotated) {
            try {
                const blame = await this.git.getBlameForLine(uri.fsPath, line);
                if (!blame) return undefined;

                const commit = blame.commit;
                // If the line is uncommitted, find the previous commit
                if (commit.isUncommitted) {
                    return commands.executeCommand(Commands.DiffWithWorking, commit.uri, commit.repoPath, commit.previousSha, commit.previousUri, blame.line.line + 1);
                }
                return commands.executeCommand(Commands.DiffWithWorking, commit.uri, commit.repoPath, commit.sha, commit.uri, line);
            }
            catch (ex) {
                console.error('[GitLens.DiffWithWorkingCommand]', `getBlameForLine(${line})`, ex);
            }
        }
        else {
            try {
                const log = await this.git.getLogForFile(uri.fsPath);
                if (!log) return undefined;

                const commit = Iterables.first(log.commits.values());
                return commands.executeCommand(Commands.DiffWithWorking, commit.uri, commit.repoPath, commit.sha, commit.uri, line);
            }
            catch (ex) {
                console.error('[GitLens.DiffWithPreviousCommand]', `getLogForFile(${uri.fsPath})`, ex);
            }
        }
    }
}
