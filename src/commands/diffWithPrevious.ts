'use strict';
import { Iterables } from '../system';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { BuiltInCommands, Commands } from '../constants';
import BlameAnnotationController from '../blameAnnotationController';
import GitProvider from '../gitProvider';
import * as path from 'path';

export default class DiffWithPreviousCommand extends EditorCommand {
    constructor(private git: GitProvider, private annotationController: BlameAnnotationController) {
        super(Commands.DiffWithPrevious);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, repoPath?: string, sha?: string, shaUri?: Uri, compareWithSha?: string, compareWithUri?: Uri, line?: number) {
        line = line || editor.selection.active.line;
        if (sha && !GitProvider.isUncommitted(sha)) {
            if (!compareWithSha) {
                return window.showInformationMessage(`Commit ${sha} has no previous commit`);
            }

            return Promise.all([this.git.getVersionedFile(shaUri.fsPath, repoPath, sha), this.git.getVersionedFile(compareWithUri.fsPath, repoPath, compareWithSha)])
                .then(values => commands.executeCommand(BuiltInCommands.Diff, Uri.file(values[1]), Uri.file(values[0]), `${path.basename(compareWithUri.fsPath)} (${compareWithSha}) ↔ ${path.basename(shaUri.fsPath)} (${sha})`))
                .then(() => commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: line, at: 'center' }))
                .catch(ex => console.error('[GitLens.DiffWithPreviousCommand]', 'getVersionedFile', ex));
        }

        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        if (this.annotationController.annotated) {
            try {
                const blame = await this.git.getBlameForLine(uri.fsPath, line);
                if (!blame) return undefined;

                // If the line is uncommitted, find the previous commit
                const commit = blame.commit;
                if (commit.isUncommitted) {
                    try {
                        const prevBlame = await this.git.getBlameForLine(commit.previousUri.fsPath, blame.line.originalLine + 1, commit.previousSha, commit.repoPath);
                        if (!prevBlame) return undefined;

                        const prevCommit = prevBlame.commit;
                        return commands.executeCommand(Commands.DiffWithPrevious, commit.previousUri, commit.repoPath, commit.previousSha, commit.previousUri, prevCommit.sha, prevCommit.uri, blame.line.originalLine);
                    }
                    catch (ex) {
                        console.error('[GitLens.DiffWithPreviousCommand]', `getBlameForLine(${blame.line.originalLine}, ${commit.previousSha})`, ex);
                    }
                }
                return commands.executeCommand(Commands.DiffWithPrevious, commit.uri, commit.repoPath, commit.sha, commit.uri, commit.previousSha, commit.previousUri, line);
            }
            catch (ex) {
                console.error('[GitLens.DiffWithPreviousCommand]', `getBlameForLine(${line})`, ex);
            }
        }
        else {
            try {
                const log = await this.git.getLogForFile(uri.fsPath);
                if (!log) return undefined;

                const commits = log.commits.values();
                const commit = Iterables.next(commits);
                const prevCommit = Iterables.next(commits);
                return commands.executeCommand(Commands.DiffWithPrevious, commit.uri, commit.repoPath, commit.sha, commit.uri, prevCommit.sha, prevCommit.uri, line);
            }
            catch (ex) {
                console.error('[GitLens.DiffWithPreviousCommand]', `getLogForFile(${uri.fsPath})`, ex);
            }
        }
    }
}