'use strict';
import { Arrays } from '../system';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export class OpenFileInHostingProviderCommand extends ActiveEditorCommand {

    constructor(private git: GitService, private repoPath: string) {
        super(Commands.OpenFileInHostingProvider);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        try {
            const remotes = Arrays.uniqueBy(await this.git.getRemotes(this.repoPath), _ => _.url, _ => !!_.provider);
            return commands.executeCommand(Commands.OpenInHostingProvider, uri, remotes, 'file', [gitUri.getRelativePath(), gitUri.sha]);
        }
        catch (ex) {
            Logger.error('[GitLens.OpenFileInHostingProviderCommand]', ex);
            return window.showErrorMessage(`Unable to open file in hosting provider. See output channel for more details`);
        }
    }
}