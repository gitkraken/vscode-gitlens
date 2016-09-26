'use strict'
import {commands, Disposable, TextEditor, TextEditorEdit} from 'vscode';
import {Commands} from '../constants';

export abstract class Command extends Disposable {
    private _subscriptions: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._subscriptions = commands.registerCommand(command, this.execute, this);
    }

    dispose() {
        this._subscriptions && this._subscriptions.dispose();
    }

    abstract execute(...args): any;
}

export abstract class EditorCommand extends Disposable {
    private _subscriptions: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._subscriptions = commands.registerTextEditorCommand(command, this.execute, this);
    }

    dispose() {
        this._subscriptions && this._subscriptions.dispose();
    }

    abstract execute(editor: TextEditor, edit: TextEditorEdit, ...args): any;
}