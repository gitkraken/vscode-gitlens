import type {
	DecorationOptions,
	Range,
	TextDocument,
	TextEditor,
	TextEditorDecorationType,
	TextEditorSelectionChangeEvent,
	Uri,
} from 'vscode';
import { Disposable, window } from 'vscode';
import type { FileAnnotationType } from '../config';
import { setContext } from '../system/context';
import { Logger } from '../system/logger';
import type { GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';

export type AnnotationStatus = 'computing' | 'computed';

export interface AnnotationContext {
	selection?: { sha?: string; line?: undefined } | { sha?: undefined; line?: number } | false;
}

export type TextEditorCorrelationKey = string;
export function getEditorCorrelationKey(editor: TextEditor | undefined): TextEditorCorrelationKey {
	return `${editor?.document.uri.toString()}|${editor?.viewColumn}`;
}

export abstract class AnnotationProviderBase<TContext extends AnnotationContext = AnnotationContext>
	implements Disposable
{
	annotationContext: TContext | undefined;
	correlationKey: TextEditorCorrelationKey;
	document: TextDocument;
	status: AnnotationStatus | undefined;

	private decorations:
		| { decorationType: TextEditorDecorationType; rangesOrOptions: Range[] | DecorationOptions[] }[]
		| undefined;
	protected disposable: Disposable;

	constructor(
		public readonly annotationType: FileAnnotationType,
		public editor: TextEditor,
		protected readonly trackedDocument: TrackedDocument<GitDocumentState>,
	) {
		this.correlationKey = getEditorCorrelationKey(this.editor);
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

		void this.selection({ line: e.selections[0].active.line });
	}

	get editorUri(): Uri | undefined {
		return this.editor?.document?.uri;
	}

	clear() {
		this.annotationContext = undefined;
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

	mustReopen(_context?: TContext): boolean {
		return false;
	}

	refresh(replaceDecorationTypes: Map<TextEditorDecorationType, TextEditorDecorationType | null>) {
		if (this.editor == null || !this.decorations?.length) return;

		const decorations = [];

		for (const d of this.decorations) {
			const type = replaceDecorationTypes.get(d.decorationType);
			// If the type is null then we've removed that type, so remove the decorations that reference it
			if (type === null) continue;

			if (type != null) {
				d.decorationType = type;
			}
			decorations.push(d);
		}

		this.setDecorations(this.decorations);
	}

	async restore(editor: TextEditor) {
		// If the editor isn't disposed then we don't need to do anything
		// Explicitly check for `false`
		if ((this.editor as any)._disposed === false) return;

		this.status = 'computing';
		if (editor === window.activeTextEditor) {
			await setContext('gitlens:annotationStatus', this.status);
		}

		this.editor = editor;
		this.correlationKey = getEditorCorrelationKey(editor);
		this.document = editor.document;

		if (this.decorations?.length) {
			for (const d of this.decorations) {
				this.editor.setDecorations(d.decorationType, d.rangesOrOptions);
			}
		}

		this.status = 'computed';
		if (editor === window.activeTextEditor) {
			await setContext('gitlens:annotationStatus', this.status);
		}
	}

	async provideAnnotation(context?: TContext): Promise<boolean> {
		this.status = 'computing';
		try {
			if (await this.onProvideAnnotation(context)) {
				this.status = 'computed';
				return true;
			}
		} catch (ex) {
			Logger.error(ex);
		}

		this.status = undefined;
		return false;
	}

	protected abstract onProvideAnnotation(context?: TContext): Promise<boolean>;

	abstract selection(selection?: TContext['selection']): Promise<void>;

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
