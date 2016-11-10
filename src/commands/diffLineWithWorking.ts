'use strict';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitCommit } from '../gitProvider';
import { Logger } from '../logger';

export default class DiffLineWithWorkingCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.DiffLineWithWorking);
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
                const blame = await this.git.getBlameForLine(uri.fsPath, line);
                if (!blame) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                commit = blame.commit;
                // If the line is uncommitted, find the previous commit
                if (commit.isUncommitted) {
                    commit = new GitCommit(commit.repoPath, commit.previousSha, commit.previousFileName, commit.author, commit.date, commit.message);
                    line = blame.line.line + 1;
                }
            }
            catch (ex) {
                Logger.error('[GitLens.DiffLineWithWorkingCommand]', `getBlameForLine(${line})`, ex);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        return commands.executeCommand(Commands.DiffWithWorking, commit.uri, commit, line);
    }
}
