'use strict';
import { Strings } from '../system';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { GitLog, GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, FileHistoryQuickPick, ShowCommitsInResultsQuickPickItem } from '../quickPicks';
import { ShowQuickCommitFileDetailsCommandArgs } from './showQuickCommitFileDetails';
import { Messages } from '../messages';
import * as path from 'path';

export interface ShowQuickFileHistoryCommandArgs {
    log?: GitLog;
    maxCount?: number;
    range?: Range;

    goBackCommand?: CommandQuickPickItem;
    nextPageCommand?: CommandQuickPickItem;
}

export class ShowQuickFileHistoryCommand extends ActiveEditorCachedCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.ShowQuickFileHistory);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowQuickFileHistoryCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return commands.executeCommand(Commands.ShowQuickCurrentBranchHistory);

        const gitUri = await GitUri.fromUri(uri, this.git);

        args = { ...args };

        const progressCancellation = FileHistoryQuickPick.showProgress(gitUri);
        try {
            if (args.log === undefined) {
                args.log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { maxCount: args.maxCount, range: args.range, ref: gitUri.sha });
                if (args.log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to show file history');
            }

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const label = `${gitUri.getFormattedPath()}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''}`;
            const pick = await FileHistoryQuickPick.show(this.git, args.log, gitUri, label, progressCancellation, {
                goBackCommand: args.goBackCommand,
                nextPageCommand: args.nextPageCommand,
                showAllCommand: args.log !== undefined && args.log.truncated
                    ? new CommandQuickPickItem({
                        label: `$(sync) Show All Commits`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                    }, Commands.ShowQuickFileHistory, [uri, { ...args, maxCount: 0 }])
                    : undefined,
                showInResultsExplorerCommand: args.log !== undefined
                    ? new ShowCommitsInResultsQuickPickItem(args.log, {
                        label: label,
                        resultsType: { singular: 'commit', plural: 'commits' }
                    })
                    : undefined
            });
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            // Create a command to get back to where we are right now
            const currentCommand = new CommandQuickPickItem({
                label: `go back ${GlyphChars.ArrowBack}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to history of ${GlyphChars.Space}$(file-text) ${path.basename(pick.commit.fileName)}${gitUri.sha ? ` from ${GlyphChars.Space}$(git-commit) ${gitUri.shortSha}` : ''}`
            }, Commands.ShowQuickFileHistory, [
                    uri,
                    args
                ]);

            return commands.executeCommand(Commands.ShowQuickCommitFileDetails,
                pick.commit.toGitUri(),
                {
                    commit: pick.commit,
                    fileLog: args.log,
                    sha: pick.commit.sha,
                    goBackCommand: currentCommand
                } as ShowQuickCommitFileDetailsCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickFileHistoryCommand');
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
        finally {
            progressCancellation.dispose();
        }
    }
}