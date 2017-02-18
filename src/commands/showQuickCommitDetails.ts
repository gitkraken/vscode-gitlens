'use strict';
import { Iterables } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitCommit, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem, FileQuickPickItem } from './quickPickItems';
import { CommitQuickPick, CommitFilesQuickPick } from './quickPicks';

export default class ShowQuickCommitDetailsCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.ShowQuickCommitDetails);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string, commit?: GitCommit, goBackCommand?: CommandQuickPickItem, options: { showFileHistory?: boolean } = { showFileHistory: true }) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = GitUri.fromUri(uri, this.git);

        let repoPath = gitUri.repoPath;

        if (!sha) {
            if (!editor) return undefined;

            const blameline = editor.selection.active.line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri.fsPath, blameline, gitUri.sha, gitUri.repoPath);
                if (!blame) return window.showWarningMessage(`Unable to show commit details. File is probably not under source control`);

                sha = blame.commit.isUncommitted ? blame.commit.previousSha : blame.commit.sha;
                repoPath = blame.commit.repoPath;

                return commands.executeCommand(Commands.ShowQuickFileHistory, uri, undefined, blame.commit);
            }
            catch (ex) {
                Logger.error('[GitLens.ShowQuickCommitDetails]', `getBlameForLine(${blameline})`, ex);
                return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
            }
        }

        try {
            let pick: FileQuickPickItem | CommandQuickPickItem;
            let alreadyPickedCommit = !!commit;
            let workingFileName: string;
            if (!alreadyPickedCommit) {
                let log = await this.git.getLogForRepo(repoPath, sha, 0);
                if (!log) return window.showWarningMessage(`Unable to show commit details`);

                commit = Iterables.first(log.commits.values());

                pick = await CommitFilesQuickPick.show(commit, uri, goBackCommand);
                if (!pick) return undefined;

                if (pick instanceof CommandQuickPickItem) {
                    return pick.execute();
                }

                // Attempt to the most recent commit -- so that we can find the real working filename if there was a rename
                const workingCommit = await this.git.findMostRecentCommitForFile(pick.uri.fsPath, pick.sha);
                // TODO: Leave this at undefined until findMostRecentCommitForFile actually works
                workingFileName = !workingCommit ? pick.fileName : undefined;

                log = await this.git.getLogForFile(pick.uri.fsPath, pick.sha, undefined, undefined, 2);
                if (!log) return window.showWarningMessage(`Unable to open diff`);

                commit = Iterables.find(log.commits.values(), c => c.sha === commit.sha);
                uri = pick.uri || uri;
            }
            else {
                // Attempt to the most recent commit -- so that we can find the real working filename if there was a rename
                const workingCommit = await this.git.findMostRecentCommitForFile(commit.uri.fsPath, commit.sha);
                // TODO: Leave this at undefined until findMostRecentCommitForFile actually works
                workingFileName = !workingCommit ? commit.fileName : undefined;
            }

            pick = await CommitQuickPick.show(this.git, commit, workingFileName, uri,
                // Create a command to get back to where we are right now
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: null
                }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), sha, commit, goBackCommand, options]),
                // If we have already picked a commit, just jump back to the previous (since we skipped a quickpick menu)
                // Otherwise setup a normal back command
                alreadyPickedCommit
                    ? goBackCommand
                    : new CommandQuickPickItem({
                        label: `go back \u21A9`,
                        description: null
                    }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), sha, undefined, goBackCommand, options]),
                { showFileHistory: options.showFileHistory });

            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return undefined;
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickCommitDetailsCommand]', ex);
            return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
        }
    }
}