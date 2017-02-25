'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from '../commands';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem } from './quickPickItems';
import { RepoStatusesQuickPick } from './quickPicks';

export default class ShowQuickRepoStatusCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.ShowQuickRepoStatus);
    }

    async execute(editor: TextEditor, uri?: Uri, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            let repoPath: string;
            if (uri instanceof Uri) {
                const gitUri = GitUri.fromUri(uri, this.git);
                repoPath = gitUri.repoPath;

                if (!repoPath) {
                    repoPath = await this.git.getRepoPathFromFile(gitUri.fsPath);
                }
            }

            if (!repoPath) {
                repoPath = this.repoPath;
            }
            if (!repoPath) return window.showWarningMessage(`Unable to show repository status`);

            const statuses = await this.git.getStatusesForRepo(repoPath);
            if (!statuses) return window.showWarningMessage(`Unable to show repository status`);

            const pick = await RepoStatusesQuickPick.show(statuses, goBackCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            // commit = pick.commit;

            // return commands.executeCommand(Commands.ShowQuickCommitDetails,
            //     new GitUri(commit.uri, commit),
            //     commit.sha, undefined,
            //     new CommandQuickPickItem({
            //         label: `go back \u21A9`,
            //         description: null
            //     }, Commands.ShowQuickRepoHistory, [uri, maxCount, undefined, goBackCommand]));
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickRepoStatusCommand]', ex);
            return window.showErrorMessage(`Unable to show repository status. See output channel for more details`);
        }
    }
}