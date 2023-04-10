import { Disposable, Uri, window } from 'vscode';
import type { GHPRPullRequest } from '../../../commands';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import { PlusFeatures } from '../../../features';
import { add as addRemote } from '../../../git/actions/remote';
import * as RepoActions from '../../../git/actions/repository';
import type { GitBranch } from '../../../git/models/branch';
import { getLocalBranchByNameOrUpstream } from '../../../git/models/branch';
import type { SearchedIssue } from '../../../git/models/issue';
import { serializeIssue } from '../../../git/models/issue';
import type { PullRequestShape, SearchedPullRequest } from '../../../git/models/pullRequest';
import {
	PullRequestMergeableState,
	PullRequestReviewDecision,
	serializePullRequest,
} from '../../../git/models/pullRequest';
import { createReference } from '../../../git/models/reference';
import type { GitRemote } from '../../../git/models/remote';
import type { Repository, RepositoryChangeEvent } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { getWorktreeForBranch } from '../../../git/models/worktree';
import { parseGitRemoteUrl } from '../../../git/parsers/remoteParser';
import type { RichRemoteProvider } from '../../../git/remotes/richRemoteProvider';
import type { Subscription } from '../../../subscription';
import { SubscriptionState } from '../../../subscription';
import { executeCommand, registerCommand } from '../../../system/command';
import { setContext } from '../../../system/context';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import type { OpenWorktreeParams, State, SwitchToBranchParams } from './protocol';
import {
	DidChangeStateNotificationType,
	DidChangeSubscriptionNotificationType,
	OpenWorktreeCommandType,
	SwitchToBranchCommandType,
} from './protocol';

interface RepoWithRichRemote {
	repo: Repository;
	remote: GitRemote<RichRemoteProvider>;
	isConnected: boolean;
	isGitHub: boolean;
}

interface SearchedPullRequestWithRemote extends SearchedPullRequest {
	repoAndRemote: RepoWithRichRemote;
	branch?: GitBranch;
	hasLocalBranch?: boolean;
	isCurrentBranch?: boolean;
	hasWorktree?: boolean;
	isCurrentWorktree?: boolean;
}

export class FocusWebviewProvider implements WebviewProvider<State> {
	private _bootstrapping = true;
	private _pullRequests: SearchedPullRequestWithRemote[] = [];
	private _issues: SearchedIssue[] = [];
	private readonly _disposable: Disposable;
	private _etagSubscription?: number;
	private _repositoryEventsDisposable?: Disposable;
	private _repos?: RepoWithRichRemote[];

