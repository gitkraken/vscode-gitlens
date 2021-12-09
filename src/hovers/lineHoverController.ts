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
import { UriComparer } from '../comparers';
import { configuration, FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';
import { debug } from '../system';
import { LinesChangeEvent } from '../trackers/gitLineTracker';
import { Hovers } from './hovers';

export class LineHoverController implements Disposable {
	private readonly _disposable: Disposable;
	private _hoverProviderDisposable: Disposable | undefined;
	private _uri: Uri | undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			container.onReady(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
	}

	dispose() {
		this.unregister();

		this.container.lineTracker.stop(this);
		this._disposable.dispose();
	}

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'hovers.enabled') && !configuration.changed(e, 'hovers.currentLine.enabled')) {
			return;
		}

		if (this.container.config.hovers.enabled && this.container.config.hovers.currentLine.enabled) {
			this.container.lineTracker.start(
				this,
				this.container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this),
			);

			this.register(window.activeTextEditor);
		} else {
			this.container.lineTracker.stop(this);
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
		_token: CancellationToken,
	): Promise<Hover | undefined> {
		if (!this.container.lineTracker.includes(position.line)) return undefined;

		const lineState = this.container.lineTracker.getState(position.line);
		const commit = lineState?.commit;
		if (commit == null) return undefined;

		// Avoid double annotations if we are showing the whole-file hover blame annotations
		if (this.container.config.hovers.annotations.details) {
			const fileAnnotations = await this.container.fileAnnotations.getAnnotationType(window.activeTextEditor);
			if (fileAnnotations === FileAnnotationType.Blame) return undefined;
		}

		const wholeLine = this.container.config.hovers.currentLine.over === 'line';
		// If we aren't showing the hover over the whole line, make sure the annotation is on
		if (!wholeLine && this.container.lineAnnotations.suspended) return undefined;

		const range = document.validateRange(
			new Range(position.line, wholeLine ? 0 : Number.MAX_SAFE_INTEGER, position.line, Number.MAX_SAFE_INTEGER),
		);
		if (!wholeLine && range.start.character !== position.character) return undefined;

		// Get the full commit message -- since blame only returns the summary
		let logCommit = lineState?.logCommit;
		if (logCommit == null && !commit.isUncommitted) {
			logCommit = await this.container.git.getCommitForFile(commit.repoPath, commit.uri.fsPath, {
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

		const trackedDocument = await this.container.tracker.get(document);
		if (trackedDocument == null) return undefined;

		const message = await Hovers.detailsMessage(
			logCommit ?? commit,
			trackedDocument.uri,
			editorLine,
			this.container.config.hovers.detailsMarkdownFormat,
			this.container.config.defaultDateFormat,
			{
				autolinks: this.container.config.hovers.autolinks.enabled,
				pullRequests: {
					enabled: this.container.config.hovers.pullRequests.enabled,
				},
			},
		);
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

		// Avoid double annotations if we are showing the whole-file hover blame annotations
		if (this.container.config.hovers.annotations.changes) {
			const fileAnnotations = await this.container.fileAnnotations.getAnnotationType(window.activeTextEditor);
			if (fileAnnotations === FileAnnotationType.Blame) return undefined;
		}

		const wholeLine = this.container.config.hovers.currentLine.over === 'line';
		// If we aren't showing the hover over the whole line, make sure the annotation is on
		if (!wholeLine && this.container.lineAnnotations.suspended) return undefined;

		const range = document.validateRange(
			new Range(position.line, wholeLine ? 0 : Number.MAX_SAFE_INTEGER, position.line, Number.MAX_SAFE_INTEGER),
		);
		if (!wholeLine && range.start.character !== position.character) return undefined;

		const trackedDocument = await this.container.tracker.get(document);
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

		const cfg = this.container.config.hovers;
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
