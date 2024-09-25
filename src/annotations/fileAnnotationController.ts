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
import type { AnnotationStatus } from '../constants';
import type { Colors, CoreColors } from '../constants.colors';
import type { Container } from '../container';
import { debug, log } from '../system/decorators/log';
import { once } from '../system/event';
import type { Deferrable } from '../system/function';
import { debounce } from '../system/function';
import { find } from '../system/iterable';
import { basename } from '../system/path';
import { registerCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import type { KeyboardScope } from '../system/vscode/keyboard';
import { UriSet } from '../system/vscode/uriMap';
import { isTrackableTextEditor } from '../system/vscode/utils';
import type {
	DocumentBlameStateChangeEvent,
	DocumentDirtyIdleTriggerEvent,
	DocumentDirtyStateChangeEvent,
} from '../trackers/documentTracker';
import type { AnnotationContext, AnnotationProviderBase, TextEditorCorrelationKey } from './annotationProvider';
import { getEditorCorrelationKey } from './annotationProvider';
import type { ChangesAnnotationContext } from './gutterChangesAnnotationProvider';

export const Decorations = {
	gutterBlameAnnotation: window.createTextEditorDecorationType({
		rangeBehavior: DecorationRangeBehavior.OpenOpen,
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

		if (configuration.changed(e, 'fileAnnotations.dismissOnEscape')) {
			if (configuration.get('fileAnnotations.dismissOnEscape')) {
				if (window.visibleTextEditors.some(e => this.getProvider(e))) {
					void this.attachKeyboardHook();
				}
			} else {
				void this.detachKeyboardHook();
			}
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
		if (editor != null && !isTrackableTextEditor(editor)) return;

		this._editor = editor;
		// Logger.log('AnnotationController.onActiveTextEditorChanged', editor && editor.document.uri.fsPath);

		if (this.isInWindowToggle()) {
			await this.show(editor, this._windowAnnotationType!);

			return;
		}

		const provider = this.getProvider(editor);
		if (provider == null) {
			void this.detachKeyboardHook();
		} else {
			void this.attachKeyboardHook();
		}
	}

	private onBlameStateChanged(e: DocumentBlameStateChangeEvent) {
		const editor = window.activeTextEditor;
		if (editor == null) return;

		// Only care if we are becoming un-blameable
		if (e.blameable) {
			if (configuration.get('fileAnnotations.preserveWhileEditing')) {
				this.restore(editor);
			}

			return;
		}

		void this.clearCore(getEditorCorrelationKey(editor));
	}

	private async onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent) {
		if (!configuration.get('fileAnnotations.preserveWhileEditing')) return;

		const status = await e.document.getStatus();
		if (!status.blameable) return;

		const editor = window.activeTextEditor;
		if (editor == null) return;

		this.restore(editor);
	}

	private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent) {
		for (const [key, p] of this._annotationProviders) {
			if (!e.document.is(p.editor.document)) continue;

			if (configuration.get('fileAnnotations.preserveWhileEditing')) {
				if (!e.dirty) {
					this.restore(e.editor);
				}
			} else if (e.dirty) {
				void this.clearCore(key);
			}
		}
	}

	private onTextDocumentClosed(document: TextDocument) {
		if (!this.container.git.isTrackable(document.uri)) return;

		for (const [key, p] of this._annotationProviders) {
			if (p.editor.document !== document) continue;

			void this.clearCore(key);
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

			void this.clearCore(fuzzyProvider.correlationKey);

			return;
		}

		provider.restore(e.textEditor);
	}

	private onVisibleTextEditorsChanged(editors: readonly TextEditor[]) {
		for (const e of editors) {
			this.getProvider(e)?.restore(e, false);
		}
	}

	isInWindowToggle(): boolean {
		return this.getToggleMode(this._windowAnnotationType) === 'window';
	}

	private getToggleMode(annotationType: FileAnnotationType | undefined): AnnotationsToggleMode {
		if (annotationType == null) return 'file';

		return this._toggleModes.get(annotationType) ?? 'file';
	}

	@log<FileAnnotationController['clear']>({ args: { 0: e => e?.document.uri.toString(true) } })
	clear(editor: TextEditor) {
		if (this.isInWindowToggle()) return this.clearAll();

		return this.clearCore(getEditorCorrelationKey(editor), true);
	}

	@log()
	async clearAll() {
		this._windowAnnotationType = undefined;

		for (const [key] of this._annotationProviders) {
			await this.clearCore(key, true);
		}

		this.unsubscribe();
	}

	async getAnnotationType(editor: TextEditor | undefined): Promise<FileAnnotationType | undefined> {
		const provider = this.getProvider(editor);
		if (provider == null) return undefined;

		const trackedDocument = await this.container.documentTracker.get(editor!.document);
		const status = await trackedDocument?.getStatus();
		if (!status?.blameable) return undefined;

		return provider.annotationType;
	}

	getProvider(editor: TextEditor | undefined): AnnotationProviderBase | undefined {
		if (editor?.document == null) return undefined;
		return this._annotationProviders.get(getEditorCorrelationKey(editor));
	}

	private debouncedRestores = new WeakMap<TextEditor, Deferrable<AnnotationProviderBase['restore']>>();

	private restore(editor: TextEditor, recompute?: boolean) {
		const provider = this.getProvider(editor);
		if (provider == null) return;

		let debouncedRestore = this.debouncedRestores.get(editor);
		if (debouncedRestore == null) {
			debouncedRestore = debounce((editor: TextEditor) => {
				this.debouncedRestores.delete(editor);
				provider.restore(editor, recompute ?? true);
			}, 500);
			this.debouncedRestores.set(editor, debouncedRestore);
		}

		debouncedRestore(editor);
	}

	private readonly _annotatedUris = new UriSet();
	private readonly _computingUris = new UriSet();

	async onProviderEditorStatusChanged(editor: TextEditor | undefined, status: AnnotationStatus | undefined) {
		if (editor == null) return;

		let changed = false;
		let windowStatus;

		if (this.isInWindowToggle()) {
			windowStatus = status;

			changed = Boolean(this._annotatedUris.size || this._computingUris.size);
			this._annotatedUris.clear();
			this._computingUris.clear();
		} else {
			windowStatus = undefined;

			const uri = editor.document.uri;
			switch (status) {
				case 'computing':
					if (!this._annotatedUris.has(uri)) {
						this._annotatedUris.add(uri);
						changed = true;
					}

					if (!this._computingUris.has(uri)) {
						this._computingUris.add(uri);
						changed = true;
					}

					break;
				case 'computed': {
					const provider = this.getProvider(editor);
					if (provider == null) {
						if (this._annotatedUris.has(uri)) {
							this._annotatedUris.delete(uri);
							changed = true;
						}
					} else if (!this._annotatedUris.has(uri)) {
						this._annotatedUris.add(uri);
						changed = true;
					}

					if (this._computingUris.has(uri)) {
						this._computingUris.delete(uri);
						changed = true;
					}
					break;
				}
				default:
					if (this._annotatedUris.has(uri)) {
						this._annotatedUris.delete(uri);
						changed = true;
					}

					if (this._computingUris.has(uri)) {
						this._computingUris.delete(uri);
						changed = true;
					}
					break;
			}
		}

		if (!changed) return;

		await Promise.allSettled([
			setContext('gitlens:window:annotated', windowStatus),
			setContext('gitlens:tabs:annotated:computing', [...this._computingUris]),
			setContext('gitlens:tabs:annotated', [...this._annotatedUris]),
		]);
	}

	async show(editor: TextEditor | undefined, type: FileAnnotationType, context?: AnnotationContext): Promise<boolean>;
	async show(editor: TextEditor | undefined, type: 'changes', context?: ChangesAnnotationContext): Promise<boolean>;
	@log<FileAnnotationController['show']>({
		args: {
			0: e => e?.document.uri.toString(true),
			2: false,
		},
	})
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

			if (editor == null) {
				this.subscribe();
				return false;
			}
		}

		if (editor == null) return false; // || editor.viewColumn == null) return false;
		this._editor = editor;

		const trackedDocument = await this.container.documentTracker.getOrAdd(editor.document);
		const status = await trackedDocument?.getStatus();
		if (!status?.blameable) return false;

		const currentProvider = this.getProvider(editor);
		if (currentProvider?.annotationType === type) {
			await currentProvider.provideAnnotation(context);
			return true;
		}

		const provider = await window.withProgress(
			{ location: ProgressLocation.Window },
			async (progress: Progress<{ message: string }>) => {
				void this.onProviderEditorStatusChanged(editor, 'computing');

				const computingAnnotations = this.showAnnotationsCore(currentProvider, editor, type, context, progress);
				void (await computingAnnotations);

				void this.onProviderEditorStatusChanged(editor, 'computed');

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
	@log<FileAnnotationController['toggle']>({
		args: {
			0: e => e?.document.uri.toString(true),
			2: false,
		},
	})
	async toggle(
		editor: TextEditor | undefined,
		type: FileAnnotationType,
		context?: AnnotationContext | ChangesAnnotationContext,
		on?: boolean,
	): Promise<boolean> {
		if (editor != null && this._toggleModes.get(type) === 'file') {
			const trackedDocument = await this.container.documentTracker.getOrAdd(editor.document);
			const status = await trackedDocument?.getStatus();
			if ((type === 'changes' && !status?.tracked) || !status?.blameable) {
				return false;
			}
		}

		const provider = this.getProvider(editor);
		if (provider == null) {
			if (editor == null && this.isInWindowToggle()) {
				await this.clearAll();
				return false;
			}

			return this.show(editor, type, context);
		}

		const reopen = provider.annotationType !== type || !provider.canReuse(context);
		if (on === true && !reopen) return true;

		if (this.isInWindowToggle()) {
			await this.clearAll();
		} else {
			await this.clearCore(provider.correlationKey, true);
		}

		if (!reopen) return false;

		return this.show(editor, type, context);
	}

	@log()
	nextChange() {
		const provider = this.getProvider(window.activeTextEditor);
		provider?.nextChange?.();
	}

	@log()
	previousChange() {
		const provider = this.getProvider(window.activeTextEditor);
		provider?.previousChange?.();
	}

	private async attachKeyboardHook() {
		if (!configuration.get('fileAnnotations.dismissOnEscape')) return;

		// Allows pressing escape to exit the annotations
		if (this._keyboardScope == null) {
			this._keyboardScope = await this.container.keyboard.beginScope({
				escape: {
					onDidPressKey: async () => {
						const e = this._editor;
						if (e == null) return undefined;

						await this.clear(e);
						return undefined;
					},
				},
			});
		}
	}

	@log()
	private async clearCore(key: TextEditorCorrelationKey, force?: boolean) {
		const provider = this._annotationProviders.get(key);
		if (provider == null) return;

		this._annotationProviders.delete(key);
		provider.dispose();

		if (!this._annotationProviders.size || key === getEditorCorrelationKey(this._editor)) {
			if (this._editor != null) {
				void this.onProviderEditorStatusChanged(this._editor, undefined);
			}

			await this.detachKeyboardHook();
		}

		if (!this._annotationProviders.size && (force || !this.isInWindowToggle())) {
			this._windowAnnotationType = undefined;
			this.unsubscribe();
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

		const trackedDocument = await this.container.documentTracker.getOrAdd(editor.document);

		let provider: AnnotationProviderBase | undefined = undefined;
		switch (type) {
			case 'blame': {
				const { GutterBlameAnnotationProvider } = await import(
					/* webpackChunkName: "annotations" */ './gutterBlameAnnotationProvider'
				);
				provider = new GutterBlameAnnotationProvider(
					this.container,
					e => this.onProviderEditorStatusChanged(e.editor, e.status),
					editor,
					trackedDocument,
				);
				break;
			}
			case 'changes': {
				const { GutterChangesAnnotationProvider } = await import(
					/* webpackChunkName: "annotations" */ './gutterChangesAnnotationProvider'
				);
				provider = new GutterChangesAnnotationProvider(
					this.container,
					e => this.onProviderEditorStatusChanged(e.editor, e.status),
					editor,
					trackedDocument,
				);
				break;
			}
			case 'heatmap': {
				const { GutterHeatmapBlameAnnotationProvider } = await import(
					/* webpackChunkName: "annotations" */ './gutterHeatmapBlameAnnotationProvider'
				);
				provider = new GutterHeatmapBlameAnnotationProvider(
					this.container,
					e => this.onProviderEditorStatusChanged(e.editor, e.status),
					editor,
					trackedDocument,
				);
				break;
			}
		}
		if (provider == null || (await provider.validate?.()) === false) return undefined;

		if (currentProvider != null) {
			await this.clearCore(currentProvider.correlationKey, true);
		}

		if (this._annotationProviders.size === 0) {
			this.subscribe();
		}

		this._annotationProviders.set(provider.correlationKey, provider);
		if (await provider.provideAnnotation(context)) {
			this._onDidToggleAnnotations.fire();
			return provider;
		}

		await this.clearCore(provider.correlationKey, true);

		return undefined;
	}

	@debug({
		singleLine: true,
		if: function () {
			return this._annotationsDisposable == null;
		},
	})
	private subscribe() {
		this._annotationsDisposable ??= Disposable.from(
			window.onDidChangeActiveTextEditor(debounce(this.onActiveTextEditorChanged, 50), this),
			window.onDidChangeTextEditorViewColumn(this.onTextEditorViewColumnChanged, this),
			window.onDidChangeVisibleTextEditors(debounce(this.onVisibleTextEditorsChanged, 50), this),
			workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this),
			this.container.documentTracker.onDidChangeBlameState(this.onBlameStateChanged, this),
			this.container.documentTracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
			this.container.documentTracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
			registerCommand('gitlens.annotations.nextChange', () => this.nextChange()),
			registerCommand('gitlens.annotations.previousChange', () => this.previousChange()),
		);
	}

	@debug({
		singleLine: true,
		if: function () {
			return this._annotationsDisposable != null;
		},
	})
	private unsubscribe() {
		this._annotationsDisposable?.dispose();
		this._annotationsDisposable = undefined;
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
							)})' x='13' y='0' width='3' height='18'/></svg>`,
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
							)})' x='13' y='0' width='3' height='18'/></svg>`,
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
