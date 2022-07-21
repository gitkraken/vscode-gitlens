import { ProgressLocation, window } from 'vscode';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { GitCommit, GitRemote, IssueOrPullRequest } from '../../git/models';
import { RichRemoteProvider } from '../../git/remotes/provider';
import { debug } from '../../system/decorators/log';
import { WebviewBase } from '../webviewBase';
import type { CommitDetails, CommitSummary, ShowCommitDetailsPageCommandArgs, State } from './protocol';

export class CommitDetailsWebview extends WebviewBase<State> {
	private shaList: string[] = [
		'7224b547bbaa3a643e89ceb515dfb7cbad83aa26',
		'f55b2ad418a05a51c381c667e5e87d0435883cfc',
	];
	private selectedSha: string | undefined = 'f55b2ad418a05a51c381c667e5e87d0435883cfc';

	constructor(container: Container) {
		super(
			container,
			'gitlens.commitDetails',
			'commitDetails.html',
			'images/gitlens-icon.png',
			'Commit Details',
			Commands.ShowCommitDetailsPage,
		);
	}

	private updateShaList(refs?: string[]) {
		let refsList;
		if (refs?.length && refs.length > 0) {
			refsList = refs;
		} else {
			// TODO: replace with quick pick for a commit
			refsList = ['7224b547bbaa3a643e89ceb515dfb7cbad83aa26', 'f55b2ad418a05a51c381c667e5e87d0435883cfc'];
		}

		this.shaList = refsList;

		if (this.selectedSha && !this.shaList.includes(this.selectedSha)) {
			// TODO: maybe make a quick pick for the list of commits?
			this.selectedSha = this.shaList[0];
		}
	}

	protected override onShowCommand(refs?: ShowCommitDetailsPageCommandArgs): void {
		// TODO: get args from command
		this.updateShaList(refs);

		super.onShowCommand();
	}

	private async getLinkedIssuesAndPullRequests(
		message: string,
		remote: GitRemote<RichRemoteProvider>,
	): Promise<IssueOrPullRequest[] | undefined> {
		try {
			const issueSearch = await this.container.autolinks.getLinkedIssuesAndPullRequests(message, remote);
			console.log('CommitDetailsWebview getLinkedIssuesAndPullRequests', issueSearch);

			if (issueSearch != null) {
				const filteredIssues = Array.from(issueSearch.values()).filter(
					value => value != null,
				) as IssueOrPullRequest[];
				return filteredIssues;
			}

			return undefined;
		} catch (e) {
			console.error(e);
			return undefined;
		}
	}

	private async getRichContent(selected: GitCommit): Promise<Record<string, any>> {
		const pullRequest = selected != null ? await selected.getAssociatedPullRequest() : undefined;
		console.log('CommitDetailsWebview pullRequest', pullRequest);

		const issues: Record<string, any>[] = [];
		let formattedMessage;
		if (selected?.message !== undefined && typeof selected.message === 'string') {
			const remote = await this.container.git.getBestRemoteWithRichProvider(selected.repoPath);
			console.log('CommitDetailsWebview remote', remote);

			if (remote != null) {
				formattedMessage = this.container.autolinks.linkify(selected.message, true, [remote]);
				const issueSearch = await this.getLinkedIssuesAndPullRequests(selected.message, remote);

				console.log('CommitDetailsWebview issueSearch', issueSearch);

				if (issueSearch !== undefined) {
					issues.push(...issueSearch);
				}
			}
		}

		return {
			formattedMessage: formattedMessage,
			pullRequest: pullRequest,
			issues: issues?.length ? issues : undefined,
		};
	}

	@debug({ args: false })
	protected async getState(init = false): Promise<State> {
		const repo = this.container.git.openRepositories?.[0];

		console.log('CommitDetailsWebview repo', repo);
		if (repo === undefined) {
			return {
				commits: [],
			};
		}

		const commitPromises = this.shaList.map(sha => repo.getCommit(sha));

		const results = await Promise.all(commitPromises);

		console.log('CommitDetailsWebview results', results);
		const commits = results.filter(commit => commit !== undefined) as GitCommit[];
		const selected = commits.find(commit => commit.sha === this.selectedSha);
		console.log('CommitDetailsWebview selected', selected);

		// const pullRequest = selected != null ? await selected.getAssociatedPullRequest() : undefined;
		// console.log('CommitDetailsWebview pullRequest', pullRequest);

		// const issues: Record<string, any>[] = [];
		// let formattedMessage;
		// if (selected?.message !== undefined && typeof selected.message === 'string') {
		// 	const remote = await this.container.git.getBestRemoteWithRichProvider(selected.repoPath);
		// 	console.log('CommitDetailsWebview remote', remote);

		// 	if (remote != null) {
		// 		formattedMessage = this.container.autolinks.linkify(selected.message, true, [remote]);
		// 		const issueSearch = await this.getLinkedIssuesAndPullRequests(selected.message, remote);

		// 		console.log('CommitDetailsWebview issueSearch', issueSearch);

		// 		if (issueSearch !== undefined) {
		// 			issues.push(...issueSearch);
		// 		}
		// 	}
		// }

		const richContent = !init && selected != null ? await this.getRichContent(selected) : undefined;

		let formattedCommit;
		if (selected !== undefined) {
			formattedCommit = await getDetailsModel(selected, richContent?.formattedMessage);
		}

		const commitChoices = await Promise.all(commits.map(async commit => summaryModel(commit)));

		return {
			// TODO: keep state of the selected commit
			commits: commitChoices,
			selected: formattedCommit,
			pullRequest: richContent?.pullRequest,
			issues: richContent?.issues,
		};
	}

	protected override async includeBootstrap() {
		return window.withProgress({ location: ProgressLocation.Window, title: 'Loading webview...' }, () =>
			this.getState(true),
		);
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

async function getDetailsModel(commit: GitCommit, formattedMessage?: string): Promise<CommitDetails | undefined> {
	if (commit === undefined) {
		return;
	}

	const authorAvatar = await commit.author?.getAvatarUri(commit);
	const committerAvatar = await commit.committer?.getAvatarUri(commit);

	return {
		sha: commit.sha,
		shortSha: commit.shortSha,
		summary: commit.summary,
		message: formattedMessage ?? commit.message,
		author: { ...commit.author, avatar: authorAvatar?.toString(true) },
		committer: { ...commit.committer, avatar: committerAvatar?.toString(true) },
		files: commit.files?.map(({ repoPath, path, status }) => ({ repoPath: repoPath, path: path, status: status })),
		stats: commit.stats,
	};
}