	constructor(private readonly container: Container, private readonly host: WebviewController<State>) {
		this._disposable = Disposable.from(
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this.container.git.onDidChangeRepositories(() => void this.host.refresh(true)),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	registerCommands(): Disposable[] {
		return [registerCommand(Commands.RefreshFocus, () => this.host.refresh(true))];
	}

	onFocusChanged(focused: boolean): void {
		if (focused) {
			// If we are becoming focused, delay it a bit to give the UI time to update
			setTimeout(() => void setContext('gitlens:focus:focused', focused), 0);

			return;
		}

		void setContext('gitlens:focus:focused', focused);
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case SwitchToBranchCommandType.method:
				onIpc(SwitchToBranchCommandType, e, params => this.onSwitchBranch(params));
				break;
			case OpenWorktreeCommandType.method:
				onIpc(OpenWorktreeCommandType, e, params => this.onOpenWorktree(params));
				break;
		}
	}

	private findSearchedPullRequest(pullRequest: PullRequestShape): SearchedPullRequestWithRemote | undefined {
		return this._pullRequests?.find(r => r.pullRequest.id === pullRequest.id);
	}

	private async getRemoteBranch(searchedPullRequest: SearchedPullRequestWithRemote) {
		const pullRequest = searchedPullRequest.pullRequest;
		const repoAndRemote = searchedPullRequest.repoAndRemote;
		const localUri = repoAndRemote.repo.folder!.uri;

		const repo = await repoAndRemote.repo.getMainRepository();
		if (repo == null) {
			void window.showWarningMessage(
				`Unable to find main repository(${localUri.toString()}) for PR #${pullRequest.id}`,
			);
			return;
		}

		const rootOwner = pullRequest.refs!.base.owner;
		const rootUri = Uri.parse(pullRequest.refs!.base.url);
		const ref = pullRequest.refs!.head.branch;
		const remoteUri = Uri.parse(pullRequest.refs!.head.url);
		const remoteUrl = remoteUri.toString();
		const [, remoteDomain, remotePath] = parseGitRemoteUrl(remoteUrl);

		let remote: GitRemote | undefined;
		[remote] = await repo.getRemotes({ filter: r => r.matches(remoteDomain, remotePath) });
		let remoteBranchName;
		if (remote != null) {
			remoteBranchName = `${remote.name}/${ref}`;
			// Ensure we have the latest from the remote
			await this.container.git.fetch(repo.path, { remote: remote.name });
		} else {
			const result = await window.showInformationMessage(
				`Unable to find a remote for '${remoteUrl}'. Would you like to add a new remote?`,
				{ modal: true },
				{ title: 'Yes' },
				{ title: 'No', isCloseAffordance: true },
			);
			if (result?.title !== 'Yes') return;

			const remoteOwner = pullRequest.refs!.head.owner;
			await addRemote(repo, remoteOwner, remoteUrl, {
				confirm: false,
				fetch: true,
				reveal: false,
			});
			[remote] = await repo.getRemotes({ filter: r => r.url === remoteUrl });
			if (remote == null) return;

			remoteBranchName = `${remote.name}/${ref}`;
			const rootRepository = pullRequest.refs!.base.repo;
			const localBranchName = `pr/${rootUri.toString() === remoteUri.toString() ? ref : remoteBranchName}`;
			// Save the PR number in the branch config
			// https://github.com/Microsoft/vscode-pull-request-github/blob/0c556c48c69a3df2f9cf9a45ed2c40909791b8ab/src/github/pullRequestGitHelper.ts#L18
			void this.container.git.setConfig(
				repo.path,
				`branch.${localBranchName}.github-pr-owner-number`,
				`${rootOwner}#${rootRepository}#${pullRequest.id}`,
			);
		}

		const reference = createReference(remoteBranchName, repo.path, {
			refType: 'branch',
			name: remoteBranchName,
			remote: true,
		});

		return {
			remote: remote,
			reference: reference,
		};
	}

	private async onSwitchBranch({ pullRequest }: SwitchToBranchParams) {
		const searchedPullRequestWithRemote = this.findSearchedPullRequest(pullRequest);
		if (searchedPullRequestWithRemote == null || searchedPullRequestWithRemote.isCurrentBranch) {
			return Promise.resolve();
		}

		if (searchedPullRequestWithRemote.branch != null) {
			return RepoActions.switchTo(
				searchedPullRequestWithRemote.branch.repoPath,
				searchedPullRequestWithRemote.branch,
			);
		}

		const remoteBranch = await this.getRemoteBranch(searchedPullRequestWithRemote);
		if (remoteBranch == null) return Promise.resolve();

		return RepoActions.switchTo(remoteBranch.remote.repoPath, remoteBranch.reference);
	}

	private async onOpenWorktree({ pullRequest }: OpenWorktreeParams) {
		const searchedPullRequestWithRemote = this.findSearchedPullRequest(pullRequest);
		if (searchedPullRequestWithRemote?.repoAndRemote == null) {
			return;
		}

		const baseUri = Uri.parse(pullRequest.refs!.base.url);
		const localInfo = searchedPullRequestWithRemote.repoAndRemote.repo.folder;
		return executeCommand<GHPRPullRequest>(Commands.OpenOrCreateWorktreeForGHPR, {
			base: {
				repositoryCloneUrl: {
					repositoryName: pullRequest.refs!.base.repo,
					owner: pullRequest.refs!.base.owner,
					url: baseUri,
				},
			},
			githubRepository: {
				rootUri: localInfo!.uri,
			},
			head: {
				ref: pullRequest.refs!.head.branch,
				sha: pullRequest.refs!.head.sha,
				repositoryCloneUrl: {
					repositoryName: pullRequest.refs!.head.repo,
					owner: pullRequest.refs!.head.owner,
					url: Uri.parse(pullRequest.refs!.head.url),
				},
			},
			item: {
				number: parseInt(pullRequest.id, 10),
			},
		});
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;

		const access = await this.container.git.access(PlusFeatures.Focus);
		const { subscription, isPlus } = await this.getSubscription(access.subscription.current);
		if (isPlus) {
			void this.notifyDidChangeState();
		}
		return this.host.notify(DidChangeSubscriptionNotificationType, {
			subscription: subscription,
			isPlus: isPlus,
		});
	}

	private async getSubscription(subscription?: Subscription) {
		const currentSubscription = subscription ?? (await this.container.subscription.getSubscription(true));
		const isPlus = ![
			SubscriptionState.Free,
			SubscriptionState.FreePreviewTrialExpired,
			SubscriptionState.FreePlusTrialExpired,
			SubscriptionState.VerificationRequired,
		].includes(currentSubscription.state);

		return {
			subscription: currentSubscription,
			isPlus: isPlus,
		};
	}

	private async getState(deferState = false): Promise<State> {
		const { subscription, isPlus } = await this.getSubscription();
		if (!isPlus) {
			return {
				isPlus: isPlus,
				subscription: subscription,
			};
		}

		const allRichRepos = await this.getRichRepos();
		const githubRepos = filterGithubRepos(allRichRepos);
		const connectedRepos = filterUsableRepos(githubRepos);
		const hasConnectedRepos = connectedRepos.length > 0;

		if (deferState || !hasConnectedRepos) {
			return {
				isPlus: isPlus,
				subscription: subscription,
				repos: (hasConnectedRepos ? connectedRepos : githubRepos).map(r => serializeRepoWithRichRemote(r)),
			};
		}

		const prs = await this.getMyPullRequests(connectedRepos);
		const serializedPrs = prs.map(pr => ({
			pullRequest: serializePullRequest(pr.pullRequest),
			reasons: pr.reasons,
			isCurrentBranch: pr.isCurrentBranch ?? false,
			isCurrentWorktree: pr.isCurrentWorktree ?? false,
			hasWorktree: pr.hasWorktree ?? false,
			hasLocalBranch: pr.hasLocalBranch ?? false,
		}));

		const issues = await this.getMyIssues(connectedRepos);
		const serializedIssues = issues.map(issue => ({
			issue: serializeIssue(issue.issue),
			reasons: issue.reasons,
		}));

		return {
			isPlus: isPlus,
			subscription: subscription,
			pullRequests: serializedPrs,
			issues: serializedIssues,
			repos: connectedRepos.map(r => serializeRepoWithRichRemote(r)),
		};
	}

	async includeBootstrap(): Promise<State> {
		if (this._bootstrapping) {
			const state = await this.getState(true);
			if (state.isPlus) {
				void this.notifyDidChangeState();
			}
			return state;
		}

		return this.getState();
	}

	private async getRichRepos(force?: boolean): Promise<RepoWithRichRemote[]> {
		if (this._repos == null || force === true) {
			const repos = [];
			const disposables = [];
			for (const repo of this.container.git.openRepositories) {
				const richRemote = await repo.getRichRemote();
				if (richRemote == null || repos.findIndex(repo => repo.remote === richRemote) > -1) {
					continue;
				}

				disposables.push(repo.onDidChange(this.onRepositoryChanged, this));

				repos.push({
					repo: repo,
					remote: richRemote,
					isConnected: await richRemote.provider.isConnected(),
					isGitHub: richRemote.provider.name === 'GitHub',
				});
			}
			if (this._repositoryEventsDisposable) {
				this._repositoryEventsDisposable.dispose();
				this._repositoryEventsDisposable = undefined;
			}
			this._repositoryEventsDisposable = Disposable.from(...disposables);
			this._repos = repos;
		}

		return this._repos;
	}

	private async onRepositoryChanged(e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.RemoteProviders, RepositoryChangeComparisonMode.Any)) {
			await this.getRichRepos(true);
			void this.notifyDidChangeState();
		}
	}

	private async getMyPullRequests(richRepos: RepoWithRichRemote[]): Promise<SearchedPullRequestWithRemote[]> {
		const allPrs: SearchedPullRequestWithRemote[] = [];
		for (const richRepo of richRepos) {
			const remotes = await richRepo.repo.getRemotes();
			const remoteNames = remotes.map(r => r.name);

			const remote = richRepo.remote;
			const prs = await this.container.git.getMyPullRequests(remote);
			if (prs == null) {
				continue;
			}

			for (const pr of prs) {
				if (pr.reasons.length === 0) {
					continue;
				}
				const entry: SearchedPullRequestWithRemote = {
					...pr,
					repoAndRemote: richRepo,
					isCurrentWorktree: false,
					isCurrentBranch: false,
				};

				const upstreams = remoteNames.map(r => `${r}/${entry.pullRequest.refs!.head.branch}`);

				const worktree = await getWorktreeForBranch(
					entry.repoAndRemote.repo,
					entry.pullRequest.refs!.head.branch,
					upstreams,
				);
				entry.hasWorktree = worktree != null;
				entry.isCurrentWorktree = worktree?.opened === true;

				const branch = await getLocalBranchByNameOrUpstream(
					richRepo.repo,
					entry.pullRequest.refs!.head.branch,
					upstreams,
				);
				if (branch) {
					entry.branch = branch;
					entry.hasLocalBranch = true;
					entry.isCurrentBranch = branch.current;
				}

				allPrs.push(entry);
			}
		}

		function getScore(pr: SearchedPullRequest) {
			let score = 0;
			if (pr.reasons.includes('authored')) {
				score += 1000;
			} else if (pr.reasons.includes('assigned')) {
				score += 900;
			} else if (pr.reasons.includes('review-requested')) {
				score += 800;
			} else if (pr.reasons.includes('mentioned')) {
				score += 700;
			}

			if (pr.pullRequest.reviewDecision === PullRequestReviewDecision.Approved) {
				if (pr.pullRequest.mergeableState === PullRequestMergeableState.Mergeable) {
					score += 100;
				} else if (pr.pullRequest.mergeableState === PullRequestMergeableState.Conflicting) {
					score += 90;
				} else {
					score += 80;
				}
			} else if (pr.pullRequest.reviewDecision === PullRequestReviewDecision.ChangesRequested) {
				score += 70;
			}

			return score;
		}

		this._pullRequests = allPrs.sort((a, b) => {
			const scoreA = getScore(a);
			const scoreB = getScore(b);

			if (scoreA === scoreB) {
				return a.pullRequest.date.getTime() - b.pullRequest.date.getTime();
			}
			return (scoreB ?? 0) - (scoreA ?? 0);
		});

		return this._pullRequests;
	}

	private async getMyIssues(richRepos: RepoWithRichRemote[]): Promise<SearchedIssue[]> {
		const allIssues = [];
		for (const { remote } of richRepos) {
			const issues = await this.container.git.getMyIssues(remote);
			if (issues == null) {
				continue;
			}
			allIssues.push(...issues.filter(pr => pr.reasons.length > 0));
		}

		this._issues = allIssues.sort((a, b) => b.issue.updatedDate.getTime() - a.issue.updatedDate.getTime());

		return this._issues;
	}

	private async notifyDidChangeState() {
		if (!this.host.visible) return;

		const state = await this.getState();
		this._bootstrapping = false;
		void this.host.notify(DidChangeStateNotificationType, { state: state });
	}
}

function filterGithubRepos(list: RepoWithRichRemote[]): RepoWithRichRemote[] {
	return list.filter(entry => entry.isGitHub);
}

function filterUsableRepos(list: RepoWithRichRemote[]): RepoWithRichRemote[] {
	return list.filter(entry => entry.isConnected && entry.isGitHub);
}

function serializeRepoWithRichRemote(entry: RepoWithRichRemote) {
	return {
		repo: entry.repo.path,
		isGitHub: entry.isGitHub,
		isConnected: entry.isConnected,
	};
}
