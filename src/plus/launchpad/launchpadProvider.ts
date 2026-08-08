import type { EnrichedItemsByUniqueId, PullRequestWithUniqueID } from '@gitkraken/provider-apis/providers';
import type { CancellationToken, ConfigurationChangeEvent, Event } from 'vscode';
import { Disposable, env, EventEmitter, Uri } from 'vscode';
import type { Account } from '@gitlens/git/models/author.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { PullRequest, PullRequestMember } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RepositoryDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import {
	getComparisonRefsForPullRequest,
	getPullRequestIdentityFromMaybeUrl,
	getRepositoryIdentityForPullRequest,
	isMaybeNonSpecificPullRequestSearchUrl,
} from '@gitlens/git/utils/pullRequest.utils.js';
import { gitSuffixRegex } from '@gitlens/git/utils/remote.utils.js';
import type { CloudGitSelfManagedHostIntegrationIds, IntegrationIds } from '@gitlens/integrations/constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '@gitlens/integrations/constants.js';
import type { ConnectionStateChangeEvent } from '@gitlens/integrations/integrationService.js';
import type { GitHostIntegration } from '@gitlens/integrations/models/gitHostIntegration.js';
import type { IntegrationResult } from '@gitlens/integrations/models/integration.js';
import { isMaybeGitHubPullRequestUrl } from '@gitlens/integrations/providers/github/github.utils.js';
import { isMaybeGitLabPullRequestUrl } from '@gitlens/integrations/providers/gitlab/gitlab.utils.js';
import type {
	EnrichablePullRequest,
	ProviderAccount,
	ProviderActionablePullRequest,
} from '@gitlens/integrations/providers/models.js';
import {
	getActionablePullRequests,
	toProviderPullRequestWithUniqueId,
} from '@gitlens/integrations/providers/models.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { md5 } from '@gitlens/utils/crypto.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { filterMap, groupByMap, map, some } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { TimedResult } from '@gitlens/utils/promise.js';
import { getSettledValue, timedWithSlowThreshold } from '@gitlens/utils/promise.js';
import type { Container } from '../../container.js';
import { openComparisonChanges } from '../../git/actions/commit.js';
import type { GlRepository } from '../../git/models/repository.js';
import { getOrOpenPullRequestRepository } from '../../git/utils/-webview/pullRequest.utils.js';
import { getCancellationTokenId, toAbortSignal } from '../../system/-webview/cancellation.js';
import { executeCommand, registerCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { getContext, setContext } from '../../system/-webview/context.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import { gate } from '../../system/decorators/gate.js';
import type { UriTypes } from '../../uris/deepLinks/deepLink.js';
import { DeepLinkActionType, DeepLinkType } from '../../uris/deepLinks/deepLink.js';
import {
	confirmPullRequestMerge,
	mergePullRequestWithProgress,
} from '../integrations/utils/-webview/pullRequest.merge.utils.js';
import {
	convertIntegrationIdToEnrichProvider,
	convertRemoteProviderIdToEnrichProvider,
	isEnrichableIntegrationId,
	isEnrichableRemoteProviderId,
} from './enrichmentService.js';
import type { EnrichableItem, EnrichedItem } from './models/enrichedItem.js';
import type { LaunchpadAction, LaunchpadActionCategory, LaunchpadGroup } from './models/launchpad.js';
import {
	launchpadActionCategories,
	launchpadCategoryToGroupMap,
	launchpadGroups,
	prActionsMap,
	sharedCategoryToLaunchpadActionCategoryMap,
} from './models/launchpad.js';

export function getSuggestedActions(category: LaunchpadActionCategory, isCurrentBranch: boolean): LaunchpadAction[] {
	const actions = [...prActionsMap.get(category)!];

	// Offer an agent-driven PR review on every item, gated on AI being enabled (org + user setting).
	if (getContext('gitlens:ai:allowed', true)) {
		actions.push('start-review');
	}

	if (isCurrentBranch) {
		actions.push('show-overview', 'open-changes', 'open-in-graph');
	} else {
		actions.push('open-worktree', 'switch', 'open-in-graph');
	}
	return actions;
}

export type LaunchpadPullRequest = EnrichablePullRequest & ProviderActionablePullRequest;

export type LaunchpadItem = LaunchpadPullRequest & {
	currentViewer: Account;
	isNew: boolean;
	isSearched: boolean;
	actionableCategory: LaunchpadActionCategory;
	suggestedActions: LaunchpadAction[];
	openRepository?: OpenRepository;

	underlyingPullRequest: PullRequest;
};

export type OpenRepository = {
	repo: GlRepository;
	remote?: GitRemote;
	localBranch?: GitBranch;
};

type CachedLaunchpadPromise<T> = {
	expiresAt: number;
	promise: Promise<T | undefined>;
	/** Whether the promise is still in flight */
	pending: boolean;
	/** Whether the fetch was started with a cancellation token */
	cancellable: boolean;
	/** When the fetch was started, so a hung promise can't be reused forever */
	startedAt: number;
};

const cacheExpiration = 1000 * 60 * 30; // 30 minutes
const errorCacheExpiration = 1000 * 60; // 1 minute
const inFlightReuseWindow = 1000 * 30; // 30 seconds

function createCachedPromise<T>(promise: Promise<T | undefined>, cancellable: boolean): CachedLaunchpadPromise<T> {
	const cached: CachedLaunchpadPromise<T> = {
		expiresAt: Date.now() + cacheExpiration,
		promise: promise,
		pending: true,
		cancellable: cancellable,
		startedAt: Date.now(),
	};

	// Hold a failure for far less time than a success, so a transient outage (an expired token at startup, say)
	// doesn't leave every reader stuck on it for the full cache window. A short window rather than no window at
	// all keeps a sustained outage from turning each of Launchpad's several readers into its own request.
	const settled = (outcome: 'ok' | 'failed' | 'cancelled') => {
		cached.pending = false;
		if (outcome === 'cancelled') {
			// A cancelled fetch says nothing about the data — expire it so the next reader refetches rather
			// than inheriting one caller's abort (the cache is shared across callers with different tokens)
			cached.expiresAt = 0;
		} else if (outcome === 'failed') {
			cached.expiresAt = Math.min(cached.expiresAt, Date.now() + errorCacheExpiration);
		}
	};
	// Use `then` rather than `finally` so we never create an unhandled rejection
	void promise.then(
		value => {
			// An integration failure resolves as a value carrying `error` rather than rejecting. Only treat it
			// as a failure when nothing usable came back — a partial success carries `error` alongside `value`
			// and deserves the full cache window.
			const result = value as { value?: unknown; error?: unknown } | undefined;
			const hasValue = Array.isArray(result?.value) ? result.value.length > 0 : result?.value != null;
			settled(result?.error != null && !hasValue ? 'failed' : 'ok');
		},
		(ex: unknown) => settled(isCancellationError(ex) ? 'cancelled' : 'failed'),
	);

	return cached;
}

/** Whether a forced fetch can join `cached` rather than starting a second one. Declines when either side
 * carries a cancellation token (one caller's cancellation would abort it for everyone), and when the
 * in-flight fetch is old enough to be considered hung — otherwise a stalled promise would pin the entry
 * `pending` forever and turn every forced refresh into a no-op. */
function canReuseInFlight(
	cached: CachedLaunchpadPromise<unknown> | undefined,
	cancellation?: CancellationToken,
): boolean {
	if (cached?.pending !== true || cached.cancellable || cancellation != null) return false;

	return Date.now() - cached.startedAt < inFlightReuseWindow;
}

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
export function isSupportedLaunchpadIntegrationId(id: string): id is SupportedLaunchpadIntegrationIds {
	return supportedLaunchpadIntegrations.includes(id as SupportedLaunchpadIntegrationIds);
}

/**
 * Rewrites whichever of a pull request's people are the viewer onto the account's own id, so the shared
 * categorizer's viewer match — author, assignees and reviewers compared to the viewer by `id` alone —
 * actually lands. It doesn't otherwise wherever the account and the pull request's people are keyed in
 * different namespaces, and every viewer-relative category then silently disappears. GitHub fetched
 * provider-natively is the one path that does that: every account carries the provider's own id, and the
 * providers-api keys a pull request's people the same way, but GitHub's native fetch keys them by login.
 * Everywhere else both sides already agree, so this is a no-op that costs one `Set` miss.
 *
 * The handle comes off our own model's members rather than the provider-shaped copies: `toProviderAccount`
 * fills their `username` from the display name, so on that path they no longer carry a handle to match on.
 * Everyone whose handle isn't the account's is left exactly as-is, so the blast radius of a bad match is
 * the viewer's own rows.
 *
 * Callers canonicalize at the seam where they build the provider-shaped inputs, because that's the only
 * place both halves — our model for the handles, the account for the id — are in hand.
 */
export function canonicalizeViewerIdentity(
	providerPr: PullRequestWithUniqueID,
	pr: PullRequest,
	account: Account,
): PullRequestWithUniqueID {
	// Ids matching the account's need no rewrite; this collects the ones only the handle can identify.
	const viewerIds = new Set<string>();
	const collect = (member: PullRequestMember | undefined) => {
		if (account.username && member?.username === account.username && member.id) {
			viewerIds.add(member.id);
		}
	};

	collect(pr.author);
	pr.assignees?.forEach(collect);
	pr.reviewRequests?.forEach(r => collect(r.reviewer));
	pr.latestReviews?.forEach(r => collect(r.reviewer));
	if (!viewerIds.size) return providerPr;

	const rewrite = (person: ProviderAccount) => (viewerIds.has(person.id) ? { ...person, id: account.id } : person);

	return {
		...providerPr,
		author: providerPr.author != null ? rewrite(providerPr.author) : providerPr.author,
		assignees: providerPr.assignees?.map(rewrite) ?? providerPr.assignees,
		reviews: providerPr.reviews?.map(r => ({ ...r, reviewer: rewrite(r.reviewer) })) ?? providerPr.reviews,
	};
}

// TODO: Switch to using getActionablePullRequests from the shared provider library
// once it supports passing in multiple current users, one for each provider
/** Splits pull requests by integration so each batch is categorized against that provider's current
 *  user, since the shared library takes a single viewer. Shared with the graph's PRs panel, which
 *  categorizes without the enrichment (pin/snooze) half.
 *
 *  `options.viewer: 'none'` categorizes with no viewer at all — see below. */
export function categorizePullRequests(
	pullRequests: (PullRequestWithUniqueID & { provider: { id: string } })[],
	currentUsers: Map<string, Account> | undefined,
	options?: { enrichedItemsByUniqueId?: EnrichedItemsByUniqueId; viewer?: 'current' | 'none' },
): ProviderActionablePullRequest[] {
	// The last resort for a caller that can't resolve an account at all. It gives up every viewer-relative
	// category (`needsMyReview` becomes unreachable) and, worse, ungates every author-side one, so each fires
	// for every pull request — a caller asking for it owes its rows the demotions that keeps honest, at
	// minimum dropping `unassignedReviewers`, which is true of anything nobody has been asked to review yet.
	// Prefer resolving the account: viewer-relative categories only need the account and the pull request's
	// people to share an id namespace, which `canonicalizeViewerIdentity` gives callers on the one path
	// (GitHub fetched provider-natively) that doesn't already agree.
	if (options?.viewer === 'none') return getActionablePullRequests(pullRequests, null, options);

	const pullRequestsByIntegration = groupByMap<string, PullRequestWithUniqueID & { provider: { id: string } }>(
		pullRequests,
		pr => pr.provider.id,
	);

	const actionablePullRequests: ProviderActionablePullRequest[] = [];
	for (const [integrationId, prs] of pullRequestsByIntegration.entries()) {
		const currentUser = currentUsers?.get(integrationId);
		if (currentUser == null) {
			Logger.warn(`No current user for integration ${integrationId}`);
			continue;
		}

		const actionablePrs = getActionablePullRequests(prs, { id: currentUser.id }, options);
		actionablePullRequests.push(...actionablePrs);
	}

	return actionablePullRequests;
}

export type LaunchpadCategorizedResult =
	| {
			items: LaunchpadItem[];
			timings?: LaunchpadCategorizedTimings;
			error?: Error;
	  }
	| {
			error: Error;
			items?: never;
	  };

export interface LaunchpadCategorizedTimings {
	prs: number | undefined;
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

	private _prs: CachedLaunchpadPromise<IntegrationResult<PullRequest[] | undefined>> | undefined;
	@trace({ args: options => ({ options: `force=${options?.force}` }) })
	private async getPullRequests(options?: { cancellation?: CancellationToken; force?: boolean }) {
		// A forced fetch joins one already in flight rather than starting a second one
		const reusable = canReuseInFlight(this._prs, options?.cancellation);
		if (this._prs == null || this._prs.expiresAt < Date.now() || (options?.force && !reusable)) {
			this._prs = createCachedPromise(
				this.fetchPullRequests(options?.cancellation),
				options?.cancellation != null,
			);
		}

		return this._prs?.promise;
	}

	@trace({ args: false })
	private async fetchPullRequests(cancellation?: CancellationToken) {
		const scope = getScopedLogger();

		try {
			const result = await withDurationAndSlowEventOnTimeout(
				this.container.integrations.getMyPullRequests(
					supportedLaunchpadIntegrations,
					toAbortSignal(cancellation),
					true,
				),
				'getMyPullRequests',
				this.container,
			);
			return result.value;
		} catch (ex) {
			scope?.error(ex, 'Failed to get pull requests');
			throw ex;
		}
	}

	private async getSearchedPullRequests(search: string, cancellation?: CancellationToken) {
		const connectedIntegrations = await this.getConnectedIntegrations();
		const prUrlIdentity: PullRequestUrlIdentity | undefined = await this.getPullRequestIdentityFromSearch(
			search,
			connectedIntegrations,
		);
		const result: { readonly value: PullRequest[]; duration: number; error?: Error } = {
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
				integration?.searchPullRequests(search, undefined, toAbortSignal(cancellation)),
				'searchPullRequests',
				this.container,
			);
			if (prs != null) {
				return { value: prs.value, duration: prs.duration };
			}
			return undefined;
		};

		const searchIntegrationPRs = prUrlIdentity ? findByPrIdentity : findByQuery;

		const results = await Promise.allSettled(
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

		// Surface search failures instead of silently reporting them as "no results"
		const errors = [
			...filterMap(results, r =>
				r.status === 'rejected'
					? r.reason instanceof Error
						? r.reason
						: new Error(String(r.reason))
					: undefined,
			),
		];
		if (errors.length) {
			result.error =
				errors.length === 1 ? errors[0] : new AggregateError(errors, 'Failed to search some pull requests');
		}

		return result;
	}

	private _enrichedItems: CachedLaunchpadPromise<TimedResult<EnrichedItem[]>> | undefined;
	@trace({ args: options => ({ options: `force=${options?.force}` }) })
	private async getEnrichedItems(options?: { cancellation?: CancellationToken; force?: boolean }) {
		// A forced fetch joins one already in flight rather than starting a second one
		const reusable = canReuseInFlight(this._enrichedItems, options?.cancellation);
		if (
			this._enrichedItems == null ||
			this._enrichedItems.expiresAt < Date.now() ||
			(options?.force && !reusable)
		) {
			this._enrichedItems = createCachedPromise(
				withDurationAndSlowEventOnTimeout(
					this.container.enrichments.get(undefined, options?.cancellation),
					'getEnrichedItems',
					this.container,
				),
				options?.cancellation != null,
			);
		}

		return this._enrichedItems?.promise;
	}

	@debug()
	refresh(): void {
		this._prs = undefined;
		this._enrichedItems = undefined;

		this._onDidChange.fire();
	}

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
	async pin(item: LaunchpadItem): Promise<void> {
		item.viewer.pinned = true;
		this._onDidChange.fire();

		await this.container.enrichments.pinItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
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

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
	async snooze(item: LaunchpadItem): Promise<void> {
		item.viewer.snoozed = true;
		this._onDidChange.fire();

		await this.container.enrichments.snoozeItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
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

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
	async merge(item: LaunchpadItem): Promise<void> {
		if (item.headRef?.oid == null) return;

		const integrationId = item.provider.id;
		if (!isSupportedLaunchpadIntegrationId(integrationId)) return;

		if (!(await confirmPullRequestMerge(item.underlyingPullRequest))) return;

		const integration = await this.container.integrations.get(integrationId);
		if (integration == null) return;

		await mergePullRequestWithProgress(integration, item.underlyingPullRequest);
		// Even a failed stacked merge can have landed lower layers before failing, so refresh regardless of outcome
		this.refresh();
	}

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
	open(item: LaunchpadItem): void {
		if (item.url == null) return;

		void openUrl(item.url);
		this._prs = undefined;
	}

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
	async switchTo(item: LaunchpadItem, options?: { openInWorktree?: boolean }): Promise<void> {
		if (item.openRepository?.localBranch?.current) {
			void executeCommand('gitlens.showGraph', {
				action: 'show-wip',
				target: { sha: uncommitted, worktreePath: item.openRepository.repo.path },
				source: { source: 'launchpad' },
			});
			return;
		}

		const deepLinkUrl = this.getItemBranchDeepLink(
			item,
			options?.openInWorktree
				? DeepLinkActionType.SwitchToPullRequestWorktree
				: DeepLinkActionType.SwitchToPullRequest,
		);
		if (deepLinkUrl == null) return;

		const prRepo = options?.openInWorktree
			? await getOrOpenPullRequestRepository(this.container, item.underlyingPullRequest, {
					skipVirtual: true,
				})
			: undefined;
		await this.container.deepLinks.processDeepLinkUri(deepLinkUrl, false, prRepo);
	}

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
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

	@debug({ args: item => ({ item: `${item.id} (${item.provider.name} ${item.type})` }) })
	async openInGraph(item: LaunchpadItem): Promise<void> {
		const deepLinkUrl = this.getItemBranchDeepLink(item);
		if (deepLinkUrl == null) return;

		await this.container.deepLinks.processDeepLinkUri(deepLinkUrl, false);
	}

	generateWebUrl(): Promise<string> {
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
		matchingRemoteMap: Map<string, [GlRepository, GitRemote]>,
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
				uniqueRemoteUrls.add(item.repoIdentity.remote.url.replace(gitSuffixRegex, ''));
			}
		}

		// Get the repo/remote pairs for the unique remote urls
		const repoRemotes = new Map<string, [GlRepository, GitRemote]>();

		async function matchRemotes(repo: GlRepository) {
			if (uniqueRemoteUrls.size === 0) return;

			const remotes = await repo.git.remotes.getRemotes();

			for (const remote of remotes) {
				if (uniqueRemoteUrls.size === 0) return;

				const remoteUrl = remote.url.replace(gitSuffixRegex, '');
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

	@gate(
		(o, c) =>
			`${o?.force ?? false}|${
				o?.search != null && typeof o.search !== 'string' ? o.search.map(pr => pr.url).join(',') : o?.search
			}${getCancellationTokenId(c)}`,
	)
	@debug({ args: options => ({ options: `force=${options?.force}` }) })
	async getCategorizedItems(
		options?: { force?: boolean; search?: string | PullRequest[] },
		cancellation?: CancellationToken,
	): Promise<LaunchpadCategorizedResult> {
		const scope = getScopedLogger();

		const isSearching = ((o): o is RequireSome<NonNullable<typeof options>, 'search'> => Boolean(o?.search))(
			options,
		);
		// Include the expired case: the shortened error TTL repairs a stuck failure via an unforced read, and
		// consumers only learn about it through `onDidRefresh`
		const fireRefresh = !isSearching && (options?.force || this._prs == null || this._prs.expiresAt < Date.now());

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
			const [_, enrichedItemsResult, prsResult] = await Promise.allSettled([
				this.container.git.isDiscoveringRepositories,
				this.getEnrichedItems({ force: options?.force, cancellation: cancellation }),
				isSearching
					? typeof options.search === 'string'
						? this.getSearchedPullRequests(options.search, cancellation)
						: { value: options.search, duration: 0, error: undefined }
					: this.getPullRequests({ force: options?.force, cancellation: cancellation }),
			]);

			if (cancellation?.isCancellationRequested) throw new CancellationError();

			if (prsResult.status === 'rejected') {
				scope?.error(prsResult.reason, 'Failed to get pull requests');
				result = {
					error: prsResult.reason instanceof Error ? prsResult.reason : new Error(String(prsResult.reason)),
				};
				return result;
			}

			const enrichedItems = getSettledValue(enrichedItemsResult);
			const prs = getSettledValue(prsResult);

			if (prs?.value == null) {
				if (prs?.error != null) {
					scope?.error(prs.error, 'Failed to get pull requests');
				}
				result = {
					items: [],
					timings: { prs: prs?.duration, enrichedItems: enrichedItems?.duration },
					error: prs?.error,
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

				// Keyed the same way `categorizePullRequests` groups below, so a pull request is canonicalized
				// against the very account it is then categorized against.
				const account = myAccounts.get(providerId);

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
					...(account != null ? canonicalizeViewerIdentity(providerPr, pr, account) : providerPr),
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
			const actionableItems = categorizePullRequests(
				inputPrs.filter((i: EnrichablePullRequest | undefined): i is EnrichablePullRequest => i != null),
				myAccounts,
				{ enrichedItemsByUniqueId: enrichedItemsByEntityId },
			) as LaunchpadPullRequest[];

			// Get the unique remote urls
			const mappedRemotesPromise = await this.getMatchingRemoteMap(actionableItems);

			// Map from shared category label to local actionable category, and get suggested actions
			const categorized = await Promise.allSettled(
				actionableItems.map<Promise<LaunchpadItem>>(async item => {
					let actionableCategory = sharedCategoryToLaunchpadActionCategoryMap.get(
						item.suggestedActionCategory,
					)!;
					// category overrides
					if (!options?.search && staleDate != null && item.updatedDate.getTime() < staleDate.getTime()) {
						actionableCategory = 'other';
					}

					const openRepository = await this.getMatchingOpenRepository(item, mappedRemotesPromise);

					const suggestedActions = getSuggestedActions(
						actionableCategory,
						openRepository?.localBranch?.current ?? false,
					);

					return {
						...item,
						currentViewer: myAccounts.get(item.provider.id)!,
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
				timings: { prs: prs.duration, enrichedItems: enrichedItems?.duration },
				error: prs.error,
			};

			if (result.error != null && result.items.length > 0) {
				scope?.warn(
					`Partial failure: Retrieved ${result.items.length} items but some integrations failed: ${result.error.message}`,
				);
			}

			return result;
		} catch (ex) {
			// A cancelled run isn't a failure — let it propagate so `result` stays unset and the `finally` below
			// doesn't broadcast it on `onDidRefresh` as one
			if (isCancellationError(ex)) throw ex;

			// Other post-fetch work (repo matching, account lookup) can throw. Return it as an `{ error }` result
			// rather than rejecting, so consumers get the documented shape and `onDidRefresh` still fires.
			scope?.error(ex, 'Failed to get categorized items');
			result = { error: ex instanceof Error ? ex : new Error(String(ex)) };
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
	// Typed on the fields the link carries, so callers holding only a PR's identity + refs can build one
	pr: Pick<PullRequest, 'id' | 'title' | 'provider' | 'refs'>,
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
	name: 'getPullRequest' | 'searchPullRequests' | 'getMyPullRequests' | 'getEnrichedItems',
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
