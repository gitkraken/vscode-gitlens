'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand, getCommandUri } from './common';
import { GitExplorer } from '../views/gitExplorer';
import { GitService, GitUri } from '../gitService';
import { Messages } from '../messages';
import { Logger } from '../logger';

export class ShowStashListCommand extends EditorCommand {

    constructor(private git: GitService, private explorer: GitExplorer) {
        super(Commands.ShowStashList);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri) {
        uri = getCommandUri(uri, editor);

        try {
            const repoPath = await this.git.getRepoPathFromUri(uri);
            if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to show stashed changes`);

            this.explorer.addStash(new GitUri(uri, { repoPath: repoPath, fileName: uri!.fsPath }));
            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'ShowStashListCommand');
            return window.showErrorMessage(`Unable to show stash list. See output channel for more details`);
        }
    }
}