
'use strict';
import { Functions } from './system';
import { commands, Disposable, TextEditor, window } from 'vscode';
import { BuiltInCommands } from './constants';

export class ActiveEditorTracker extends Disposable {

    private _disposable: Disposable;
    private _resolver: ((value?: TextEditor | PromiseLike<TextEditor>) => void) | undefined;

    constructor() {
        super(() => this.dispose());

        const fn = Functions.debounce((e: TextEditor) => this._resolver && this._resolver(e), 50);
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
            let timer: any;

            this._resolver = (e: TextEditor) => {
                if (timer) {
                    clearTimeout(timer as any);
                    timer = 0;
                    resolve(e);
                }
            };

            timer = setTimeout(() => {
                resolve(window.activeTextEditor);
                timer = 0;
            }, timeout) as any;
        });

        this._resolver = undefined;
        return editor;
    }
}