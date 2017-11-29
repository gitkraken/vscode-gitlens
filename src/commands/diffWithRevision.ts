'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
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
        if (args.maxCount == null) {
            args.maxCount = this.git.config.advanced.maxQuickHistory;
        }

        const progressCancellation = FileHistoryQuickPick.showProgress(gitUri);
        try {
            const log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, gitUri.sha, { maxCount: args.maxCount });
            if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open history compare');

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const pick = await FileHistoryQuickPick.show(this.git, log, gitUri, progressCancellation, { pickerOnly: true });
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