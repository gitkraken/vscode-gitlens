'use strict';
import { Iterables } from '../system';
import { commands, QuickPickOptions, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { BackQuickPickItem, CommitQuickPickItem, CompareQuickPickItem, FileQuickPickItem } from './quickPickItems';
import * as moment from 'moment';

export default class ShowQuickCommitDetailsCommand extends EditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.ShowQuickCommitDetails);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string) {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = GitUri.fromUri(uri, this.git);

        let repoPath = gitUri.repoPath;

        let line = editor.selection.active.line;
        if (!sha) {
            const blameline = line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri.fsPath, blameline, gitUri.sha, gitUri.repoPath);
                if (!blame) return window.showWarningMessage(`Unable to show commit details. File is probably not under source control`);

                sha = blame.commit.isUncommitted ? blame.commit.previousSha : blame.commit.sha;
                repoPath = blame.commit.repoPath;
            }
            catch (ex) {
                Logger.error('[GitLens.ShowQuickCommitDetails]', `getBlameForLine(${blameline})`, ex);
                return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
            }
        }

        try {
            const log = await this.git.getLogForRepo(repoPath, sha, 0);
            if (!log) return window.showWarningMessage(`Unable to show commit details`);

            const commit = Iterables.first(log.commits.values());
            const commitPick = new CommitQuickPickItem(commit, ` \u2014 ${commit.fileName}`);
            const files = commitPick.commit.fileName
                .split(', ')
                .filter(_ => !!_)
                .map(f => new FileQuickPickItem(commitPick.commit, f));

            const filePick = await window.showQuickPick(files, {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: `${commitPick.commit.sha} \u2022 ${commitPick.commit.author}, ${moment(commitPick.commit.date).fromNow()}`
            } as QuickPickOptions);

            if (filePick) {
                // Get the most recent commit -- so that we can find the real working filename if there was a rename
                const workingCommit = await this.git.findMostRecentCommitForFile(filePick.uri.fsPath, filePick.sha);

                const log = await this.git.getLogForFile(filePick.uri.fsPath, filePick.sha, undefined, undefined, 2);
                if (!log) return window.showWarningMessage(`Unable to open diff`);

                const commit = Iterables.find(log.commits.values(), c => c.sha === commitPick.commit.sha);

                let command: Commands | undefined = Commands.DiffWithWorking;
                const items: CompareQuickPickItem[] = [
                    {
                        label: `Compare with Working Tree`,
                        description: `\u2022 ${commit.sha}  $(git-compare)  ${(workingCommit || commit).fileName}`,
                        command: Commands.DiffWithWorking
                    }
                ];

                if (commit.previousSha) {
                    items.push({
                        label: `Compare with Previous Commit`,
                        description: `\u2022 ${commit.previousSha}  $(git-compare)  ${commit.sha}`,
                        command: Commands.DiffWithPrevious
                    });
                }

                items.push({
                    label: `go back \u21A9`,
                    description: null,
                    command: Commands.ShowQuickCommitDetails
                } as BackQuickPickItem);

                const comparePick = await window.showQuickPick(items, {
                    matchOnDescription: true,
                    placeHolder: `${commit.fileName} \u2022 ${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()}`
                } as QuickPickOptions);

                command = comparePick ? comparePick.command : undefined;

                if (command) {
                    if (command === Commands.ShowQuickCommitDetails) return commands.executeCommand(command, uri), sha;
                    return commands.executeCommand(command, commit.uri, commit);
                }
            }

            return undefined;
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickCommitDetailsCommand]', ex);
            return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
        }
    }
}