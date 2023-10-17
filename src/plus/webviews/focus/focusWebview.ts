import { Disposable, Uri, window } from 'vscode';
import type { GHPRPullRequest } from '../../../commands/ghpr/openOrCreateWorktree';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import type { FeatureAccess, RepoFeatureAccess } from '../../../features';
import { PlusFeatures } from '../../../features';
import { add as addRemote } from '../../../git/actions/remote';
import * as RepoActions from '../../../git/actions/repository';
import type { GitBranch } from '../../../git/models/branch';
import { getLocalBranchByUpstream } from '../../../git/models/branch';
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
import type { GitWorktree } from '../../../git/models/worktree';
import { getWorktreeForBranch } from '../../../git/models/worktree';
import { parseGitRemoteUrl } from '../../../git/parsers/remoteParser';
import type { RichRemoteProvider } from '../../../git/remotes/richRemoteProvider';
import { executeCommand } from '../../../system/command';
import { debug } from '../../../system/decorators/log';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import { PageableResult } from '../../../system/paging';
import { getSettledValue } from '../../../system/promise';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import type { EnrichedItem, FocusItem } from '../../focus/focusService';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import type { ShowInCommitGraphCommandArgs } from '../graph/protocol';
import type {
	OpenBranchParams,
	OpenWorktreeParams,
	PinIssueParams,
	PinPrParams,
	SnoozeIssueParams,
	SnoozePrParams,
	State,
	SwitchToBranchParams,
} from './protocol';
import {
	DidChangeNotificationType,
	OpenBranchCommandType,
	OpenWorktreeCommandType,
	PinIssueCommandType,
	PinPrCommandType,
	SnoozeIssueCommandType,
	SnoozePrCommandType,
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
	rank: number;
	enriched?: EnrichedItem[];
}

interface SearchedIssueWithRank extends SearchedIssue {
	repoAndRemote: RepoWithRichRemote;
	rank: number;
	enriched?: EnrichedItem[];
}

export class FocusWebviewProvider implements WebviewProvider<State> {
	private _pullRequests: SearchedPullRequestWithRemote[] = [];
	private _issues: SearchedIssueWithRank[] = [];
	private _discovering: Promise<number | undefined> | undefined;
	private readonly _disposable: Disposable;
	private _etag?: number;
	private _etagSubscription?: number;
	private _repositoryEventsDisposable?: Disposable;
	private _repos?: RepoWithRichRemote[];
	private _enrichedItems?: EnrichedItem[];

	constructor(
		private readonly container: Container,
		private readonly host: WebviewController<State>,
	) {
		this._disposable = Disposable.from(
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this.container.git.onDidChangeRepositories(async () => {
				if (this._etag !== this.container.git.etag) {
					if (this._discovering != null) {
						this._etag = await this._discovering;
						if (this._etag === this.container.git.etag) return;
					}

					void this.host.refresh(true);
				}
			}),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case OpenBranchCommandType.method:
				onIpc(OpenBranchCommandType, e, params => this.onOpenBranch(params));
				break;
			case SwitchToBranchCommandType.method:
				onIpc(SwitchToBranchCommandType, e, params => this.onSwitchBranch(params));
				break;
			case OpenWorktreeCommandType.method:
				onIpc(OpenWorktreeCommandType, e, params => this.onOpenWorktree(params));
				break;
			case SnoozePrCommandType.method:
				onIpc(SnoozePrCommandType, e, params => this.onSnoozePr(params));
				break;
			case PinPrCommandType.method:
				onIpc(PinPrCommandType, e, params => this.onPinPr(params));
				break;
			case SnoozeIssueCommandType.method:
				onIpc(SnoozeIssueCommandType, e, params => this.onSnoozeIssue(params));
				break;
			case PinIssueCommandType.method:
				onIpc(PinIssueCommandType, e, params => this.onPinIssue(params));
				break;
		}
	}

