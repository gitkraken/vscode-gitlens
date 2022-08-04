import { Uri, window } from 'vscode';
import type {
	DiffWithPreviousCommandArgs,
	DiffWithWorkingCommandArgs,
	OpenFileOnRemoteCommandArgs,
} from '../../commands';
import { executeGitCommand } from '../../commands/gitCommands.actions';
import { Commands, CoreCommands } from '../../constants';
import type { Container } from '../../container';
import { GitUri } from '../../git/gitUri';
import { GitCommit, GitFile, IssueOrPullRequest } from '../../git/models';
import { executeCommand, executeCoreCommand } from '../../system/command';
import { debug } from '../../system/decorators/log';
import { IpcMessage, onIpc } from '../protocol';
import { WebviewViewBase } from '../webviewViewBase';
import {
	AutolinkSettingsCommandType,
	CommitActionsCommandType,
	CommitDetails,
	CommitSummary,
	FileComparePreviousCommandType,
	FileCompareWorkingCommandType,
	FileMoreActionsCommandType,
	FileParams,
	OpenFileCommandType,
	OpenFileOnRemoteCommandType,
	PickCommitCommandType,
	RichCommitDetails,
	RichContentNotificationType,
	State,
} from './protocol';

export class CommitDetailsWebviewView extends WebviewViewBase<State> {
	private originalTitle?: string;
	private commits?: GitCommit[];
	private selectedCommit?: GitCommit;
	private loadedOnce = false;

	constructor(container: Container) {
		super(container, 'gitlens.views.commitDetails', 'commitDetails.html', 'Commit Details');
		this.originalTitle = this.title;
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
				onIpc(CommitActionsCommandType, e, _params => {
					this.showCommitActions();
				});
				break;
			case PickCommitCommandType.method:
				onIpc(PickCommitCommandType, e, _params => {
					this.showCommitPicker();
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

	private showCommitPicker() {
		void executeGitCommand({ command: 'log', state: { openPickInView: true } });
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
		const pullRequest = selected != null ? await selected.getAssociatedPullRequest() : undefined;
		console.log('CommitDetailsWebview pullRequest', pullRequest);

		const issues: Record<string, any>[] = [];
		let formattedMessage;
		if (selected?.message !== undefined && typeof selected.message === 'string') {
			const remote = await this.container.git.getBestRemoteWithRichProvider(selected.repoPath);
			console.log('CommitDetailsWebview remote', remote);

			if (remote != null) {
				const issueSearch = await this.container.autolinks.getLinkedIssuesAndPullRequests(
					selected.message,
					remote,
				);
				// TODO: add HTML formatting option to linkify
				// formattedMessage = this.container.autolinks.linkify(
				// 	escapeMarkdown(selected.message, { quoted: true }),
				// 	true,
				// 	[remote],
				// 	// issueSearch,
				// );
				formattedMessage = this.container.autolinks.linkify(
					encodeMarkup(selected.message),
					true,
					[remote],
					// issueSearch,
				);

				let filteredIssues;
				if (issueSearch != null) {
					if (pullRequest !== undefined) {
						issueSearch.delete(pullRequest.id);
					}

					filteredIssues = Array.from(issueSearch.values()).filter(
						value => value != null,
					) as IssueOrPullRequest[];
				}

				console.log('CommitDetailsWebview filteredIssues', filteredIssues);

				if (filteredIssues !== undefined) {
					issues.push(...filteredIssues);
				}
			}
		}

		return {
			formattedMessage: formattedMessage,
			pullRequest: pullRequest,
			issues: issues?.length ? issues : undefined,
		};
	}

	private selectCommit(commit: GitCommit) {
		this.commits = [commit];
		this.selectedCommit = commit;
		this.title = `${this.originalTitle}${
			this.selectedCommit !== undefined ? `: ${this.selectedCommit.shortSha}` : ''
		}`;
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
