import type {
	CodeSuggestionsCountByPrUuid,
	EnrichedItemsByUniqueId,
	PullRequestWithUniqueID,
} from '@gitkraken/provider-apis/providers';
import type { CancellationToken, ConfigurationChangeEvent, Event } from 'vscode';
import { Disposable, env, EventEmitter, Uri, window } from 'vscode';
import { md5 } from '@env/crypto';
import type { OpenCloudPatchCommandArgs } from '../../commands/patches';
import type { CloudGitSelfManagedHostIntegrationIds, IntegrationIds } from '../../constants.integrations';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.integrations';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import { openComparisonChanges } from '../../git/actions/commit';
import type { Account } from '../../git/models/author';
import type { GitBranch } from '../../git/models/branch';
import type { PullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { ProviderReference } from '../../git/models/remoteProvider';
import type { Repository } from '../../git/models/repository';
import type { RepositoryDescriptor } from '../../git/models/resourceDescriptor';
import { getOrOpenPullRequestRepository } from '../../git/utils/-webview/pullRequest.utils';
import type { PullRequestUrlIdentity } from '../../git/utils/pullRequest.utils';
import {
	getComparisonRefsForPullRequest,
	getPullRequestIdentityFromMaybeUrl,
	getRepositoryIdentityForPullRequest,
	isMaybeNonSpecificPullRequestSearchUrl,
} from '../../git/utils/pullRequest.utils';
import { getCancellationTokenId } from '../../system/-webview/cancellation';
import { executeCommand, registerCommand } from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { setContext } from '../../system/-webview/context';
import { openUrl } from '../../system/-webview/vscode/uris';
import { gate } from '../../system/decorators/-webview/gate';
import { debug, log } from '../../system/decorators/log';
import { filterMap, groupByMap, map, some } from '../../system/iterable';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { TimedResult } from '../../system/promise';
import { getSettledValue, timedWithSlowThreshold } from '../../system/promise';
import type { UriTypes } from '../../uris/deepLinks/deepLink';
import { DeepLinkActionType, DeepLinkType } from '../../uris/deepLinks/deepLink';
import { showInspectView } from '../../webviews/commitDetails/actions';
import type { ShowWipArgs } from '../../webviews/commitDetails/protocol';
import type { CodeSuggestionCounts, Draft } from '../drafts/models/drafts';
import type { ConnectionStateChangeEvent } from '../integrations/integrationService';
import type { GitHostIntegration } from '../integrations/models/gitHostIntegration';
import type { IntegrationResult } from '../integrations/models/integration';
import { isMaybeGitHubPullRequestUrl } from '../integrations/providers/github/github.utils';
import { isMaybeGitLabPullRequestUrl } from '../integrations/providers/gitlab/gitlab.utils';
import type { EnrichablePullRequest, ProviderActionablePullRequest } from '../integrations/providers/models';
import {
	getActionablePullRequests,
	supportsCodeSuggest,
	toProviderPullRequestWithUniqueId,
} from '../integrations/providers/models';
import {
	convertIntegrationIdToEnrichProvider,
	convertRemoteProviderIdToEnrichProvider,
	isEnrichableIntegrationId,
	isEnrichableRemoteProviderId,
} from './enrichmentService';
import type { EnrichableItem, EnrichedItem } from './models/enrichedItem';
import type { LaunchpadAction, LaunchpadActionCategory, LaunchpadGroup } from './models/launchpad';
import {
	launchpadActionCategories,
	launchpadCategoryToGroupMap,
	launchpadGroups,
	prActionsMap,
	sharedCategoryToLaunchpadActionCategoryMap,
} from './models/launchpad';

export function getSuggestedActions(
	category: LaunchpadActionCategory,
	provider: ProviderReference,
	isCurrentBranch: boolean,
): LaunchpadAction[] {
	const actions = [...prActionsMap.get(category)!];
	if (isCurrentBranch) {
		actions.push('show-overview', 'open-changes');
		if (supportsCodeSuggest(provider)) {
			actions.push('code-suggest');
		}

		actions.push('open-in-graph');
	} else {
		actions.push('open-worktree', 'switch');
		if (supportsCodeSuggest(provider)) {
			actions.push('switch-and-code-suggest');
		}

		actions.push('open-in-graph');
	}
	return actions;
}

export type LaunchpadPullRequest = EnrichablePullRequest & ProviderActionablePullRequest;

export type LaunchpadItem = LaunchpadPullRequest & {
	currentViewer: Account;
	codeSuggestionsCount: number;
	codeSuggestions?: TimedResult<Draft[]>;
	isNew: boolean;
	isSearched: boolean;
	actionableCategory: LaunchpadActionCategory;
	suggestedActions: LaunchpadAction[];
	openRepository?: OpenRepository;

	underlyingPullRequest: PullRequest;
};

export type OpenRepository = {
	repo: Repository;
	remote?: GitRemote;
	localBranch?: GitBranch;
};

type CachedLaunchpadPromise<T> = {
	expiresAt: number;
	promise: Promise<T | undefined>;
};

const cacheExpiration = 1000 * 60 * 30; // 30 minutes

type PullRequestsWithSuggestionCounts = {
	prs: IntegrationResult<PullRequest[] | undefined> | undefined;
	suggestionCounts: TimedResult<CodeSuggestionCounts | undefined> | undefined;
};

export type LaunchpadRefreshEvent = LaunchpadCategorizedResult;

export const supportedLaunchpadIntegrations: (GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds)[] = [
	GitCloudHostIntegrationId.GitHub,
	GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	GitCloudHostIntegrationId.GitLab,
	GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
	GitCloudHostIntegrationId.AzureDevOps,
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	GitCloudHostIntegrationId.Bitbucket,
	GitSelfManagedHostIntegrationId.BitbucketServer,
];
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
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private readonly _onDidRefresh = new EventEmitter<LaunchpadRefreshEvent>();
	get onDidRefresh(): Event<LaunchpadCategorizedResult> {
		return this._onDidRefresh.event;
	}

	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			this._onDidChange,
			this._onDidRefresh,
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.integrations.onDidChangeConnectionState(this.onIntegrationConnectionStateChanged, this),
			...this.registerCommands(),
		);
	}

	dispose(): void {
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
					this.container.drafts.getCodeSuggestionCounts(
						prs.value.filter(pr => supportsCodeSuggest(pr.provider)),
					),
					'getCodeSuggestionCounts',
					this.container,
				);
			} catch (ex) {
				Logger.error(ex, scope, 'Failed to get code suggestion counts');
			}
		}

		return { prs: prs, suggestionCounts: suggestionCounts };
	}

	private async getSearchedPullRequests(search: string, cancellation?: CancellationToken) {
		const connectedIntegrations = await this.getConnectedIntegrations();
		const prUrlIdentity: PullRequestUrlIdentity | undefined = await this.getPullRequestIdentityFromSearch(
			search,
			connectedIntegrations,
		);
		const result: { readonly value: PullRequest[]; duration: number } = {
			value: [],
			duration: 0,
		};

		const findByPrIdentity = async (
			integration: GitHostIntegration,
		): Promise<undefined | TimedResult<PullRequest[] | undefined>> => {
			const { provider, ownerAndRepo, prNumber } = prUrlIdentity ?? {};
			const providerMatch = provider == null || provider === integration.id;
			if (providerMatch && prNumber != null && ownerAndRepo != null) {
				const [owner, repo] = ownerAndRepo.split('/', 2);
				const descriptor: RepositoryDescriptor = {
					key: ownerAndRepo,
					owner: owner,
					name: repo,
				};
				const pr = await withDurationAndSlowEventOnTimeout(
					integration?.getPullRequest(descriptor, prNumber),
					'getPullRequest',
					this.container,
				);
				if (pr?.value != null) {
					return { value: [pr.value], duration: pr.duration };
				}
			}
			return undefined;
		};

		const findByQuery = async (
			integration: GitHostIntegration,
		): Promise<undefined | TimedResult<PullRequest[] | undefined>> => {
			const prs = await withDurationAndSlowEventOnTimeout(
				integration?.searchPullRequests(search, undefined, cancellation),
				'searchPullRequests',
				this.container,
			);
			if (prs != null) {
				return { value: prs.value, duration: prs.duration };
			}
			return undefined;
		};

		const searchIntegrationPRs = prUrlIdentity ? findByPrIdentity : findByQuery;

		await Promise.allSettled(
			[...connectedIntegrations.keys()]
				.filter(
					(id: IntegrationIds): id is SupportedLaunchpadIntegrationIds =>
						(connectedIntegrations.get(id) && isSupportedLaunchpadIntegrationId(id)) ?? false,
				)
				.map(async (id: SupportedLaunchpadIntegrationIds) => {
					const integration = await this.container.integrations.get(id);
					if (integration == null) return;

					const searchResult = await searchIntegrationPRs(integration);
					const prs = searchResult?.value;
					if (prs) {
						result.value?.push(...prs);
						result.duration = Math.max(result.duration, searchResult.duration);
					}
				}),
		);
		return {
			prs: result,
			suggestionCounts: undefined,
		};
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
			if (!isSupportedLaunchpadIntegrationId(providerId) || !supportsCodeSuggest(item.provider)) {
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
	refresh(): void {
		this._prs = undefined;
		this._enrichedItems = undefined;
		this._codeSuggestions = undefined;

		this._onDidChange.fire();
	}

	@log<LaunchpadProvider['pin']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async pin(item: LaunchpadItem): Promise<void> {
		item.viewer.pinned = true;
		this._onDidChange.fire();

		await this.container.enrichments.pinItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<LaunchpadProvider['unpin']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async unpin(item: LaunchpadItem): Promise<void> {
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
	async snooze(item: LaunchpadItem): Promise<void> {
		item.viewer.snoozed = true;
		this._onDidChange.fire();

		await this.container.enrichments.snoozeItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<LaunchpadProvider['unsnooze']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async unsnooze(item: LaunchpadItem): Promise<void> {
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
		if (item.headRef?.oid == null) return;
		const integrationId = item.provider.id;
		if (!isSupportedLaunchpadIntegrationId(integrationId)) return;
		const confirm = await window.showQuickPick(['Merge', 'Cancel'], {
			placeHolder: `Are you sure you want to merge ${item.headRef?.name ?? 'this pull request'}${
				item.baseRef?.name ? ` into ${item.baseRef.name}` : ''
			}? This cannot be undone.`,
		});
		if (confirm !== 'Merge') return;
		const integration = await this.container.integrations.get(integrationId);
		if (integration == null) return;

		await integration.mergePullRequest(item.underlyingPullRequest);
		this.refresh();
	}

	@log<LaunchpadProvider['open']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	open(item: LaunchpadItem): void {
		if (item.url == null) return;
		void openUrl(item.url);
		this._prs = undefined;
	}

	@log<LaunchpadProvider['openCodeSuggestion']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	openCodeSuggestion(item: LaunchpadItem, target: string): void {
		const draft = item.codeSuggestions?.value?.find(d => d.id === target);
		if (draft == null) return;
		this._codeSuggestions?.delete(item.uuid);
		this._prs = undefined;
		void executeCommand<OpenCloudPatchCommandArgs>('gitlens.openCloudPatch', {
			type: 'code_suggestion',
			draft: draft,
		});
	}

	@log()
	openCodeSuggestionInBrowser(target: string): void {
		void openUrl(this.container.drafts.generateWebUrl(target));
	}

	@log<LaunchpadProvider['switchTo']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async switchTo(
		item: LaunchpadItem,
		options?: { openInWorktree?: boolean; startCodeSuggestion?: boolean },
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
				: options?.openInWorktree
					? DeepLinkActionType.SwitchToPullRequestWorktree
					: DeepLinkActionType.SwitchToPullRequest,
		);
		if (deepLinkUrl == null) return;

		const prRepo = options?.openInWorktree
			? await getOrOpenPullRequestRepository(this.container, item.underlyingPullRequest, {
					skipVirtual: true,
				})
			: undefined;
		this._codeSuggestions?.delete(item.uuid);
		await this.container.deepLinks.processDeepLinkUri(deepLinkUrl, false, prRepo);
	}

	@log<LaunchpadProvider['openChanges']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async openChanges(item: LaunchpadItem): Promise<void> {
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
	async openInGraph(item: LaunchpadItem): Promise<void> {
		const deepLinkUrl = this.getItemBranchDeepLink(item);
		if (deepLinkUrl == null) return;

		await this.container.deepLinks.processDeepLinkUri(deepLinkUrl, false);
	}

	generateWebUrl(): string {
		return this.container.urls.getGkDevUrl('launchpad');
	}

	private getItemBranchDeepLink(item: LaunchpadItem, action?: DeepLinkActionType): Uri | undefined {
		if (item.type !== 'pullrequest' || item.headRef == null || item.repoIdentity?.remote?.url == null) {
			return undefined;
		}

		const branchName =
			action == null && item.openRepository?.localBranch?.current
				? item.openRepository.localBranch.name
				: item.headRef.name;

		return getPullRequestBranchDeepLink(
			this.container,
			item.underlyingPullRequest,
			branchName,
			item.repoIdentity.remote.url,
			action,
		);
	}

	private async getMatchingOpenRepository(
		pr: EnrichablePullRequest,
		matchingRemoteMap: Map<string, [Repository, GitRemote]>,
	): Promise<OpenRepository | undefined> {
		if (pr.repoIdentity.remote.url == null) return undefined;

		let match = matchingRemoteMap.get(pr.repoIdentity.remote.url);
		if (match == null) {
			if (pr.underlyingPullRequest?.refs?.base?.url == null) return undefined;

			match = matchingRemoteMap.get(pr.underlyingPullRequest.refs.base.url);
			if (match == null) return undefined;

			const [repo] = match;
			return { repo: repo };
		}

		const [repo, remote] = match;

		const remoteBranchName = `${remote.name}/${pr.refs?.head.branch ?? pr.headRef?.name}`;
		const matchingLocalBranch = await repo.git.branches.getLocalBranchByUpstream?.(remoteBranchName);

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

			const remotes = await repo.git.remotes.getRemotes();

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

	isMaybeSupportedLaunchpadPullRequestSearchUrl(search: string): boolean {
		return (
			isMaybeGitHubPullRequestUrl(search) ||
			isMaybeGitLabPullRequestUrl(search) ||
			isMaybeNonSpecificPullRequestSearchUrl(search)
		);
	}

	async getPullRequestIdentityFromSearch(
		search: string,
		connectedIntegrations: Map<IntegrationIds, boolean>,
	): Promise<PullRequestUrlIdentity | undefined> {
		for (const integrationId of supportedLaunchpadIntegrations) {
			if (connectedIntegrations.get(integrationId)) {
				const integration = await this.container.integrations.get(integrationId);
				if (integration == null) continue;

				const prIdentity = integration.getPullRequestIdentityFromMaybeUrl(search);
				if (prIdentity) return prIdentity;
			}
		}
		return getPullRequestIdentityFromMaybeUrl(search);
	}

	@gate<LaunchpadProvider['getCategorizedItems']>(
		(o, c) =>
			`${o?.force ?? false}|${
				o?.search != null && typeof o.search !== 'string' ? o.search.map(pr => pr.url).join(',') : o?.search
			}${getCancellationTokenId(c)}`,
	)
	@log<LaunchpadProvider['getCategorizedItems']>({ args: { 0: o => `force=${o?.force}`, 1: false } })
	async getCategorizedItems(
		options?: { force?: boolean; search?: string | PullRequest[] },
		cancellation?: CancellationToken,
	): Promise<LaunchpadCategorizedResult> {
		const scope = getLogScope();

		const isSearching = ((o): o is RequireSome<NonNullable<typeof options>, 'search'> => Boolean(o?.search))(
			options,
		);
		const fireRefresh = !isSearching && (options?.force || this._prs == null);

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

		// TODO: Since this is all repos we probably should order by repos you are a contributor on (or even filter out one you aren't)

		let result: LaunchpadCategorizedResult | undefined;

		try {
			const [_, enrichedItemsResult, prsWithCountsResult] = await Promise.allSettled([
				this.container.git.isDiscoveringRepositories,
				this.getEnrichedItems({ force: options?.force, cancellation: cancellation }),
				isSearching
					? typeof options.search === 'string'
						? this.getSearchedPullRequests(options.search, cancellation)
						: { prs: { value: options.search, duration: 0 }, suggestionCounts: undefined }
					: this.getPullRequestsWithSuggestionCounts({ force: options?.force, cancellation: cancellation }),
			]);

			if (cancellation?.isCancellationRequested) throw new CancellationError();

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
								`${pr.repository.owner.toLowerCase()}/${pr.repository.repo.toLowerCase()}`,
							),
					);

			// There was a conversation https://github.com/gitkraken/vscode-gitlens/pull/3200#discussion_r1563347675
			// that was related to this piece of code.
			// But since the code has changed it might be hard to find it, therefore I'm leaving the link here,
			// because it's still relevant.
			const myAccounts: Map<string, Account> =
				await this.container.integrations.getMyCurrentAccounts(supportedLaunchpadIntegrations);

			const inputPrs: (EnrichablePullRequest | undefined)[] = filteredPrs.map(pr => {
				const providerPr = toProviderPullRequestWithUniqueId(pr);

				const providerId = pr.provider.id;

				const enrichProviderId = !isSupportedLaunchpadIntegrationId(providerId)
					? undefined
					: isEnrichableIntegrationId(providerId)
						? convertIntegrationIdToEnrichProvider(providerId)
						: isEnrichableRemoteProviderId(providerId)
							? convertRemoteProviderIdToEnrichProvider(providerId)
							: undefined;

				if (!enrichProviderId) {
					Logger.warn(`Unsupported provider ${providerId}`);
					return undefined;
				}

				const enrichable = {
					type: 'pr',
					id: providerPr.uuid,
					url: pr.url,
					provider: enrichProviderId,
				} satisfies EnrichableItem;

				const repoIdentity = getRepositoryIdentityForPullRequest(pr);

				return {
					...providerPr,
					type: 'pullrequest',
					uuid: providerPr.uuid,
					provider: pr.provider,
					enrichable: enrichable,
					repoIdentity: repoIdentity,
					refs: pr.refs,
					underlyingPullRequest: pr,
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
					if (!options?.search && staleDate != null && item.updatedDate.getTime() < staleDate.getTime()) {
						actionableCategory = 'other';
					} else if (codeSuggestionsCount > 0 && item.viewer.isAuthor) {
						actionableCategory = 'code-suggestions';
					}

					const openRepository = await this.getMatchingOpenRepository(item, mappedRemotesPromise);

					const suggestedActions = getSuggestedActions(
						actionableCategory,
						item.provider,
						openRepository?.localBranch?.current ?? false,
					);

					return {
						...item,
						currentViewer: myAccounts.get(item.provider.id)!,
						codeSuggestionsCount: codeSuggestionsCount,
						isNew: isSearching ? false : this.isItemNewInGroup(item, actionableCategory),
						isSearched: isSearching,
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
			if (!options?.search) {
				this.updateGroupedIds(result?.items ?? []);
			}

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
			if (integration == null) continue;

			if (integration.maybeConnected ?? (await integration.isConnected())) {
				void setContext('gitlens:launchpad:connected', true);
				return true;
			}
		}

		void setContext('gitlens:launchpad:connected', false);
		return false;
	}

	async getConnectedIntegrations(): Promise<Map<IntegrationIds, boolean>> {
		const connected = new Map<IntegrationIds, boolean>();
		await Promise.allSettled(
			supportedLaunchpadIntegrations.map(async integrationId => {
				const integration = await this.container.integrations.get(integrationId);
				if (integration == null) {
					connected.set(integrationId, false);
					return;
				}
				const isConnected = integration.maybeConnected ?? (await integration.isConnected());
				const hasAccess = isConnected && (await integration.access());
				connected.set(integrationId, hasAccess);
			}),
		);

		void setContext(
			'gitlens:launchpad:connected',
			some(connected.values(), c => c),
		);
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
			registerCommand('gitlens.launchpad.indicator.toggle', () => {
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
			'config.launchpad.includedOrganizations': cfg.includedOrganizations?.length ?? 0,
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
			configuration.changed(e, 'launchpad.includedOrganizations') ||
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
			void setContext(
				'gitlens:launchpad:connected',
				e.reason === 'connected' ? true : await this.hasConnectedIntegration(),
			);
		}
	}
}

export function getLaunchpadItemGroups(item: LaunchpadItem): LaunchpadGroup[] {
	if (item.viewer.snoozed) return ['snoozed'];

	const groups: LaunchpadGroup[] = [];
	if (item.viewer.pinned) {
		groups.push('pinned');
	}

	if (item.openRepository?.localBranch?.current) {
		groups.push('current-branch');
	}

	if (item.isDraft) {
		groups.push('draft');
	}

	const group = launchpadCategoryToGroupMap.get(item.actionableCategory)!;
	if (!item.isDraft || group === 'needs-review') {
		groups.push(group);
	}

	return groups;
}

export function groupAndSortLaunchpadItems(items?: LaunchpadItem[]): Map<LaunchpadGroup, LaunchpadItem[]> {
	if (items == null || items.length === 0) return new Map<LaunchpadGroup, LaunchpadItem[]>();
	const grouped = new Map<LaunchpadGroup, LaunchpadItem[]>(launchpadGroups.map(g => [g, []]));

	sortLaunchpadItems(items);

	for (const item of items) {
		const groups = getLaunchpadItemGroups(item);
		for (const group of groups) {
			grouped.get(group)!.push(item);
		}
	}

	// Re-sort needs review category so draft items are at the bottom
	grouped.get('needs-review')!.sort((a, b) => (a.isDraft ? 1 : -1) - (b.isDraft ? 1 : -1));

	// Re-sort pinned and draft groups by updated date
	grouped.get('pinned')!.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());
	grouped.get('draft')!.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());
	return grouped;
}

export function countLaunchpadItemGroups(items?: LaunchpadItem[]): Map<LaunchpadGroup, number> {
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

export function sortLaunchpadItems(items: LaunchpadItem[]): LaunchpadItem[] {
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
	pr: PullRequest,
	headRefBranchName: string,
	remoteUrl: string,
	action?: DeepLinkActionType,
): Uri {
	const schemeOverride = configuration.get('deepLinks.schemeOverride');
	const scheme = typeof schemeOverride === 'string' ? schemeOverride : env.uriScheme;

	const searchParams = new URLSearchParams({
		url: pr.provider.id !== GitCloudHostIntegrationId.AzureDevOps ? ensureRemoteUrl(remoteUrl) : remoteUrl,
	});
	if (action) {
		searchParams.set('action', action);
	}

	searchParams.set('prId', pr.id);
	searchParams.set('prTitle', pr.title);
	if (pr.refs) {
		searchParams.set('prBaseRef', pr.refs.base.sha);
		searchParams.set('prHeadRef', pr.refs.head.sha);
	}
	// TODO: Get the proper pull URL from the provider, rather than tacking .git at the end of the
	// url from the head ref.
	return Uri.parse(
		`${scheme}://${container.context.extension.id}/${'link' satisfies UriTypes}/${DeepLinkType.Repository}/-/${
			DeepLinkType.Branch
		}/${encodeURIComponent(headRefBranchName)}?${searchParams.toString()}`,
	);
}

export function getLaunchpadItemIdHash(item: LaunchpadItem): string {
	return md5(item.uuid);
}

const slowEventTimeout = 1000 * 30; // 30 seconds

function withDurationAndSlowEventOnTimeout<T>(
	promise: Promise<T>,
	name:
		| 'getPullRequest'
		| 'searchPullRequests'
		| 'getMyPullRequests'
		| 'getCodeSuggestionCounts'
		| 'getCodeSuggestions'
		| 'getEnrichedItems',
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
