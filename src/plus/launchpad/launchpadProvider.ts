import type {
	CodeSuggestionsCountByPrUuid,
	EnrichedItemsByUniqueId,
	PullRequestWithUniqueID,
} from '@gitkraken/provider-apis';
import type { CancellationToken, ConfigurationChangeEvent } from 'vscode';
import { Disposable, env, EventEmitter, Uri, window } from 'vscode';
import { md5 } from '@env/crypto';
import { Commands } from '../../constants.commands';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import { openComparisonChanges } from '../../git/actions/commit';
import type { Account } from '../../git/models/author';
import type { GitBranch } from '../../git/models/branch';
import { getLocalBranchByUpstream } from '../../git/models/branch';
import type { PullRequest, SearchedPullRequest } from '../../git/models/pullRequest';
import { getComparisonRefsForPullRequest, getRepositoryIdentityForPullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';
import type { CodeSuggestionCounts, Draft } from '../../gk/models/drafts';
import { executeCommand, registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { setContext } from '../../system/context';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { filterMap, groupByMap, map, some } from '../../system/iterable';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { TimedResult } from '../../system/promise';
import { getSettledValue, timedWithSlowThreshold } from '../../system/promise';
import { openUrl } from '../../system/utils';
import type { UriTypes } from '../../uris/deepLinks/deepLink';
import { DeepLinkActionType, DeepLinkType } from '../../uris/deepLinks/deepLink';
import { showInspectView } from '../../webviews/commitDetails/actions';
import type { ShowWipArgs } from '../../webviews/commitDetails/protocol';
import type { IntegrationResult } from '../integrations/integration';
import type { ConnectionStateChangeEvent } from '../integrations/integrationService';
import type {
	EnrichablePullRequest,
	IntegrationId,
	ProviderActionablePullRequest,
} from '../integrations/providers/models';
import {
	fromProviderPullRequest,
	getActionablePullRequests,
	HostingIntegrationId,
	toProviderPullRequestWithUniqueId,
} from '../integrations/providers/models';
import type { EnrichableItem, EnrichedItem } from './enrichmentService';
import { convertRemoteProviderIdToEnrichProvider, isEnrichableRemoteProviderId } from './enrichmentService';

export const launchpadActionCategories = [
	'mergeable',
	'unassigned-reviewers',
	'failed-checks',
	'conflicts',
	'needs-my-review',
	'code-suggestions',
	'changes-requested',
	'reviewer-commented',
	'waiting-for-review',
	'draft',
	'other',
] as const;
export type LaunchpadActionCategory = (typeof launchpadActionCategories)[number];

export const launchpadGroups = [
	'current-branch',
	'pinned',
	'mergeable',
	'blocked',
	'follow-up',
	'needs-review',
	'waiting-for-review',
	'draft',
	'other',
	'snoozed',
] as const;
export type LaunchpadGroup = (typeof launchpadGroups)[number];

export const launchpadPriorityGroups = [
	'mergeable',
	'blocked',
	'follow-up',
	'needs-review',
] satisfies readonly LaunchpadPriorityGroup[] as readonly LaunchpadGroup[];
export type LaunchpadPriorityGroup = Extract<LaunchpadGroup, 'mergeable' | 'blocked' | 'follow-up' | 'needs-review'>;

export const launchpadGroupIconMap = new Map<LaunchpadGroup, `$(${string})`>([
	['current-branch', '$(git-branch)'],
	['pinned', '$(pinned)'],
	['mergeable', '$(rocket)'],
	['blocked', '$(error)'], //bracket-error
	['follow-up', '$(report)'],
	['needs-review', '$(comment-unresolved)'], // feedback
	['waiting-for-review', '$(gitlens-clock)'],
	['draft', '$(git-pull-request-draft)'],
	['other', '$(ellipsis)'],
	['snoozed', '$(bell-slash)'],
]);

export const launchpadGroupLabelMap = new Map<LaunchpadGroup, string>([
	['current-branch', 'Current Branch'],
	['pinned', 'Pinned'],
	['mergeable', 'Ready to Merge'],
	['blocked', 'Blocked'],
	['follow-up', 'Requires Follow-up'],
	['needs-review', 'Needs Your Review'],
	['waiting-for-review', 'Waiting for Review'],
	['draft', 'Draft'],
	['other', 'Other'],
	['snoozed', 'Snoozed'],
]);

export const launchpadCategoryToGroupMap = new Map<LaunchpadActionCategory, LaunchpadGroup>([
	['mergeable', 'mergeable'],
	['conflicts', 'blocked'],
	['failed-checks', 'blocked'],
	['unassigned-reviewers', 'blocked'],
	['needs-my-review', 'needs-review'],
	['code-suggestions', 'follow-up'],
	['changes-requested', 'follow-up'],
	['reviewer-commented', 'follow-up'],
	['waiting-for-review', 'waiting-for-review'],
	['draft', 'draft'],
	['other', 'other'],
]);

export const sharedCategoryToLaunchpadActionCategoryMap = new Map<string, LaunchpadActionCategory>([
	['readyToMerge', 'mergeable'],
	['unassignedReviewers', 'unassigned-reviewers'],
	['failingCI', 'failed-checks'],
	['conflicts', 'conflicts'],
	['needsMyReview', 'needs-my-review'],
	['changesRequested', 'changes-requested'],
	['reviewerCommented', 'reviewer-commented'],
	['waitingForReview', 'waiting-for-review'],
	['draft', 'draft'],
	['other', 'other'],
]);

export type LaunchpadAction =
	| 'merge'
	| 'open'
	| 'soft-open'
	| 'switch'
	| 'switch-and-code-suggest'
	| 'open-worktree'
	| 'code-suggest'
	| 'show-overview'
	| 'open-changes'
	| 'open-in-graph';

export type LaunchpadTargetAction = {
	action: 'open-suggestion';
	target: string;
};

const prActionsMap = new Map<LaunchpadActionCategory, LaunchpadAction[]>([
	['mergeable', ['merge']],
	['unassigned-reviewers', ['open']],
	['failed-checks', ['open']],
	['conflicts', ['open']],
	['needs-my-review', ['open']],
	['code-suggestions', ['open']],
	['changes-requested', ['open']],
	['reviewer-commented', ['open']],
	['waiting-for-review', ['open']],
	['draft', ['open']],
	['other', []],
]);

export function getSuggestedActions(category: LaunchpadActionCategory, isCurrentBranch: boolean): LaunchpadAction[] {
	const actions = [...prActionsMap.get(category)!];
	if (isCurrentBranch) {
		actions.push('show-overview', 'open-changes', 'code-suggest', 'open-in-graph');
	} else {
		actions.push('open-worktree', 'switch', 'switch-and-code-suggest', 'open-in-graph');
	}
	return actions;
}

export type LaunchpadPullRequest = EnrichablePullRequest & ProviderActionablePullRequest;

export type LaunchpadItem = LaunchpadPullRequest & {
	currentViewer: Account;
	codeSuggestionsCount: number;
	codeSuggestions?: TimedResult<Draft[]>;
	isNew: boolean;
	actionableCategory: LaunchpadActionCategory;
	suggestedActions: LaunchpadAction[];
	openRepository?: OpenRepository;

	underlyingPullRequest: PullRequest;
};

export type OpenRepository = {
	repo: Repository;
	remote: GitRemote;
	localBranch?: GitBranch;
};

type CachedLaunchpadPromise<T> = {
	expiresAt: number;
	promise: Promise<T | undefined>;
};

const cacheExpiration = 1000 * 60 * 30; // 30 minutes

type PullRequestsWithSuggestionCounts = {
	prs: IntegrationResult<SearchedPullRequest[] | undefined> | undefined;
	suggestionCounts: TimedResult<CodeSuggestionCounts | undefined> | undefined;
};

export type LaunchpadRefreshEvent = LaunchpadCategorizedResult;

export const supportedLaunchpadIntegrations = [HostingIntegrationId.GitHub, HostingIntegrationId.GitLab];
type SupportedLaunchpadIntegrationIds = (typeof supportedLaunchpadIntegrations)[number];
function isSupportedLaunchpadIntegrationId(id: string): id is SupportedLaunchpadIntegrationIds {
	return supportedLaunchpadIntegrations.includes(id as SupportedLaunchpadIntegrationIds);
}

export type LaunchpadCategorizedResult =
	| {
			items: LaunchpadItem[];
			timings?: LaunchpadCategorizedTimings;
			error?: never;
	  }
	| {
			error: Error;
			items?: never;
	  };

export interface LaunchpadCategorizedTimings {
	prs: number | undefined;
	codeSuggestionCounts: number | undefined;
	enrichedItems: number | undefined;
}

export class LaunchpadProvider implements Disposable {
	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange() {
		return this._onDidChange.event;
	}

	private readonly _onDidRefresh = new EventEmitter<LaunchpadRefreshEvent>();
	get onDidRefresh() {
		return this._onDidRefresh.event;
	}

	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.integrations.onDidChangeConnectionState(this.onIntegrationConnectionStateChanged, this),
			...this.registerCommands(),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private _prs: CachedLaunchpadPromise<PullRequestsWithSuggestionCounts> | undefined;
	@debug<LaunchpadProvider['getPullRequestsWithSuggestionCounts']>({ args: { 0: o => `force=${o?.force}` } })
	private async getPullRequestsWithSuggestionCounts(options?: { cancellation?: CancellationToken; force?: boolean }) {
		if (options?.force || this._prs == null || this._prs.expiresAt < Date.now()) {
			this._prs = {
				promise: this.fetchPullRequestsWithSuggestionCounts(options?.cancellation),
				expiresAt: Date.now() + cacheExpiration,
			};
		}

		return this._prs?.promise;
	}

	@debug<LaunchpadProvider['fetchPullRequestsWithSuggestionCounts']>({ args: false })
	private async fetchPullRequestsWithSuggestionCounts(cancellation?: CancellationToken) {
		const scope = getLogScope();

		const [prsResult, subscriptionResult] = await Promise.allSettled([
			withDurationAndSlowEventOnTimeout(
				this.container.integrations.getMyPullRequests(supportedLaunchpadIntegrations, cancellation, true),
				'getMyPullRequests',
				this.container,
			),
			this.container.subscription.getSubscription(true),
		]);

		if (prsResult.status === 'rejected') {
			Logger.error(prsResult.reason, scope, 'Failed to get pull requests');
			throw prsResult.reason;
		}

		const prs = getSettledValue(prsResult)?.value;
		if (prs?.error != null) {
			Logger.error(prs.error, scope, 'Failed to get pull requests');
			throw prs.error;
		}

		const subscription = getSettledValue(subscriptionResult);

		let suggestionCounts;
		if (prs?.value?.length && subscription?.account != null) {
			try {
				suggestionCounts = await withDurationAndSlowEventOnTimeout(
					this.container.drafts.getCodeSuggestionCounts(prs.value.map(pr => pr.pullRequest)),
					'getCodeSuggestionCounts',
					this.container,
				);
			} catch (ex) {
				Logger.error(ex, scope, 'Failed to get code suggestion counts');
			}
		}

		return { prs: prs, suggestionCounts: suggestionCounts };
	}

	private _enrichedItems: CachedLaunchpadPromise<TimedResult<EnrichedItem[]>> | undefined;
	@debug<LaunchpadProvider['getEnrichedItems']>({ args: { 0: o => `force=${o?.force}` } })
	private async getEnrichedItems(options?: { cancellation?: CancellationToken; force?: boolean }) {
		if (options?.force || this._enrichedItems == null || this._enrichedItems.expiresAt < Date.now()) {
			this._enrichedItems = {
				promise: withDurationAndSlowEventOnTimeout(
					this.container.enrichments.get(undefined, options?.cancellation),
					'getEnrichedItems',
					this.container,
				),
				expiresAt: Date.now() + cacheExpiration,
			};
		}

		return this._enrichedItems?.promise;
	}

	private _codeSuggestions: Map<string, CachedLaunchpadPromise<TimedResult<Draft[]>>> | undefined;
	@debug<LaunchpadProvider['getCodeSuggestions']>({
		args: { 0: i => `${i.id} (${i.provider.name} ${i.type})`, 1: o => `force=${o?.force}` },
	})
	private async getCodeSuggestions(item: LaunchpadItem, options?: { force?: boolean }) {
		if (item.codeSuggestionsCount < 1) return undefined;

		if (this._codeSuggestions == null || options?.force) {
			this._codeSuggestions = new Map<string, CachedLaunchpadPromise<TimedResult<Draft[]>>>();
		}

		if (
			options?.force ||
			!this._codeSuggestions.has(item.uuid) ||
			this._codeSuggestions.get(item.uuid)!.expiresAt < Date.now()
		) {
			const providerId = item.provider.id;
			if (!isSupportedLaunchpadIntegrationId(providerId)) {
				return undefined;
			}

			this._codeSuggestions.set(item.uuid, {
				promise: withDurationAndSlowEventOnTimeout(
					this.container.drafts.getCodeSuggestions(item, providerId, {
						includeArchived: false,
					}),
					'getCodeSuggestions',
					this.container,
				),
				expiresAt: Date.now() + cacheExpiration,
			});
		}

		return this._codeSuggestions.get(item.uuid)!.promise;
	}

	@log()
	refresh() {
		this._prs = undefined;
		this._enrichedItems = undefined;
		this._codeSuggestions = undefined;

		this._onDidChange.fire();
	}

	@log<LaunchpadProvider['pin']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async pin(item: LaunchpadItem) {
		item.viewer.pinned = true;
		this._onDidChange.fire();

		await this.container.enrichments.pinItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<LaunchpadProvider['unpin']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async unpin(item: LaunchpadItem) {
		item.viewer.pinned = false;
		this._onDidChange.fire();

		if (item.viewer.enrichedItems == null) return;
		const pinned = item.viewer.enrichedItems.find(e => e.type === 'pin');
		if (pinned == null) return;
		await this.container.enrichments.unpinItem(pinned.id);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<LaunchpadProvider['snooze']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async snooze(item: LaunchpadItem) {
		item.viewer.snoozed = true;
		this._onDidChange.fire();

		await this.container.enrichments.snoozeItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<LaunchpadProvider['unsnooze']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async unsnooze(item: LaunchpadItem) {
		item.viewer.snoozed = false;
		this._onDidChange.fire();

		if (item.viewer.enrichedItems == null) return;
		const snoozed = item.viewer.enrichedItems.find(e => e.type === 'snooze');
		if (snoozed == null) return;
		await this.container.enrichments.unsnoozeItem(snoozed.id);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<LaunchpadProvider['merge']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async merge(item: LaunchpadItem): Promise<void> {
		if (item.graphQLId == null || item.headRef?.oid == null) return;
		const integrationId = item.provider.id;
		if (!isSupportedLaunchpadIntegrationId(integrationId)) return;
		const confirm = await window.showQuickPick(['Merge', 'Cancel'], {
			placeHolder: `Are you sure you want to merge ${item.headRef?.name ?? 'this pull request'}${
				item.baseRef?.name ? ` into ${item.baseRef.name}` : ''
			}? This cannot be undone.`,
		});
		if (confirm !== 'Merge') return;
		const integration = await this.container.integrations.get(integrationId);
		const pr: PullRequest = fromProviderPullRequest(item, integration);
		await integration.mergePullRequest(pr);
		this.refresh();
	}

	@log<LaunchpadProvider['open']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	open(item: LaunchpadItem): void {
		if (item.url == null) return;
		void openUrl(item.url);
		this._prs = undefined;
	}

	@log<LaunchpadProvider['openCodeSuggestion']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	openCodeSuggestion(item: LaunchpadItem, target: string) {
		const draft = item.codeSuggestions?.value?.find(d => d.id === target);
		if (draft == null) return;
		this._codeSuggestions?.delete(item.uuid);
		this._prs = undefined;
		void executeCommand(Commands.OpenCloudPatch, {
			type: 'code_suggestion',
			draft: draft,
		});
	}

	@log()
	openCodeSuggestionInBrowser(target: string) {
		void openUrl(this.container.drafts.generateWebUrl(target));
	}

	@log<LaunchpadProvider['switchTo']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async switchTo(
		item: LaunchpadItem,
		options?: { skipWorktreeConfirmations?: boolean; startCodeSuggestion?: boolean },
	): Promise<void> {
		if (item.openRepository?.localBranch?.current) {
			void showInspectView({
				type: 'wip',
				inReview: options?.startCodeSuggestion,
				repository: item.openRepository.repo,
				source: 'launchpad',
			} satisfies ShowWipArgs);
			return;
		}

		const deepLinkUrl = this.getItemBranchDeepLink(
			item,
			options?.startCodeSuggestion
				? DeepLinkActionType.SwitchToAndSuggestPullRequest
				: options?.skipWorktreeConfirmations
				  ? DeepLinkActionType.SwitchToPullRequestWorktree
				  : DeepLinkActionType.SwitchToPullRequest,
		);
		if (deepLinkUrl == null) return;

		this._codeSuggestions?.delete(item.uuid);
		await this.container.deepLinks.processDeepLinkUri(deepLinkUrl, false);
	}

	@log<LaunchpadProvider['openChanges']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async openChanges(item: LaunchpadItem) {
		if (!item.openRepository?.localBranch?.current) return;

		await this.switchTo(item);
		if (item.refs != null) {
			const refs = getComparisonRefsForPullRequest(item.openRepository.repo.path, item.refs);
			await openComparisonChanges(
				this.container,
				{
					repoPath: refs.repoPath,
					lhs: refs.base.ref,
					rhs: refs.head.ref,
				},
				{ title: `Changes in Pull Request #${item.id}` },
			);
		}
	}

	@log<LaunchpadProvider['openInGraph']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async openInGraph(item: LaunchpadItem) {
		const deepLinkUrl = this.getItemBranchDeepLink(item);
		if (deepLinkUrl == null) return;
		await this.container.deepLinks.processDeepLinkUri(deepLinkUrl, false);
	}

	generateWebUrl(): string {
		return this.container.generateWebGkDevUrl('/launchpad');
	}

	private getItemBranchDeepLink(item: LaunchpadItem, action?: DeepLinkActionType): Uri | undefined {
		if (item.type !== 'pullrequest' || item.headRef == null || item.repoIdentity?.remote?.url == null)
			return undefined;

		const branchName =
			action == null && item.openRepository?.localBranch?.current
				? item.openRepository.localBranch.name
				: item.headRef.name;

		return getPullRequestBranchDeepLink(this.container, branchName, item.repoIdentity.remote.url, action);
	}

	private async getMatchingOpenRepository(
		pr: EnrichablePullRequest,
		matchingRemoteMap: Map<string, [Repository, GitRemote]>,
	): Promise<OpenRepository | undefined> {
		if (pr.repoIdentity.remote.url == null) return undefined;

		const match =
			matchingRemoteMap.get(pr.repoIdentity.remote.url) ??
			(pr.underlyingPullRequest?.refs?.base?.url
				? matchingRemoteMap.get(pr.underlyingPullRequest.refs.base.url)
				: undefined);
		if (match == null) return undefined;

		const [repo, remote] = match;

		const remoteBranchName = `${remote.name}/${pr.refs?.head.branch ?? pr.headRef?.name}`;
		const matchingLocalBranch = await getLocalBranchByUpstream(repo, remoteBranchName);

		return { repo: repo, remote: remote, localBranch: matchingLocalBranch };
	}

	private async getMatchingRemoteMap(actionableItems: LaunchpadPullRequest[]) {
		const uniqueRemoteUrls = new Set<string>();
		for (const item of actionableItems) {
			if (item.repoIdentity.remote.url != null) {
				uniqueRemoteUrls.add(item.repoIdentity.remote.url.replace(/\.git$/, ''));
			}
		}

		// Get the repo/remote pairs for the unique remote urls
		const repoRemotes = new Map<string, [Repository, GitRemote]>();

		async function matchRemotes(repo: Repository) {
			if (uniqueRemoteUrls.size === 0) return;

			const remotes = await repo.getRemotes();

			for (const remote of remotes) {
				if (uniqueRemoteUrls.size === 0) return;

				const remoteUrl = remote.url.replace(/\.git$/, '');
				if (uniqueRemoteUrls.has(remoteUrl)) {
					repoRemotes.set(remoteUrl, [repo, remote]);
					uniqueRemoteUrls.delete(remoteUrl);

					if (uniqueRemoteUrls.size === 0) return;
				} else {
					for (const [url] of uniqueRemoteUrls) {
						if (remote.matches(url)) {
							repoRemotes.set(url, [repo, remote]);
							uniqueRemoteUrls.delete(url);

							if (uniqueRemoteUrls.size === 0) return;

							break;
						}
					}
				}
			}
		}

		await Promise.allSettled(map(this.container.git.openRepositories, r => matchRemotes(r)));

		return repoRemotes;
	}

	@gate<LaunchpadProvider['getCategorizedItems']>(o => `${o?.force ?? false}`)
	@log<LaunchpadProvider['getCategorizedItems']>({ args: { 0: o => `force=${o?.force}`, 1: false } })
	async getCategorizedItems(
		options?: { force?: boolean },
		cancellation?: CancellationToken,
	): Promise<LaunchpadCategorizedResult> {
		const scope = getLogScope();

		const fireRefresh = options?.force || this._prs == null;

		const ignoredRepositories = new Set(
			(configuration.get('launchpad.ignoredRepositories') ?? []).map(r => r.toLowerCase()),
		);
		const staleThreshold = configuration.get('launchpad.staleThreshold');
		let staleDate: Date | undefined;
		if (staleThreshold != null) {
			staleDate = new Date();
			// Subtract the number of days from the current date
			staleDate.setDate(staleDate.getDate() - staleThreshold);
		}

		const enrichedItemsPromise = this.getEnrichedItems({ force: options?.force, cancellation: cancellation });

		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		if (cancellation?.isCancellationRequested) throw new CancellationError();

		const [enrichedItemsResult, prsWithCountsResult] = await Promise.allSettled([
			enrichedItemsPromise,
			this.getPullRequestsWithSuggestionCounts({ force: options?.force, cancellation: cancellation }),
		]);

		if (cancellation?.isCancellationRequested) throw new CancellationError();

		// TODO: Since this is all repos we probably should order by repos you are a contributor on (or even filter out one you aren't)

		let result: LaunchpadCategorizedResult | undefined;

		try {
			if (prsWithCountsResult.status === 'rejected') {
				Logger.error(prsWithCountsResult.reason, scope, 'Failed to get pull requests with suggestion counts');
				result = {
					error:
						prsWithCountsResult.reason instanceof Error
							? prsWithCountsResult.reason
							: new Error(String(prsWithCountsResult.reason)),
				};
				return result;
			}

			const enrichedItems = getSettledValue(enrichedItemsResult);
			const prsWithSuggestionCounts = getSettledValue(prsWithCountsResult);

			const prs = prsWithSuggestionCounts?.prs;
			if (prs?.value == null) {
				result = {
					items: [],
					timings: {
						prs: prsWithSuggestionCounts?.prs?.duration,
						codeSuggestionCounts: prsWithSuggestionCounts?.suggestionCounts?.duration,
						enrichedItems: enrichedItems?.duration,
					},
				};
				return result;
			}

			// Multiple enriched items can have the same entityId. Map by entityId to an array of enriched items.
			const enrichedItemsByEntityId: { [id: string]: EnrichedItem[] } = {};

			if (enrichedItems?.value != null) {
				for (const enrichedItem of enrichedItems.value) {
					if (enrichedItem.entityId in enrichedItemsByEntityId) {
						enrichedItemsByEntityId[enrichedItem.entityId].push(enrichedItem);
					} else {
						enrichedItemsByEntityId[enrichedItem.entityId] = [enrichedItem];
					}
				}
			}

			const filteredPrs = !ignoredRepositories.size
				? prs.value
				: prs.value.filter(
						pr =>
							!ignoredRepositories.has(
								`${pr.pullRequest.repository.owner.toLowerCase()}/${pr.pullRequest.repository.repo.toLowerCase()}`,
							),
				  );

			// There was a conversation https://github.com/gitkraken/vscode-gitlens/pull/3200#discussion_r1563347675
			// that was related to this piece of code.
			// But since the code has changed it might be hard to find it, therefore I'm leaving the link here,
			// because it's still relevant.
			const myAccounts: Map<string, Account> =
				await this.container.integrations.getMyCurrentAccounts(supportedLaunchpadIntegrations);

			const inputPrs: (EnrichablePullRequest | undefined)[] = filteredPrs.map(pr => {
				const providerPr = toProviderPullRequestWithUniqueId(pr.pullRequest);

				const providerId = pr.pullRequest.provider.id;

				if (!isSupportedLaunchpadIntegrationId(providerId) || !isEnrichableRemoteProviderId(providerId)) {
					Logger.warn(`Unsupported provider ${providerId}`);
					return undefined;
				}

				const enrichable = {
					type: 'pr',
					id: providerPr.uuid,
					url: pr.pullRequest.url,
					provider: convertRemoteProviderIdToEnrichProvider(providerId),
				} satisfies EnrichableItem;

				const repoIdentity = getRepositoryIdentityForPullRequest(pr.pullRequest);

				return {
					...providerPr,
					type: 'pullrequest',
					uuid: providerPr.uuid,
					provider: pr.pullRequest.provider,
					enrichable: enrichable,
					repoIdentity: repoIdentity,
					refs: pr.pullRequest.refs,
					underlyingPullRequest: pr.pullRequest,
				} satisfies EnrichablePullRequest;
			}) satisfies (EnrichablePullRequest | undefined)[];

			// Note: The expected output of this is ActionablePullRequest[], but we are passing in EnrichablePullRequest,
			// so we need to cast the output as LaunchpadPullRequest[].
			const actionableItems = this.getActionablePullRequests(
				inputPrs.filter((i: EnrichablePullRequest | undefined): i is EnrichablePullRequest => i != null),
				myAccounts,
				{ enrichedItemsByUniqueId: enrichedItemsByEntityId },
			) as LaunchpadPullRequest[];

			// Get the unique remote urls
			const mappedRemotesPromise = await this.getMatchingRemoteMap(actionableItems);

			const { suggestionCounts } = prsWithSuggestionCounts!;

			// Map from shared category label to local actionable category, and get suggested actions
			const categorized = await Promise.allSettled(
				actionableItems.map<Promise<LaunchpadItem>>(async item => {
					const codeSuggestionsCount = suggestionCounts?.value?.[item.uuid]?.count ?? 0;

					let actionableCategory = sharedCategoryToLaunchpadActionCategoryMap.get(
						item.suggestedActionCategory,
					)!;
					// category overrides
					if (staleDate != null && item.updatedDate.getTime() < staleDate.getTime()) {
						actionableCategory = 'other';
					} else if (codeSuggestionsCount > 0 && item.viewer.isAuthor) {
						actionableCategory = 'code-suggestions';
					}

					const openRepository = await this.getMatchingOpenRepository(item, mappedRemotesPromise);

					const suggestedActions = getSuggestedActions(
						actionableCategory,
						openRepository?.localBranch?.current ?? false,
					);

					return {
						...item,
						currentViewer: myAccounts.get(item.provider.id)!,
						codeSuggestionsCount: codeSuggestionsCount,
						isNew: this.isItemNewInGroup(item, actionableCategory),
						actionableCategory: actionableCategory,
						suggestedActions: suggestedActions,
						openRepository: openRepository,
						underlyingPullRequest: item.underlyingPullRequest,
					} satisfies LaunchpadItem;
				}),
			);

			result = {
				items: [...filterMap(categorized, i => getSettledValue(i))],
				timings: {
					prs: prsWithSuggestionCounts?.prs?.duration,
					codeSuggestionCounts: prsWithSuggestionCounts?.suggestionCounts?.duration,
					enrichedItems: enrichedItems?.duration,
				},
			};
			return result;
		} finally {
			this.updateGroupedIds(result?.items ?? []);
			if (result != null && fireRefresh) {
				this._onDidRefresh.fire(result);
			}
		}
	}

	// TODO: Switch to using getActionablePullRequests from the shared provider library
	// once it supports passing in multiple current users, one for each provider
	private getActionablePullRequests(
		pullRequests: (PullRequestWithUniqueID & { provider: { id: string } })[],
		currentUsers: Map<string, Account>,
		options?: {
			enrichedItemsByUniqueId?: EnrichedItemsByUniqueId;
			codeSuggestionsCountByPrUuid?: CodeSuggestionsCountByPrUuid;
		},
	): ProviderActionablePullRequest[] {
		const pullRequestsByIntegration = groupByMap<string, PullRequestWithUniqueID & { provider: { id: string } }>(
			pullRequests,
			pr => pr.provider.id,
		);

		const actionablePullRequests: ProviderActionablePullRequest[] = [];
		for (const [integrationId, prs] of pullRequestsByIntegration.entries()) {
			const currentUser = currentUsers.get(integrationId);
			if (currentUser == null) {
				Logger.warn(`No current user for integration ${integrationId}`);
				continue;
			}

			const actionablePrs = getActionablePullRequests(prs, { id: currentUser.id }, options);
			actionablePullRequests.push(...actionablePrs);
		}

		return actionablePullRequests;
	}

	private _groupedIds: Set<string> | undefined;

	private isItemNewInGroup(item: LaunchpadPullRequest, actionableCategory: LaunchpadActionCategory) {
		return (
			this._groupedIds != null &&
			!this._groupedIds.has(`${item.uuid}:${launchpadCategoryToGroupMap.get(actionableCategory)}`)
		);
	}

	private updateGroupedIds(items: LaunchpadItem[]) {
		const groupedIds = new Set<string>();
		for (const item of items) {
			const group = launchpadCategoryToGroupMap.get(item.actionableCategory)!;
			const key = `${item.uuid}:${group}`;
			if (!groupedIds.has(key)) {
				groupedIds.add(key);
			}
		}

		this._groupedIds = groupedIds;
	}

	async hasConnectedIntegration(): Promise<boolean> {
		for (const integrationId of supportedLaunchpadIntegrations) {
			const integration = await this.container.integrations.get(integrationId);
			if (integration.maybeConnected ?? (await integration.isConnected())) {
				return true;
			}
		}

		void setContext('gitlens:launchpad:connect', true);
		return false;
	}

	async getConnectedIntegrations(): Promise<Map<IntegrationId, boolean>> {
		const connected = new Map<IntegrationId, boolean>();
		await Promise.allSettled(
			supportedLaunchpadIntegrations.map(async integrationId => {
				const integration = await this.container.integrations.get(integrationId);
				connected.set(integrationId, integration.maybeConnected ?? (await integration.isConnected()));
			}),
		);

		void setContext('gitlens:launchpad:connect', !some(connected.values(), c => c));
		return connected;
	}

	@log<LaunchpadProvider['ensureLaunchpadItemCodeSuggestions']>({
		args: { 0: i => `${i.id} (${i.provider.name} ${i.type})`, 1: o => `force=${o?.force}` },
	})
	async ensureLaunchpadItemCodeSuggestions(
		item: LaunchpadItem,
		options?: { force?: boolean },
	): Promise<TimedResult<Draft[]> | undefined> {
		item.codeSuggestions ??= await this.getCodeSuggestions(item, options);
		return item.codeSuggestions;
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand(Commands.ToggleLaunchpadIndicator, () => {
				const enabled = configuration.get('launchpad.indicator.enabled') ?? false;
				void configuration.updateEffective('launchpad.indicator.enabled', !enabled);
			}),
		];
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'launchpad')) return;

		const cfg = configuration.get('launchpad');
		this.container.telemetry.sendEvent('launchpad/configurationChanged', {
			'config.launchpad.staleThreshold': cfg.staleThreshold,
			'config.launchpad.ignoredOrganizations': cfg.ignoredOrganizations?.length ?? 0,
			'config.launchpad.ignoredRepositories': cfg.ignoredRepositories?.length ?? 0,
			'config.launchpad.indicator.enabled': cfg.indicator.enabled,
			'config.launchpad.indicator.icon': cfg.indicator.icon,
			'config.launchpad.indicator.label': cfg.indicator.label,
			'config.launchpad.indicator.useColors': cfg.indicator.useColors,
			'config.launchpad.indicator.groups': cfg.indicator.groups.join(','),
			'config.launchpad.indicator.polling.enabled': cfg.indicator.polling.enabled,
			'config.launchpad.indicator.polling.interval': cfg.indicator.polling.interval,
		});

		if (
			configuration.changed(e, 'launchpad.ignoredOrganizations') ||
			configuration.changed(e, 'launchpad.ignoredRepositories') ||
			configuration.changed(e, 'launchpad.staleThreshold')
		) {
			this.refresh();
			void this.getCategorizedItems({ force: true });
		}
	}

	private async onIntegrationConnectionStateChanged(e: ConnectionStateChangeEvent) {
		if (isSupportedLaunchpadIntegrationId(e.key)) {
			if (e.reason === 'connected') {
				void setContext('gitlens:launchpad:connect', false);
			} else {
				void setContext('gitlens:launchpad:connect', await this.hasConnectedIntegration());
			}
		}
	}
}

export function groupAndSortLaunchpadItems(items?: LaunchpadItem[]) {
	if (items == null || items.length === 0) return new Map<LaunchpadGroup, LaunchpadItem[]>();
	const grouped = new Map<LaunchpadGroup, LaunchpadItem[]>(launchpadGroups.map(g => [g, []]));

	sortLaunchpadItems(items);

	for (const item of items) {
		if (item.viewer.snoozed) {
			grouped.get('snoozed')!.push(item);

			continue;
		} else if (item.viewer.pinned) {
			grouped.get('pinned')!.push(item);
		}

		if (item.openRepository?.localBranch?.current) {
			grouped.get('current-branch')!.push(item);
		}

		if (item.isDraft) {
			grouped.get('draft')!.push(item);
		} else {
			const group = launchpadCategoryToGroupMap.get(item.actionableCategory)!;
			grouped.get(group)!.push(item);
		}
	}

	// Re-sort pinned and draft groups by updated date
	grouped.get('pinned')!.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());
	grouped.get('draft')!.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());
	return grouped;
}

export function countLaunchpadItemGroups(items?: LaunchpadItem[]) {
	if (items == null || items.length === 0) return new Map<LaunchpadGroup, number>();
	const grouped = new Map<LaunchpadGroup, number>(launchpadGroups.map(g => [g, 0]));

	function incrementGroup(group: LaunchpadGroup) {
		grouped.set(group, (grouped.get(group) ?? 0) + 1);
	}

	for (const item of items) {
		if (item.viewer.snoozed) {
			incrementGroup('snoozed');
			continue;
		} else if (item.viewer.pinned) {
			incrementGroup('pinned');
		}

		if (item.openRepository?.localBranch?.current) {
			incrementGroup('current-branch');
		}

		if (item.isDraft) {
			incrementGroup('draft');
		} else {
			incrementGroup(launchpadCategoryToGroupMap.get(item.actionableCategory)!);
		}
	}

	return grouped;
}

export function sortLaunchpadItems(items: LaunchpadItem[]) {
	return items.sort(
		(a, b) =>
			(a.viewer.pinned ? -1 : 1) - (b.viewer.pinned ? -1 : 1) ||
			launchpadActionCategories.indexOf(a.actionableCategory) -
				launchpadActionCategories.indexOf(b.actionableCategory) ||
			b.updatedDate.getTime() - a.updatedDate.getTime(),
	);
}

function ensureRemoteUrl(url: string) {
	if (url.startsWith('https')) {
		return url.endsWith('.git') ? url : `${url}.git`;
	}

	return url;
}

export function getPullRequestBranchDeepLink(
	container: Container,
	headRefBranchName: string,
	remoteUrl: string,
	action?: DeepLinkActionType,
) {
	const schemeOverride = configuration.get('deepLinks.schemeOverride');
	const scheme = typeof schemeOverride === 'string' ? schemeOverride : env.uriScheme;
	// TODO: Get the proper pull URL from the provider, rather than tacking .git at the end of the
	// url from the head ref.
	return Uri.parse(
		`${scheme}://${container.context.extension.id}/${'link' satisfies UriTypes}/${DeepLinkType.Repository}/-/${
			DeepLinkType.Branch
		}/${headRefBranchName}?url=${encodeURIComponent(ensureRemoteUrl(remoteUrl))}${
			action != null ? `&action=${action}` : ''
		}`,
	);
}

export function getLaunchpadItemIdHash(item: LaunchpadItem) {
	return md5(item.uuid);
}

const slowEventTimeout = 1000 * 30; // 30 seconds

function withDurationAndSlowEventOnTimeout<T>(
	promise: Promise<T>,
	name: 'getMyPullRequests' | 'getCodeSuggestionCounts' | 'getCodeSuggestions' | 'getEnrichedItems',
	container: Container,
): Promise<TimedResult<T>> {
	return timedWithSlowThreshold(promise, {
		timeout: slowEventTimeout,
		onSlow: (duration: number) => {
			container.telemetry.sendEvent('launchpad/operation/slow', {
				timeout: slowEventTimeout,
				operation: name,
				duration: duration,
			});
		},
	});
}
