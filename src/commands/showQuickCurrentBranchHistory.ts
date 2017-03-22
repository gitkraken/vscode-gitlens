'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from '../commands';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem } from '../quickPicks';

export class ShowQuickCurrentBranchHistoryCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickCurrentBranchHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            const branch = (await this.git.getBranch(this.git.repoPath)).name;

            return commands.executeCommand(Commands.ShowQuickBranchHistory, uri, branch, undefined, goBackCommand);
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickCurrentBranchHistoryCommand]', ex);
            return window.showErrorMessage(`Unable to show branch history. See output channel for more details`);
        }
    }
}