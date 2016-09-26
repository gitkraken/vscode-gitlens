'use strict'
import {commands, TextEditor, TextEditorEdit, Uri, window} from 'vscode';
import {EditorCommand} from './commands';
import {BuiltInCommands, Commands} from '../constants';
import GitProvider from '../gitProvider';
import * as path from 'path';

export default class DiffWithPreviousCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithPrevious);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, repoPath?: string, sha?: string, shaUri?: Uri, compareWithSha?: string, compareWithUri?: Uri, line?: number) {
        line = line || editor.selection.active.line;
        if (!sha || GitProvider.isUncommitted(sha)) {
            if (!(uri instanceof Uri)) {
                if (!editor.document) return;
                uri = editor.document.uri;
            }

            return this.git.getBlameForLine(uri.fsPath, line)
                .catch(ex => console.error('[GitLens.DiffWithPreviousCommand]', `getBlameForLine(${line})`, ex))
                .then(blame => {
                    if (!blame) return;

                    // If the line is uncommitted, find the previous commit
                    const commit = blame.commit;
                    if (commit.isUncommitted) {
                        return this.git.getBlameForLine(commit.previousUri.fsPath, blame.line.originalLine + 1, commit.previousSha, commit.repoPath)
                            .catch(ex => console.error('[GitLens.DiffWithPreviousCommand]', `getBlameForLine(${blame.line.originalLine}, ${commit.previousSha})`, ex))
                            .then(prevBlame => {
                                if (!prevBlame) return;

                                const prevCommit = prevBlame.commit;
                                return commands.executeCommand(Commands.DiffWithPrevious, commit.previousUri, commit.repoPath, commit.previousSha, commit.previousUri, prevCommit.sha, prevCommit.uri, blame.line.originalLine);
                            });
                    }
                    return commands.executeCommand(Commands.DiffWithPrevious, commit.uri, commit.repoPath, commit.sha, commit.uri, commit.previousSha, commit.previousUri, line);
                });
        }

        if (!compareWithSha) {
            return window.showInformationMessage(`Commit ${sha} has no previous commit`);
        }

        return Promise.all([this.git.getVersionedFile(shaUri.fsPath, repoPath, sha), this.git.getVersionedFile(compareWithUri.fsPath, repoPath, compareWithSha)])
            .catch(ex => console.error('[GitLens.DiffWithPreviousCommand]', 'getVersionedFile', ex))
            .then(values => commands.executeCommand(BuiltInCommands.Diff, Uri.file(values[1]), Uri.file(values[0]), `${path.basename(compareWithUri.fsPath)} (${compareWithSha}) ↔ ${path.basename(shaUri.fsPath)} (${sha})`)
                .then(() => commands.executeCommand(BuiltInCommands.RevealLine, {lineNumber: line, at: 'center'})));
    }
}