'use strict';
import { Strings } from '../system';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, CommandContext, Commands, getCommandUri, isCommandViewContextWithCommit } from './common';
import { GlyphChars } from '../constants';
import { GitCommit, GitLog, GitLogCommit, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitFileQuickPick } from '../quickPicks/quickPicks';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';
import { Messages } from '../messages';
import * as path from 'path';
import { Container } from '../container';

export interface ShowQuickCommitFileDetailsCommandArgs {
    sha?: string;
    commit?: GitCommit | GitLogCommit;
    fileLog?: GitLog;

    goBackCommand?: CommandQuickPickItem;
}

export class ShowQuickCommitFileDetailsCommand extends ActiveEditorCachedCommand {

    static getMarkdownCommandArgs(sha: string): string;
    static getMarkdownCommandArgs(args: ShowQuickCommitFileDetailsCommandArgs): string;
    static getMarkdownCommandArgs(argsOrSha: ShowQuickCommitFileDetailsCommandArgs | string): string {
        const args = typeof argsOrSha === 'string'
            ? { sha: argsOrSha }
            : argsOrSha;
        return super.getMarkdownCommandArgsCore<ShowQuickCommitFileDetailsCommandArgs>(Commands.ShowQuickCommitFileDetails, args);
    }

    constructor() {
        super(Commands.ShowQuickCommitFileDetails);
    }

    protected async preExecute(context: CommandContext, args: ShowQuickCommitFileDetailsCommandArgs = {}): Promise<any> {
        if (context.type === 'view') {
            args = { ...args };
            args.sha = context.node.uri.sha;

            if (isCommandViewContextWithCommit(context)) {
                args.commit = context.node.commit;
            }
        }
        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowQuickCommitFileDetailsCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        let workingFileName = args.commit && args.commit.workingFileName;

        const gitUri = await GitUri.fromUri(uri);

        args = { ...args };
        if (args.sha === undefined) {
            if (editor == null) return undefined;

            const blameline = editor.selection.active.line;
            if (blameline < 0) return undefined;

            try {
                const blame = await Container.git.getBlameForLine(gitUri, blameline);
                if (blame === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to show commit file details');

                // Because the previous sha of an uncommitted file isn't trust worthy we just have to kick out
                if (blame.commit.isUncommitted) return Messages.showLineUncommittedWarningMessage('Unable to show commit file details');

                args.sha = blame.commit.sha;

                args.commit = blame.commit;
                workingFileName = path.relative(args.commit.repoPath, gitUri.fsPath);
            }
            catch (ex) {
                Logger.error(ex, 'ShowQuickCommitFileDetailsCommand', `getBlameForLine(${blameline})`);
                return window.showErrorMessage(`Unable to show commit file details. See output channel for more details`);
            }
        }

        try {
            if (args.commit === undefined || !args.commit.isFile) {
                if (args.commit !== undefined) {
                    workingFileName = undefined;
                }

                if (args.fileLog !== undefined) {
                    args.commit = args.fileLog.commits.get(args.sha!);
                    // If we can't find the commit, kill the fileLog
                    if (args.commit === undefined) {
                        args.fileLog = undefined;
                    }
                }

                if (args.fileLog === undefined) {
                    args.commit = await Container.git.getLogCommitForFile(args.commit === undefined ? gitUri.repoPath : args.commit.repoPath, gitUri.fsPath, { ref: args.sha });
                    if (args.commit === undefined) return Messages.showCommitNotFoundWarningMessage(`Unable to show commit file details`);
                }
            }

            if (args.commit === undefined) return Messages.showCommitNotFoundWarningMessage(`Unable to show commit file details`);

            // Attempt to the most recent commit -- so that we can find the real working filename if there was a rename
            args.commit.workingFileName = workingFileName;
            [args.commit.workingFileName] = await Container.git.findWorkingFileName(args.commit);

            const shortSha = GitService.shortenSha(args.sha!);

            if (args.goBackCommand === undefined) {
                // Create a command to get back to the commit details
                args.goBackCommand = new CommandQuickPickItem({
                    label: `go back ${GlyphChars.ArrowBack}`,
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to details of ${GlyphChars.Space}$(git-commit) ${shortSha}`
                }, Commands.ShowQuickCommitDetails, [
                        args.commit.toGitUri(),
                        {
                            commit: args.commit,
                            sha: args.sha
                        } as ShowQuickCommitDetailsCommandArgs
                    ]);
            }

            // Create a command to get back to where we are right now
            const currentCommand = new CommandQuickPickItem({
                label: `go back ${GlyphChars.ArrowBack}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to details of ${GlyphChars.Space}$(file-text) ${path.basename(args.commit.fileName)} in ${GlyphChars.Space}$(git-commit) ${shortSha}`
            }, Commands.ShowQuickCommitFileDetails, [
                    args.commit.toGitUri(),
                    args
                ]);

            const pick = await CommitFileQuickPick.show(args.commit as GitLogCommit, uri, args.goBackCommand, currentCommand, args.fileLog);
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