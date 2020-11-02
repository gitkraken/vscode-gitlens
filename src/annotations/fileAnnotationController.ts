'use strict';
import * as paths from 'path';
import {
	ConfigurationChangeEvent,
	DecorationRangeBehavior,
	Disposable,
	Event,
	EventEmitter,
	OverviewRulerLane,
	Progress,
	ProgressLocation,
	TextDocument,
	TextEditor,
	TextEditorDecorationType,
	TextEditorViewColumnChangeEvent,
	ThemeColor,
	Uri,
	window,
	workspace,
} from 'vscode';
import { AnnotationProviderBase, AnnotationStatus, TextEditorCorrelationKey } from './annotationProvider';
import {
	AnnotationsToggleMode,
	BlameHighlightLocations,
	ChangesLocations,
	configuration,
	FileAnnotationType,
} from '../configuration';
import { ContextKeys, isTextEditor, setContext } from '../constants';
import { Container } from '../container';
import { GutterBlameAnnotationProvider } from './gutterBlameAnnotationProvider';
import { GutterChangesAnnotationProvider } from './gutterChangesAnnotationProvider';
import { GutterHeatmapBlameAnnotationProvider } from './gutterHeatmapBlameAnnotationProvider';
import { KeyboardScope } from '../keyboard';
import { Logger } from '../logger';
import { Functions, Iterables } from '../system';
import {
	DocumentBlameStateChangeEvent,
	DocumentDirtyStateChangeEvent,
	GitDocumentState,
} from '../trackers/gitDocumentTracker';

export enum AnnotationClearReason {
	User = 'User',
	BlameabilityChanged = 'BlameabilityChanged',
	ColumnChanged = 'ColumnChanged',
	Disposing = 'Disposing',
	DocumentChanged = 'DocumentChanged',
	DocumentClosed = 'DocumentClosed',
}

export const Decorations = {
	gutterBlameAnnotation: window.createTextEditorDecorationType({
		rangeBehavior: DecorationRangeBehavior.ClosedOpen,
		textDecoration: 'none',
	}),
	gutterBlameHighlight: undefined as TextEditorDecorationType | undefined,
	changesLineChangedAnnotation: undefined as TextEditorDecorationType | undefined,
	changesLineAddedAnnotation: undefined as TextEditorDecorationType | undefined,
	changesLineDeletedAnnotation: undefined as TextEditorDecorationType | undefined,
};

export class FileAnnotationController implements Disposable {
	private _onDidToggleAnnotations = new EventEmitter<void>();
	get onDidToggleAnnotations(): Event<void> {
		return this._onDidToggleAnnotations.event;
	}

	private _annotationsDisposable: Disposable | undefined;
	private _annotationProviders = new Map<TextEditorCorrelationKey, AnnotationProviderBase>();
	private _disposable: Disposable;
	private _editor: TextEditor | undefined;
	private _keyboardScope: KeyboardScope | undefined = undefined;
	private readonly _toggleModes: Map<FileAnnotationType, AnnotationsToggleMode>;
	private _annotationType: FileAnnotationType | undefined = undefined;

	constructor() {
		this._disposable = Disposable.from(configuration.onDidChange(this.onConfigurationChanged, this));

		this._toggleModes = new Map<FileAnnotationType, AnnotationsToggleMode>();
		this.onConfigurationChanged(configuration.initializingChangeEvent);
	}