	@debug({ args: false })
	private async onPinIssue({ issue, pin }: PinIssueParams) {
		const issueWithRemote = this._issues?.find(r => r.issue.nodeId === issue.nodeId);
		if (issueWithRemote == null) return;

		if (pin) {
			await this.container.focus.unpinItem(pin);
			this._enrichedItems = this._enrichedItems?.filter(e => e.id !== pin);
			issueWithRemote.enriched = issueWithRemote.enriched?.filter(e => e.id !== pin);
		} else {
			const focusItem: FocusItem = {
				type: 'issue',
				id: issueWithRemote.issue.nodeId!,
				remote: issueWithRemote.repoAndRemote.remote,
				url: issueWithRemote.issue.url,
			};
			const enrichedItem = await this.container.focus.pinItem(focusItem);
			if (enrichedItem == null) return;
			if (this._enrichedItems == null) {
				this._enrichedItems = [];
			}
			this._enrichedItems.push(enrichedItem);
			if (issueWithRemote.enriched == null) {
				issueWithRemote.enriched = [];
			}
			issueWithRemote.enriched.push(enrichedItem);
		}

		void this.notifyDidChangeState();
	}

	@debug({ args: false })
	private async onSnoozeIssue({ issue, snooze }: SnoozeIssueParams) {
		const issueWithRemote = this._issues?.find(r => r.issue.nodeId === issue.nodeId);
		if (issueWithRemote == null) return;

		if (snooze) {
			await this.container.focus.unsnoozeItem(snooze);
			this._enrichedItems = this._enrichedItems?.filter(e => e.id !== snooze);
			issueWithRemote.enriched = issueWithRemote.enriched?.filter(e => e.id !== snooze);
		} else {
			const focusItem: FocusItem = {
				type: 'issue',
				id: issueWithRemote.issue.nodeId!,
				remote: issueWithRemote.repoAndRemote.remote,
				url: issueWithRemote.issue.url,
			};
			const enrichedItem = await this.container.focus.snoozeItem(focusItem);
			if (enrichedItem == null) return;
			if (this._enrichedItems == null) {
				this._enrichedItems = [];
			}
			this._enrichedItems.push(enrichedItem);
			if (issueWithRemote.enriched == null) {
				issueWithRemote.enriched = [];
			}
			issueWithRemote.enriched.push(enrichedItem);
		}

		void this.notifyDidChangeState();
	}

	@debug({ args: false })
	private async onPinPr({ pullRequest, pin }: PinPrParams) {
		const prWithRemote = this._pullRequests?.find(r => r.pullRequest.nodeId === pullRequest.nodeId);
		if (prWithRemote == null) return;

		if (pin) {
			await this.container.focus.unpinItem(pin);
			this._enrichedItems = this._enrichedItems?.filter(e => e.id !== pin);
			prWithRemote.enriched = prWithRemote.enriched?.filter(e => e.id !== pin);
		} else {
			const focusItem: FocusItem = {
				type: 'pr',
				id: prWithRemote.pullRequest.nodeId!,
				remote: prWithRemote.repoAndRemote.remote,
				url: prWithRemote.pullRequest.url,
			};
			const enrichedItem = await this.container.focus.pinItem(focusItem);
			if (enrichedItem == null) return;
			if (this._enrichedItems == null) {
				this._enrichedItems = [];
			}
			this._enrichedItems.push(enrichedItem);
			if (prWithRemote.enriched == null) {
				prWithRemote.enriched = [];
			}
			prWithRemote.enriched.push(enrichedItem);
		}

		void this.notifyDidChangeState();
	}

	@debug({ args: false })
	private async onSnoozePr({ pullRequest, snooze }: SnoozePrParams) {
		const prWithRemote = this._pullRequests?.find(r => r.pullRequest.nodeId === pullRequest.nodeId);
		if (prWithRemote == null) return;

		if (snooze) {
			await this.container.focus.unsnoozeItem(snooze);
			this._enrichedItems = this._enrichedItems?.filter(e => e.id !== snooze);
			prWithRemote.enriched = prWithRemote.enriched?.filter(e => e.id !== snooze);
		} else {
			const focusItem: FocusItem = {
				type: 'pr',
				id: prWithRemote.pullRequest.nodeId!,
				remote: prWithRemote.repoAndRemote.remote,
				url: prWithRemote.pullRequest.url,
			};
			const enrichedItem = await this.container.focus.snoozeItem(focusItem);
			if (enrichedItem == null) return;
			if (this._enrichedItems == null) {
				this._enrichedItems = [];
			}
			this._enrichedItems.push(enrichedItem);
			if (prWithRemote.enriched == null) {
				prWithRemote.enriched = [];
			}
			prWithRemote.enriched.push(enrichedItem);
		}

		void this.notifyDidChangeState();
	}

