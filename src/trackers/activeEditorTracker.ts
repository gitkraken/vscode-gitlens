'use strict';
import { commands, Disposable, TextEditor, window } from 'vscode';
import { BuiltInCommands } from '../constants';
import { Functions } from '../system';

export class ActiveEditorTracker implements Disposable {
    private _disposable: Disposable;
    private _resolver: ((editor: TextEditor | undefined) => void) | undefined;

    constructor() {
        const fn = Functions.debounce((e: TextEditor | undefined) => this._resolver && this._resolver(e), 50);
        this._disposable = window.onDidChangeActiveTextEditor(fn);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    async awaitClose(timeout: number = 500): Promise<TextEditor | undefined> {
        this.close();
        return this.wait(timeout);
    }

    async awaitNext(timeout: number = 500): Promise<TextEditor | undefined> {
        this.next();
        return this.wait(timeout);
    }

    async close(): Promise<{} | undefined> {
        return commands.executeCommand(BuiltInCommands.CloseActiveEditor);
    }

    async next(): Promise<{} | undefined> {
        return commands.executeCommand(BuiltInCommands.NextEditor);
    }

    async wait(timeout: number = 500): Promise<TextEditor | undefined> {
        const editor = await new Promise<TextEditor>((resolve, reject) => {
            let timer: NodeJS.Timer | undefined;

            this._resolver = (editor: TextEditor | undefined) => {
                if (timer) {
                    clearTimeout(timer);
                    timer = undefined;
                    resolve(editor);
                }
            };

            timer = setTimeout(() => {
                resolve(window.activeTextEditor);
                timer = undefined;
            }, timeout);
        });

        this._resolver = undefined;
        return editor;
    }
}
