import type {
	ColorTheme,
	ConfigurationChangeEvent,
	Event,
	Progress,
	TextDocument,
	TextEditor,
	TextEditorDecorationType,
	TextEditorViewColumnChangeEvent,
} from 'vscode';
import {
	ColorThemeKind,
	DecorationRangeBehavior,
	Disposable,
	EventEmitter,
	OverviewRulerLane,
	ProgressLocation,
	ThemeColor,
	Uri,
	window,
	workspace,
} from 'vscode';
import type { AnnotationsToggleMode, FileAnnotationType } from '../config';
import type { Colors, CoreColors } from '../constants';
import type { Container } from '../container';
import { configuration } from '../system/configuration';
import { setContext } from '../system/context';
import { once } from '../system/event';
import { debounce } from '../system/function';
import { find } from '../system/iterable';
import type { KeyboardScope } from '../system/keyboard';
import { Logger } from '../system/logger';
import { basename } from '../system/path';
import { isTextEditor } from '../system/utils';
import type {
	DocumentBlameStateChangeEvent,
	DocumentDirtyStateChangeEvent,
	GitDocumentState,
} from '../trackers/gitDocumentTracker';
import type { AnnotationContext, AnnotationProviderBase, TextEditorCorrelationKey } from './annotationProvider';
import { getEditorCorrelationKey } from './annotationProvider';
import type { ChangesAnnotationContext } from './gutterChangesAnnotationProvider';

