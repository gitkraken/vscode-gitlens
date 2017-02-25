'use strict';
import { commands, Disposable, TextEditor, TextEditorEdit, window } from 'vscode';

export type Commands = 'gitlens.copyMessageToClipboard' | 'gitlens.copyShaToClipboard' | 'gitlens.diffWithPrevious' | 'gitlens.diffLineWithPrevious' | 'gitlens.diffWithWorking' | 'gitlens.diffLineWithWorking' | 'gitlens.showBlame' | 'gitlens.showBlameHistory' | 'gitlens.showFileHistory' | 'gitlens.showQuickCommitDetails' | 'gitlens.showQuickFileHistory' | 'gitlens.showQuickRepoHistory' | 'gitlens.showQuickRepoStatus' | 'gitlens.toggleBlame' | 'gitlens.toggleCodeLens';
export const Commands = {
    CopyMessageToClipboard: 'gitlens.copyMessageToClipboard' as Commands,
    CopyShaToClipboard: 'gitlens.copyShaToClipboard' as Commands,
    DiffWithPrevious: 'gitlens.diffWithPrevious' as Commands,
    DiffLineWithPrevious: 'gitlens.diffLineWithPrevious' as Commands,
    DiffWithWorking: 'gitlens.diffWithWorking' as Commands,
    DiffLineWithWorking: 'gitlens.diffLineWithWorking' as Commands,
    ShowBlame: 'gitlens.showBlame' as Commands,
    ShowBlameHistory: 'gitlens.showBlameHistory' as Commands,
    ShowFileHistory: 'gitlens.showFileHistory' as Commands,
    ShowQuickCommitDetails: 'gitlens.showQuickCommitDetails' as Commands,
    ShowQuickFileHistory: 'gitlens.showQuickFileHistory' as Commands,
    ShowQuickRepoHistory: 'gitlens.showQuickRepoHistory' as Commands,
    ShowQuickRepoStatus: 'gitlens.showQuickRepoStatus' as Commands,
    ToggleBlame: 'gitlens.toggleBlame' as Commands,
    ToggleCodeLens: 'gitlens.toggleCodeLens' as Commands
};

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