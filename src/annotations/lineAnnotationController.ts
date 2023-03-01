import type {
	CancellationToken,
	ConfigurationChangeEvent,
	DecorationOptions,
	TextEditor,
	TextEditorDecorationType,
} from 'vscode';
import { CancellationTokenSource, DecorationRangeBehavior, Disposable, Range, window } from 'vscode';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import { CommitFormatter } from '../git/formatters/commitFormatter';
import type { GitCommit } from '../git/models/commit';
import type { PullRequest } from '../git/models/pullRequest';
import { configuration } from '../system/configuration';
import { debug, log } from '../system/decorators/log';
import { once } from '../system/event';
import { count, every, filter } from '../system/iterable';
import { Logger } from '../system/logger';
import type { LogScope } from '../system/logger.scope';
import { getLogScope } from '../system/logger.scope';
import type { PromiseCancelledErrorWithId } from '../system/promise';
import { PromiseCancelledError, raceAll } from '../system/promise';
import { isTextEditor } from '../system/utils';
import type { LinesChangeEvent } from '../trackers/gitLineTracker';
import { getInlineDecoration } from './annotations';

const annotationDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
	after: {
		margin: '0 0 0 3em',
		textDecoration: 'none',
	},
	rangeBehavior: DecorationRangeBehavior.ClosedOpen,
});
const maxSmallIntegerV8 = 2 ** 30; // Max number that can be stored in V8's smis (small integers)

