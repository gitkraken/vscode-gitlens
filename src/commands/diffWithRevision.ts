'use strict';
import { Iterables, Strings } from '../system';
import { commands, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { DiffWithCommandArgs } from './diffWith';
import { GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, FileHistoryQuickPick, ShowBranchesAndTagsQuickPickItem } from '../quickPicks/quickPicks';

export interface DiffWithRevisionCommandArgs {
    maxCount?: number;

    line?: number;
    showOptions?: TextDocumentShowOptions;
    nextPageCommand?: CommandQuickPickItem;
}

export class DiffWithRevisionCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.DiffWithRevision);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithRevisionCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        const gitUri = await GitUri.fromUri(uri);

        const placeHolder = `Compare ${gitUri.getFormattedPath()}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''} with ${GlyphChars.Ellipsis}`;
        const progressCancellation = FileHistoryQuickPick.showProgress(placeHolder);

        try {
            const log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { maxCount: args.maxCount, ref: gitUri.sha });
            if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open history compare');

            if (progressCancellation.token.isCancellationRequested) return undefined;

            let previousPageCommand: CommandQuickPickItem | undefined = undefined;

            if (log.truncated) {
                const npc = new CommandQuickPickItem({
                    label: `$(arrow-right) Show Next Commits`,
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} newer commits`
                }, Commands.DiffWithRevision, [uri, { ...args } as DiffWithRevisionCommandArgs]);

                const last = Iterables.last(log.commits.values());
                if (last != null) {
                    previousPageCommand = new CommandQuickPickItem({
                        label: `$(arrow-left) Show Previous Commits`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} older commits`
                    }, Commands.DiffWithRevision, [new GitUri(uri, last), { ...args, nextPageCommand: npc } as DiffWithRevisionCommandArgs]);
                }
            }

            const pick = await FileHistoryQuickPick.show(log, gitUri, placeHolder, {
                pickerOnly: true,
                progressCancellation: progressCancellation,
                currentCommand: new CommandQuickPickItem({
                    label: `go back ${GlyphChars.ArrowBack}`,
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to history of ${GlyphChars.Space}$(file-text) ${gitUri.getFormattedPath()}${gitUri.sha ? ` from ${GlyphChars.Space}$(git-commit) ${gitUri.shortSha}` : ''}`
                }, Commands.DiffWithRevision, [uri, { ...args }]),
                nextPageCommand: args.nextPageCommand,
                previousPageCommand: previousPageCommand,
                showAllCommand: log !== undefined && log.truncated
                    ? new CommandQuickPickItem({
                        label: `$(sync) Show All Commits`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                    }, Commands.DiffWithRevision, [uri, { ...args, maxCount: 0 }])
                    : undefined
            });
            if (pick === undefined) return undefined;

            let ref: string;

            if (pick instanceof ShowBranchesAndTagsQuickPickItem) {
                const branchOrTag = await pick.execute();
                if (branchOrTag === undefined) return undefined;

                if (branchOrTag instanceof CommandQuickPickItem) return branchOrTag.execute();

                ref = branchOrTag.name;
            }
            else {
                if (pick instanceof CommandQuickPickItem) return pick.execute();

                ref = pick.commit.sha;
            }

            const diffArgs: DiffWithCommandArgs = {
                repoPath: gitUri.repoPath,
                lhs: {
                    sha: ref,
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
            progressCancellation.cancel();
        }
   }
}