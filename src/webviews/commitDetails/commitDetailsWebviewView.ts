import { env, Uri, window } from 'vscode';
import type {
	DiffWithPreviousCommandArgs,
	DiffWithWorkingCommandArgs,
	OpenFileOnRemoteCommandArgs,
} from '../../commands';
import { executeGitCommand } from '../../commands/gitCommands.actions';
import { Commands, CoreCommands } from '../../constants';
import type { Container } from '../../container';
import { GitUri } from '../../git/gitUri';
import type { GitCommit } from '../../git/models/commit';
import { GitFile } from '../../git/models/file';
import { executeCommand, executeCoreCommand } from '../../system/command';
import { debug } from '../../system/decorators/log';
import { getSettledValue } from '../../system/promise';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import { WebviewViewBase } from '../webviewViewBase';
import type { CommitDetails, CommitSummary, FileParams, RichCommitDetails, State } from './protocol';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	FileComparePreviousCommandType,
	FileCompareWorkingCommandType,
	FileMoreActionsCommandType,
	OpenFileCommandType,
	OpenFileOnRemoteCommandType,
	PickCommitCommandType,
	RichContentNotificationType,
	SearchCommitCommandType,
} from './protocol';

export class CommitDetailsWebviewView extends WebviewViewBase<State> {
	private commits?: GitCommit[];
	private selectedCommit?: GitCommit;
	private loadedOnce = false;

	constructor(container: Container) {
		super(container, 'gitlens.views.commitDetails', 'commitDetails.html', 'Commit Details');
	}

	override async show(options?: { commit?: GitCommit; preserveFocus?: boolean | undefined }): Promise<void> {
		if (options?.commit != null) {
			this.selectCommit(options.commit);
			void this.refresh();
		}

		return super.show(options != null ? { preserveFocus: options.preserveFocus } : undefined);
	}