	private findSearchedPullRequest(pullRequest: PullRequestShape): SearchedPullRequestWithRemote | undefined {
		return this._pullRequests?.find(r => r.pullRequest.id === pullRequest.id);
	}

	private async getRemoteBranch(searchedPullRequest: SearchedPullRequestWithRemote) {
		const pullRequest = searchedPullRequest.pullRequest;
		const repoAndRemote = searchedPullRequest.repoAndRemote;
		const localUri = repoAndRemote.repo.uri;

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

	@debug({ args: false })
	private async onOpenBranch({ pullRequest }: OpenBranchParams) {
		const prWithRemote = this.findSearchedPullRequest(pullRequest);
		if (prWithRemote == null) return;

		const remoteBranch = await this.getRemoteBranch(prWithRemote);
		if (remoteBranch == null) {
			void window.showErrorMessage(
				`Unable to find remote branch for '${prWithRemote.pullRequest.refs?.head.owner}:${prWithRemote.pullRequest.refs?.head.branch}'`,
			);
			return;
		}

		void executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, { ref: remoteBranch.reference });
	}

	@debug({ args: false })
	private async onSwitchBranch({ pullRequest }: SwitchToBranchParams) {
		const prWithRemote = this.findSearchedPullRequest(pullRequest);
		if (prWithRemote == null || prWithRemote.isCurrentBranch) return;

		if (prWithRemote.branch != null) {
			return RepoActions.switchTo(prWithRemote.branch.repoPath, prWithRemote.branch);
		}

		const remoteBranch = await this.getRemoteBranch(prWithRemote);
		if (remoteBranch == null) {
			void window.showErrorMessage(
				`Unable to find remote branch for '${prWithRemote.pullRequest.refs?.head.owner}:${prWithRemote.pullRequest.refs?.head.branch}'`,
			);
			return;
		}

		return RepoActions.switchTo(remoteBranch.remote.repoPath, remoteBranch.reference);
	}

