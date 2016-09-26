'use strict'
import {commands, TextEditor, TextEditorEdit, Uri, window} from 'vscode';
import {EditorCommand} from './commands';
import {BuiltInCommands, Commands} from '../constants';
import GitProvider from '../gitProvider';
import * as path from 'path';

export default class DiffWithWorkingCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithWorking);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, repoPath?: string, sha?: string, shaUri?: Uri, line?: number) {
        line = line || editor.selection.active.line;
        if (!sha || GitProvider.isUncommitted(sha)) {
            if (!(uri instanceof Uri)) {
                if (!editor.document) return;
                uri = editor.document.uri;
            }

            return this.git.getBlameForLine(uri.fsPath, line)
                .catch(ex => console.error('[GitLens.DiffWithWorkingCommand]', `getBlameForLine(${line})`, ex))
                .then(blame => {
                    if (!blame) return;

                    const commit = blame.commit;
                    // If the line is uncommitted, find the previous commit
                    if (commit.isUncommitted) {
                        return commands.executeCommand(Commands.DiffWithWorking, commit.uri, commit.repoPath, commit.previousSha, commit.previousUri, blame.line.line + 1);
                    }
                    return commands.executeCommand(Commands.DiffWithWorking, commit.uri, commit.repoPath, commit.sha, commit.uri, line)
                });
        };

        return this.git.getVersionedFile(shaUri.fsPath, repoPath, sha)
            .catch(ex => console.error('[GitLens.DiffWithWorkingCommand]', 'getVersionedFile', ex))
            .then(compare => commands.executeCommand(BuiltInCommands.Diff, Uri.file(compare), uri, `${path.basename(shaUri.fsPath)} (${sha}) ↔ ${path.basename(uri.fsPath)}`)
                .then(() => commands.executeCommand(BuiltInCommands.RevealLine, {lineNumber: line, at: 'center'})));
    }
}
