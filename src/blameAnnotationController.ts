'use strict';
import { Disposable, ExtensionContext, TextEditor, workspace } from 'vscode';
import { BlameAnnotationProvider } from './blameAnnotationProvider';
import GitProvider from './gitProvider';

export default class BlameAnnotationController extends Disposable {
    private _disposable: Disposable;
    private _annotationProvider: BlameAnnotationProvider | undefined;

    constructor(private context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());

        const subscriptions: Disposable[] = [];

        // subscriptions.push(window.onDidChangeActiveTextEditor(e => {
        //     if (!e || !this._controller || this._controller.editor === e) return;
        //     this.clear();
        // }));

        subscriptions.push(workspace.onDidCloseTextDocument(d => {
            if (!this._annotationProvider || this._annotationProvider.uri.fsPath !== d.uri.fsPath) return;
            this.clear();
        }));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this.clear();
        this._disposable && this._disposable.dispose();
    }

    clear() {
        this._annotationProvider && this._annotationProvider.dispose();
        this._annotationProvider = undefined;
    }

    get annotated() {
        return this._annotationProvider !== undefined;
    }

    showBlameAnnotation(editor: TextEditor, sha?: string): Promise<void> {
        if (!editor || !editor.document || editor.document.isUntitled) {
            this.clear();
            return Promise.resolve();
        }

        if (!this._annotationProvider) {
            this._annotationProvider = new BlameAnnotationProvider(this.context, this.git, editor);
            return this._annotationProvider.provideBlameAnnotation(sha);
        }

        return Promise.resolve();
    }

    toggleBlameAnnotation(editor: TextEditor, sha?: string): Promise<void> {
        if (!editor || !editor.document || editor.document.isUntitled || this._annotationProvider) {
            this.clear();
            return Promise.resolve();
        }

        return this.showBlameAnnotation(editor, sha);
    }
}