	@debug({ args: false })
	private async onOpenWorktree({ pullRequest }: OpenWorktreeParams) {
		const searchedPullRequestWithRemote = this.findSearchedPullRequest(pullRequest);
		if (searchedPullRequestWithRemote?.repoAndRemote == null) {
			return;
		}

		const baseUri = Uri.parse(pullRequest.refs!.base.url);
		const localUri = searchedPullRequestWithRemote.repoAndRemote.repo.uri;
		return executeCommand<GHPRPullRequest>(Commands.OpenOrCreateWorktreeForGHPR, {
			base: {
				repositoryCloneUrl: {
					repositoryName: pullRequest.refs!.base.repo,
					owner: pullRequest.refs!.base.owner,
					url: baseUri,
				},
			},
			githubRepository: {
				rootUri: localUri,
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

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;
		this._access = undefined;
		void this.notifyDidChangeState();
	}

	private _access: FeatureAccess | RepoFeatureAccess | undefined;
	@debug()
	private async getAccess(force?: boolean) {
		if (force || this._access == null) {
			this._access = await this.container.git.access(PlusFeatures.Focus);
		}
		return this._access;
	}

	@debug()
	private async getState(force?: boolean, deferState?: boolean): Promise<State> {
		const baseState = this.host.baseWebviewState;

		this._etag = this.container.git.etag;
		if (this.container.git.isDiscoveringRepositories) {
			this._discovering = this.container.git.isDiscoveringRepositories.then(r => {
				this._discovering = undefined;
				return r;
			});
			this._etag = await this._discovering;
		}

		const access = await this.getAccess(force);
		if (access.allowed !== true) {
			return {
				...baseState,
				access: access,
			};
		}

		const allRichRepos = await this.getRichRepos(force);
		const githubRepos = filterGithubRepos(allRichRepos);
		const connectedRepos = filterUsableRepos(githubRepos);
		const hasConnectedRepos = connectedRepos.length > 0;

		if (!hasConnectedRepos) {
			return {
				...baseState,
				access: access,
				repos: githubRepos.map(r => serializeRepoWithRichRemote(r)),
			};
		}

		const repos = connectedRepos.map(r => serializeRepoWithRichRemote(r));

		const statePromise = Promise.allSettled([
			this.getMyPullRequests(connectedRepos, force),
			this.getMyIssues(connectedRepos, force),
			this.getEnrichedItems(force),
		]);

		async function getStateCore() {
			const [prsResult, issuesResult, enrichedItems] = await statePromise;
			return {
				...baseState,
				access: access,
				repos: repos,
				pullRequests: getSettledValue(prsResult)?.map(pr => ({
					pullRequest: serializePullRequest(pr.pullRequest),
					reasons: pr.reasons,
					isCurrentBranch: pr.isCurrentBranch ?? false,
					isCurrentWorktree: pr.isCurrentWorktree ?? false,
					hasWorktree: pr.hasWorktree ?? false,
					hasLocalBranch: pr.hasLocalBranch ?? false,
					enriched: findEnrichedItems(pr, getSettledValue(enrichedItems)),
					rank: pr.rank,
				})),
				issues: getSettledValue(issuesResult)?.map(issue => ({
					issue: serializeIssue(issue.issue),
					reasons: issue.reasons,
					enriched: findEnrichedItems(issue, getSettledValue(enrichedItems)),
					rank: issue.rank,
				})),
			};
		}

		if (deferState) {
			queueMicrotask(async () => {
				const state = await getStateCore();
				void this.host.notify(DidChangeNotificationType, { state: state });
			});

			return {
				...baseState,
				access: access,
				repos: repos,
			};
		}

		const state = await getStateCore();
		return state;
	}

	async includeBootstrap(): Promise<State> {
		return this.getState(true, true);
	}

	@debug()
	private async getRichRepos(force?: boolean): Promise<RepoWithRichRemote[]> {
		if (force || this._repos == null) {
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
					isGitHub: richRemote.provider.id === 'github',
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

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.RemoteProviders, RepositoryChangeComparisonMode.Any)) {
			void this.notifyDidChangeState(true);
		}
	}

	@debug({ args: { 0: false } })
	private async getMyPullRequests(
		richRepos: RepoWithRichRemote[],
		force?: boolean,
	): Promise<SearchedPullRequestWithRemote[]> {
		const scope = getLogScope();

		if (force || this._pullRequests == null) {
			const allPrs: SearchedPullRequestWithRemote[] = [];

			const branchesByRepo = new Map<Repository, PageableResult<GitBranch>>();
			const worktreesByRepo = new Map<Repository, GitWorktree[]>();

			const queries = richRepos.map(r => [r, this.container.git.getMyPullRequests(r.remote)] as const);
			for (const [r, query] of queries) {
				let prs;
				try {
					prs = await query;
				} catch (ex) {
					Logger.error(ex, scope, `Failed to get prs for '${r.remote.url}'`);
				}
				if (prs == null) continue;

				for (const pr of prs) {
					if (pr.reasons.length === 0) continue;

					const entry: SearchedPullRequestWithRemote = {
						...pr,
						repoAndRemote: r,
						isCurrentWorktree: false,
						isCurrentBranch: false,
						rank: getPrRank(pr),
					};

					const remoteBranchName = `${entry.pullRequest.refs!.head.owner}/${
						entry.pullRequest.refs!.head.branch
					}`; // TODO@eamodio really need to check for upstream url rather than name

					let branches = branchesByRepo.get(entry.repoAndRemote.repo);
					if (branches == null) {
						branches = new PageableResult<GitBranch>(paging =>
							entry.repoAndRemote.repo.getBranches(paging != null ? { paging: paging } : undefined),
						);
						branchesByRepo.set(entry.repoAndRemote.repo, branches);
					}

					let worktrees = worktreesByRepo.get(entry.repoAndRemote.repo);
					if (worktrees == null) {
						worktrees = await entry.repoAndRemote.repo.getWorktrees();
						worktreesByRepo.set(entry.repoAndRemote.repo, worktrees);
					}

					const worktree = await getWorktreeForBranch(
						entry.repoAndRemote.repo,
						entry.pullRequest.refs!.head.branch,
						remoteBranchName,
						worktrees,
						branches,
					);

					entry.hasWorktree = worktree != null;
					entry.isCurrentWorktree = worktree?.opened === true;

					const branch = await getLocalBranchByUpstream(r.repo, remoteBranchName, branches);
					if (branch) {
						entry.branch = branch;
						entry.hasLocalBranch = true;
						entry.isCurrentBranch = branch.current;
					}

					allPrs.push(entry);
				}
			}

			this._pullRequests = allPrs.sort((a, b) => {
				const scoreA = a.rank;
				const scoreB = b.rank;

				if (scoreA === scoreB) {
					return a.pullRequest.date.getTime() - b.pullRequest.date.getTime();
				}
				return (scoreB ?? 0) - (scoreA ?? 0);
			});
		}

		return this._pullRequests;
	}

	@debug({ args: { 0: false } })
	private async getMyIssues(richRepos: RepoWithRichRemote[], force?: boolean): Promise<SearchedIssueWithRank[]> {
		const scope = getLogScope();

		if (force || this._pullRequests == null) {
			const allIssues = [];

			const queries = richRepos.map(r => [r, this.container.git.getMyIssues(r.remote)] as const);
			for (const [r, query] of queries) {
				let issues;
				try {
					issues = await query;
				} catch (ex) {
					Logger.error(ex, scope, `Failed to get issues for '${r.remote.url}'`);
				}
				if (issues == null) continue;

				for (const issue of issues) {
					if (issue.reasons.length === 0) continue;

					allIssues.push({
						...issue,
						repoAndRemote: r,
						rank: 0, // getIssueRank(issue),
					});
				}
			}

			// this._issues = allIssues.sort((a, b) => {
			// 	const scoreA = a.rank;
			// 	const scoreB = b.rank;

			// 	if (scoreA === scoreB) {
			// 		return b.issue.updatedDate.getTime() - a.issue.updatedDate.getTime();
			// 	}
			// 	return (scoreB ?? 0) - (scoreA ?? 0);
			// });

			this._issues = allIssues.sort((a, b) => b.issue.updatedDate.getTime() - a.issue.updatedDate.getTime());
		}

		return this._issues;
	}

	@debug()
	private async getEnrichedItems(force?: boolean): Promise<EnrichedItem[] | undefined> {
		// TODO needs cache invalidation
		if (force || this._enrichedItems == null) {
			const enrichedItems = await this.container.focus.get();
			this._enrichedItems = enrichedItems;
		}
		return this._enrichedItems;
	}

	private async notifyDidChangeState(force?: boolean, deferState?: boolean) {
		void this.host.notify(DidChangeNotificationType, { state: await this.getState(force, deferState) });
	}
}

function findEnrichedItems(
	item: SearchedPullRequestWithRemote | SearchedIssueWithRank,
	enrichedItems?: EnrichedItem[],
) {
	if (enrichedItems == null || enrichedItems.length === 0) return;

	let result;
	// TODO: filter by entity id, type, and gitRepositoryId
	if ((item as SearchedPullRequestWithRemote).pullRequest != null) {
		result = enrichedItems.filter(e => e.entityUrl === (item as SearchedPullRequestWithRemote).pullRequest.url);
	} else {
		result = enrichedItems.filter(e => e.entityUrl === (item as SearchedIssueWithRank).issue.url);
	}

	if (result.length === 0) return;

	item.enriched = result;

	return result.map(result => {
		return {
			id: result.id,
			type: result.type,
		};
	});
}

function getPrRank(pr: SearchedPullRequest) {
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

// function getIssueRank(issue: SearchedIssue) {
// 	let score = 0;
// 	if (issue.reasons.includes('authored')) {
// 		score += 1000;
// 	} else if (issue.reasons.includes('assigned')) {
// 		score += 900;
// 	} else if (issue.reasons.includes('mentioned')) {
// 		score += 700;
// 	}

// 	return score;
// }

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
