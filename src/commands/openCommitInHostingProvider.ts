'use strict';
import { Arrays } from '../system';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export class OpenCommitInHostingProviderCommand extends ActiveEditorCommand {

    constructor(private git: GitService, private repoPath: string) {
        super(Commands.OpenCommitInHostingProvider);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        if (editor && editor.document && editor.document.isDirty) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);
        const line = (editor && editor.selection.active.line) || gitUri.offset;

        try {
            const blameline = line - gitUri.offset;
            if (blameline < 0) return undefined;

            const blame = await this.git.getBlameForLine(gitUri, blameline);
            if (!blame) return window.showWarningMessage(`Unable to open commit in hosting provider. File is probably not under source control`);

            let commit = blame.commit;
            // If the line is uncommitted, find the previous commit
            if (commit.isUncommitted) {
                commit = new GitCommit(commit.repoPath, commit.previousSha, commit.previousFileName, commit.author, commit.date, commit.message);
            }

            const remotes = Arrays.uniqueBy(await this.git.getRemotes(this.repoPath), _ => _.url, _ => !!_.provider);
            return commands.executeCommand(Commands.OpenInHostingProvider, uri, remotes, 'commit', [commit.sha]);
        }
        catch (ex) {
            Logger.error('[GitLens.OpenCommitInHostingProviderCommand]', ex);
            return window.showErrorMessage(`Unable to open commit in hosting provider. See output channel for more details`);
        }
    }
}