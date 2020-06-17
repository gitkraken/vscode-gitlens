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
	window,
} from 'vscode';
import { FileAnnotationType } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Logger } from '../logger';
import { GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';

export enum AnnotationStatus {
	Computing = 'computing',
	Computed = 'computed',
}

export type TextEditorCorrelationKey = string;

export abstract class AnnotationProviderBase implements Disposable {
	static getCorrelationKey(editor: TextEditor | undefined): TextEditorCorrelationKey {
		return editor != null ? (editor as any).id : '';
	}

	annotationType: FileAnnotationType | undefined;
	correlationKey: TextEditorCorrelationKey;
	document: TextDocument;
	status: AnnotationStatus | undefined;

	private decorations:
		| { decorationType: TextEditorDecorationType; rangesOrOptions: Range[] | DecorationOptions[] }[]
		| undefined;
	protected disposable: Disposable;

	constructor(public editor: TextEditor, protected readonly trackedDocument: TrackedDocument<GitDocumentState>) {
		this.correlationKey = AnnotationProviderBase.getCorrelationKey(this.editor);
		this.document = this.editor.document;

		this.disposable = Disposable.from(
			window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this),
		);
	}

	dispose() {
		this.clear();

		this.disposable.dispose();
	}

	private onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
		if (this.document !== e.textEditor.document) return;

		void this.selection(e.selections[0].active.line);
	}

	get editorId(): string {
		if (this.editor?.document == null) return '';
		return (this.editor as any).id;
	}

	get editorUri(): Uri | undefined {
		if (this.editor?.document == null) return undefined;
		return this.editor.document.uri;
	}

	clear() {
		this.status = undefined;
		if (this.editor == null) return;

		if (this.decorations?.length) {
			for (const d of this.decorations) {
				try {
					this.editor.setDecorations(d.decorationType, []);
				} catch {}
			}

			this.decorations = undefined;
		}
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

		if (this.decorations?.length) {
			for (const d of this.decorations) {
				this.editor.setDecorations(d.decorationType, d.rangesOrOptions);
			}
		}

		this.status = AnnotationStatus.Computed;
		if (editor === window.activeTextEditor) {
			await setCommandContext(CommandContext.AnnotationStatus, this.status);
		}
	}

	async provideAnnotation(shaOrLine?: string | number): Promise<boolean> {
		this.status = AnnotationStatus.Computing;
		try {
			if (await this.onProvideAnnotation(shaOrLine)) {
				this.status = AnnotationStatus.Computed;
				return true;
			}
		} catch (ex) {
			Logger.error(ex);
		}

		this.status = undefined;
		return false;
	}

	protected abstract onProvideAnnotation(shaOrLine?: string | number): Promise<boolean>;

	abstract selection(shaOrLine?: string | number): Promise<void>;

	protected setDecorations(
		decorations: { decorationType: TextEditorDecorationType; rangesOrOptions: Range[] | DecorationOptions[] }[],
	) {
		if (this.decorations?.length) {
			this.clear();
		}

		this.decorations = decorations;
		if (this.decorations?.length) {
			for (const d of this.decorations) {
				this.editor.setDecorations(d.decorationType, d.rangesOrOptions);
			}
		}
	}

	abstract validate(): Promise<boolean>;
}
