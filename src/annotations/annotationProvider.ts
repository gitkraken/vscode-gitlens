'use strict';
import { Functions } from '../system';
import { Disposable, ExtensionContext, TextDocument, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import { TextDocumentComparer } from '../comparers';
import { ExtensionKey, FileAnnotationType, IConfig } from '../configuration';
import { WhitespaceController } from './whitespaceController';

 export abstract class AnnotationProviderBase extends Disposable {

    public annotationType: FileAnnotationType;
    public document: TextDocument;

    protected _config: IConfig;
    protected _disposable: Disposable;

    constructor(context: ExtensionContext, public editor: TextEditor, protected decoration: TextEditorDecorationType, protected highlightDecoration: TextEditorDecorationType | undefined, protected whitespaceController: WhitespaceController | undefined) {
        super(() => this.dispose());

        this.document = this.editor.document;

        this._config = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

        const subscriptions: Disposable[] = [];

        subscriptions.push(window.onDidChangeTextEditorSelection(this._onTextEditorSelectionChanged, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    async dispose() {
        await this.clear();

        this._disposable && this._disposable.dispose();
    }

    private async _onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
        if (!TextDocumentComparer.equals(this.document, e.textEditor && e.textEditor.document)) return;

        return this.selection(e.selections[0].active.line);
    }

    async clear() {
        if (this.editor !== undefined) {
            try {
                this.editor.setDecorations(this.decoration, []);
                this.highlightDecoration && this.editor.setDecorations(this.highlightDecoration, []);
                // I have no idea why the decorators sometimes don't get removed, but if they don't try again with a tiny delay
                if (this.highlightDecoration !== undefined) {
                    await Functions.wait(1);

                    if (this.highlightDecoration === undefined) return;

                    this.editor.setDecorations(this.highlightDecoration, []);
                }
            }
            catch (ex) { }
        }

        // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- restore whitespace
        this.whitespaceController && await this.whitespaceController.restore();
    }

    async reset() {
        await this.clear();

        this._config = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

        await this.provideAnnotation(this.editor === undefined ? undefined : this.editor.selection.active.line);
    }

    abstract async provideAnnotation(shaOrLine?: string | number): Promise<boolean>;
    abstract async selection(shaOrLine?: string | number): Promise<void>;
    abstract async validate(): Promise<boolean>;
 }