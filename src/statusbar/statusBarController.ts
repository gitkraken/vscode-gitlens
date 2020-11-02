'use strict';
import {
	CancellationToken,
	CancellationTokenSource,
	ConfigurationChangeEvent,
	Disposable,
	StatusBarAlignment,
	StatusBarItem,
	TextEditor,
	window,
} from 'vscode';
import { Commands } from '../commands';
import { configuration, StatusBarCommand } from '../configuration';
import { GlyphChars, isTextEditor } from '../constants';
import { Container } from '../container';
import { CommitFormatter, GitBlameCommit, PullRequest } from '../git/git';
import { LinesChangeEvent } from '../trackers/gitLineTracker';
import { debug, Promises } from '../system';
import { LogCorrelationContext, Logger } from '../logger';

export class StatusBarController implements Disposable {
	private _cancellation: CancellationTokenSource | undefined;
	private readonly _disposable: Disposable;
	private _statusBarBlame: StatusBarItem | undefined;
	private _statusBarMode: StatusBarItem | undefined;

	constructor() {
		this._disposable = Disposable.from(configuration.onDidChange(this.onConfigurationChanged, this));
		this.onConfigurationChanged(configuration.initializingChangeEvent);
	}

	dispose() {
		this.clearBlame();

		this._statusBarBlame?.dispose();
		this._statusBarMode?.dispose();

		Container.lineTracker.stop(this);
		this._disposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'mode')) {
			const mode =
				Container.config.mode.active && Container.config.mode.statusBar.enabled
					? Container.config.modes[Container.config.mode.active]
					: undefined;
			if (mode?.statusBarItemName) {
				const alignment =
					Container.config.mode.statusBar.alignment !== 'left'
						? StatusBarAlignment.Right
						: StatusBarAlignment.Left;

				if (configuration.changed(e, 'mode', 'statusBar', 'alignment')) {
					if (this._statusBarMode?.alignment !== alignment) {
						this._statusBarMode?.dispose();
						this._statusBarMode = undefined;
					}
				}

				this._statusBarMode =
					this._statusBarMode ??
					window.createStatusBarItem(alignment, alignment === StatusBarAlignment.Right ? 999 : 1);
				this._statusBarMode.command = Commands.SwitchMode;
				this._statusBarMode.text = mode.statusBarItemName;
				this._statusBarMode.tooltip = 'Switch GitLens Mode';
				this._statusBarMode.show();
			} else {
				this._statusBarMode?.dispose();
				this._statusBarMode = undefined;
			}
		}

		if (!configuration.changed(e, 'statusBar')) return;

		if (Container.config.statusBar.enabled) {
			const alignment =
				Container.config.statusBar.alignment !== 'left' ? StatusBarAlignment.Right : StatusBarAlignment.Left;

			if (configuration.changed(e, 'statusBar', 'alignment')) {
				if (this._statusBarBlame?.alignment !== alignment) {
					this._statusBarBlame?.dispose();
					this._statusBarBlame = undefined;
				}
			}

			this._statusBarBlame =
				this._statusBarBlame ??
				window.createStatusBarItem(alignment, alignment === StatusBarAlignment.Right ? 1000 : 0);
			this._statusBarBlame.command = Container.config.statusBar.command;

			if (configuration.changed(e, 'statusBar', 'enabled')) {
				Container.lineTracker.start(
					this,
					Container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this),
				);
			}
		} else if (configuration.changed(e, 'statusBar', 'enabled')) {
			Container.lineTracker.stop(this);

			this._statusBarBlame?.dispose();
			this._statusBarBlame = undefined;
		}
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
		// If we need to reduceFlicker, don't clear if only the selected lines changed
		let clear = !(
			Container.config.statusBar.reduceFlicker &&
			e.reason === 'selection' &&
			(e.pending || e.selections != null)
		);
		if (!e.pending && e.selections != null) {
			const state = Container.lineTracker.getState(e.selections[0].active);
			if (state?.commit != null) {
				void this.updateBlame(e.editor!, state.commit);

				return;
			}

			clear = true;
		}

		if (clear) {
			this.clearBlame();
		}
	}

	clearBlame() {
		this._cancellation?.cancel();
		this._statusBarBlame?.hide();
	}

	@debug({ args: false })
	private async updateBlame(editor: TextEditor, commit: GitBlameCommit, options?: { pr?: PullRequest | undefined }) {
		const cfg = Container.config.statusBar;
		if (!cfg.enabled || this._statusBarBlame == null || !isTextEditor(editor)) return;

		const cc = Logger.getCorrelationContext();

		// TODO: Make this configurable?
		const timeout = 100;
		const [getBranchAndTagTips, pr] = await Promise.all([
			CommitFormatter.has(cfg.format, 'tips')
				? Container.git.getBranchesAndTagsTipsFn(commit.repoPath)
				: undefined,
			cfg.pullRequests.enabled &&
			CommitFormatter.has(
				cfg.format,
				'pullRequest',
				'pullRequestAgo',
				'pullRequestAgoOrDate',
				'pullRequestDate',
				'pullRequestState',
			)
				? options?.pr ?? this.getPullRequest(commit, { timeout: timeout })
				: undefined,
		]);

		if (pr != null) {
			this._cancellation?.cancel();
			this._cancellation = new CancellationTokenSource();
			void this.waitForPendingPullRequest(editor, commit, pr, this._cancellation.token, timeout, cc);
		}

		this._statusBarBlame.text = `$(git-commit) ${CommitFormatter.fromTemplate(cfg.format, commit, {
			dateFormat: cfg.dateFormat === null ? Container.config.defaultDateFormat : cfg.dateFormat,
			getBranchAndTagTips: getBranchAndTagTips,
			messageTruncateAtNewLine: true,
			pullRequestOrRemote: pr,
		})}`;

		switch (cfg.command) {
			case StatusBarCommand.ToggleFileBlame:
				this._statusBarBlame.tooltip = 'Toggle File Blame Annotations';
				break;
			case StatusBarCommand.DiffWithPrevious:
				this._statusBarBlame.command = Commands.DiffLineWithPrevious;
				this._statusBarBlame.tooltip = 'Open Line Changes with Previous Revision';
				break;
			case StatusBarCommand.DiffWithWorking:
				this._statusBarBlame.command = Commands.DiffLineWithWorking;
				this._statusBarBlame.tooltip = 'Open Line Changes with Working File';
				break;
			case StatusBarCommand.ToggleCodeLens:
				this._statusBarBlame.tooltip = 'Toggle Git CodeLens';
				break;
			case StatusBarCommand.RevealCommitInView:
				this._statusBarBlame.tooltip = 'Reveal Commit in the Side Bar';
				break;
			case StatusBarCommand.ShowCommitsInView:
				this._statusBarBlame.tooltip = 'Search for Commit';
				break;
			case StatusBarCommand.ShowQuickCommitDetails:
				this._statusBarBlame.tooltip = 'Show Commit';
				break;
			case StatusBarCommand.ShowQuickCommitFileDetails:
				this._statusBarBlame.tooltip = 'Show Commit (file)';
				break;
			case StatusBarCommand.ShowQuickFileHistory:
				this._statusBarBlame.tooltip = 'Show File History';
				break;
			case StatusBarCommand.ShowQuickCurrentBranchHistory:
				this._statusBarBlame.tooltip = 'Show Branch History';
				break;
		}

		this._statusBarBlame.show();
	}

	private async getPullRequest(commit: GitBlameCommit, { timeout }: { timeout?: number } = {}) {
		const remote = await Container.git.getRemoteWithApiProvider(commit.repoPath);
		if (remote?.provider == null) return undefined;

		const { provider } = remote;
		try {
			return await Container.git.getPullRequestForCommit(commit.ref, provider, { timeout: timeout });
		} catch (ex) {
			return ex;
		}
	}

	private async waitForPendingPullRequest(
		editor: TextEditor,
		commit: GitBlameCommit,
		pr: PullRequest | Promises.CancellationError<Promise<PullRequest | undefined>> | undefined,
		cancellationToken: CancellationToken,
		timeout: number,
		cc: LogCorrelationContext | undefined,
	) {
		if (cancellationToken.isCancellationRequested || !(pr instanceof Promises.CancellationError)) return;

		// If the PR timed out, refresh the status bar once it completes
		Logger.debug(cc, `${GlyphChars.Dot} pull request query took too long (over ${timeout} ms)`);

		pr = await pr.promise;

		if (cancellationToken.isCancellationRequested) return;

		Logger.debug(cc, `${GlyphChars.Dot} pull request query completed; refreshing...`);

		void this.updateBlame(editor, commit, { pr: pr });
	}
}