	protected override onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case OpenFileOnRemoteCommandType.method:
				onIpc(OpenFileOnRemoteCommandType, e, params => {
					this.openFileOnRemote(params);
				});
				break;
			case OpenFileCommandType.method:
				onIpc(OpenFileCommandType, e, params => {
					this.openFile(params);
				});
				break;
			case FileCompareWorkingCommandType.method:
				onIpc(FileCompareWorkingCommandType, e, params => {
					this.openFileComparisonWithWorking(params);
				});
				break;
			case FileComparePreviousCommandType.method:
				onIpc(FileComparePreviousCommandType, e, params => {
					this.openFileComparisonWithPrevious(params);
				});
				break;
			case FileMoreActionsCommandType.method:
				onIpc(FileMoreActionsCommandType, e, params => {
					this.showFileActions(params);
				});
				break;
			case CommitActionsCommandType.method:
				onIpc(CommitActionsCommandType, e, params => {
					switch (params.action) {
						case 'more':
							this.showCommitActions();
							break;
						case 'sha':
							if (params.alt) {
								this.showCommitPicker();
							} else if (this.selectedCommit != null) {
								void env.clipboard.writeText(this.selectedCommit.sha);
							}
							break;
					}
				});
				break;
			case PickCommitCommandType.method:
				onIpc(PickCommitCommandType, e, _params => {
					this.showCommitPicker();
				});
				break;
			case SearchCommitCommandType.method:
				onIpc(SearchCommitCommandType, e, _params => {
					this.showCommitSearch();
				});
				break;
			case AutolinkSettingsCommandType.method:
				onIpc(AutolinkSettingsCommandType, e, _params => {
					this.showAutolinkSettings();
				});
				break;
		}
	}

	private getFileFromParams(params: FileParams): GitFile | undefined {
		return this.selectedCommit?.files?.find(file => file.path === params.path && file.repoPath === params.repoPath);
	}

	private showAutolinkSettings() {
		void executeCommand(Commands.ShowSettingsPageAndJumpToAutolinks);
	}

	private showCommitSearch() {
		void executeGitCommand({ command: 'search', state: { openPickInView: true } });
	}

	private showCommitPicker() {
		void executeGitCommand({
			command: 'log',
			state: {
				reference: 'HEAD',
				repo: this.selectedCommit?.repoPath,
				openPickInView: true,
			},
		});
	}

	private showCommitActions() {
		if (this.selectedCommit === undefined) {
			return;
		}

		void executeCommand(Commands.ShowQuickCommit, {
			commit: this.selectedCommit,
		});
	}

	private showFileActions(params: FileParams) {
		const file = this.getFileFromParams(params);
		if (this.selectedCommit === undefined || file === undefined) {
			return;
		}

		const uri = GitUri.fromFile(file, this.selectedCommit.repoPath, this.selectedCommit.sha);
		void executeCommand(Commands.ShowQuickCommitFile, uri, {
			sha: this.selectedCommit.sha,
		});
	}

	private openFileComparisonWithWorking(params: FileParams) {
		const file = this.getFileFromParams(params);
		if (this.selectedCommit === undefined || file === undefined) {
			return;
		}

		const uri = GitUri.fromFile(file, this.selectedCommit.repoPath, this.selectedCommit.sha);
		void executeCommand<[Uri, DiffWithWorkingCommandArgs]>(Commands.DiffWithWorking, uri, {
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		});
	}

	private openFileComparisonWithPrevious(params: FileParams) {
		const file = this.getFileFromParams(params);
		if (this.selectedCommit === undefined || file === undefined) {
			return;
		}

		const uri = GitUri.fromFile(file, this.selectedCommit.repoPath, this.selectedCommit.sha);
		const line = this.selectedCommit.lines.length ? this.selectedCommit.lines[0].line - 1 : 0;
		void executeCommand<[Uri, DiffWithPreviousCommandArgs]>(Commands.DiffWithPrevious, uri, {
			commit: this.selectedCommit,
			line: line,
			showOptions: {
				preserveFocus: true,
				preview: true,
				...params.showOptions,
			},
		});
	}

	private openFile(params: FileParams) {
		const file = this.getFileFromParams(params);
		if (this.selectedCommit === undefined || file === undefined) {
			return;
		}

		const uri = GitUri.fromFile(file, this.selectedCommit.repoPath, this.selectedCommit.sha);
		void executeCoreCommand(CoreCommands.Open, uri, { background: false, preview: false });
	}

	private openFileOnRemote(params: FileParams) {
		const file = this.getFileFromParams(params);
		if (this.selectedCommit === undefined || file === undefined) {
			return;
		}

		const uri = GitUri.fromFile(file, this.selectedCommit.repoPath, this.selectedCommit.sha);

		void executeCommand<[Uri, OpenFileOnRemoteCommandArgs]>(Commands.OpenFileOnRemote, uri, {
			sha: this.selectedCommit?.sha,
		});
	}

	private copyRemoteFileUrl() {}

	private async getRichContent(selected: GitCommit): Promise<RichCommitDetails> {
		const remotes = await this.container.git.getRemotesWithProviders(selected.repoPath, { sort: true });
		const remote = await this.container.git.getBestRemoteWithRichProvider(remotes);

		if (selected.message == null) {
			await selected.ensureFullDetails();
		}

		let autolinkedIssuesOrPullRequests;
		let pr;

		if (remote?.provider != null) {
			const [autolinkedIssuesOrPullRequestsResult, prResult] = await Promise.allSettled([
				this.container.autolinks.getLinkedIssuesAndPullRequests(selected.message ?? selected.summary, remote),
				selected.getAssociatedPullRequest({ remote: remote }),
			]);

			autolinkedIssuesOrPullRequests = getSettledValue(autolinkedIssuesOrPullRequestsResult);
			pr = getSettledValue(prResult);
		}

		// TODO: add HTML formatting option to linkify
		const formattedMessage = this.container.autolinks.linkify(
			encodeMarkup(selected.message!),
			true,
			remote != null ? [remote] : undefined,
			autolinkedIssuesOrPullRequests,
		);

		// Remove possible duplicate pull request
		if (pr != null) {
			autolinkedIssuesOrPullRequests?.delete(pr.id);
		}

		return {
			formattedMessage: formattedMessage,
			pullRequest: pr,
			issues:
				autolinkedIssuesOrPullRequests != null
					? [...autolinkedIssuesOrPullRequests.values()].filter(<T>(i: T | undefined): i is T => i != null)
					: undefined,
		};
	}

	private selectCommit(commit: GitCommit) {
		this.commits = [commit];
		this.selectedCommit = commit;
	}

	@debug({ args: false })
	protected async getState(includeRichContent = true): Promise<State | undefined> {
		if (this.commits === undefined) {
			return;
		}
		console.log('CommitDetailsWebview selected', this.selectedCommit);

		let richContent;
		let formattedCommit;
		if (this.selectedCommit !== undefined) {
			if (includeRichContent) {
				richContent = await this.getRichContent(this.selectedCommit);
			}
			formattedCommit = await this.getDetailsModel(this.selectedCommit, richContent?.formattedMessage);
		}

		const commitChoices = await Promise.all(this.commits.map(async commit => summaryModel(commit)));

		return {
			includeRichContent: includeRichContent,
			commits: commitChoices,
			selected: formattedCommit,
			pullRequest: richContent?.pullRequest,
			issues: richContent?.issues,
		};
	}

	protected override async includeBootstrap() {
		return window.withProgress({ location: { viewId: this.id } }, async () => {
			const state = await this.getState(this.loadedOnce);
			if (state === undefined) {
				return {};
			}

			if (this.loadedOnce === false) {
				void this.updateRichContent();
				this.loadedOnce = true;
			}

			return state;
		});
	}

	private async updateRichContent() {
		if (this.selectedCommit === undefined) {
			return;
		}

		const richContent = await this.getRichContent(this.selectedCommit);
		if (richContent != null) {
			void this.notify(RichContentNotificationType, richContent);
		}
	}

	private async getDetailsModel(commit: GitCommit, formattedMessage?: string): Promise<CommitDetails | undefined> {
		if (commit === undefined) {
			return;
		}

		const authorAvatar = await commit.author?.getAvatarUri(commit);
		// const committerAvatar = await commit.committer?.getAvatarUri(commit);

		return {
			sha: commit.sha,
			shortSha: commit.shortSha,
			summary: commit.summary,
			message: formattedMessage ?? encodeMarkup(commit.message ?? ''),
			author: { ...commit.author, avatar: authorAvatar?.toString(true) },
			// committer: { ...commit.committer, avatar: committerAvatar?.toString(true) },
			files: commit.files?.map(({ repoPath, path, status }) => {
				const icon = GitFile.getStatusIcon(status);
				return {
					repoPath: repoPath,
					path: path,
					status: status,
					icon: {
						dark: this._view!.webview.asWebviewUri(
							Uri.joinPath(this.container.context.extensionUri, 'images', 'dark', icon),
						).toString(),
						light: this._view!.webview.asWebviewUri(
							Uri.joinPath(this.container.context.extensionUri, 'images', 'light', icon),
						).toString(),
					},
				};
			}),
			stats: commit.stats,
		};
	}
}

async function summaryModel(commit: GitCommit): Promise<CommitSummary> {
	return {
		sha: commit.sha,
		shortSha: commit.shortSha,
		summary: commit.summary,
		message: commit.message,
		author: commit.author,
		avatar: (await commit.getAvatarUri())?.toString(true),
	};
}

function encodeMarkup(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
