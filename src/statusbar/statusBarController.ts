'use strict';
import {
	CancellationToken,
	CancellationTokenSource,
	ConfigurationChangeEvent,
	Disposable,
	MarkdownString,
	StatusBarAlignment,
	StatusBarItem,
	TextEditor,
	Uri,
	window,
} from 'vscode';
import { command, Commands, ToggleFileChangesAnnotationCommandArgs } from '../commands';
import { configuration, FileAnnotationType, StatusBarCommand } from '../configuration';
import { GlyphChars, isTextEditor } from '../constants';
import { Container } from '../container';
import { CommitFormatter, GitBlameCommit, PullRequest } from '../git/git';
import { Hovers } from '../hovers/hovers';
import { LogCorrelationContext, Logger } from '../logger';
import { debug, Promises } from '../system';
import { LinesChangeEvent } from '../trackers/gitLineTracker';

export class StatusBarController implements Disposable {
	private _pullRequestCancellation: CancellationTokenSource | undefined;
	private _tooltipCancellation: CancellationTokenSource | undefined;
	private _tooltipDelayTimer: any | undefined;

	private readonly _disposable: Disposable;
	private _statusBarBlame: StatusBarItem | undefined;
	private _statusBarMode: StatusBarItem | undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			container.onReady(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
	}

