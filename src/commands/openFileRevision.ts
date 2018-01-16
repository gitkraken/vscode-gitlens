'use strict';
import { Iterables, Strings } from '../system';
import { CancellationTokenSource, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri, openEditor } from './common';
import { FileAnnotationType } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, FileHistoryQuickPick, ShowBranchesAndTagsQuickPickItem } from '../quickPicks';

export interface OpenFileRevisionCommandArgs {
    uri?: Uri;
    maxCount?: number;

    line?: number;
    showOptions?: TextDocumentShowOptions;
    annotationType?: FileAnnotationType;
    nextPageCommand?: CommandQuickPickItem;
}

export class OpenFileRevisionCommand extends ActiveEditorCommand {

    static getMarkdownCommandArgs(args: OpenFileRevisionCommandArgs): string;
    static getMarkdownCommandArgs(uri: Uri, annotationType?: FileAnnotationType, line?: number): string;
    static getMarkdownCommandArgs(argsOrUri: OpenFileRevisionCommandArgs | Uri, annotationType?: FileAnnotationType, line?: number): string {
        let args: OpenFileRevisionCommandArgs | Uri;
        if (argsOrUri instanceof Uri) {
            const uri = argsOrUri;

            args = {
                uri: uri,
                line: line,
                annotationType: annotationType
            };
        }
        else {
            args = argsOrUri;
        }

        return super.getMarkdownCommandArgsCore<OpenFileRevisionCommandArgs>(Commands.OpenFileRevision, args);
    }

    constructor() {
        super(Commands.OpenFileRevision);
    }

    async execute(editor: TextEditor, uri?: Uri, args: OpenFileRevisionCommandArgs = {}) {
        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        let progressCancellation: CancellationTokenSource | undefined;

        try {
            if (args.uri === undefined) {
                uri = getCommandUri(uri, editor);
                if (uri === undefined) return undefined;

                const gitUri = await GitUri.fromUri(uri);

                const placeHolder = `Open ${gitUri.getFormattedPath()}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''} in revision ${GlyphChars.Ellipsis}`;
                progressCancellation = FileHistoryQuickPick.showProgress(placeHolder);

                const log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { maxCount: args.maxCount, ref: gitUri.sha });
                if (log === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open history compare');

                if (progressCancellation.token.isCancellationRequested) return undefined;

                let previousPageCommand: CommandQuickPickItem | undefined = undefined;

                if (log.truncated) {
                    const npc = new CommandQuickPickItem({
                        label: `$(arrow-right) Show Next Commits`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} newer commits`
                    }, Commands.OpenFileRevision, [uri, { ...args } as OpenFileRevisionCommandArgs]);

                    const last = Iterables.last(log.commits.values());
                    if (last != null) {
                        previousPageCommand = new CommandQuickPickItem({
                            label: `$(arrow-left) Show Previous Commits`,
                            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} older commits`
                        }, Commands.OpenFileRevision, [new GitUri(uri, last), { ...args, nextPageCommand: npc } as OpenFileRevisionCommandArgs]);
                    }
                }

                const pick = await FileHistoryQuickPick.show(log, gitUri, placeHolder, {
                    pickerOnly: true,
                    progressCancellation: progressCancellation,
                    currentCommand: new CommandQuickPickItem({
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to history of ${GlyphChars.Space}$(file-text) ${gitUri.getFormattedPath()}${gitUri.sha ? ` from ${GlyphChars.Space}$(git-commit) ${gitUri.shortSha}` : ''}`
                    }, Commands.OpenFileRevision, [uri, { ...args }]),
                    nextPageCommand: args.nextPageCommand,
                    previousPageCommand: previousPageCommand,
                    showAllCommand: log !== undefined && log.truncated
                        ? new CommandQuickPickItem({
                            label: `$(sync) Show All Commits`,
                            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                        }, Commands.OpenFileRevision, [uri, { ...args, maxCount: 0 } as OpenFileRevisionCommandArgs])
                        : undefined
                });
                if (pick === undefined) return undefined;

                if (pick instanceof ShowBranchesAndTagsQuickPickItem) {
                    const branchOrTag = await pick.execute();
                    if (branchOrTag === undefined) return undefined;

                    if (branchOrTag instanceof CommandQuickPickItem) return branchOrTag.execute();

                    args.uri = GitUri.toRevisionUri(branchOrTag.name, gitUri.fsPath, gitUri.repoPath!);
                }
                else {
                    if (pick instanceof CommandQuickPickItem) return pick.execute();

                    args.uri = GitUri.toRevisionUri(pick.commit.sha, pick.commit.uri.fsPath, pick.commit.repoPath);
                }

            }

            if (args.line !== undefined && args.line !== 0) {
                if (args.showOptions === undefined) {
                    args.showOptions = {};
                }
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            const e = await openEditor(args.uri!, { ...args.showOptions, rethrow: true });
            if (args.annotationType === undefined) return e;

            return Container.annotations.showAnnotations(e!, args.annotationType, args.line);
        }
        catch (ex) {
            Logger.error(ex, 'OpenFileRevisionCommand');
            return window.showErrorMessage(`Unable to open file revision. See output channel for more details`);
        }
        finally {
            progressCancellation && progressCancellation.dispose();
        }
    }
}