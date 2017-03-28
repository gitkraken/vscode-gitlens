'use strict';
import { Arrays } from '../system';
import { commands, Range, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export class OpenFileInRemoteCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenFileInRemote);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);
        const branch = await this.git.getBranch(gitUri.repoPath || this.git.repoPath);

        try {
            const remotes = Arrays.uniqueBy(await this.git.getRemotes(this.git.repoPath), _ => _.url, _ => !!_.provider);
            const range = editor && new Range(editor.selection.start.with({ line: editor.selection.start.line + 1 }), editor.selection.end.with({ line: editor.selection.end.line + 1 }));
            return commands.executeCommand(Commands.OpenInRemote, uri, remotes, 'file', [gitUri.getRelativePath(), branch.name, gitUri.sha, range]);
        }
        catch (ex) {
            Logger.error(ex, 'OpenFileInRemoteCommand');
            return window.showErrorMessage(`Unable to open file in remote provider. See output channel for more details`);
        }
    }
}