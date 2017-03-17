'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepoStatusQuickPick } from '../quickPicks';

export class ShowQuickRepoStatusCommand extends ActiveEditorCommand {

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

            const statuses = await this.git.getStatusesForRepo(repoPath);
            if (!statuses) return window.showWarningMessage(`Unable to show repository status`);

            const pick = await RepoStatusQuickPick.show(statuses, goBackCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickRepoStatusCommand]', ex);
            return window.showErrorMessage(`Unable to show repository status. See output channel for more details`);
        }
    }
}