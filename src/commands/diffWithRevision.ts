'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri } from './common';
import { BuiltInCommands, GlyphChars } from '../constants';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, FileHistoryQuickPick } from '../quickPicks';
import * as path from 'path';

export interface DiffWithRevisionCommandArgs {
    line?: number;
    maxCount?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithRevisionCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.DiffWithRevision);
    }

    async run(context: CommandContext, args: DiffWithRevisionCommandArgs = {}): Promise<any> {
        // Since we can change the args and they could be cached -- make a copy
        switch (context.type) {
            case 'uri':
                return this.execute(context.editor, context.uri, { ...args });
            case 'scm-states':
                const resource = context.scmResourceStates[0];
                return this.execute(undefined, resource.resourceUri, { ...args });
            case 'scm-groups':
                return undefined;
            default:
                return this.execute(context.editor, undefined, { ...args });
        }
    }

    async execute(editor: TextEditor | undefined, uri?: Uri, args: DiffWithRevisionCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

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

            const compare = await this.git.getVersionedFile(gitUri.repoPath, gitUri.fsPath, pick.commit.sha);

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(compare),
                gitUri.fileUri(),
                `${path.basename(gitUri.fsPath)} (${pick.commit.shortSha}) ${GlyphChars.ArrowLeftRight} ${path.basename(gitUri.fsPath)}`,
                args.showOptions);

            if (args.line === undefined || args.line === 0) return undefined;

            // TODO: Figure out how to focus the left pane
            return await commands.executeCommand(BuiltInCommands.RevealLine, { lineNumber: args.line, at: 'center' });
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithRevisionCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open history compare. See output channel for more details`);
        }
    }
}