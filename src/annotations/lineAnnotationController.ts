'use strict';
import {
	ConfigurationChangeEvent,
	DecorationOptions,
	DecorationRangeBehavior,
	Disposable,
	Range,
	TextEditor,
	TextEditorDecorationType,
	window
} from 'vscode';
import { configuration } from '../configuration';
import { GlyphChars, isTextEditor } from '../constants';
import { Container } from '../container';
import { LinesChangeEvent } from '../trackers/gitLineTracker';
import { Annotations } from './annotations';
import { debug, log } from '../system';
import { Logger } from '../logger';
import { CommitFormatter, CommitPullRequest, GitRemote } from '../git/gitService';

const annotationDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
	after: {
		margin: '0 0 0 3em',
		textDecoration: 'none'
	},
	rangeBehavior: DecorationRangeBehavior.ClosedOpen
});

export class LineAnnotationController implements Disposable {
	private _disposable: Disposable;
	private _editor: TextEditor | undefined;
	private _enabled: boolean = false;

	constructor() {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			Container.fileAnnotations.onDidToggleAnnotations(this.onFileAnnotationsToggled, this)
		);
		this.onConfigurationChanged(configuration.initializingChangeEvent);
	}

	dispose() {
		this.clearAnnotations(this._editor);

		Container.lineTracker.stop(this);
		this._disposable && this._disposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'currentLine')) return;

		if (configuration.changed(e, 'currentLine', 'enabled')) {
			if (Container.config.currentLine.enabled) {
				this._enabled = true;
				this.resume();
			} else {
				this._enabled = false;
				this.setLineTracker(false);
			}
		}

		void this.refresh(window.activeTextEditor);
	}

	private _suspended: boolean = false;
	get suspended() {
		return !this._enabled || this._suspended;
	}

	@log()
	resume() {
		this.setLineTracker(true);

		if (this._suspended) {
			this._suspended = false;
			return true;
		}

		return false;
	}

	@log()
	suspend() {
		this.setLineTracker(false);

		if (!this._suspended) {
			this._suspended = true;
			return true;
		}

		return false;
	}

	@debug({
		args: {
			0: (e: LinesChangeEvent) =>
				`editor=${e.editor?.document.uri.toString(true)}, lines=${e.lines?.join(',')}, pending=${Boolean(
					e.pending
				)}, reason=${e.reason}`
		}
	})
	private onActiveLinesChanged(e: LinesChangeEvent) {
		if (!e.pending && e.lines !== undefined) {
			void this.refresh(e.editor);

			return;
		}

		this.clear(e.editor);
	}

	private onFileAnnotationsToggled() {
		void this.refresh(window.activeTextEditor);
	}

	@debug({ args: false, singleLine: true })
	clear(editor: TextEditor | undefined) {
		if (this._editor !== editor && this._editor !== undefined) {
			this.clearAnnotations(this._editor);
		}
		this.clearAnnotations(editor);
	}

	@log({ args: false })
	async toggle(editor: TextEditor | undefined) {
		this._enabled = !(this._enabled && !this.suspended);

		if (this._enabled) {
			if (this.resume()) {
				await this.refresh(editor);
			}
		} else if (this.suspend()) {
			await this.refresh(editor);
		}
	}

	private clearAnnotations(editor: TextEditor | undefined) {
		if (editor === undefined || (editor as any)._disposed === true) return;

		editor.setDecorations(annotationDecoration, []);
	}

	private async getPullRequestForCommit(ref: string, remotes: GitRemote[]) {
		try {
			return await Container.git.getPullRequestForCommit(ref, remotes, { timeout: 100 });
		} catch {
			return undefined;
		}
	}

	@debug({ args: false })
	private async refresh(editor: TextEditor | undefined) {
		if (editor === undefined && this._editor === undefined) return;

		const cc = Logger.getCorrelationContext();

		const lines = Container.lineTracker.lines;
		if (editor === undefined || lines === undefined || !isTextEditor(editor)) {
			if (cc) {
				cc.exitDetails = ` ${GlyphChars.Dot} Skipped because there is no valid editor or no valid lines`;
			}

			this.clear(this._editor);
			return;
		}

		if (this._editor !== editor) {
			// Clear any annotations on the previously active editor
			this.clear(this._editor);

			this._editor = editor;
		}

		const cfg = Container.config.currentLine;
		if (this.suspended) {
			if (cc) {
				cc.exitDetails = ` ${GlyphChars.Dot} Skipped because the controller is suspended`;
			}

			this.clear(editor);
			return;
		}

		const trackedDocument = await Container.tracker.getOrAdd(editor.document);
		if (!trackedDocument.isBlameable && this.suspended) {
			if (cc) {
				cc.exitDetails = ` ${GlyphChars.Dot} Skipped because the ${
					this.suspended
						? 'controller is suspended'
						: `document(${trackedDocument.uri.toString(true)}) is not blameable`
				}`;
			}

			this.clear(editor);
			return;
		}

		// Make sure the editor hasn't died since the await above and that we are still on the same line(s)
		if (editor.document === undefined || !Container.lineTracker.includesAll(lines)) {
			if (cc) {
				cc.exitDetails = ` ${GlyphChars.Dot} Skipped because the ${
					editor.document === undefined ? 'editor is gone' : `line(s)=${lines.join()} are no longer current`
				}`;
			}
			return;
		}

		if (cc) {
			cc.exitDetails = ` ${GlyphChars.Dot} line(s)=${lines.join()}`;
		}

		let getBranchAndTagTips;
		if (CommitFormatter.has(cfg.format, 'tips')) {
			getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(trackedDocument.uri.repoPath);
		}

		let prs;
		if (
			Container.config.pullRequests.enabled &&
			CommitFormatter.has(
				cfg.format,
				'pullRequest',
				'pullRequestAgo',
				'pullRequestAgoOrDate',
				'pullRequestDate',
				'pullRequestState'
			)
		) {
			const promises = [];
			let remotes;

			for (const l of lines) {
				const state = Container.lineTracker.getState(l);
				if (state?.commit == null || state.commit.isUncommitted || (remotes != null && remotes.length === 0)) {
					continue;
				}

				if (remotes == null) {
					remotes = await Container.git.getRemotes(state.commit.repoPath);
				}
				promises.push(this.getPullRequestForCommit(state.commit.ref, remotes));
			}

			prs = new Map<string, CommitPullRequest | undefined>();
			for await (const pr of promises) {
				if (pr === undefined) continue;

				prs.set(pr?.ref, pr);
			}
		}

		const decorations = [];

		for (const l of lines) {
			const state = Container.lineTracker.getState(l);
			if (state?.commit == null) continue;

			const decoration = Annotations.trailing(
				state.commit,
				// await GitUri.fromUri(editor.document.uri),
				// l,
				cfg.format,
				{
					dateFormat: cfg.dateFormat === null ? Container.config.defaultDateFormat : cfg.dateFormat,
					getBranchAndTagTips: getBranchAndTagTips,
					pr: prs?.get(state.commit.ref)
				},
				cfg.scrollable
			) as DecorationOptions;
			decoration.range = editor.document.validateRange(
				new Range(l, Number.MAX_SAFE_INTEGER, l, Number.MAX_SAFE_INTEGER)
			);

			decorations.push(decoration);
		}

		editor.setDecorations(annotationDecoration, decorations);
	}

	private setLineTracker(enabled: boolean) {
		if (enabled) {
			if (!Container.lineTracker.isSubscribed(this)) {
				Container.lineTracker.start(
					this,
					Container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this)
				);
			}

			return;
		}

		Container.lineTracker.stop(this);
	}
}
