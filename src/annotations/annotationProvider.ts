'use strict';
import { Functions } from '../system';
import { DecorationOptions, Disposable, ExtensionContext, TextDocument, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, Uri, window } from 'vscode';
import { FileAnnotationType } from '../annotations/annotationController';
import { TextDocumentComparer } from '../comparers';
import { configuration, IConfig } from '../configuration';
import { GitContextTracker } from '../gitService';

export type TextEditorCorrelationKey = string;

export abstract class AnnotationProviderBase extends Disposable {

    static getCorrelationKey(editor: TextEditor | undefined): TextEditorCorrelationKey {
        return editor !== undefined ? (editor as any).id : '';
    }

    public annotationType: FileAnnotationType;
    public correlationKey: TextEditorCorrelationKey;
    public document: TextDocument;

    protected _config: IConfig;
    protected _decorations: DecorationOptions[] | undefined;
    protected _disposable: Disposable;

    constructor(
        context: ExtensionContext,
        public editor: TextEditor,
        protected readonly gitContextTracker: GitContextTracker,
        protected decoration: TextEditorDecorationType | undefined,
        protected highlightDecoration: TextEditorDecorationType | undefined
    ) {
        super(() => this.dispose());

        this.correlationKey = AnnotationProviderBase.getCorrelationKey(this.editor);
        this.document = this.editor.document;

        this._config = configuration.get<IConfig>();

        this._disposable = Disposable.from(
            window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this)
        );
    }

    async dispose() {
        await this.clear();

        this._disposable && this._disposable.dispose();
    }

    private async onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
        if (!TextDocumentComparer.equals(this.document, e.textEditor && e.textEditor.document)) return;

        return this.selection(e.selections[0].active.line);
    }

    get editorId(): string {
        if (this.editor === undefined || this.editor.document === undefined) return '';
        return (this.editor as any).id;
    }

    get editorUri(): Uri | undefined {
        if (this.editor === undefined || this.editor.document === undefined) return undefined;
        return this.editor.document.uri;
    }

    async clear() {
        this.gitContextTracker.setLineTracking(this.editor, false);

        if (this.editor !== undefined) {
            try {
                if (this.highlightDecoration !== undefined) {
                    this.editor.setDecorations(this.highlightDecoration, []);
                }

                if (this.decoration !== undefined) {
                    this.editor.setDecorations(this.decoration, []);
                }
            }
            catch { }
        }
    }

    private _resetDebounced: ((changes?: { decoration: TextEditorDecorationType | undefined, highlightDecoration: TextEditorDecorationType | undefined }) => Promise<void>) | undefined;

    async reset(changes?: { decoration: TextEditorDecorationType | undefined, highlightDecoration: TextEditorDecorationType | undefined }) {
        if (this._resetDebounced === undefined) {
            this._resetDebounced = Functions.debounce(this.onReset, 250);
        }

        this._resetDebounced(changes);
    }

    async onReset(changes?: { decoration: TextEditorDecorationType | undefined, highlightDecoration: TextEditorDecorationType | undefined }) {
        if (changes !== undefined) {
            await this.clear();

            this.decoration = changes.decoration;
            this.highlightDecoration = changes.highlightDecoration;
        }

        this._config = configuration.get<IConfig>();
        await this.provideAnnotation(this.editor === undefined ? undefined : this.editor.selection.active.line);
    }

    restore(editor: TextEditor, force: boolean = false) {
        this.gitContextTracker.setLineTracking(this.editor, true);

        // If the editor isn't disposed then we don't need to do anything
        // Explicitly check for `false`
        if (!force && (this.editor as any)._disposed === false) return;

        this.editor = editor;
        this.correlationKey = AnnotationProviderBase.getCorrelationKey(editor);
        this.document = editor.document;

        if (this._decorations !== undefined && this._decorations.length) {
            this.editor.setDecorations(this.decoration!, this._decorations);
        }
    }

    provideAnnotation(shaOrLine?: string | number): Promise<boolean> {
        this.gitContextTracker.setLineTracking(this.editor, true);

        return this.onProvideAnnotation(shaOrLine);
    }

    abstract async onProvideAnnotation(shaOrLine?: string | number): Promise<boolean>;
    abstract async selection(shaOrLine?: string | number): Promise<void>;
    abstract async validate(): Promise<boolean>;
 }