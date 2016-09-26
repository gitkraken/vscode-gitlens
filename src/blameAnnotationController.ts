'use strict'
import {Disposable, ExtensionContext, TextEditor, workspace} from 'vscode';
import {BlameAnnotationProvider} from './blameAnnotationProvider';
import GitProvider from './gitProvider';

export default class BlameAnnotationController extends Disposable {
    private _disposable: Disposable;
    private _annotationProvider: BlameAnnotationProvider|null;

    constructor(private context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());

        const subscriptions: Disposable[] = [];

        // subscriptions.push(window.onDidChangeActiveTextEditor(e => {
        //     if (!e || !this._controller || this._controller.editor === e) return;
        //     this.clear();
        // }));

        subscriptions.push(workspace.onDidCloseTextDocument(d => {
            if (!this._annotationProvider || this._annotationProvider.uri.toString() !== d.uri.toString()) return;
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
        this._annotationProvider = null;
    }

    showBlameAnnotation(editor: TextEditor, sha?: string) {
        if (!editor || !editor.document || editor.document.isUntitled) {
            this.clear();
            return;
        }

        if (!this._annotationProvider) {
            this._annotationProvider = new BlameAnnotationProvider(this.context, this.git, editor);
            return this._annotationProvider.provideBlameAnnotation(sha);
        }
    }

    toggleBlameAnnotation(editor: TextEditor, sha?: string) {
        if (!editor ||!editor.document || editor.document.isUntitled || this._annotationProvider) {
            this.clear();
            return;
        }

        return this.showBlameAnnotation(editor, sha);
    }
}