'use strict';
import {
	ConfigurationChangeEvent,
	DecorationOptions,
	DecorationRangeBehavior,
	Disposable,
	Range,
	TextEditor,
	TextEditorDecorationType,
	window,
} from 'vscode';
import { configuration } from '../configuration';
import { GlyphChars, isTextEditor } from '../constants';
import { Container } from '../container';
import { LinesChangeEvent } from '../trackers/gitLineTracker';
import { Annotations } from './annotations';
import { debug, Iterables, log, Promises } from '../system';
import { Logger } from '../logger';
import { CommitFormatter, GitBlameCommit } from '../git/gitService';

const annotationDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
	after: {
		margin: '0 0 0 3em',
		textDecoration: 'none',
	},
	rangeBehavior: DecorationRangeBehavior.ClosedOpen,
});

export class LineAnnotationController implements Disposable {
	private _disposable: Disposable;
	private _editor: TextEditor | undefined;
	private _enabled: boolean = false;

	constructor() {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			Container.fileAnnotations.onDidToggleAnnotations(this.onFileAnnotationsToggled, this),
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
					e.pending,
				)}, reason=${e.reason}`,
		},
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

	private async getPullRequests(
		repoPath: string,
		lines: [number, GitBlameCommit][],
		{ timeout }: { timeout?: number } = {},
	) {
		if (lines.length === 0) return undefined;

		const remotes = await Container.git.getRemotes(repoPath);
		const remote = remotes.find(r => r.default);
		if (!remote?.provider?.hasApi()) return undefined;

		const { provider } = remote;
		const connected = provider.maybeConnected ?? (await provider.isConnected());
		if (!connected) return undefined;

		const refs = new Set<string>();

		for (const [, commit] of lines) {
			refs.add(commit.ref);
		}

		if (refs.size === 0) return undefined;

		const prs = await Promises.raceAll(
			refs.values(),
			ref => Container.git.getPullRequestForCommit(ref, provider),
			timeout,
		);
		if (prs.size === 0 || Iterables.every(prs.values(), pr => pr === undefined)) return undefined;

		return prs;
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

		const commitLines = [
			...Iterables.filterMap<number, [number, GitBlameCommit]>(lines, l => {
				const state = Container.lineTracker.getState(l);
				if (state?.commit == null) {
					Logger.debug(cc, `Line ${l} returned no commit`);
					return undefined;
				}

				return [l, state.commit];
			}),
		];

		const repoPath = trackedDocument.uri.repoPath;

		// TODO: Make this configurable?
		const timeout = 100;

		const [getBranchAndTagTips, prs] = await Promise.all([
			CommitFormatter.has(cfg.format, 'tips') ? Container.git.getBranchesAndTagsTipsFn(repoPath) : undefined,
			repoPath != null &&
			Container.config.currentLine.pullRequests.enabled &&
			CommitFormatter.has(
				Container.config.currentLine.format,
				'pullRequest',
				'pullRequestAgo',
				'pullRequestAgoOrDate',
				'pullRequestDate',
				'pullRequestState',
			)
				? this.getPullRequests(
						repoPath,
						commitLines.filter(([, commit]) => !commit.isUncommitted),
						{ timeout: timeout },
				  )
				: undefined,
		]);

		if (prs !== undefined) {
			const timeouts = [
				...Iterables.filterMap(prs.values(), pr =>
					pr instanceof Promises.CancellationError ? pr.promise : undefined,
				),
			];

			// If there are any PRs that timed out, refresh the annotation(s) once they complete
			if (timeouts.length !== 0) {
				Logger.debug(
					cc,
					`${GlyphChars.Dot} pull request queries (${timeouts.length}) took too long (over ${timeout} ms)`,
				);
				Promise.all(timeouts).then(() => {
					if (editor === this._editor) {
						Logger.debug(
							cc,
							`${GlyphChars.Dot} pull request queries (${timeouts.length}) completed; refreshing...`,
						);

						this.refresh(editor);
					}
				});
			}
		}

		const decorations = [];

		for (const [l, commit] of commitLines) {
			const decoration = Annotations.trailing(
				commit,
				// await GitUri.fromUri(editor.document.uri),
				// l,
				cfg.format,
				{
					dateFormat: cfg.dateFormat === null ? Container.config.defaultDateFormat : cfg.dateFormat,
					getBranchAndTagTips: getBranchAndTagTips,
					pullRequestOrRemote: prs?.get(commit.ref),
				},
				cfg.scrollable,
			) as DecorationOptions;
			decoration.range = editor.document.validateRange(
				new Range(l, Number.MAX_SAFE_INTEGER, l, Number.MAX_SAFE_INTEGER),
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
					Container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this),
				);
			}

			return;
		}

		Container.lineTracker.stop(this);
	}
}
