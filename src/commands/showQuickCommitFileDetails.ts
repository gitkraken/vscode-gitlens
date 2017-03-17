'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitCommit, GitLogCommit, GitService, GitUri, IGitLog } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitFileDetailsQuickPick } from '../quickPicks';
import * as path from 'path';

export class ShowQuickCommitFileDetailsCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickCommitFileDetails);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string, commit?: GitCommit | GitLogCommit, goBackCommand?: CommandQuickPickItem, options: { showFileHistory?: boolean } = { showFileHistory: true }, fileLog?: IGitLog) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        if (!sha) {
            if (!editor) return undefined;

            const gitUri = await GitUri.fromUri(uri, this.git);

            const blameline = editor.selection.active.line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri.fsPath, blameline, gitUri.sha, gitUri.repoPath);
                if (!blame) return window.showWarningMessage(`Unable to show commit file details. File is probably not under source control`);

                sha = blame.commit.isUncommitted ? blame.commit.previousSha : blame.commit.sha;

                commit = blame.commit;
            }
            catch (ex) {
                Logger.error('[GitLens.ShowQuickCommitFileDetailsCommand]', `getBlameForLine(${blameline})`, ex);
                return window.showErrorMessage(`Unable to show commit file details. See output channel for more details`);
            }
        }

        try {
            if (!commit || !(commit instanceof GitLogCommit) || commit.type !== 'file') {
                if (fileLog) {
                    commit = fileLog.commits.get(sha);
                    // If we can't find the commit, kill the fileLog
                    if (!commit) {
                        fileLog = undefined;
                    }
                }

                if (!fileLog) {
                    const log = await this.git.getLogForFile(uri.fsPath, sha, undefined, undefined, 2);
                    if (!log) return window.showWarningMessage(`Unable to show commit file details`);

                    commit = log.commits.get(sha);
                }
            }

            // Attempt to the most recent commit -- so that we can find the real working filename if there was a rename
            const workingCommit = await this.git.findMostRecentCommitForFile(commit.uri.fsPath, commit.sha);
            // TODO: Leave this at undefined until findMostRecentCommitForFile actually works
            const workingFileName = !workingCommit ? commit.fileName : undefined;

            const shortSha = sha.substring(0, 8);

            if (!goBackCommand) {
                // Create a command to get back to the commit details
                goBackCommand = new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to details of \u00a0$(git-commit) ${shortSha}`
                }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), sha, commit]);
            }

            const pick = await CommitFileDetailsQuickPick.show(this.git, commit as GitLogCommit, workingFileName, uri, goBackCommand,
                // Create a command to get back to where we are right now
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to details of \u00a0$(file-text) ${path.basename(commit.fileName)} in \u00a0$(git-commit) ${shortSha}`
                }, Commands.ShowQuickCommitFileDetails, [new GitUri(commit.uri, commit), sha, commit, goBackCommand, options]),
                { showFileHistory: options.showFileHistory }, fileLog);

            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return undefined;
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickCommitFileDetailsCommand]', ex);
            return window.showErrorMessage(`Unable to show commit file details. See output channel for more details`);
        }
    }
}