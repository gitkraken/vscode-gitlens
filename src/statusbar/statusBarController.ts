import type { CancellationToken, ConfigurationChangeEvent, StatusBarItem, TextEditor, Uri } from 'vscode';
import { CancellationTokenSource, Disposable, MarkdownString, StatusBarAlignment, window } from 'vscode';
import type { ToggleFileChangesAnnotationCommandArgs } from '../commands/toggleFileAnnotations';
import { FileAnnotationType, StatusBarCommand } from '../config';
import { Commands, GlyphChars } from '../constants';
import type { Container } from '../container';
import { CommitFormatter } from '../git/formatters/commitFormatter';
import type { GitCommit } from '../git/models/commit';
import type { PullRequest } from '../git/models/pullRequest';
import { detailsMessage } from '../hovers/hovers';
import { asCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { debug } from '../system/decorators/log';
import { once } from '../system/event';
import { Logger } from '../system/logger';
import type { LogScope } from '../system/logger.scope';
import { getLogScope } from '../system/logger.scope';
import { PromiseCancelledError } from '../system/promise';
import { isTextEditor } from '../system/utils';
import type { LinesChangeEvent } from '../trackers/gitLineTracker';

export class StatusBarController implements Disposable {
	private _pullRequestCancellation: CancellationTokenSource | undefined;
	private _tooltipCancellation: CancellationTokenSource | undefined;
	private _tooltipDelayTimer: ReturnType<typeof setTimeout> | undefined;

	private readonly _disposable: Disposable;
	private _statusBarBlame: StatusBarItem | undefined;
	private _statusBarMode: StatusBarItem | undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
	}

	dispose() {
		this.clearBlame();

		this._statusBarBlame?.dispose();
		this._statusBarMode?.dispose();

		this.container.lineTracker.unsubscribe(this);
		this._disposable.dispose();
	}

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'mode')) {
			const mode = configuration.get('mode.statusBar.enabled') ? this.container.mode : undefined;
			if (mode?.statusBarItemName) {
				const alignment =
					configuration.get('mode.statusBar.alignment') !== 'left'
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
					`**${mode.statusBarItemName}** ${GlyphChars.Dash} ${mode.description}\n\n---\n\nClick to Switch GitLens Modes`,
					true,
				);
				this._statusBarMode.accessibilityInformation = {
					label: `GitLens Mode: ${mode.statusBarItemName}\nClick to Switch GitLens Modes`,
				};
				this._statusBarMode.show();
			} else {
				this._statusBarMode?.dispose();
				this._statusBarMode = undefined;
			}
		}

		if (!configuration.changed(e, 'statusBar')) return;

		if (configuration.get('statusBar.enabled')) {
			const alignment =
				configuration.get('statusBar.alignment') !== 'left'
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
			this._statusBarBlame.command = configuration.get('statusBar.command');

			if (configuration.changed(e, 'statusBar.enabled')) {
				this.container.lineTracker.subscribe(
					this,
					this.container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this),
				);
			}
		} else if (configuration.changed(e, 'statusBar.enabled')) {
			this.container.lineTracker.unsubscribe(this);

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
			configuration.get('statusBar.reduceFlicker') &&
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
			this._statusBarBlame.text = this._statusBarBlame.text.replace('$(git-commit)', '$(watch)');
		}
	}

	clearBlame() {
		this._pullRequestCancellation?.cancel();
		this._tooltipCancellation?.cancel();
		this._statusBarBlame?.hide();
	}

	@debug({ args: false })
	private async updateBlame(editor: TextEditor, commit: GitCommit, options?: { pr?: PullRequest | null }) {
		const cfg = configuration.get('statusBar');
		if (!cfg.enabled || this._statusBarBlame == null || !isTextEditor(editor)) return;

		const scope = getLogScope();

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
			void this.waitForPendingPullRequest(
				editor,
				commit,
				pr,
				this._pullRequestCancellation.token,
				timeout,
				scope,
			);
		}

		this._statusBarBlame.text = `$(git-commit) ${CommitFormatter.fromTemplate(cfg.format, commit, {
			dateFormat: cfg.dateFormat === null ? configuration.get('defaultDateFormat') : cfg.dateFormat,
			getBranchAndTagTips: getBranchAndTagTips,
			messageTruncateAtNewLine: true,
			pullRequestOrRemote: pr,
			pullRequestPendingMessage: 'PR $(watch)',
		})}`;

		let tooltip: string;
		switch (cfg.command) {
			case StatusBarCommand.CopyRemoteCommitUrl:
				tooltip = 'Click to Copy Remote Commit URL';
				break;
			case StatusBarCommand.CopyRemoteFileUrl:
				this._statusBarBlame.command = Commands.CopyRemoteFileUrl;
				tooltip = 'Click to Copy Remote File Revision URL';
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
				if (commit.file != null) {
					this._statusBarBlame.command = asCommand<[Uri, ToggleFileChangesAnnotationCommandArgs]>({
						title: 'Toggle File Changes',
						command: Commands.ToggleFileChanges,
						arguments: [
							commit.file.uri,
							{
								type: FileAnnotationType.Changes,
								context: { sha: commit.sha, only: false, selection: false },
							},
						],
					});
				}
				tooltip = 'Click to Toggle File Changes';
				break;
			}
			case StatusBarCommand.ToggleFileChangesOnly: {
				if (commit.file != null) {
					this._statusBarBlame.command = asCommand<[Uri, ToggleFileChangesAnnotationCommandArgs]>({
						title: 'Toggle File Changes',
						command: Commands.ToggleFileChanges,
						arguments: [
							commit.file.uri,
							{
								type: FileAnnotationType.Changes,
								context: { sha: commit.sha, only: true, selection: false },
							},
						],
					});
				}
				tooltip = 'Click to Toggle File Changes';
				break;
			}
			case StatusBarCommand.ToggleFileHeatmap:
				tooltip = 'Click to Toggle File Heatmap';
				break;
		}

		this._statusBarBlame.tooltip = tooltip;
		this._statusBarBlame.accessibilityInformation = {
			label: `${this._statusBarBlame.text}\n${tooltip}`,
		};

		if (this._tooltipDelayTimer != null) {
			clearTimeout(this._tooltipDelayTimer);
		}
		this._tooltipCancellation?.cancel();

		this._tooltipDelayTimer = setTimeout(() => {
			this._tooltipDelayTimer = undefined;
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
		commit: GitCommit,
		{ timeout }: { timeout?: number } = {},
	): Promise<PullRequest | PromiseCancelledError<Promise<PullRequest | undefined>> | undefined> {
		const remote = await this.container.git.getBestRemoteWithRichProvider(commit.repoPath);
		if (remote?.provider == null) return undefined;

		const { provider } = remote;
		try {
			return await this.container.git.getPullRequestForCommit(commit.ref, provider, { timeout: timeout });
		} catch (ex) {
			return ex instanceof PromiseCancelledError ? ex : undefined;
		}
	}

	private async updateCommitTooltip(
		statusBarItem: StatusBarItem,
		commit: GitCommit,
		actionTooltip: string,
		getBranchAndTagTips:
			| ((
					sha: string,
					options?: { compact?: boolean | undefined; icons?: boolean | undefined } | undefined,
			  ) => string | undefined)
			| undefined,
		pullRequests: {
			enabled: boolean;
			pr: PullRequest | PromiseCancelledError<Promise<PullRequest | undefined>> | undefined | undefined;
		},
		cancellationToken: CancellationToken,
	) {
		if (cancellationToken.isCancellationRequested) return;

		const tooltip = await detailsMessage(
			commit,
			commit.getGitUri(),
			commit.lines[0].line,
			configuration.get('statusBar.tooltipFormat'),
			configuration.get('defaultDateFormat'),
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
		statusBarItem.accessibilityInformation = {
			label: `${statusBarItem.text}\n${actionTooltip}`,
		};
	}

	private async waitForPendingPullRequest(
		editor: TextEditor,
		commit: GitCommit,
		pr: PullRequest | PromiseCancelledError<Promise<PullRequest | undefined>> | undefined,
		cancellationToken: CancellationToken,
		timeout: number,
		scope: LogScope | undefined,
	) {
		if (cancellationToken.isCancellationRequested || !(pr instanceof PromiseCancelledError)) return;

		// If the PR timed out, refresh the status bar once it completes
		Logger.debug(scope, `${GlyphChars.Dot} pull request query took too long (over ${timeout} ms)`);

		pr = await pr.promise;

		if (cancellationToken.isCancellationRequested) return;

		Logger.debug(scope, `${GlyphChars.Dot} pull request query completed; refreshing...`);

		void this.updateBlame(editor, commit, { pr: pr ?? null });
	}
}
