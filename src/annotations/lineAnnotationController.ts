import type { ConfigurationChangeEvent, DecorationOptions, TextEditor, TextEditorDecorationType } from 'vscode';
import { CancellationTokenSource, DecorationRangeBehavior, Disposable, Range, window } from 'vscode';
import { GlyphChars, Schemes } from '../constants';
import type { Container } from '../container';
import { CommitFormatter } from '../git/formatters/commitFormatter';
import type { PullRequest } from '../git/models/pullRequest';
import { detailsMessage } from '../hovers/hovers';
import { debug, log } from '../system/decorators/log';
import { once } from '../system/event';
import { debounce } from '../system/function';
import { Logger } from '../system/logger';
import { getLogScope, setLogScopeExit } from '../system/logger.scope';
import type { MaybePausedResult } from '../system/promise';
import { getSettledValue, pauseOnCancelOrTimeoutMap } from '../system/promise';
import { configuration } from '../system/vscode/configuration';
import { isTrackableTextEditor } from '../system/vscode/utils';
import type { LinesChangeEvent, LineState } from '../trackers/lineTracker';
import { getInlineDecoration } from './annotations';
import type { BlameFontOptions } from './gutterBlameAnnotationProvider';

const annotationDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
	after: {
		margin: '0 0 0 3em',
		textDecoration: 'none',
	},
	rangeBehavior: DecorationRangeBehavior.OpenOpen,
});
const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

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
			container.integrations.onDidChangeConnectionState(
				debounce(() => void this.refresh(window.activeTextEditor), 250),
			),
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

	private getPullRequestsForLines(
		repoPath: string,
		lines: Map<number, LineState>,
	): Map<string, Promise<PullRequest | undefined>> {
		const prs = new Map<string, Promise<PullRequest | undefined>>();
		if (lines.size === 0) return prs;

		const remotePromise = this.container.git.getBestRemoteWithIntegration(repoPath);

		for (const [, state] of lines) {
			if (state.commit.isUncommitted) continue;

			let pr = prs.get(state.commit.ref);
			if (pr == null) {
				pr = remotePromise.then(remote => state.commit.getAssociatedPullRequest(remote));
				prs.set(state.commit.ref, pr);
			}
		}

		return prs;
	}

	@debug()
	private async refresh(editor: TextEditor | undefined) {
		if (editor == null && this._editor == null) return;

		const scope = getLogScope();

		const selections = this.container.lineTracker.selections;
		if (editor == null || selections == null || !isTrackableTextEditor(editor)) {
			setLogScopeExit(
				scope,
				` ${GlyphChars.Dot} Skipped because there is no valid editor or no valid selections`,
			);

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
			setLogScopeExit(scope, ` ${GlyphChars.Dot} Skipped because the controller is suspended`);

			this.clear(editor);
			return;
		}

		const trackedDocument = await this.container.documentTracker.getOrAdd(editor.document);
		const status = await trackedDocument?.getStatus();
		if (!status?.blameable && this.suspended) {
			setLogScopeExit(
				scope,
				` ${GlyphChars.Dot} Skipped because the ${
					this.suspended ? 'controller is suspended' : 'document is not blameable'
				}`,
			);

			this.clear(editor);
			return;
		}

		// Make sure the editor hasn't died since the await above and that we are still on the same line(s)
		if (editor.document == null || !this.container.lineTracker.includes(selections)) {
			setLogScopeExit(
				scope,
				` ${GlyphChars.Dot} Skipped because the ${
					editor.document == null
						? 'editor is gone'
						: `selection=${selections.map(s => `[${s.anchor}-${s.active}]`).join()} are no longer current`
				}`,
			);
			return;
		}

		setLogScopeExit(
			scope,
			` ${GlyphChars.Dot} selection=${selections.map(s => `[${s.anchor}-${s.active}]`).join()}`,
		);

		let uncommittedOnly = true;

		const commitPromises = new Map<string, Promise<void>>();
		const lines = new Map<number, LineState>();
		for (const selection of selections) {
			const state = this.container.lineTracker.getState(selection.active);
			if (state?.commit == null) {
				Logger.debug(scope, `Line ${selection.active} returned no commit`);
				continue;
			}

			if (state.commit.message == null && !commitPromises.has(state.commit.ref)) {
				commitPromises.set(state.commit.ref, state.commit.ensureFullDetails());
			}
			lines.set(selection.active, state);
			if (!state.commit.isUncommitted) {
				uncommittedOnly = false;
			}
		}

		const repoPath = trackedDocument.uri.repoPath;

		let hoverOptions: RequireSome<Parameters<typeof detailsMessage>[4], 'autolinks' | 'pullRequests'> | undefined;
		// Live Share (vsls schemes) don't support `languages.registerHoverProvider` so we'll need to add them to the decoration directly
		if (editor.document.uri.scheme === Schemes.Vsls || editor.document.uri.scheme === Schemes.VslsScc) {
			const hoverCfg = configuration.get('hovers');
			hoverOptions = {
				autolinks: hoverCfg.autolinks.enabled,
				dateFormat: configuration.get('defaultDateFormat'),
				format: hoverCfg.detailsMarkdownFormat,
				pullRequests: hoverCfg.pullRequests.enabled,
			};
		}

		const getPullRequests =
			!uncommittedOnly &&
			repoPath != null &&
			cfg.pullRequests.enabled &&
			CommitFormatter.has(
				cfg.format,
				'pullRequest',
				'pullRequestAgo',
				'pullRequestAgoOrDate',
				'pullRequestDate',
				'pullRequestState',
			);

		this._cancellation?.cancel();
		this._cancellation = new CancellationTokenSource();
		const cancellation = this._cancellation.token;

		const getBranchAndTagTipsPromise = CommitFormatter.has(cfg.format, 'tips')
			? this.container.git.getBranchesAndTagsTipsLookup(repoPath)
			: undefined;

		async function updateDecorations(
			container: Container,
			editor: TextEditor,
			getBranchAndTagTips: Awaited<typeof getBranchAndTagTipsPromise> | undefined,
			prs: Map<string, MaybePausedResult<PullRequest | undefined>> | undefined,
			timeout?: number,
		) {
			const fontOptions: BlameFontOptions = {
				family: cfg.fontFamily,
				size: cfg.fontSize,
				style: cfg.fontStyle,
				weight: cfg.fontWeight,
			};

			const decorations = [];

			for (const [l, state] of lines) {
				const commit = state.commit;
				if (commit == null || (commit.isUncommitted && cfg.uncommittedChangesFormat === '')) continue;

				const pr = prs?.get(commit.ref);

				const decoration = getInlineDecoration(
					commit,
					// await GitUri.fromUri(editor.document.uri),
					// l,
					commit.isUncommitted ? cfg.uncommittedChangesFormat ?? cfg.format : cfg.format,
					{
						dateFormat: cfg.dateFormat === null ? configuration.get('defaultDateFormat') : cfg.dateFormat,
						getBranchAndTagTips: getBranchAndTagTips,
						pullRequest: pr?.value,
						pullRequestPendingMessage: `PR ${GlyphChars.Ellipsis}`,
					},
					fontOptions,
					cfg.scrollable,
				) as DecorationOptions;
				decoration.range = editor.document.validateRange(new Range(l, maxSmallIntegerV8, l, maxSmallIntegerV8));

				if (hoverOptions != null) {
					decoration.hoverMessage = await detailsMessage(container, commit, trackedDocument.uri, l, {
						...hoverOptions,
						pullRequest: pr?.value,
						timeout: timeout,
					});
				}

				decorations.push(decoration);
			}

			editor.setDecorations(annotationDecoration, decorations);
		}

		// TODO: Make this configurable?
		const timeout = 100;
		const prsResult = getPullRequests
			? await pauseOnCancelOrTimeoutMap(
					this.getPullRequestsForLines(repoPath, lines),
					true,
					cancellation,
					timeout,
					async result => {
						if (
							result.reason !== 'timedout' ||
							cancellation.isCancellationRequested ||
							editor !== this._editor
						) {
							return;
						}

						// If the PRs are taking too long, refresh the decorations once they complete

						Logger.debug(
							scope,
							`${GlyphChars.Dot} pull request queries took too long (over ${timeout} ms)`,
						);

						const [getBranchAndTagTipsResult, prsResult] = await Promise.allSettled([
							getBranchAndTagTipsPromise,
							result.value,
						]);

						if (cancellation.isCancellationRequested || editor !== this._editor) return;

						const prs = getSettledValue(prsResult);
						const getBranchAndTagTips = getSettledValue(getBranchAndTagTipsResult);

						Logger.debug(scope, `${GlyphChars.Dot} pull request queries completed; updating...`);

						void updateDecorations(this.container, editor, getBranchAndTagTips, prs);
					},
			  )
			: undefined;

		const [getBranchAndTagTipsResult] = await Promise.allSettled([
			getBranchAndTagTipsPromise,
			...commitPromises.values(),
		]);

		if (cancellation.isCancellationRequested) return;

		await updateDecorations(this.container, editor, getSettledValue(getBranchAndTagTipsResult), prsResult, 100);
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
}
