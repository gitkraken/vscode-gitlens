'use strict';
import { Strings } from '../system';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { DiffWithCommandArgs } from './diffWith';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, FileHistoryQuickPick } from '../quickPicks';

export interface DiffWithRevisionCommandArgs {
    maxCount?: number;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithRevisionCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.DiffWithRevision);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithRevisionCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        const progressCancellation = FileHistoryQuickPick.showProgress(gitUri);
        try {
            const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { maxCount: args.maxCount, ref: gitUri.sha });
            if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open history compare');

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const label = `${gitUri.getFormattedPath()}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''}`;
            const pick = await FileHistoryQuickPick.show(this.git, log, gitUri, label, progressCancellation, {
                pickerOnly: true,
                showAllCommand: log !== undefined && log.truncated
                    ? new CommandQuickPickItem({
                        label: `$(sync) Show All Commits`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                    }, Commands.ShowQuickFileHistory, [uri, { ...args, maxCount: 0 }])
                    : undefined
            });
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            const diffArgs: DiffWithCommandArgs = {
                repoPath: gitUri.repoPath,
                lhs: {
                    sha: pick.commit.sha,
                    uri: gitUri as Uri
                },
                rhs: {
                    sha: '',
                    uri: gitUri as Uri
                },
                line: args.line,
                showOptions: args.showOptions
            };
            return await commands.executeCommand(Commands.DiffWith, diffArgs);
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithRevisionCommand');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
        finally {
            progressCancellation.dispose();
        }
   }
}