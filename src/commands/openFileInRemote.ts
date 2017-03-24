'use strict';
import { Arrays } from '../system';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export class OpenFileInRemoteCommand extends ActiveEditorCommand {

    constructor(private git: GitService, private repoPath: string) {
        super(Commands.OpenFileInRemote);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);
        const branch = await this.git.getBranch(gitUri.repoPath || this.repoPath);

        try {
            const remotes = Arrays.uniqueBy(await this.git.getRemotes(this.repoPath), _ => _.url, _ => !!_.provider);
            return commands.executeCommand(Commands.OpenInRemote, uri, remotes, 'file', [gitUri.getRelativePath(), branch.name, gitUri.sha]);
        }
        catch (ex) {
            Logger.error('[GitLens.OpenFileInRemoteCommand]', ex);
            return window.showErrorMessage(`Unable to open file in remote provider. See output channel for more details`);
        }
    }
}