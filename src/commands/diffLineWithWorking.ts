'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export class DiffLineWithWorkingCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffLineWithWorking);
    }

    async execute(editor: TextEditor): Promise<any>;
    async execute(editor: TextEditor, uri: Uri): Promise<any>;
    async execute(editor: TextEditor, uri?: Uri, commit?: GitCommit, line?: number): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);
        line = line || (editor && editor.selection.active.line) || gitUri.offset;

        if (!commit || GitService.isUncommitted(commit.sha)) {
            if (editor && editor.document && editor.document.isDirty) return undefined;

            const blameline = line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri, blameline);
                if (!blame) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                commit = blame.commit;
                // If the line is uncommitted, find the previous commit
                if (commit.isUncommitted) {
                    commit = new GitCommit(commit.repoPath, commit.previousSha, commit.previousFileName, commit.author, commit.date, commit.message);
                    line = blame.line.line + 1 + gitUri.offset;
                }
            }
            catch (ex) {
                Logger.error(ex, 'DiffLineWithWorkingCommand', `getBlameForLine(${blameline})`);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        return commands.executeCommand(Commands.DiffWithWorking, uri, commit, line);
    }
}
