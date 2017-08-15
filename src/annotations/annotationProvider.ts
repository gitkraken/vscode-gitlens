'use strict';
// import { Functions } from '../system';
import { Disposable, ExtensionContext, TextDocument, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import { FileAnnotationType } from '../annotations/annotationController';
import { TextDocumentComparer } from '../comparers';
import { ExtensionKey, IConfig } from '../configuration';
import { WhitespaceController } from './whitespaceController';

 export abstract class AnnotationProviderBase extends Disposable {

    public annotationType: FileAnnotationType;
    public document: TextDocument;

    protected _config: IConfig;
    protected _disposable: Disposable;

    constructor(context: ExtensionContext, public editor: TextEditor, protected decoration: TextEditorDecorationType | undefined, protected highlightDecoration: TextEditorDecorationType | undefined, protected whitespaceController: WhitespaceController | undefined) {
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
                if (this.highlightDecoration !== undefined) {
                    this.editor.setDecorations(this.highlightDecoration, []);
                }

                if (this.decoration !== undefined) {
                    this.editor.setDecorations(this.decoration, []);
                }
            }
            catch (ex) { }
        }

        // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- restore whitespace
        this.whitespaceController && await this.whitespaceController.restore();
    }

    async reset(decoration: TextEditorDecorationType | undefined, highlightDecoration: TextEditorDecorationType | undefined, whitespaceController?: WhitespaceController) {
        await this.clear();

        this._config = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
        this.decoration = decoration;
        this.highlightDecoration = highlightDecoration;
        this.whitespaceController = whitespaceController;

        await this.provideAnnotation(this.editor === undefined ? undefined : this.editor.selection.active.line);
    }

    abstract async provideAnnotation(shaOrLine?: string | number): Promise<boolean>;
    abstract async selection(shaOrLine?: string | number): Promise<void>;
    abstract async validate(): Promise<boolean>;
 }