'use strict';
import {
    DecorationOptions,
    Disposable,
    Range,
    TextDocument,
    TextEditor,
    TextEditorDecorationType,
    TextEditorSelectionChangeEvent,
    Uri,
    window
} from 'vscode';
import { TextDocumentComparer } from '../comparers';
import { FileAnnotationType } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Functions } from '../system';
import { GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';

export enum AnnotationStatus {
    Computing = 'computing',
    Computed = 'computed'
}

export type TextEditorCorrelationKey = string;

export abstract class AnnotationProviderBase implements Disposable {
    static getCorrelationKey(editor: TextEditor | undefined): TextEditorCorrelationKey {
        return editor !== undefined ? (editor as any).id : '';
    }

    annotationType: FileAnnotationType | undefined;
    correlationKey: TextEditorCorrelationKey;
    document: TextDocument;
    status: AnnotationStatus | undefined;

    protected decorations: DecorationOptions[] | undefined;
    protected disposable: Disposable;

    constructor(
        public editor: TextEditor,
        protected readonly trackedDocument: TrackedDocument<GitDocumentState>,
        protected decoration: TextEditorDecorationType,
        protected highlightDecoration: TextEditorDecorationType | undefined
    ) {
        this.correlationKey = AnnotationProviderBase.getCorrelationKey(this.editor);
        this.document = this.editor.document;

        this.disposable = Disposable.from(
            window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this)
        );
    }

    dispose() {
        this.clear();

        this.disposable && this.disposable.dispose();
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

    protected additionalDecorations: { decoration: TextEditorDecorationType; ranges: Range[] }[] | undefined;

    clear() {
        this.status = undefined;
        if (this.editor === undefined) return;

        if (this.decoration !== undefined) {
            try {
                this.editor.setDecorations(this.decoration, []);
            }
            catch {}
        }

        if (this.additionalDecorations !== undefined && this.additionalDecorations.length > 0) {
            for (const d of this.additionalDecorations) {
                try {
                    this.editor.setDecorations(d.decoration, []);
                }
                catch {}
            }

            this.additionalDecorations = undefined;
        }

        if (this.highlightDecoration !== undefined) {
            try {
                this.editor.setDecorations(this.highlightDecoration, []);
            }
            catch {}
        }
    }

    private _resetDebounced:
        | ((
              changes?: {
                  decoration: TextEditorDecorationType;
                  highlightDecoration: TextEditorDecorationType | undefined;
              }
          ) => void)
        | undefined;

    reset(changes?: {
        decoration: TextEditorDecorationType;
        highlightDecoration: TextEditorDecorationType | undefined;
    }) {
        if (this._resetDebounced === undefined) {
            this._resetDebounced = Functions.debounce(this.onReset, 250);
        }

        this._resetDebounced(changes);
    }

    async onReset(changes?: {
        decoration: TextEditorDecorationType;
        highlightDecoration: TextEditorDecorationType | undefined;
    }) {
        if (changes !== undefined) {
            this.clear();

            this.decoration = changes.decoration;
            this.highlightDecoration = changes.highlightDecoration;
        }

        await this.provideAnnotation(this.editor === undefined ? undefined : this.editor.selection.active.line);
    }

    async restore(editor: TextEditor) {
        // If the editor isn't disposed then we don't need to do anything
        // Explicitly check for `false`
        if ((this.editor as any)._disposed === false) return;

        this.status = AnnotationStatus.Computing;
        if (editor === window.activeTextEditor) {
            await setCommandContext(CommandContext.AnnotationStatus, this.status);
        }

        this.editor = editor;
        this.correlationKey = AnnotationProviderBase.getCorrelationKey(editor);
        this.document = editor.document;

        if (this.decorations !== undefined && this.decorations.length) {
            this.editor.setDecorations(this.decoration, this.decorations);

            if (this.additionalDecorations !== undefined && this.additionalDecorations.length) {
                for (const d of this.additionalDecorations) {
                    this.editor.setDecorations(d.decoration, d.ranges);
                }
            }
        }

        this.status = AnnotationStatus.Computed;
        if (editor === window.activeTextEditor) {
            await setCommandContext(CommandContext.AnnotationStatus, this.status);
            await this.selection(editor.selection.active.line);
        }
    }

    async provideAnnotation(shaOrLine?: string | number): Promise<boolean> {
        this.status = AnnotationStatus.Computing;
        if (await this.onProvideAnnotation(shaOrLine)) {
            this.status = AnnotationStatus.Computed;
            return true;
        }

        this.status = undefined;
        return false;
    }

    abstract async onProvideAnnotation(shaOrLine?: string | number): Promise<boolean>;
    abstract async selection(shaOrLine?: string | number): Promise<void>;
    abstract async validate(): Promise<boolean>;
}
