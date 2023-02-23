import { Disposable } from 'vscode';
import { Commands, ContextKeys } from '../../../constants';
import type { Container } from '../../../container';
import { setContext } from '../../../context';
import { PlusFeatures } from '../../../features';
import type { SearchedIssue } from '../../../git/models/issue';
import { serializeIssue } from '../../../git/models/issue';
import type { SearchedPullRequest } from '../../../git/models/pullRequest';
import {
	PullRequestMergeableState,
	PullRequestReviewDecision,
	serializePullRequest,
} from '../../../git/models/pullRequest';
import type { GitRemote } from '../../../git/models/remote';
import type { Repository, RepositoryChangeEvent } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import type { RichRemoteProvider } from '../../../git/remotes/richRemoteProvider';
import type { Subscription } from '../../../subscription';
import { SubscriptionState } from '../../../subscription';
import { registerCommand } from '../../../system/command';
import { WebviewBase } from '../../../webviews/webviewBase';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../../subscription/utils';
import type { State } from './protocol';
import { DidChangeStateNotificationType, DidChangeSubscriptionNotificationType } from './protocol';

interface RepoWithRichRemote {
	repo: Repository;
	remote: GitRemote<RichRemoteProvider>;
	isConnected: boolean;
	isGitHub: boolean;
}

export class FocusWebview extends WebviewBase<State> {
	private _bootstrapping = true;
	private _pullRequests: SearchedPullRequest[] = [];
	private _issues: SearchedIssue[] = [];
	private _etagSubscription?: number;
	private _repositoryEventsDisposable?: Disposable;
	private _repos?: RepoWithRichRemote[];

	constructor(container: Container) {
		super(
			container,
			'gitlens.focus',
			'focus.html',
			'images/gitlens-icon.png',
			'Focus View',
			`${ContextKeys.WebviewPrefix}focus`,
			'focusWebview',
			Commands.ShowFocusPage,
		);

		this.disposables.push(this.container.subscription.onDidChange(this.onSubscriptionChanged, this));
		this.disposables.push(this.container.git.onDidChangeRepositories(() => void this.refresh(true)));
	}

	protected override registerCommands(): Disposable[] {
		return [registerCommand(Commands.RefreshFocus, () => this.refresh(true))];
	}

	protected override onFocusChanged(focused: boolean): void {
		if (focused) {
			// If we are becoming focused, delay it a bit to give the UI time to update
			setTimeout(() => void setContext(ContextKeys.FocusFocused, focused), 0);

			return;
		}

		void setContext(ContextKeys.FocusFocused, focused);
	}

	private async onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;

		const access = await this.container.git.access(PlusFeatures.Focus);
		const { subscription, isPlus } = await this.getSubscription(access.subscription.current);
		if (isPlus) {
			void this.notifyDidChangeState();
		}
		return this.notify(DidChangeSubscriptionNotificationType, {
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

	protected override async includeBootstrap(): Promise<State> {
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

	private async getMyPullRequests(richRepos: RepoWithRichRemote[]): Promise<SearchedPullRequest[]> {
		const allPrs = [];
		for (const { remote } of richRepos) {
			const prs = await this.container.git.getMyPullRequests(remote);
			if (prs == null) {
				continue;
			}
			allPrs.push(...prs.filter(pr => pr.reasons.length > 0));
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

	override async show(options?: {
		preserveFocus?: boolean | undefined;
		preserveVisibility?: boolean | undefined;
	}): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		return super.show(options);
	}

	private async notifyDidChangeState() {
		if (!this.visible) return;

		const state = await this.getState();
		this._bootstrapping = false;
		void this.notify(DidChangeStateNotificationType, { state: state });
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
