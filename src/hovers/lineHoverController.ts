'use strict';
import {
	CancellationToken,
	ConfigurationChangeEvent,
	Disposable,
	Hover,
	languages,
	Position,
	Range,
	TextDocument,
	TextEditor,
	Uri,
	window,
} from 'vscode';
import { configuration, FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { Hovers } from './hovers';
import { LinesChangeEvent } from '../trackers/gitLineTracker';
import { debug } from '../system';
import { UriComparer } from '../comparers';

export class LineHoverController implements Disposable {
	private readonly _disposable: Disposable;
	private _hoverProviderDisposable: Disposable | undefined;
	private _uri: Uri | undefined;

	constructor() {
		this._disposable = Disposable.from(configuration.onDidChange(this.onConfigurationChanged, this));
		this.onConfigurationChanged(configuration.initializingChangeEvent);
	}

	dispose() {
		this.unregister();

		Container.lineTracker.stop(this);
		this._disposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			!configuration.changed(e, 'hovers', 'enabled') &&
			!configuration.changed(e, 'hovers', 'currentLine', 'enabled')
		) {
			return;
		}

		if (Container.config.hovers.enabled && Container.config.hovers.currentLine.enabled) {
			Container.lineTracker.start(
				this,
				Container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this),
			);

			this.register(window.activeTextEditor);
		} else {
			Container.lineTracker.stop(this);
			this.unregister();
		}
	}

	@debug({
		args: {
			0: (e: LinesChangeEvent) =>
				`editor=${e.editor?.document.uri.toString(true)}, lines=${e.lines?.join(',')}, pending=${Boolean(
					e.pending,
				)}, reason=${e.reason}`,
		},
	})
	private onActiveLinesChanged(e: LinesChangeEvent) {
		if (e.pending) return;

		if (e.editor == null || e.lines == null) {
			this.unregister();

			return;
		}

		if (this.isRegistered(e.editor?.document.uri)) return;

		this.register(e.editor);
	}

	@debug({
		args: {
			0: document => document.uri.toString(true),
			1: (position: Position) => `${position.line}:${position.character}`,
			2: () => false,
		},
	})
	async provideDetailsHover(
		document: TextDocument,
		position: Position,
		_token: CancellationToken,
	): Promise<Hover | undefined> {
		if (!Container.lineTracker.includes(position.line)) return undefined;

		const lineState = Container.lineTracker.getState(position.line);
		const commit = lineState?.commit;
		if (commit == null) return undefined;

		// Avoid double annotations if we are showing the whole-file hover blame annotations
		if (Container.config.hovers.annotations.details) {
			const fileAnnotations = await Container.fileAnnotations.getAnnotationType(window.activeTextEditor);
			if (fileAnnotations === FileAnnotationType.Blame) return undefined;
		}

		const wholeLine = Container.config.hovers.currentLine.over === 'line';
		// If we aren't showing the hover over the whole line, make sure the annotation is on
		if (!wholeLine && Container.lineAnnotations.suspended) return undefined;

		const range = document.validateRange(
			new Range(position.line, wholeLine ? 0 : Number.MAX_SAFE_INTEGER, position.line, Number.MAX_SAFE_INTEGER),
		);
		if (!wholeLine && range.start.character !== position.character) return undefined;

		// Get the full commit message -- since blame only returns the summary
		let logCommit = lineState?.logCommit;
		if (logCommit == null && !commit.isUncommitted) {
			logCommit = await Container.git.getCommitForFile(commit.repoPath, commit.uri.fsPath, {
				ref: commit.sha,
			});
			if (logCommit != null) {
				// Preserve the previous commit from the blame commit
				logCommit.previousSha = commit.previousSha;
				logCommit.previousFileName = commit.previousFileName;

				if (lineState != null) {
					lineState.logCommit = logCommit;
				}
			}
		}

		let editorLine = position.line;
		const line = editorLine + 1;
		const commitLine = commit.lines.find(l => l.line === line) ?? commit.lines[0];
		editorLine = commitLine.originalLine - 1;

		const trackedDocument = await Container.tracker.get(document);
		if (trackedDocument == null) return undefined;

		const message = await Hovers.detailsMessage(
			logCommit ?? commit,
			trackedDocument.uri,
			editorLine,
			Container.config.defaultDateFormat,
		);
		return new Hover(message, range);
	}

	@debug({
		args: {
			0: document => document.uri.toString(true),
			1: (position: Position) => `${position.line}:${position.character}`,
			2: () => false,
		},
	})
	async provideChangesHover(
		document: TextDocument,
		position: Position,
		_token: CancellationToken,
	): Promise<Hover | undefined> {
		if (!Container.lineTracker.includes(position.line)) return undefined;

		const lineState = Container.lineTracker.getState(position.line);
		const commit = lineState?.commit;
		if (commit == null) return undefined;

		// Avoid double annotations if we are showing the whole-file hover blame annotations
		if (Container.config.hovers.annotations.changes) {
			const fileAnnotations = await Container.fileAnnotations.getAnnotationType(window.activeTextEditor);
			if (fileAnnotations === FileAnnotationType.Blame) return undefined;
		}

		const wholeLine = Container.config.hovers.currentLine.over === 'line';
		// If we aren't showing the hover over the whole line, make sure the annotation is on
		if (!wholeLine && Container.lineAnnotations.suspended) return undefined;

		const range = document.validateRange(
			new Range(position.line, wholeLine ? 0 : Number.MAX_SAFE_INTEGER, position.line, Number.MAX_SAFE_INTEGER),
		);
		if (!wholeLine && range.start.character !== position.character) return undefined;

		const trackedDocument = await Container.tracker.get(document);
		if (trackedDocument == null) return undefined;

		const message = await Hovers.changesMessage(commit, trackedDocument.uri, position.line);
		if (message == null) return undefined;

		return new Hover(message, range);
	}

	private isRegistered(uri: Uri | undefined) {
		return this._hoverProviderDisposable != null && UriComparer.equals(this._uri, uri);
	}

	private register(editor: TextEditor | undefined) {
		this.unregister();

		if (editor == null) return;

		const cfg = Container.config.hovers;
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
