'use strict';
import { commands, Disposable, TextEditor, TextEditorEdit, window } from 'vscode';
import { Commands } from '../constants';

export abstract class Command extends Disposable {

    private _disposable: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._disposable = commands.registerCommand(command, this.execute, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    abstract execute(...args: any[]): any;
}

export abstract class EditorCommand extends Disposable {
    private _disposable: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._disposable = commands.registerTextEditorCommand(command, this.execute, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    abstract execute(editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any;
}

export abstract class ActiveEditorCommand extends Disposable {
    private _disposable: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._disposable = commands.registerCommand(command, this._execute, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    _execute(...args: any[]): any {
        return this.execute(window.activeTextEditor, ...args);
    }

    abstract execute(editor: TextEditor, ...args: any[]): any;
}