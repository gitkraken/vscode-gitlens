'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from './commands';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepoStatusQuickPick } from '../quickPicks';

export class ShowQuickRepoStatusCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService, private repoPath: string) {
        super(Commands.ShowQuickRepoStatus);
    }

    async execute(editor: TextEditor, uri?: Uri, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            const repoPath = await this.git.getRepoPathFromUri(uri, this.repoPath);
            if (!repoPath) return window.showWarningMessage(`Unable to show repository status`);

            const status = await this.git.getStatusForRepo(repoPath);
            if (!status) return window.showWarningMessage(`Unable to show repository status`);

            const pick = await RepoStatusQuickPick.show(status, goBackCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickRepoStatusCommand');
            return window.showErrorMessage(`Unable to show repository status. See output channel for more details`);
        }
    }
}