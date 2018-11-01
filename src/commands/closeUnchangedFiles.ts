'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { TextEditorComparer, UriComparer } from '../comparers';
import { BuiltInCommands, GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Functions } from '../system';
import { ActiveEditorCommand, command, Commands, getCommandUri, getRepoPathOrPrompt } from './common';

export interface CloseUnchangedFilesCommandArgs {
    uris?: Uri[];
}

@command()
export class CloseUnchangedFilesCommand extends ActiveEditorCommand {
    private _onEditorChangedFn: ((editor: TextEditor | undefined) => void) | undefined;

    constructor() {
        super(Commands.CloseUnchangedFiles);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: CloseUnchangedFilesCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            if (args.uris === undefined) {
                args = { ...args };

                const repoPath = await getRepoPathOrPrompt(
                    undefined,
                    `Close all files except those changed in which repository${GlyphChars.Ellipsis}`
                );
                if (!repoPath) return undefined;

                const status = await Container.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to close unchanged files`);

                args.uris = status.files.map(f => f.uri);
            }

            if (args.uris.length === 0) return commands.executeCommand(BuiltInCommands.CloseAllEditors);

            const disposable = window.onDidChangeActiveTextEditor(
                Functions.debounce(
                    (e: TextEditor | undefined) => this._onEditorChangedFn && this._onEditorChangedFn(e),
                    50
                )
            );

            editor = window.activeTextEditor;

            let count = 0;
            let loopCount = 0;
            const editors: TextEditor[] = [];

            // Find out how many editors there are
            while (true) {
                if (editor != null) {
                    let found = false;
                    for (const e of editors) {
                        if (TextEditorComparer.equals(e, editor, { useId: true, usePosition: true })) {
                            found = true;
                            break;
                        }
                    }
                    if (found) break;

                    // Start counting at the first real editor
                    count++;
                    editors.push(editor);
                }
                else {
                    if (count !== 0) {
                        count++;
                    }
                }

                editor = await this.nextEditor();

                loopCount++;
                // Break out if we've looped 4 times and haven't found any editors
                if (loopCount >= 4 && editors.length === 0) break;
            }

            if (editors.length) {
                editor = window.activeTextEditor;

                for (let i = 0; i <= count; i++) {
                    if (
                        editor == null ||
                        (editor.document !== undefined &&
                            (editor.document.isDirty ||
                                args.uris.some(uri =>
                                    UriComparer.equals(uri, editor!.document && editor!.document.uri)
                                )))
                    ) {
                        editor = await this.nextEditor();
                    }
                    else {
                        editor = await this.closeEditor();
                    }
                }
            }

            disposable.dispose();

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'CloseUnchangedFilesCommand');
            return Messages.showGenericErrorMessage('Unable to close all unchanged files');
        }
    }

    private async closeEditor(timeout: number = 500): Promise<TextEditor | undefined> {
        const editor = window.activeTextEditor;

        void (await commands.executeCommand(BuiltInCommands.CloseActiveEditor));

        if (editor !== window.activeTextEditor) {
            return window.activeTextEditor;
        }

        return this.waitForEditorChange(timeout);
    }

    private async nextEditor(timeout: number = 500): Promise<TextEditor | undefined> {
        const editor = window.activeTextEditor;

        void (await commands.executeCommand(BuiltInCommands.NextEditor));

        if (editor !== window.activeTextEditor) {
            return window.activeTextEditor;
        }

        return this.waitForEditorChange(timeout);
    }

    private waitForEditorChange(timeout: number = 500): Promise<TextEditor | undefined> {
        return new Promise<TextEditor>((resolve, reject) => {
            let timer: NodeJS.Timer | undefined;

            this._onEditorChangedFn = (editor: TextEditor | undefined) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = undefined;

                    resolve(editor);
                }
            };

            timer = setTimeout(() => {
                timer = undefined;

                resolve(window.activeTextEditor);
            }, timeout);
        });
    }
}
