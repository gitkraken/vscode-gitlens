'use strict';
import { Strings } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, CommandContext, Commands, getCommandUri, isCommandViewContextWithCommit } from './common';
import { GlyphChars } from '../constants';
import { GitCommit, GitCommitType, GitLog, GitLogCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitDetailsQuickPick, CommitWithFileStatusQuickPickItem } from '../quickPicks';
import { ShowQuickCommitFileDetailsCommandArgs } from './showQuickCommitFileDetails';
import { Messages } from '../messages';
import * as path from 'path';

export interface ShowQuickCommitDetailsCommandArgs {
    sha?: string;
    commit?: GitCommit | GitLogCommit;
    repoLog?: GitLog;

    goBackCommand?: CommandQuickPickItem;
}

export class ShowQuickCommitDetailsCommand extends ActiveEditorCachedCommand {

    static getMarkdownCommandArgs(sha: string): string;
    static getMarkdownCommandArgs(args: ShowQuickCommitDetailsCommandArgs): string;
    static getMarkdownCommandArgs(argsOrSha: ShowQuickCommitDetailsCommandArgs | string): string {
        const args = typeof argsOrSha === 'string'
            ? { sha: argsOrSha }
            : argsOrSha;
        return super.getMarkdownCommandArgsCore<ShowQuickCommitDetailsCommandArgs>(Commands.ShowQuickCommitDetails, args);
    }

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.ShowQuickCommitDetails);
    }

    protected async preExecute(context: CommandContext, args: ShowQuickCommitDetailsCommandArgs = {}): Promise<any> {
        if (context.type === 'view') {
            args = { ...args };
            args.sha = context.node.uri.sha;

            if (isCommandViewContextWithCommit(context)) {
                args.commit = context.node.commit;
            }
        }
        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowQuickCommitDetailsCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        const gitUri = await GitUri.fromUri(uri, this.git);

        let repoPath = gitUri.repoPath;
        let workingFileName = path.relative(repoPath || '', gitUri.fsPath);

        args = { ...args };
        if (args.sha === undefined) {
            if (editor === undefined) return undefined;

            const blameline = editor.selection.active.line;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri, blameline);
                if (blame === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to show commit details');

                // Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
                if (blame.commit.isUncommitted) return Messages.showLineUncommittedWarningMessage('Unable to show commit details');

                args.sha = blame.commit.sha;
                repoPath = blame.commit.repoPath;
                workingFileName = blame.commit.fileName;

                args.commit = blame.commit;
            }
            catch (ex) {
                Logger.error(ex, 'ShowQuickCommitDetailsCommand', `getBlameForLine(${blameline})`);
                return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
            }
        }

        try {
            if (args.commit === undefined || (args.commit.type !== GitCommitType.Branch && args.commit.type !== GitCommitType.Stash)) {
                if (args.repoLog !== undefined) {
                    args.commit = args.repoLog.commits.get(args.sha!);
                    // If we can't find the commit, kill the repoLog
                    if (args.commit === undefined) {
                        args.repoLog = undefined;
                    }
                }

                if (args.repoLog === undefined) {
                    const log = await this.git.getLogForRepo(repoPath!, args.sha, 2);
                    if (log === undefined) return Messages.showCommitNotFoundWarningMessage(`Unable to show commit details`);

                    args.commit = log.commits.get(args.sha!);
                }
            }

            if (args.commit === undefined) return Messages.showCommitNotFoundWarningMessage(`Unable to show commit details`);

            if (args.commit.workingFileName === undefined) {
                args.commit.workingFileName = workingFileName;
            }

            if (args.goBackCommand === undefined) {
                // Create a command to get back to the branch history
                args.goBackCommand = new CommandQuickPickItem({
                    label: `go back ${GlyphChars.ArrowBack}`,
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to branch history`
                }, Commands.ShowQuickCurrentBranchHistory, [
                        new GitUri(args.commit.uri, args.commit)
                    ]);
            }

            // Create a command to get back to where we are right now
            const currentCommand = new CommandQuickPickItem({
                label: `go back ${GlyphChars.ArrowBack}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to details of ${GlyphChars.Space}$(git-commit) ${args.commit.shortSha}`
            }, Commands.ShowQuickCommitDetails, [
                    new GitUri(args.commit.uri, args.commit),
                    args
                ]);

            const pick = await CommitDetailsQuickPick.show(this.git, args.commit as GitLogCommit, uri, args.goBackCommand, currentCommand, args.repoLog);
            if (pick === undefined) return undefined;

            if (!(pick instanceof CommitWithFileStatusQuickPickItem)) return pick.execute();

            return commands.executeCommand(Commands.ShowQuickCommitFileDetails,
                pick.gitUri,
                {
                    commit: args.commit,
                    sha: pick.sha,
                    goBackCommand: currentCommand
                } as ShowQuickCommitFileDetailsCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickCommitDetailsCommand');
            return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
        }
    }
}