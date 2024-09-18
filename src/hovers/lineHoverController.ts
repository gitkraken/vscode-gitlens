import type { CancellationToken, ConfigurationChangeEvent, Position, TextDocument, TextEditor, Uri } from 'vscode';
import { Disposable, Hover, languages, Range, window } from 'vscode';
import type { Container } from '../container';
import { UriComparer } from '../system/comparers';
import { debug } from '../system/decorators/log';
import { once } from '../system/event';
import { Logger } from '../system/logger';
import { configuration } from '../system/vscode/configuration';
import type { LinesChangeEvent } from '../trackers/lineTracker';
import { changesMessage, detailsMessage } from './hovers';

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

export class LineHoverController implements Disposable {
	private readonly _disposable: Disposable;
	private _hoverProviderDisposable: Disposable | undefined;
	private _uri: Uri | undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
	}

	dispose() {
		this.unregister();

		this.container.lineTracker.unsubscribe(this);
		this._disposable.dispose();
	}

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'hovers.enabled') && !configuration.changed(e, 'hovers.currentLine.enabled')) {
			return;
		}

		const cfg = configuration.get('hovers');
		if (cfg.enabled && cfg.currentLine.enabled) {
			this.container.lineTracker.subscribe(
				this,
				this.container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this),
			);

			this.register(window.activeTextEditor);
		} else {
			this.container.lineTracker.unsubscribe(this);
			this.unregister();
		}
	}

	@debug<LineHoverController['onActiveLinesChanged']>({
		args: {
			0: e =>
				`editor=${e.editor?.document.uri.toString(true)}, selections=${e.selections
					?.map(s => `[${s.anchor}-${s.active}]`)
					.join(',')}, pending=${Boolean(e.pending)}, reason=${e.reason}`,
		},
	})
	private onActiveLinesChanged(e: LinesChangeEvent) {
		if (e.pending) return;

		if (e.editor == null || e.selections == null) {
			this.unregister();

			return;
		}

		if (this.isRegistered(e.editor?.document.uri)) return;

		this.register(e.editor);
	}

	@debug<LineHoverController['provideDetailsHover']>({
		args: {
			0: document => Logger.toLoggable(document.uri),
			1: position => `${position.line}:${position.character}`,
			2: false,
		},
	})
	async provideDetailsHover(
		document: TextDocument,
		position: Position,
		token: CancellationToken,
	): Promise<Hover | undefined> {
		if (!this.container.lineTracker.includes(position.line)) return undefined;

		const lineState = this.container.lineTracker.getState(position.line);
		const commit = lineState?.commit;
		if (commit == null) return undefined;

		const cfg = configuration.get('hovers');

		// Avoid double annotations if we are showing the whole-file hover blame annotations
		if (cfg.annotations.details) {
			const fileAnnotations = await this.container.fileAnnotations.getAnnotationType(window.activeTextEditor);
			if (fileAnnotations === 'blame') return undefined;
		}

		const wholeLine = cfg.currentLine.over === 'line';
		// If we aren't showing the hover over the whole line, make sure the annotation is on
		if (!wholeLine && this.container.lineAnnotations.suspended) return undefined;

		const range = document.validateRange(
			new Range(
				position.line,
				wholeLine ? position.character : maxSmallIntegerV8,
				position.line,
				maxSmallIntegerV8,
			),
		);
		if (!wholeLine && range.start.character !== position.character) return undefined;

		let editorLine = position.line;
		const line = editorLine + 1;
		const commitLine = commit.lines.find(l => l.line === line) ?? commit.lines[0];
		editorLine = commitLine.originalLine - 1;

		const trackedDocument = await this.container.documentTracker.get(document);
		if (trackedDocument == null || token.isCancellationRequested) return undefined;

		const message =
			(await detailsMessage(this.container, commit, trackedDocument.uri, editorLine, {
				autolinks: cfg.autolinks.enabled,
				cancellation: token,
				dateFormat: configuration.get('defaultDateFormat'),
				format: cfg.detailsMarkdownFormat,
				pullRequests: cfg.pullRequests.enabled,
				timeout: 250,
			})) ?? 'Cancelled';
		return new Hover(message, range);
	}

	@debug<LineHoverController['provideChangesHover']>({
		args: {
			0: document => Logger.toLoggable(document.uri),
			1: position => `${position.line}:${position.character}`,
			2: false,
		},
	})
	async provideChangesHover(
		document: TextDocument,
		position: Position,
		_token: CancellationToken,
	): Promise<Hover | undefined> {
		if (!this.container.lineTracker.includes(position.line)) return undefined;

		const lineState = this.container.lineTracker.getState(position.line);
		const commit = lineState?.commit;
		if (commit == null) return undefined;

		const cfg = configuration.get('hovers');

		// Avoid double annotations if we are showing the whole-file hover blame annotations
		if (cfg.annotations.changes) {
			const fileAnnotations = await this.container.fileAnnotations.getAnnotationType(window.activeTextEditor);
			if (fileAnnotations === 'blame') return undefined;
		}

		const wholeLine = cfg.currentLine.over === 'line';
		// If we aren't showing the hover over the whole line, make sure the annotation is on
		if (!wholeLine && this.container.lineAnnotations.suspended) return undefined;

		const range = document.validateRange(
			new Range(
				position.line,
				wholeLine ? position.character : maxSmallIntegerV8,
				position.line,
				maxSmallIntegerV8,
			),
		);
		if (!wholeLine && range.start.character !== position.character) return undefined;

		const trackedDocument = await this.container.documentTracker.get(document);
		if (trackedDocument == null) return undefined;

		const message = await changesMessage(
			this.container,
			commit,
			trackedDocument.uri,
			position.line,
			trackedDocument.document,
		);
		if (message == null) return undefined;

		return new Hover(message, range);
	}

	private isRegistered(uri: Uri | undefined) {
		return this._hoverProviderDisposable != null && UriComparer.equals(this._uri, uri);
	}

	private register(editor: TextEditor | undefined) {
		this.unregister();

		if (editor == null) return;

		const cfg = configuration.get('hovers');
		if (!cfg.enabled || !cfg.currentLine.enabled || (!cfg.currentLine.details && !cfg.currentLine.changes)) return;

		this._uri = editor.document.uri;

		const subscriptions = [];
		if (cfg.currentLine.changes) {
			subscriptions.push(
				languages.registerHoverProvider(
					{ pattern: this._uri.fsPath },
					{
						provideHover: this.provideChangesHover.bind(this),
					},
				),
			);
		}
		if (cfg.currentLine.details) {
			subscriptions.push(
				languages.registerHoverProvider(
					{ pattern: this._uri.fsPath },
					{
						provideHover: this.provideDetailsHover.bind(this),
					},
				),
			);
		}

		this._hoverProviderDisposable = Disposable.from(...subscriptions);
	}

	private unregister() {
		this._uri = undefined;
		if (this._hoverProviderDisposable != null) {
			this._hoverProviderDisposable.dispose();
			this._hoverProviderDisposable = undefined;
		}
	}
}