export type AnnotationClearReason =
	| 'User'
	| 'BlameabilityChanged'
	| 'ColumnChanged'
	| 'Disposing'
	| 'DocumentChanged'
	| 'DocumentClosed';

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
	private _windowAnnotationType?: FileAnnotationType | undefined = undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			window.onDidChangeActiveColorTheme(this.onThemeChanged, this),
		);

		this._toggleModes = new Map<FileAnnotationType, AnnotationsToggleMode>();
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

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		const initializing = e == null;

		if (configuration.changed(e, ['blame.highlight', 'changes.locations'])) {
			this.updateDecorations(false);
		}

		let toggleMode;
		if (configuration.changed(e, 'blame.toggleMode')) {
			toggleMode = configuration.get('blame.toggleMode');
			this._toggleModes.set('blame', toggleMode);
			if (!initializing && toggleMode === 'file') {
				void this.clearAll();
			}
		}

		if (configuration.changed(e, 'changes.toggleMode')) {
			toggleMode = configuration.get('changes.toggleMode');
			this._toggleModes.set('changes', toggleMode);
			if (!initializing && toggleMode === 'file') {
				void this.clearAll();
			}
		}

		if (configuration.changed(e, 'heatmap.toggleMode')) {
			toggleMode = configuration.get('heatmap.toggleMode');
			this._toggleModes.set('heatmap', toggleMode);
			if (!initializing && toggleMode === 'file') {
				void this.clearAll();
			}
		}

		if (initializing) return;

		if (
			configuration.changed(e, [
				'blame',
				'changes',
				'heatmap',
				'hovers',
				'defaultDateFormat',
				'defaultDateSource',
				'defaultDateStyle',
				'defaultGravatarsStyle',
			])
		) {
			// Since the configuration has changed -- reset any visible annotations
			for (const provider of this._annotationProviders.values()) {
				if (provider == null) continue;

				void this.show(provider.editor, provider.annotationType ?? 'blame');
			}
		}
	}

	private onThemeChanged(_e: ColorTheme) {
		this.updateDecorations(true);
	}

	private async onActiveTextEditorChanged(editor: TextEditor | undefined) {
		if (editor != null && !isTextEditor(editor)) return;

		this._editor = editor;
		// Logger.log('AnnotationController.onActiveTextEditorChanged', editor && editor.document.uri.fsPath);

		if (this.isInWindowToggle()) {
			await this.show(editor, this._windowAnnotationType!);

			return;
		}

		const provider = this.getProvider(editor);
		if (provider == null) {
			void setContext('gitlens:annotationStatus', undefined);
			void this.detachKeyboardHook();
		} else {
			void setContext('gitlens:annotationStatus', provider.status);
			void this.attachKeyboardHook();
		}
	}

	private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
		// Only care if we are becoming un-blameable
		if (e.blameable) return;

		const editor = window.activeTextEditor;
		if (editor == null) return;

		void this.clear(editor, 'BlameabilityChanged');
	}

	private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent<GitDocumentState>) {
		for (const [key, p] of this._annotationProviders) {
			if (!e.document.is(p.document)) continue;

			void this.clearCore(key, 'DocumentChanged');
		}
	}

	private onTextDocumentClosed(document: TextDocument) {
		if (!this.container.git.isTrackable(document.uri)) return;

		for (const [key, p] of this._annotationProviders) {
			if (p.document !== document) continue;

			void this.clearCore(key, 'DocumentClosed');
		}
	}

	private onTextEditorViewColumnChanged(e: TextEditorViewColumnChangeEvent) {
		// FYI https://github.com/Microsoft/vscode/issues/35602
		const provider = this.getProvider(e.textEditor);
		if (provider == null) {
			// If we don't find an exact match, do a fuzzy match (since we can't properly track editors)
			const fuzzyProvider = find(
				this._annotationProviders.values(),
				p => p.editor.document === e.textEditor.document,
			);
			if (fuzzyProvider == null) return;

			void this.clearCore(fuzzyProvider.correlationKey, 'ColumnChanged');

			return;
		}

		void provider.restore(e.textEditor);
	}

	private onVisibleTextEditorsChanged(editors: readonly TextEditor[]) {
		for (const e of editors) {
			void this.getProvider(e)?.restore(e);
		}
	}

	isInWindowToggle(): boolean {
		return this.getToggleMode(this._windowAnnotationType) === 'window';
	}

	private getToggleMode(annotationType: FileAnnotationType | undefined): AnnotationsToggleMode {
		if (annotationType == null) return 'file';

		return this._toggleModes.get(annotationType) ?? 'file';
	}

	clear(editor: TextEditor, reason: AnnotationClearReason = 'User') {
		if (this.isInWindowToggle()) {
			return this.clearAll();
		}

		return this.clearCore(getEditorCorrelationKey(editor), reason);
	}

	async clearAll() {
		this._windowAnnotationType = undefined;
		for (const [key] of this._annotationProviders) {
			await this.clearCore(key, 'Disposing');
		}
	}

	async getAnnotationType(editor: TextEditor | undefined): Promise<FileAnnotationType | undefined> {
		const provider = this.getProvider(editor);
		if (provider == null) return undefined;

		const trackedDocument = await this.container.tracker.get(editor!.document);
		if (trackedDocument == null || !trackedDocument.isBlameable) return undefined;

		return provider.annotationType;
	}

	getProvider(editor: TextEditor | undefined): AnnotationProviderBase | undefined {
		if (editor?.document == null) return undefined;
		return this._annotationProviders.get(getEditorCorrelationKey(editor));
	}

	async show(editor: TextEditor | undefined, type: FileAnnotationType, context?: AnnotationContext): Promise<boolean>;
	async show(editor: TextEditor | undefined, type: 'changes', context?: ChangesAnnotationContext): Promise<boolean>;
	async show(
		editor: TextEditor | undefined,
		type: FileAnnotationType,
		context?: AnnotationContext | ChangesAnnotationContext,
	): Promise<boolean> {
		if (this.getToggleMode(type) === 'window') {
			let first = this._windowAnnotationType == null;
			const reset = !first && this._windowAnnotationType !== type;

			this._windowAnnotationType = type;

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

		const trackedDocument = await this.container.tracker.getOrAdd(editor.document);
		if (!trackedDocument.isBlameable) return false;

		const currentProvider = this.getProvider(editor);
		if (currentProvider?.annotationType === type) {
			await currentProvider.provideAnnotation(context);
			await currentProvider.selection(context?.selection);
			return true;
		}

		const provider = await window.withProgress(
			{ location: ProgressLocation.Window },
			async (progress: Progress<{ message: string }>) => {
				await setContext('gitlens:annotationStatus', 'computing');

				const computingAnnotations = this.showAnnotationsCore(currentProvider, editor, type, context, progress);
				const provider = await computingAnnotations;

				if (editor === this._editor) {
					await setContext('gitlens:annotationStatus', provider?.status);
				}

				return computingAnnotations;
			},
		);

		return provider != null;
	}

	async toggle(
		editor: TextEditor | undefined,
		type: FileAnnotationType,
		context?: AnnotationContext,
		on?: boolean,
	): Promise<boolean>;
	async toggle(
		editor: TextEditor | undefined,
		type: 'changes',
		context?: ChangesAnnotationContext,
		on?: boolean,
	): Promise<boolean>;
	async toggle(
		editor: TextEditor | undefined,
		type: FileAnnotationType,
		context?: AnnotationContext | ChangesAnnotationContext,
		on?: boolean,
	): Promise<boolean> {
		if (editor != null && this._toggleModes.get(type) === 'file') {
			const trackedDocument = await this.container.tracker.getOrAdd(editor.document);
			if ((type === 'changes' && !trackedDocument.isTracked) || !trackedDocument.isBlameable) {
				return false;
			}
		}

		const provider = this.getProvider(editor);
		if (provider == null) return this.show(editor, type, context);

		const reopen = provider.annotationType !== type || provider.mustReopen(context);
		if (on === true && !reopen) return true;

		if (this.isInWindowToggle()) {
			await this.clearAll();
		} else {
			await this.clearCore(provider.correlationKey, 'User');
		}

		if (!reopen) return false;

		return this.show(editor, type, context);
	}

	private async attachKeyboardHook() {
		// Allows pressing escape to exit the annotations
		if (this._keyboardScope == null) {
			this._keyboardScope = await this.container.keyboard.beginScope({
				escape: {
					onDidPressKey: async () => {
						const e = this._editor;
						if (e == null) return undefined;

						await this.clear(e, 'User');
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

		if (this._annotationProviders.size === 0 || key === getEditorCorrelationKey(this._editor)) {
			await setContext('gitlens:annotationStatus', undefined);
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
		context?: AnnotationContext | ChangesAnnotationContext,
		progress?: Progress<{ message: string }>,
	): Promise<AnnotationProviderBase | undefined> {
		if (progress != null) {
			let annotationsLabel = 'annotations';
			switch (type) {
				case 'blame':
					annotationsLabel = 'blame annotations';
					break;

				case 'changes':
					annotationsLabel = 'changes annotations';
					break;

				case 'heatmap':
					annotationsLabel = 'heatmap annotations';
					break;
			}

			progress.report({
				message: `Computing ${annotationsLabel} for ${basename(editor.document.fileName)}`,
			});
		}

		// Allows pressing escape to exit the annotations
		await this.attachKeyboardHook();

		const trackedDocument = await this.container.tracker.getOrAdd(editor.document);

		let provider: AnnotationProviderBase | undefined = undefined;
		switch (type) {
			case 'blame': {
				const { GutterBlameAnnotationProvider } = await import(
					/* webpackChunkName: "annotations-blame" */ './gutterBlameAnnotationProvider'
				);
				provider = new GutterBlameAnnotationProvider(editor, trackedDocument, this.container);
				break;
			}
			case 'changes': {
				const { GutterChangesAnnotationProvider } = await import(
					/* webpackChunkName: "annotations-changes" */ './gutterChangesAnnotationProvider'
				);
				provider = new GutterChangesAnnotationProvider(editor, trackedDocument, this.container);
				break;
			}
			case 'heatmap': {
				const { GutterHeatmapBlameAnnotationProvider } = await import(
					/* webpackChunkName: "annotations-heatmap" */ './gutterHeatmapBlameAnnotationProvider'
				);
				provider = new GutterHeatmapBlameAnnotationProvider(editor, trackedDocument, this.container);
				break;
			}
		}
		if (provider == null || !(await provider.validate())) return undefined;

		if (currentProvider != null) {
			await this.clearCore(currentProvider.correlationKey, 'User');
		}

		if (this._annotationsDisposable == null && this._annotationProviders.size === 0) {
			Logger.log('Add listener registrations for annotations');

			this._annotationsDisposable = Disposable.from(
				window.onDidChangeActiveTextEditor(debounce(this.onActiveTextEditorChanged, 50), this),
				window.onDidChangeTextEditorViewColumn(this.onTextEditorViewColumnChanged, this),
				window.onDidChangeVisibleTextEditors(debounce(this.onVisibleTextEditorsChanged, 50), this),
				workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this),
				this.container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
				this.container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
			);
		}

		this._annotationProviders.set(provider.correlationKey, provider);
		if (await provider.provideAnnotation(context)) {
			this._onDidToggleAnnotations.fire();
			return provider;
		}

		await this.clearCore(provider.correlationKey, 'Disposing');

		return undefined;
	}

	private updateDecorations(refresh: boolean) {
		const previous = refresh ? Object.entries(Decorations) : (undefined! as []);

		this.updateHighlightDecoration();
		this.updateChangedDecorations();

		if (!refresh) return;

		const replaceDecorationTypes = new Map<TextEditorDecorationType, TextEditorDecorationType | null>();
		for (const [key, value] of previous) {
			if (value == null) continue;

			const newValue = (Decorations as Record<string, TextEditorDecorationType | undefined>)[key] ?? null;
			if (value === newValue) continue;

			replaceDecorationTypes.set(
				value,
				(Decorations as Record<string, TextEditorDecorationType | undefined>)[key] ?? null,
			);
		}

		if (replaceDecorationTypes.size === 0) return;

		for (const e of window.visibleTextEditors) {
			this.getProvider(e)?.refresh(replaceDecorationTypes);
		}
	}

	private updateChangedDecorations() {
		Decorations.changesLineAddedAnnotation?.dispose();
		Decorations.changesLineChangedAnnotation?.dispose();
		Decorations.changesLineDeletedAnnotation?.dispose();

		const locations = configuration.get('changes.locations');

		type RGB = [number, number, number];
		let addedColor: RGB;
		let changedColor: RGB;
		let deletedColor: RGB;

		switch (window.activeColorTheme.kind) {
			case ColorThemeKind.Light:
				addedColor = /* #48985D */ [72, 152, 93];
				changedColor = /* #2090D3 */ [32, 144, 211];
				deletedColor = /* #E51400 */ [229, 20, 0];
				break;
			case ColorThemeKind.HighContrast:
				addedColor = /* #487E02 */ [72, 126, 2];
				changedColor = /* #1B81A8 */ [27, 129, 168];
				deletedColor = /* #F14C4C */ [241, 76, 76];
				break;
			default:
				addedColor = /* #487E02 */ [72, 126, 2];
				changedColor = /* #1B81A8 */ [27, 129, 168];
				deletedColor = /* #F14C4C */ [241, 76, 76];
				break;
		}

		Decorations.changesLineAddedAnnotation = window.createTextEditorDecorationType({
			backgroundColor: locations.includes('line') ? `rgba(${addedColor.join(',')},0.4)` : undefined,
			isWholeLine: locations.includes('line') ? true : undefined,
			gutterIconPath: locations.includes('gutter')
				? Uri.parse(
						`data:image/svg+xml,${encodeURIComponent(
							`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='rgb(${addedColor.join(
								',',
							)})' x='15' y='0' width='3' height='18'/></svg>`,
						)}`,
				  )
				: undefined,
			gutterIconSize: 'contain',
			overviewRulerLane: OverviewRulerLane.Left,
			overviewRulerColor: locations.includes('overview')
				? new ThemeColor('editorOverviewRuler.addedForeground' satisfies CoreColors)
				: undefined,
		});

		Decorations.changesLineChangedAnnotation = window.createTextEditorDecorationType({
			backgroundColor: locations.includes('line') ? `rgba(${changedColor.join(',')},0.4)` : undefined,
			isWholeLine: locations.includes('line') ? true : undefined,
			gutterIconPath: locations.includes('gutter')
				? Uri.parse(
						`data:image/svg+xml,${encodeURIComponent(
							`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='rgb(${changedColor.join(
								',',
							)})' x='15' y='0' width='3' height='18'/></svg>`,
						)}`,
				  )
				: undefined,
			gutterIconSize: 'contain',
			overviewRulerLane: OverviewRulerLane.Left,
			overviewRulerColor: locations.includes('overview')
				? new ThemeColor('editorOverviewRuler.modifiedForeground' satisfies CoreColors)
				: undefined,
		});

		Decorations.changesLineDeletedAnnotation = window.createTextEditorDecorationType({
			gutterIconPath: locations.includes('gutter')
				? Uri.parse(
						`data:image/svg+xml,${encodeURIComponent(
							`<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><polygon fill='rgb(${deletedColor.join(
								',',
							)})' points='13,10 13,18 17,14'/></svg>`,
						)}`,
				  )
				: undefined,
			gutterIconSize: 'contain',
			overviewRulerLane: OverviewRulerLane.Left,
			overviewRulerColor: locations.includes('overview')
				? new ThemeColor('editorOverviewRuler.deletedForeground' satisfies CoreColors)
				: undefined,
		});
	}

	private updateHighlightDecoration() {
		Decorations.gutterBlameHighlight?.dispose();
		Decorations.gutterBlameHighlight = undefined;

		const highlight = configuration.get('blame.highlight');
		if (highlight.enabled) {
			const { locations } = highlight;

			// TODO@eamodio: Read from the theme color when the API exists
			const gutterHighlightColor = '#00bcf2'; // new ThemeColor('gitlens.lineHighlightOverviewRulerColor' satisfies Colors)
			const gutterHighlightUri = locations.includes('gutter')
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
				backgroundColor: locations.includes('line')
					? new ThemeColor('gitlens.lineHighlightBackgroundColor' satisfies Colors)
					: undefined,
				overviewRulerColor: locations.includes('overview')
					? new ThemeColor('gitlens.lineHighlightOverviewRulerColor' satisfies Colors)
					: undefined,
			});
		}
	}
}