	dispose() {
		void this.clearAll();

		Decorations.gutterBlameAnnotation?.dispose();
		Decorations.gutterBlameHighlight?.dispose();
		Decorations.changesLineChangedAnnotation?.dispose();
		Decorations.changesLineAddedAnnotation?.dispose();
		Decorations.changesLineDeletedAnnotation?.dispose();

		this._annotationsDisposable?.dispose();
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		const cfg = Container.config;

		if (configuration.changed(e, 'blame', 'highlight')) {
			Decorations.gutterBlameHighlight?.dispose();
			Decorations.gutterBlameHighlight = undefined;

			const highlight = cfg.blame.highlight;

			if (highlight.enabled) {
				const { locations } = highlight;

				// TODO@eamodio: Read from the theme color when the API exists
				const gutterHighlightColor = '#00bcf2'; // new ThemeColor('gitlens.lineHighlightOverviewRulerColor')
				const gutterHighlightUri = locations.includes(BlameHighlightLocations.Gutter)
					? Uri.parse(
							`data:image/svg+xml,${encodeURIComponent(
								`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='${gutterHighlightColor}' fill-opacity='0.6' x='7' y='0' width='3' height='18'/></svg>`,
							)}`,
					  )
					: undefined;

				Decorations.gutterBlameHighlight = window.createTextEditorDecorationType({
					gutterIconPath: gutterHighlightUri,
					gutterIconSize: 'contain',
					isWholeLine: true,
					overviewRulerLane: OverviewRulerLane.Right,
					backgroundColor: locations.includes(BlameHighlightLocations.Line)
						? new ThemeColor('gitlens.lineHighlightBackgroundColor')
						: undefined,
					overviewRulerColor: locations.includes(BlameHighlightLocations.Overview)
						? new ThemeColor('gitlens.lineHighlightOverviewRulerColor')
						: undefined,
				});
			}
		}

		if (configuration.changed(e, 'changes', 'locations')) {
			Decorations.changesLineAddedAnnotation?.dispose();
			Decorations.changesLineChangedAnnotation?.dispose();
			Decorations.changesLineDeletedAnnotation?.dispose();

			const { locations } = cfg.changes;

			Decorations.changesLineAddedAnnotation = window.createTextEditorDecorationType({
				gutterIconPath: locations.includes(ChangesLocations.Gutter)
					? Uri.parse(
							`data:image/svg+xml,${encodeURIComponent(
								"<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='#587c0c' x='13' y='0' width='3' height='18'/></svg>",
							)}`,
					  )
					: undefined,
				gutterIconSize: 'contain',
				overviewRulerLane: OverviewRulerLane.Left,
				overviewRulerColor: locations.includes(ChangesLocations.Overview)
					? new ThemeColor('editorOverviewRuler.addedForeground')
					: undefined,
			});

			Decorations.changesLineChangedAnnotation = window.createTextEditorDecorationType({
				gutterIconPath: locations.includes(ChangesLocations.Gutter)
					? Uri.parse(
							`data:image/svg+xml,${encodeURIComponent(
								"<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='#0c7d9d' x='13' y='0' width='3' height='18'/></svg>",
							)}`,
					  )
					: undefined,
				gutterIconSize: 'contain',
				overviewRulerLane: OverviewRulerLane.Left,
				overviewRulerColor: locations.includes(ChangesLocations.Overview)
					? new ThemeColor('editorOverviewRuler.modifiedForeground')
					: undefined,
			});

			Decorations.changesLineDeletedAnnotation = window.createTextEditorDecorationType({
				gutterIconPath: locations.includes(ChangesLocations.Gutter)
					? Uri.parse(
							`data:image/svg+xml,${encodeURIComponent(
								"<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><polygon fill='#94151b' points='13,10 13,18 17,14'/></svg>",
							)}`,
					  )
					: undefined,
				gutterIconSize: 'contain',
				overviewRulerLane: OverviewRulerLane.Left,
				overviewRulerColor: locations.includes(ChangesLocations.Overview)
					? new ThemeColor('editorOverviewRuler.deletedForeground')
					: undefined,
			});
		}

		const initializing = configuration.initializing(e);

		if (configuration.changed(e, 'blame', 'toggleMode')) {
			this._toggleModes.set(FileAnnotationType.Blame, cfg.blame.toggleMode);
			if (!initializing && cfg.blame.toggleMode === AnnotationsToggleMode.File) {
				void this.clearAll();
			}
		}

		if (configuration.changed(e, 'changes', 'toggleMode')) {
			this._toggleModes.set(FileAnnotationType.Changes, cfg.changes.toggleMode);
			if (!initializing && cfg.changes.toggleMode === AnnotationsToggleMode.File) {
				void this.clearAll();
			}
		}

		if (configuration.changed(e, 'heatmap', 'toggleMode')) {
			this._toggleModes.set(FileAnnotationType.Heatmap, cfg.heatmap.toggleMode);
			if (!initializing && cfg.heatmap.toggleMode === AnnotationsToggleMode.File) {
				void this.clearAll();
			}
		}

		if (initializing) return;

		if (
			configuration.changed(e, 'blame') ||
			configuration.changed(e, 'changes') ||
			configuration.changed(e, 'heatmap') ||
			configuration.changed(e, 'hovers')
		) {
			// Since the configuration has changed -- reset any visible annotations
			for (const provider of this._annotationProviders.values()) {
				if (provider == null) continue;

				void this.show(provider.editor, provider.annotationType ?? FileAnnotationType.Blame);
			}
		}
	}

	private async onActiveTextEditorChanged(editor: TextEditor | undefined) {
		if (editor != null && !isTextEditor(editor)) return;

		this._editor = editor;
		// Logger.log('AnnotationController.onActiveTextEditorChanged', editor && editor.document.uri.fsPath);

		if (this.isInWindowToggle()) {
			await this.show(editor, this._annotationType!);

			return;
		}

		const provider = this.getProvider(editor);
		if (provider == null) {
			void setContext(ContextKeys.AnnotationStatus, undefined);
			void this.detachKeyboardHook();
		} else {
			void setContext(ContextKeys.AnnotationStatus, provider.status);
			void this.attachKeyboardHook();
		}
	}