export class LineAnnotationController implements Disposable {
	private _cancellation: CancellationTokenSource | undefined;
	private readonly _disposable: Disposable;
	private _editor: TextEditor | undefined;
	private _enabled: boolean = false;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.fileAnnotations.onDidToggleAnnotations(this.onFileAnnotationsToggled, this),
			container.richRemoteProviders.onDidChangeConnectionState(() => void this.refresh(window.activeTextEditor)),
		);
	}

	dispose() {
		this.clearAnnotations(this._editor);

		this.container.lineTracker.unsubscribe(this);
		this._disposable.dispose();
	}

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'currentLine')) return;

		if (configuration.changed(e, 'currentLine.enabled')) {
			if (configuration.get('currentLine.enabled')) {
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
				`editor=${e.editor?.document.uri.toString(true)}, selections=${e.selections
					?.map(s => `[${s.anchor}-${s.active}]`)
					.join(',')}, pending=${Boolean(e.pending)}, reason=${e.reason}`,
		},
	})
	private onActiveLinesChanged(e: LinesChangeEvent) {
		if (!e.pending && e.selections !== undefined) {
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
		this._cancellation?.cancel();
		if (this._editor !== editor && this._editor != null) {
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
		lines: [number, GitCommit][],
		{ timeout }: { timeout?: number } = {},
	) {
		if (lines.length === 0) return undefined;

		const remote = await this.container.git.getBestRemoteWithRichProvider(repoPath);
		if (remote?.provider == null) return undefined;

		const refs = new Set<string>();

		for (const [, commit] of lines) {
			refs.add(commit.ref);
		}

		if (refs.size === 0) return undefined;

		const { provider } = remote;
		const prs = await raceAll(
			refs.values(),
			ref => this.container.git.getPullRequestForCommit(ref, provider),
			timeout,
		);
		if (prs.size === 0 || every(prs.values(), pr => pr == null)) return undefined;

		return prs;
	}

	@debug({ args: false })
	private async refresh(editor: TextEditor | undefined, options?: { prs?: Map<string, PullRequest | undefined> }) {
		if (editor == null && this._editor == null) return;

		const scope = getLogScope();

		const selections = this.container.lineTracker.selections;
		if (editor == null || selections == null || !isTextEditor(editor)) {
			if (scope != null) {
				scope.exitDetails = ` ${GlyphChars.Dot} Skipped because there is no valid editor or no valid selections`;
			}

			this.clear(this._editor);
			return;
		}

		if (this._editor !== editor) {
			// Clear any annotations on the previously active editor
			this.clear(this._editor);

			this._editor = editor;
		}

		const cfg = configuration.get('currentLine');
		if (this.suspended) {
			if (scope != null) {
				scope.exitDetails = ` ${GlyphChars.Dot} Skipped because the controller is suspended`;
			}

			this.clear(editor);
			return;
		}

		const trackedDocument = await this.container.tracker.getOrAdd(editor.document);
		if (!trackedDocument.isBlameable && this.suspended) {
			if (scope != null) {
				scope.exitDetails = ` ${GlyphChars.Dot} Skipped because the ${
					this.suspended
						? 'controller is suspended'
						: `document(${trackedDocument.uri.toString(true)}) is not blameable`
				}`;
			}

			this.clear(editor);
			return;
		}

		// Make sure the editor hasn't died since the await above and that we are still on the same line(s)
		if (editor.document == null || !this.container.lineTracker.includes(selections)) {
			if (scope != null) {
				scope.exitDetails = ` ${GlyphChars.Dot} Skipped because the ${
					editor.document == null
						? 'editor is gone'
						: `selection(s)=${selections
								.map(s => `[${s.anchor}-${s.active}]`)
								.join()} are no longer current`
				}`;
			}
			return;
		}

		if (scope != null) {
			scope.exitDetails = ` ${GlyphChars.Dot} selection(s)=${selections
				.map(s => `[${s.anchor}-${s.active}]`)
				.join()}`;
		}

		const commitLines = new Map<number, GitCommit>();
		for (const selection of selections) {
			const state = this.container.lineTracker.getState(selection.active);
			if (state?.commit == null) {
				Logger.debug(scope, `Line ${selection.active} returned no commit`);
				continue;
			}
			commitLines.set(selection.active, state.commit);
		}

		const repoPath = trackedDocument.uri.repoPath;

		// TODO: Make this configurable?
		const timeout = 100;
		const [getBranchAndTagTips, prs] = await Promise.all([
			CommitFormatter.has(cfg.format, 'tips') ? this.container.git.getBranchesAndTagsTipsFn(repoPath) : undefined,
			repoPath != null &&
			cfg.pullRequests.enabled &&
			CommitFormatter.has(
				cfg.format,
				'pullRequest',
				'pullRequestAgo',
				'pullRequestAgoOrDate',
				'pullRequestDate',
				'pullRequestState',
			)
				? options?.prs ??
				  this.getPullRequests(repoPath, [...filter(commitLines, ([, commit]) => !commit.isUncommitted)], {
						timeout: timeout,
				  })
				: undefined,
		]);

		if (prs != null) {
			this._cancellation?.cancel();
			this._cancellation = new CancellationTokenSource();
			void this.waitForAnyPendingPullRequests(editor, prs, this._cancellation.token, timeout, scope);
		}

		const decorations = [];

		for (const [l, commit] of commitLines) {
			if (commit.isUncommitted && cfg.uncommittedChangesFormat === '') continue;

			const decoration = getInlineDecoration(
				commit,
				// await GitUri.fromUri(editor.document.uri),
				// l,
				commit.isUncommitted ? cfg.uncommittedChangesFormat ?? cfg.format : cfg.format,
				{
					dateFormat: cfg.dateFormat === null ? configuration.get('defaultDateFormat') : cfg.dateFormat,
					getBranchAndTagTips: getBranchAndTagTips,
					pullRequestOrRemote: prs?.get(commit.ref),
					pullRequestPendingMessage: `PR ${GlyphChars.Ellipsis}`,
				},
				cfg.scrollable,
			) as DecorationOptions;
			decoration.range = editor.document.validateRange(new Range(l, maxSmallIntegerV8, l, maxSmallIntegerV8));

			decorations.push(decoration);
		}

		editor.setDecorations(annotationDecoration, decorations);
	}

	private setLineTracker(enabled: boolean) {
		if (enabled) {
			if (!this.container.lineTracker.subscribed(this)) {
				this.container.lineTracker.subscribe(
					this,
					this.container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this),
				);
			}

			return;
		}

		this.container.lineTracker.unsubscribe(this);
	}

	private async waitForAnyPendingPullRequests(
		editor: TextEditor,
		prs: Map<
			string,
			PullRequest | PromiseCancelledErrorWithId<string, Promise<PullRequest | undefined>> | undefined
		>,
		cancellationToken: CancellationToken,
		timeout: number,
		scope: LogScope | undefined,
	) {
		// If there are any PRs that timed out, refresh the annotation(s) once they complete
		const prCount = count(prs.values(), pr => pr instanceof PromiseCancelledError);
		if (cancellationToken.isCancellationRequested || prCount === 0) return;

		Logger.debug(scope, `${GlyphChars.Dot} ${prCount} pull request queries took too long (over ${timeout} ms)`);

		const resolved = new Map<string, PullRequest | undefined>();
		for (const [key, value] of prs) {
			resolved.set(key, value instanceof PromiseCancelledError ? await value.promise : value);
		}

		if (cancellationToken.isCancellationRequested || editor !== this._editor) return;

		Logger.debug(scope, `${GlyphChars.Dot} ${prCount} pull request queries completed; refreshing...`);

		void this.refresh(editor, { prs: resolved });
	}
}
