'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands, getCommandUri } from './common';
import { GitCommit, GitLogCommit, GitService, GitUri, IGitLog } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitFileDetailsQuickPick } from '../quickPicks';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';
import * as path from 'path';

export interface ShowQuickCommitFileDetailsCommandArgs {
    sha?: string;
    commit?: GitCommit | GitLogCommit;
    fileLog?: IGitLog;

    goBackCommand?: CommandQuickPickItem;
}

export class ShowQuickCommitFileDetailsCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickCommitFileDetails);
    }

    async execute(editor: TextEditor, uri?: Uri, args: ShowQuickCommitFileDetailsCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        let workingFileName = args.commit && args.commit.workingFileName;

        const gitUri = await GitUri.fromUri(uri, this.git);

        if (args.sha === undefined) {
            if (editor === undefined) return undefined;

            const blameline = editor.selection.active.line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri, blameline);
                if (blame === undefined) return window.showWarningMessage(`Unable to show commit file details. File is probably not under source control`);

                args.sha = blame.commit.isUncommitted ? blame.commit.previousSha : blame.commit.sha;

                args.commit = blame.commit;
                workingFileName = path.relative(args.commit.repoPath, gitUri.fsPath);
            }
            catch (ex) {
                Logger.error(ex, 'ShowQuickCommitFileDetailsCommand', `getBlameForLine(${blameline})`);
                return window.showErrorMessage(`Unable to show commit file details. See output channel for more details`);
            }
        }

        try {
            if (args.commit === undefined || (args.commit.type !== 'file' && args.commit.type !== 'stash')) {
                if (args.fileLog !== undefined) {
                    args.commit = args.fileLog.commits.get(args.sha!);
                    // If we can't find the commit, kill the fileLog
                    if (args.commit === undefined) {
                        args.fileLog = undefined;
                    }
                }

                if (args.fileLog === undefined) {
                    args.commit = await this.git.getLogCommit(args.commit ? args.commit.repoPath : gitUri.repoPath, gitUri.fsPath, args.sha, { previous: true });
                    if (args.commit === undefined) return window.showWarningMessage(`Unable to show commit file details`);
                }
            }

            if (args.commit === undefined) return window.showWarningMessage(`Unable to show commit file details`);

            // Attempt to the most recent commit -- so that we can find the real working filename if there was a rename
            args.commit.workingFileName = workingFileName;
            args.commit.workingFileName = await this.git.findWorkingFileName(args.commit);

            const shortSha = args.sha!.substring(0, 8);

            if (args.goBackCommand === undefined) {
                // Create a command to get back to the commit details
                args.goBackCommand = new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to details of \u00a0$(git-commit) ${shortSha}`
                }, Commands.ShowQuickCommitDetails, [
                        new GitUri(args.commit.uri, args.commit),
                        {
                            commit: args.commit,
                            sha: args.sha
                        } as ShowQuickCommitDetailsCommandArgs
                    ]);
            }

            // Create a command to get back to where we are right now
            const currentCommand = new CommandQuickPickItem({
                label: `go back \u21A9`,
                description: `\u00a0 \u2014 \u00a0\u00a0 to details of \u00a0$(file-text) ${path.basename(args.commit.fileName)} in \u00a0$(git-commit) ${shortSha}`
            }, Commands.ShowQuickCommitFileDetails, [
                    new GitUri(args.commit.uri, args.commit),
                    args
                ]);

            const pick = await CommitFileDetailsQuickPick.show(this.git, args.commit as GitLogCommit, uri, args.goBackCommand, currentCommand, args.fileLog);
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickCommitFileDetailsCommand');
            return window.showErrorMessage(`Unable to show commit file details. See output channel for more details`);
        }
    }
}