	private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
		// Only care if we are becoming un-blameable
		if (e.blameable) return;

		const editor = window.activeTextEditor;
		if (editor == null) return;

		void this.clear(editor, AnnotationClearReason.BlameabilityChanged);
	}

	private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent<GitDocumentState>) {
		for (const [key, p] of this._annotationProviders) {
			if (!e.document.is(p.document)) continue;

			void this.clearCore(key, AnnotationClearReason.DocumentChanged);
		}
	}

	private onTextDocumentClosed(document: TextDocument) {
		if (!Container.git.isTrackable(document.uri)) return;

		for (const [key, p] of this._annotationProviders) {
			if (p.document !== document) continue;

			void this.clearCore(key, AnnotationClearReason.DocumentClosed);
		}
	}

	private onTextEditorViewColumnChanged(e: TextEditorViewColumnChangeEvent) {
		// FYI https://github.com/Microsoft/vscode/issues/35602
		const provider = this.getProvider(e.textEditor);
		if (provider == null) {
			// If we don't find an exact match, do a fuzzy match (since we can't properly track editors)
			const fuzzyProvider = Iterables.find(
				this._annotationProviders.values(),
				p => p.editor.document === e.textEditor.document,
			);
			if (fuzzyProvider == null) return;

			void this.clearCore(fuzzyProvider.correlationKey, AnnotationClearReason.ColumnChanged);

			return;
		}

		void provider.restore(e.textEditor);
	}

	private onVisibleTextEditorsChanged(editors: TextEditor[]) {
		let provider: AnnotationProviderBase | undefined;
		for (const e of editors) {
			provider = this.getProvider(e);
			if (provider == null) continue;

			void provider.restore(e);
		}
	}

	isInWindowToggle(): boolean {
		return this.getToggleMode(this._annotationType) === AnnotationsToggleMode.Window;
	}

	private getToggleMode(annotationType: FileAnnotationType | undefined): AnnotationsToggleMode {
		if (annotationType == null) return AnnotationsToggleMode.File;

		return this._toggleModes.get(annotationType) ?? AnnotationsToggleMode.File;
	}

	clear(editor: TextEditor, reason: AnnotationClearReason = AnnotationClearReason.User) {
		if (this.isInWindowToggle()) {
			return this.clearAll();
		}

		return this.clearCore(AnnotationProviderBase.getCorrelationKey(editor), reason);
	}

	async clearAll() {
		this._annotationType = undefined;
		for (const [key] of this._annotationProviders) {
			await this.clearCore(key, AnnotationClearReason.Disposing);
		}
	}

	async getAnnotationType(editor: TextEditor | undefined): Promise<FileAnnotationType | undefined> {
		const provider = this.getProvider(editor);
		if (provider == null) return undefined;

		const trackedDocument = await Container.tracker.get(editor!.document);
		if (trackedDocument == null || !trackedDocument.isBlameable) return undefined;

		return provider.annotationType;
	}

	getProvider(editor: TextEditor | undefined): AnnotationProviderBase | undefined {
		if (editor == null || editor.document == null) return undefined;
		return this._annotationProviders.get(AnnotationProviderBase.getCorrelationKey(editor));
	}

	async show(
		editor: TextEditor | undefined,
		type: FileAnnotationType,
		shaOrLine?: string | number,
	): Promise<boolean> {
		if (this.getToggleMode(type) === AnnotationsToggleMode.Window) {
			let first = this._annotationType == null;
			const reset =
				(!first && this._annotationType !== type) ||
				(this._annotationType === FileAnnotationType.Changes && typeof shaOrLine === 'string');

			this._annotationType = type;

			if (reset) {
				await this.clearAll();
				first = true;
			}

			if (first) {
				for (const e of window.visibleTextEditors) {
					if (e === editor) continue;

					void this.show(e, type);
				}
			}
		}

		if (editor == null) return false; // || editor.viewColumn == null) return false;
		this._editor = editor;

		const trackedDocument = await Container.tracker.getOrAdd(editor.document);
		if (!trackedDocument.isBlameable) return false;

		const currentProvider = this.getProvider(editor);
		if (currentProvider?.annotationType === type) {
			await currentProvider.provideAnnotation(shaOrLine);
			await currentProvider.selection(shaOrLine);
			return true;
		}

		const provider = await window.withProgress(
			{ location: ProgressLocation.Window },
			async (progress: Progress<{ message: string }>) => {
				await setContext(ContextKeys.AnnotationStatus, AnnotationStatus.Computing);

				const computingAnnotations = this.showAnnotationsCore(
					currentProvider,
					editor,
					type,
					shaOrLine,
					progress,
				);
				const provider = await computingAnnotations;

				if (editor === this._editor) {
					await setContext(ContextKeys.AnnotationStatus, provider?.status);
				}

				return computingAnnotations;
			},
		);

		return provider != null;
	}

	async toggle(
		editor: TextEditor | undefined,
		type: FileAnnotationType,
		shaOrLine?: string | number,
		on?: boolean,
	): Promise<boolean> {
		if (editor != null) {
			const trackedDocument = await Container.tracker.getOrAdd(editor.document);
			if ((type === FileAnnotationType.Changes && !trackedDocument.isTracked) || !trackedDocument.isBlameable) {
				return false;
			}
		}

		const provider = this.getProvider(editor);
		if (provider == null) return this.show(editor, type, shaOrLine);

		const reopen =
			provider.annotationType !== type || (type === FileAnnotationType.Changes && typeof shaOrLine === 'string');
		if (on === true && !reopen) return true;

		if (this.isInWindowToggle()) {
			await this.clearAll();
		} else {
			await this.clearCore(provider.correlationKey, AnnotationClearReason.User);
		}

		if (!reopen) return false;

		return this.show(editor, type, shaOrLine);
	}

	private async attachKeyboardHook() {
		// Allows pressing escape to exit the annotations
		if (this._keyboardScope == null) {
			this._keyboardScope = await Container.keyboard.beginScope({
				escape: {
					onDidPressKey: async () => {
						const e = this._editor;
						if (e == null) return undefined;

						await this.clear(e, AnnotationClearReason.User);
						return undefined;
					},
				},
			});
		}
	}

	private async clearCore(key: TextEditorCorrelationKey, reason: AnnotationClearReason) {
		const provider = this._annotationProviders.get(key);
		if (provider == null) return;

		Logger.log(`${reason}:`, `Clear annotations for ${key}`);

		this._annotationProviders.delete(key);
		provider.dispose();

		if (this._annotationProviders.size === 0 || key === AnnotationProviderBase.getCorrelationKey(this._editor)) {
			await setContext(ContextKeys.AnnotationStatus, undefined);
			await this.detachKeyboardHook();
		}

		if (this._annotationProviders.size === 0) {
			Logger.log('Remove all listener registrations for annotations');

			this._annotationsDisposable?.dispose();
			this._annotationsDisposable = undefined;
		}

		this._onDidToggleAnnotations.fire();
	}

	private async detachKeyboardHook() {
		if (this._keyboardScope == null) return;

		await this._keyboardScope.dispose();
		this._keyboardScope = undefined;
	}

	private async showAnnotationsCore(
		currentProvider: AnnotationProviderBase | undefined,
		editor: TextEditor,
		type: FileAnnotationType,
		shaOrLine?: string | number,
		progress?: Progress<{ message: string }>,
	): Promise<AnnotationProviderBase | undefined> {
		if (progress != null) {
			let annotationsLabel = 'annotations';
			switch (type) {
				case FileAnnotationType.Blame:
					annotationsLabel = 'blame annotations';
					break;

				case FileAnnotationType.Changes:
					annotationsLabel = 'changes annotations';
					break;

				case FileAnnotationType.Heatmap:
					annotationsLabel = 'heatmap annotations';
					break;
			}

			progress.report({
				message: `Computing ${annotationsLabel} for ${paths.basename(editor.document.fileName)}`,
			});
		}

		// Allows pressing escape to exit the annotations
		await this.attachKeyboardHook();

		const trackedDocument = await Container.tracker.getOrAdd(editor.document);

		let provider: AnnotationProviderBase | undefined = undefined;
		switch (type) {
			case FileAnnotationType.Blame:
				provider = new GutterBlameAnnotationProvider(editor, trackedDocument);
				break;

			case FileAnnotationType.Changes:
				provider = new GutterChangesAnnotationProvider(editor, trackedDocument);
				break;

			case FileAnnotationType.Heatmap:
				provider = new GutterHeatmapBlameAnnotationProvider(editor, trackedDocument);
				break;
		}
		if (provider == null || !(await provider.validate())) return undefined;

		if (currentProvider != null) {
			await this.clearCore(currentProvider.correlationKey, AnnotationClearReason.User);
		}

		if (this._annotationsDisposable == null && this._annotationProviders.size === 0) {
			Logger.log('Add listener registrations for annotations');

			this._annotationsDisposable = Disposable.from(
				window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveTextEditorChanged, 50), this),
				window.onDidChangeTextEditorViewColumn(this.onTextEditorViewColumnChanged, this),
				window.onDidChangeVisibleTextEditors(Functions.debounce(this.onVisibleTextEditorsChanged, 50), this),
				workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this),
				Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
				Container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
			);
		}

		this._annotationProviders.set(provider.correlationKey, provider);
		if (await provider.provideAnnotation(shaOrLine)) {
			this._onDidToggleAnnotations.fire();
			return provider;
		}

		await this.clearCore(provider.correlationKey, AnnotationClearReason.Disposing);

		return undefined;
	}
}