	dispose() {
		this.clearBlame();

		this._statusBarBlame?.dispose();
		this._statusBarMode?.dispose();

		this.container.lineTracker.stop(this);
		this._disposable.dispose();
	}

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'mode')) {
			const mode =
				this.container.config.mode.active && this.container.config.mode.statusBar.enabled
					? this.container.config.modes?.[this.container.config.mode.active]
					: undefined;
			if (mode?.statusBarItemName) {
				const alignment =
					this.container.config.mode.statusBar.alignment !== 'left'
						? StatusBarAlignment.Right
						: StatusBarAlignment.Left;

				if (configuration.changed(e, 'mode.statusBar.alignment')) {
					if (this._statusBarMode?.alignment !== alignment) {
						this._statusBarMode?.dispose();
						this._statusBarMode = undefined;
					}
				}

				this._statusBarMode =
					this._statusBarMode ??
					window.createStatusBarItem(
						'gitlens.mode',
						alignment,
						alignment === StatusBarAlignment.Right ? 999 : 1,
					);
				this._statusBarMode.name = 'GitLens Modes';
				this._statusBarMode.command = Commands.SwitchMode;
				this._statusBarMode.text = mode.statusBarItemName;
				this._statusBarMode.tooltip = new MarkdownString(
					`**${mode.statusBarItemName}** ${GlyphChars.Dash} ${mode.description}\n\n---\n\nClick to Switch GitLens Mode`,
					true,
				);
				this._statusBarMode.show();
			} else {
				this._statusBarMode?.dispose();
				this._statusBarMode = undefined;
			}
		}

		if (!configuration.changed(e, 'statusBar')) return;

		if (this.container.config.statusBar.enabled) {
			const alignment =
				this.container.config.statusBar.alignment !== 'left'
					? StatusBarAlignment.Right
					: StatusBarAlignment.Left;

			if (configuration.changed(e, 'statusBar.alignment')) {
				if (this._statusBarBlame?.alignment !== alignment) {
					this._statusBarBlame?.dispose();
					this._statusBarBlame = undefined;
				}
			}

			this._statusBarBlame =
				this._statusBarBlame ??
				window.createStatusBarItem(
					'gitlens.blame',
					alignment,
					alignment === StatusBarAlignment.Right ? 1000 : 0,
				);
			this._statusBarBlame.name = 'GitLens Current Line Blame';
			this._statusBarBlame.command = this.container.config.statusBar.command;

			if (configuration.changed(e, 'statusBar.enabled')) {
				this.container.lineTracker.start(
					this,
					this.container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this),
				);
			}
		} else if (configuration.changed(e, 'statusBar.enabled')) {
			this.container.lineTracker.stop(this);

			this._statusBarBlame?.dispose();
			this._statusBarBlame = undefined;
		}
	}

	@debug<StatusBarController['onActiveLinesChanged']>({
		args: {
			0: e =>
				`editor=${e.editor?.document.uri.toString(true)}, selections=${e.selections
					?.map(s => `[${s.anchor}-${s.active}]`)
					.join(',')}, pending=${Boolean(e.pending)}, reason=${e.reason}`,
		},
	})
	private onActiveLinesChanged(e: LinesChangeEvent) {
		// If we need to reduceFlicker, don't clear if only the selected lines changed
		let clear = !(
			this.container.config.statusBar.reduceFlicker &&
			e.reason === 'selection' &&
			(e.pending || e.selections != null)
		);
		if (!e.pending && e.selections != null) {
			const state = this.container.lineTracker.getState(e.selections[0].active);
			if (state?.commit != null) {
				void this.updateBlame(e.editor!, state.commit);

				return;
			}

			clear = true;
		}

		if (clear) {
			this.clearBlame();
		} else if (this._statusBarBlame != null) {
			this._statusBarBlame.text = this._statusBarBlame.text.replace('$(git-commit)', '$(loading~spin)');
		}
	}

	clearBlame() {
		this._pullRequestCancellation?.cancel();
		this._tooltipCancellation?.cancel();
		this._statusBarBlame?.hide();
	}

	@debug({ args: false })
	private async updateBlame(editor: TextEditor, commit: GitBlameCommit, options?: { pr?: PullRequest | null }) {
		const cfg = this.container.config.statusBar;
		if (!cfg.enabled || this._statusBarBlame == null || !isTextEditor(editor)) return;

		const cc = Logger.getCorrelationContext();

		const showPullRequests =
			cfg.pullRequests.enabled &&
			(CommitFormatter.has(
				cfg.format,
				'pullRequest',
				'pullRequestAgo',
				'pullRequestAgoOrDate',
				'pullRequestDate',
				'pullRequestState',
			) ||
				CommitFormatter.has(
					cfg.tooltipFormat,
					'pullRequest',
					'pullRequestAgo',
					'pullRequestAgoOrDate',
					'pullRequestDate',
					'pullRequestState',
				));

		// TODO: Make this configurable?
		const timeout = 100;
		const [getBranchAndTagTips, pr] = await Promise.all([
			CommitFormatter.has(cfg.format, 'tips') || CommitFormatter.has(cfg.tooltipFormat, 'tips')
				? this.container.git.getBranchesAndTagsTipsFn(commit.repoPath)
				: undefined,
			showPullRequests && options?.pr === undefined
				? this.getPullRequest(commit, { timeout: timeout })
				: options?.pr ?? undefined,
		]);

		if (pr != null) {
			this._pullRequestCancellation?.cancel();
			this._pullRequestCancellation = new CancellationTokenSource();
			void this.waitForPendingPullRequest(editor, commit, pr, this._pullRequestCancellation.token, timeout, cc);
		}

		this._statusBarBlame.text = `$(git-commit) ${CommitFormatter.fromTemplate(cfg.format, commit, {
			dateFormat: cfg.dateFormat === null ? this.container.config.defaultDateFormat : cfg.dateFormat,
			getBranchAndTagTips: getBranchAndTagTips,
			messageTruncateAtNewLine: true,
			pullRequestOrRemote: pr,
			pullRequestPendingMessage: 'PR $(loading~spin)',
		})}`;

		let tooltip: string;
		switch (cfg.command) {
			case StatusBarCommand.CopyRemoteCommitUrl:
				tooltip = 'Click to Copy Remote Commit Url';
				break;
			case StatusBarCommand.CopyRemoteFileUrl:
				this._statusBarBlame.command = Commands.CopyRemoteFileUrl;
				tooltip = 'Click to Copy Remote File Revision Url';
				break;
			case StatusBarCommand.DiffWithPrevious:
				this._statusBarBlame.command = Commands.DiffLineWithPrevious;
				tooltip = 'Click to Open Line Changes with Previous Revision';
				break;
			case StatusBarCommand.DiffWithWorking:
				this._statusBarBlame.command = Commands.DiffLineWithWorking;
				tooltip = 'Click to Open Line Changes with Working File';
				break;
			case StatusBarCommand.OpenCommitOnRemote:
				tooltip = 'Click to Open Commit on Remote';
				break;
			case StatusBarCommand.OpenFileOnRemote:
				tooltip = 'Click to Open Revision on Remote';
				break;
			case StatusBarCommand.RevealCommitInView:
				tooltip = 'Click to Reveal Commit in the Side Bar';
				break;
			case StatusBarCommand.ShowCommitsInView:
				tooltip = 'Click to Search for Commit';
				break;
			case StatusBarCommand.ShowQuickCommitDetails:
				tooltip = 'Click to Show Commit';
				break;
			case StatusBarCommand.ShowQuickCommitFileDetails:
				tooltip = 'Click to Show Commit (file)';
				break;
			case StatusBarCommand.ShowQuickCurrentBranchHistory:
				tooltip = 'Click to Show Branch History';
				break;
			case StatusBarCommand.ShowQuickFileHistory:
				tooltip = 'Click to Show File History';
				break;
			case StatusBarCommand.ToggleCodeLens:
				tooltip = 'Click to Toggle Git CodeLens';
				break;
			case StatusBarCommand.ToggleFileBlame:
				tooltip = 'Click to Toggle File Blame';
				break;
			case StatusBarCommand.ToggleFileChanges: {
				this._statusBarBlame.command = command<[Uri, ToggleFileChangesAnnotationCommandArgs]>({
					title: 'Toggle File Changes',
					command: Commands.ToggleFileChanges,
					arguments: [
						commit.uri,
						{
							type: FileAnnotationType.Changes,
							context: { sha: commit.sha, only: false, selection: false },
						},
					],
				});
				tooltip = 'Click to Toggle File Changes';
				break;
			}
			case StatusBarCommand.ToggleFileChangesOnly: {
				this._statusBarBlame.command = command<[Uri, ToggleFileChangesAnnotationCommandArgs]>({
					title: 'Toggle File Changes',
					command: Commands.ToggleFileChanges,
					arguments: [
						commit.uri,
						{
							type: FileAnnotationType.Changes,
							context: { sha: commit.sha, only: true, selection: false },
						},
					],
				});
				tooltip = 'Click to Toggle File Changes';
				break;
			}
			case StatusBarCommand.ToggleFileHeatmap:
				tooltip = 'Click to Toggle File Heatmap';
				break;
		}

		this._statusBarBlame.tooltip = tooltip;

		clearTimeout(this._tooltipDelayTimer);
		this._tooltipCancellation?.cancel();

		this._tooltipDelayTimer = setTimeout(() => {
			this._tooltipCancellation = new CancellationTokenSource();

			void this.updateCommitTooltip(
				this._statusBarBlame!,
				commit,
				tooltip,
				getBranchAndTagTips,
				{
					enabled: showPullRequests || pr != null,
					pr: pr,
				},
				this._tooltipCancellation.token,
			);
		}, 500);

		this._statusBarBlame.show();
	}

	private async getPullRequest(
		commit: GitBlameCommit,
		{ timeout }: { timeout?: number } = {},
	): Promise<PullRequest | Promises.CancellationError<Promise<PullRequest | undefined>> | undefined> {
		const remote = await this.container.git.getRichRemoteProvider(commit.repoPath);
		if (remote?.provider == null) return undefined;

		const { provider } = remote;
		try {
			return await this.container.git.getPullRequestForCommit(commit.ref, provider, { timeout: timeout });
		} catch (ex) {
			return ex instanceof Promises.CancellationError ? ex : undefined;
		}
	}

	private async updateCommitTooltip(
		statusBarItem: StatusBarItem,
		commit: GitBlameCommit,
		actionTooltip: string,
		getBranchAndTagTips:
			| ((
					sha: string,
					options?: { compact?: boolean | undefined; icons?: boolean | undefined } | undefined,
			  ) => string | undefined)
			| undefined,
		pullRequests: {
			enabled: boolean;
			pr: PullRequest | Promises.CancellationError<Promise<PullRequest | undefined>> | undefined | undefined;
		},
		cancellationToken: CancellationToken,
	) {
		if (cancellationToken.isCancellationRequested) return;

		const tooltip = await Hovers.detailsMessage(
			commit,
			commit.toGitUri(),
			commit.lines[0].line,
			this.container.config.statusBar.tooltipFormat,
			this.container.config.defaultDateFormat,
			{
				autolinks: true,
				cancellationToken: cancellationToken,
				getBranchAndTagTips: getBranchAndTagTips,
				pullRequests: pullRequests,
			},
		);

		if (cancellationToken.isCancellationRequested) return;

		tooltip.appendMarkdown(`\n\n---\n\n${actionTooltip}`);
		statusBarItem.tooltip = tooltip;
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

		void this.updateBlame(editor, commit, { pr: pr ?? null });
	}
}
