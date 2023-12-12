import type { TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent } from 'vscode';
import { Disposable, window } from 'vscode';
import type { FileAnnotationType } from '../config';
import type { Container } from '../container';
import { setContext } from '../system/context';
import { Logger } from '../system/logger';
import type { GitDocumentState } from '../trackers/gitDocumentTracker';
import type { TrackedDocument } from '../trackers/trackedDocument';
import type { Decoration } from './annotations';

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
	private decorations: Decoration[] | undefined;
	protected disposable: Disposable;

	constructor(
		protected readonly container: Container,
		public readonly annotationType: FileAnnotationType,
		editor: TextEditor,
		protected readonly trackedDocument: TrackedDocument<GitDocumentState>,
	) {
		this.editor = editor;

		this.disposable = Disposable.from(
			window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this),
		);
	}

	dispose() {
		this.clear();

		this.disposable.dispose();
	}

	private _annotationContext: TContext | undefined;
	get annotationContext(): TContext | undefined {
		return this._annotationContext;
	}
	protected set annotationContext(value: TContext | undefined) {
		this._annotationContext = value;
	}

	private _correlationKey!: TextEditorCorrelationKey;
	get correlationKey(): TextEditorCorrelationKey {
		return this._correlationKey;
	}

	private _editor!: TextEditor;
	get editor(): TextEditor {
		return this._editor;
	}
	protected set editor(value: TextEditor) {
		this._editor = value;
		this._correlationKey = getEditorCorrelationKey(value);
	}

	private _status: AnnotationStatus | undefined;
	get status(): AnnotationStatus | undefined {
		return this._status;
	}

	get statusContextValue(): string | undefined {
		return this.status != null ? `${this.status}+${this.annotationType}` : undefined;
	}

	private async setStatus(value: AnnotationStatus | undefined, editor: TextEditor | undefined): Promise<void> {
		if (this.status === value) return;

		this._status = value;
		if (editor != null && editor === window.activeTextEditor) {
			await setContext('gitlens:annotationStatus', this.statusContextValue);
		}
	}

	private onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
		if (this.editor.document !== e.textEditor.document) return;

		void this.selection?.({ line: e.selections[0].active.line });
	}

	canReuse(_context?: TContext): boolean {
		return true;
	}

	clear() {
		const decorations = this.decorations;
		this.decorations = undefined;
		this.annotationContext = undefined;
		void this.setStatus(undefined, this.editor);

		if (this.editor == null) return;

		if (decorations?.length) {
			for (const d of decorations) {
				try {
					this.editor.setDecorations(d.decorationType, []);
					if (d.dispose) {
						d.decorationType.dispose();
					}
				} catch {}
			}
		}
	}

	nextChange?(): void;
	previousChange?(): void;

	async provideAnnotation(context?: TContext, force?: boolean): Promise<boolean> {
		void this.setStatus('computing', this.editor);

		try {
			if (await this.onProvideAnnotation(context, force)) {
				void this.setStatus('computed', this.editor);
				await this.selection?.(force ? { line: this.editor.selection.active.line } : context?.selection);
				return true;
			}
		} catch (ex) {
			Logger.error(ex);
		}

		void this.setStatus(undefined, this.editor);
		return false;
	}

	protected abstract onProvideAnnotation(context?: TContext, force?: boolean): Promise<boolean>;

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

	restore(editor: TextEditor, force?: boolean) {
		// If the editor isn't disposed then we don't need to do anything
		// Explicitly check for `false`
		if ((this.editor as any)._disposed === false) return;

		if (force || this.decorations == null) {
			void this.provideAnnotation(this.annotationContext, force);
			return;
		}

		void this.setStatus('computing', this.editor);

		this.editor = editor;

		if (this.decorations?.length) {
			for (const d of this.decorations) {
				this.editor.setDecorations(d.decorationType, d.rangesOrOptions);
			}
		}

		void this.setStatus('computed', this.editor);
	}

	selection?(selection?: TContext['selection']): Promise<void>;
	validate?(): boolean | Promise<boolean>;

	protected setDecorations(decorations: Decoration[]) {
		if (this.decorations?.length) {
			// If we have no new decorations, just completely clear the old ones
			if (!decorations?.length) {
				this.clear();

				return;
			}

			// Only remove the decorations that are no longer needed
			const remove = this.decorations.filter(
				decoration => !decorations.some(d => d.decorationType.key === decoration.decorationType.key),
			);
			for (const d of remove) {
				try {
					this.editor.setDecorations(d.decorationType, []);
					if (d.dispose) {
						d.decorationType.dispose();
					}
				} catch {}
			}
		}

		this.decorations = decorations;
		if (decorations?.length) {
			for (const d of decorations) {
				this.editor.setDecorations(d.decorationType, d.rangesOrOptions);
			}
		}
	}
}
