import type { CancellationToken, ConfigurationChangeEvent } from 'vscode';
import { Disposable, env, EventEmitter, Uri, window } from 'vscode';
import { md5 } from '@env/crypto';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import { openComparisonChanges } from '../../git/actions/commit';
import type { Account } from '../../git/models/author';
import type { GitBranch } from '../../git/models/branch';
import { getLocalBranchByUpstream } from '../../git/models/branch';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import { getComparisonRefsForPullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';
import type { CodeSuggestionCounts, Draft } from '../../gk/models/drafts';
import { executeCommand, registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { debug, log } from '../../system/decorators/log';
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
import type { EnrichablePullRequest, ProviderActionablePullRequest } from '../integrations/providers/models';
import {
	getActionablePullRequests,
	HostingIntegrationId,
	toProviderPullRequestWithUniqueId,
} from '../integrations/providers/models';
import type { EnrichableItem, EnrichedItem } from './enrichmentService';

export const focusActionCategories = [
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
export type FocusActionCategory = (typeof focusActionCategories)[number];

export const focusGroups = [
	'current-branch',
	'pinned',
	'mergeable',
	'blocked',
	'follow-up',
	// 'needs-attention',
	'needs-review',
	'waiting-for-review',
	'draft',
	'other',
	'snoozed',
] as const;
export type FocusGroup = (typeof focusGroups)[number];

export const focusCategoryToGroupMap = new Map<FocusActionCategory, FocusGroup>([
	// ['pinned', 'pinned'],
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
	// ['snoozed', 'snoozed'],
]);

export const sharedCategoryToFocusActionCategoryMap = new Map<string, FocusActionCategory>([
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

export type FocusAction =
	| 'merge'
	| 'open'
	| 'soft-open'
	| 'switch'
	| 'switch-and-code-suggest'
	| 'code-suggest'
	| 'show-overview'
	| 'open-changes'
	| 'open-in-graph';

export type FocusTargetAction = {
	action: 'open-suggestion';
	target: string;
};

const prActionsMap = new Map<FocusActionCategory, FocusAction[]>([
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

export function getSuggestedActions(category: FocusActionCategory, isCurrentBranch: boolean): FocusAction[] {
	const actions = [...prActionsMap.get(category)!];
	if (isCurrentBranch) {
		actions.push('show-overview', 'open-changes', 'code-suggest', 'open-in-graph');
	} else {
		actions.push('switch', 'switch-and-code-suggest', 'open-in-graph');
	}
	return actions;
}

export type FocusPullRequest = EnrichablePullRequest & ProviderActionablePullRequest;

export type FocusItem = FocusPullRequest & {
	currentViewer: Account;
	codeSuggestionsCount: number;
	codeSuggestions?: TimedResult<Draft[]>;
	isNew: boolean;
	actionableCategory: FocusActionCategory;
	suggestedActions: FocusAction[];
	openRepository?: OpenRepository;
};

export type OpenRepository = {
	repo: Repository;
	remote: GitRemote;
	localBranch?: GitBranch;
};

type CachedFocusPromise<T> = {
	expiresAt: number;
	promise: Promise<T | undefined>;
};

const cacheExpiration = 1000 * 60 * 30; // 30 minutes

type PullRequestsWithSuggestionCounts = {
	prs: IntegrationResult<SearchedPullRequest[] | undefined> | undefined;
	suggestionCounts: TimedResult<CodeSuggestionCounts | undefined> | undefined;
};

export type FocusRefreshEvent = FocusCategorizedResult;

export const supportedFocusIntegrations = [HostingIntegrationId.GitHub];

export type FocusCategorizedResult =
	| {
			items: FocusItem[];
			timings?: FocusCategorizedTimings;
			error?: never;
	  }
	| {
			error: Error;
			items?: never;
	  };

export interface FocusCategorizedTimings {
	prs: number | undefined;
	codeSuggestionCounts: number | undefined;
	enrichedItems: number | undefined;
}

export class FocusProvider implements Disposable {
	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange() {
		return this._onDidChange.event;
	}

	private readonly _onDidRefresh = new EventEmitter<FocusRefreshEvent>();
	get onDidRefresh() {
		return this._onDidRefresh.event;
	}

	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			...this.registerCommands(),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	// private _issues: CachedFocusPromise<SearchedIssue[]> | undefined;
	// private async getIssues(options?: { cancellation?: CancellationToken; force?: boolean }) {
	// 	if (options?.force || this._issues == null || this._issues.expiresAt < Date.now()) {
	// 		this._issues = {
	// 			promise: this.container.integrations.getMyIssues([HostingIntegrationId.GitHub], options?.cancellation),
	// 			expiresAt: Date.now() + cacheExpiration,
	// 		};
	// 	}

	// 	return this._issues?.promise;
	// }

	private _prs: CachedFocusPromise<PullRequestsWithSuggestionCounts> | undefined;
	@debug<FocusProvider['getPullRequestsWithSuggestionCounts']>({ args: { 0: o => `force=${o?.force}` } })
	private async getPullRequestsWithSuggestionCounts(options?: { cancellation?: CancellationToken; force?: boolean }) {
		if (options?.force || this._prs == null || this._prs.expiresAt < Date.now()) {
			this._prs = {
				promise: this.fetchPullRequestsWithSuggestionCounts(options?.cancellation),
				expiresAt: Date.now() + cacheExpiration,
			};
		}

		return this._prs?.promise;
	}

	@debug<FocusProvider['fetchPullRequestsWithSuggestionCounts']>({ args: false })
	private async fetchPullRequestsWithSuggestionCounts(cancellation?: CancellationToken) {
		const scope = getLogScope();

		const [prsResult, subscriptionResult] = await Promise.allSettled([
			withDurationAndSlowEventOnTimeout(
				this.container.integrations.getMyPullRequests([HostingIntegrationId.GitHub], cancellation),
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

	private _enrichedItems: CachedFocusPromise<TimedResult<EnrichedItem[]>> | undefined;
	@debug<FocusProvider['getEnrichedItems']>({ args: { 0: o => `force=${o?.force}` } })
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

	private _codeSuggestions: Map<string, CachedFocusPromise<TimedResult<Draft[]>>> | undefined;
	@debug<FocusProvider['getCodeSuggestions']>({
		args: { 0: i => `${i.id} (${i.provider.name} ${i.type})`, 1: o => `force=${o?.force}` },
	})
	private async getCodeSuggestions(item: FocusItem, options?: { force?: boolean }) {
		if (item.codeSuggestionsCount < 1) return undefined;

		if (this._codeSuggestions == null || options?.force) {
			this._codeSuggestions = new Map<string, CachedFocusPromise<TimedResult<Draft[]>>>();
		}

		if (
			options?.force ||
			!this._codeSuggestions.has(item.uuid) ||
			this._codeSuggestions.get(item.uuid)!.expiresAt < Date.now()
		) {
			this._codeSuggestions.set(item.uuid, {
				promise: withDurationAndSlowEventOnTimeout(
					this.container.drafts.getCodeSuggestions(item, HostingIntegrationId.GitHub, {
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
		// this._issues = undefined;
		this._prs = undefined;
		this._enrichedItems = undefined;
		this._codeSuggestions = undefined;

		this._onDidChange.fire();
	}

	@log<FocusProvider['pin']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async pin(item: FocusItem) {
		item.viewer.pinned = true;
		this._onDidChange.fire();

		await this.container.enrichments.pinItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<FocusProvider['unpin']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async unpin(item: FocusItem) {
		item.viewer.pinned = false;
		this._onDidChange.fire();

		if (item.viewer.enrichedItems == null) return;
		const pinned = item.viewer.enrichedItems.find(e => e.type === 'pin');
		if (pinned == null) return;
		await this.container.enrichments.unpinItem(pinned.id);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<FocusProvider['snooze']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async snooze(item: FocusItem) {
		item.viewer.snoozed = true;
		this._onDidChange.fire();

		await this.container.enrichments.snoozeItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<FocusProvider['unsnooze']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async unsnooze(item: FocusItem) {
		item.viewer.snoozed = false;
		this._onDidChange.fire();

		if (item.viewer.enrichedItems == null) return;
		const snoozed = item.viewer.enrichedItems.find(e => e.type === 'snooze');
		if (snoozed == null) return;
		await this.container.enrichments.unsnoozeItem(snoozed.id);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	@log<FocusProvider['merge']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async merge(item: FocusItem): Promise<void> {
		if (item.graphQLId == null || item.headRef?.oid == null) return;
		// TODO: Include other providers.
		if (item.provider.id !== 'github') return;
		const confirm = await window.showQuickPick(['Merge', 'Cancel'], {
			placeHolder: `Are you sure you want to merge ${item.headRef?.name ?? 'this pull request'}${
				item.baseRef?.name ? ` into ${item.baseRef.name}` : ''
			}? This cannot be undone.`,
		});
		if (confirm !== 'Merge') return;
		const integrations = await this.container.integrations.get(HostingIntegrationId.GitHub);
		await integrations.mergePullRequest({ id: item.graphQLId, headRefSha: item.headRef.oid });
		this.refresh();
	}

	@log<FocusProvider['open']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	open(item: FocusItem): void {
		if (item.url == null) return;
		void openUrl(item.url);
		this._prs = undefined;
	}

	@log<FocusProvider['openCodeSuggestion']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	openCodeSuggestion(item: FocusItem, target: string) {
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

	@log<FocusProvider['switchTo']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async switchTo(item: FocusItem, startCodeSuggestion: boolean = false): Promise<void> {
		if (item.openRepository?.localBranch?.current) {
			void showInspectView({
				type: 'wip',
				inReview: startCodeSuggestion,
				repository: item.openRepository.repo,
				source: 'launchpad',
			} satisfies ShowWipArgs);
			return;
		}

		const deepLinkUrl = this.getItemBranchDeepLink(
			item,
			startCodeSuggestion
				? DeepLinkActionType.SwitchToAndSuggestPullRequest
				: DeepLinkActionType.SwitchToPullRequest,
		);
		if (deepLinkUrl == null) return;

		this._codeSuggestions?.delete(item.uuid);
		await this.container.deepLinks.processDeepLinkUri(deepLinkUrl, false);
	}

	@log<FocusProvider['openChanges']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async openChanges(item: FocusItem) {
		if (!item.openRepository?.localBranch?.current) return;
		await this.switchTo(item);
		if (item.refs != null) {
			const refs = await getComparisonRefsForPullRequest(
				this.container,
				item.openRepository.repo.path,
				item.refs,
			);
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

	@log<FocusProvider['openInGraph']>({ args: { 0: i => `${i.id} (${i.provider.name} ${i.type})` } })
	async openInGraph(item: FocusItem) {
		const deepLinkUrl = this.getItemBranchDeepLink(item);
		if (deepLinkUrl == null) return;
		await this.container.deepLinks.processDeepLinkUri(deepLinkUrl, false);
	}

	private getItemBranchDeepLink(item: FocusItem, action?: DeepLinkActionType): Uri | undefined {
		if (item.type !== 'pullrequest' || item.headRef == null || item.repoIdentity?.remote?.url == null)
			return undefined;
		const schemeOverride = configuration.get('deepLinks.schemeOverride');
		const scheme = typeof schemeOverride === 'string' ? schemeOverride : env.uriScheme;

		const branchName =
			action == null && item.openRepository?.localBranch?.current
				? item.openRepository.localBranch.name
				: item.headRef.name;

		// TODO: Get the proper pull URL from the provider, rather than tacking .git at the end of the
		// url from the head ref.
		return Uri.parse(
			`${scheme}://${this.container.context.extension.id}/${'link' satisfies UriTypes}/${
				DeepLinkType.Repository
			}/-/${DeepLinkType.Branch}/${branchName}?url=${encodeURIComponent(
				ensureRemoteUrl(item.repoIdentity.remote.url),
			)}${action != null ? `&action=${action}` : ''}`,
		);
	}

	private async getMatchingOpenRepository(
		pr: EnrichablePullRequest,
		matchingRemoteMap: Map<string, [Repository, GitRemote]>,
	): Promise<OpenRepository | undefined> {
		if (pr.repoIdentity.remote.url == null) return undefined;

		const match = matchingRemoteMap.get(pr.repoIdentity.remote.url);
		if (match == null) return undefined;

		const [repo, remote] = match;
		const remoteBranchName = `${remote.name}/${pr.refs?.head.branch ?? pr.headRef?.name}`;
		const matchingLocalBranch = await getLocalBranchByUpstream(repo, remoteBranchName);

		return { repo: repo, remote: remote, localBranch: matchingLocalBranch };
	}

	private async getMatchingRemoteMap(actionableItems: FocusPullRequest[]) {
		const uniqueRemoteUrls = new Set<string>();
		for (const item of actionableItems) {
			if (item.repoIdentity.remote.url != null) {
				uniqueRemoteUrls.add(item.repoIdentity.remote.url);
			}
		}

		// Get the repo/remote pairs for the unique remote urls
		const repoRemotes = new Map<string, [Repository, GitRemote]>();

		for (const repo of this.container.git.openRepositories) {
			const remotes = await repo.getRemotes();
			for (const remote of remotes) {
				if (uniqueRemoteUrls.has(remote.url)) {
					repoRemotes.set(remote.url, [repo, remote]);
					uniqueRemoteUrls.delete(remote.url);

					if (uniqueRemoteUrls.size === 0) return repoRemotes;
				} else {
					for (const url of uniqueRemoteUrls) {
						if (remote.matches(url)) {
							repoRemotes.set(url, [repo, remote]);
							uniqueRemoteUrls.delete(url);

							if (uniqueRemoteUrls.size === 0) return repoRemotes;

							break;
						}
					}
				}
			}
		}

		return repoRemotes;
	}

	@log<FocusProvider['getCategorizedItems']>({ args: { 0: o => `force=${o?.force}`, 1: false } })
	async getCategorizedItems(
		options?: { force?: boolean },
		cancellation?: CancellationToken,
	): Promise<FocusCategorizedResult> {
		const scope = getLogScope();

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

		let result: FocusCategorizedResult | undefined;

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

			const github = await this.container.integrations.get(HostingIntegrationId.GitHub);
			const myAccount = await github.getCurrentAccount();

			const inputPrs: EnrichablePullRequest[] = filteredPrs.map(pr => {
				const providerPr = toProviderPullRequestWithUniqueId(pr.pullRequest);

				const enrichable = {
					type: 'pr',
					id: providerPr.uuid,
					url: pr.pullRequest.url,
					provider: 'github',
				} satisfies EnrichableItem;

				const repoIdentity = {
					remote: {
						url: pr.pullRequest.refs?.head?.url,
						domain: pr.pullRequest.provider.domain,
					},
					name: pr.pullRequest.repository.repo,
					provider: {
						id: pr.pullRequest.provider.id,
						domain: pr.pullRequest.provider.domain,
						repoDomain: pr.pullRequest.repository.owner,
						repoName: pr.pullRequest.repository.repo,
					},
				};

				return {
					...providerPr,
					type: 'pullrequest',
					uuid: providerPr.uuid,
					provider: pr.pullRequest.provider,
					enrichable: enrichable,
					repoIdentity: repoIdentity,
					refs: pr.pullRequest.refs,
				};
			}) satisfies EnrichablePullRequest[];

			// Note: The expected output of this is ActionablePullRequest[], but we are passing in EnrichablePullRequest,
			// so we need to cast the output as FocusPullRequest[].
			const actionableItems = getActionablePullRequests(
				inputPrs,
				{ id: myAccount!.username! },
				{ enrichedItemsByUniqueId: enrichedItemsByEntityId },
			) as FocusPullRequest[];

			// Get the unique remote urls
			const mappedRemotesPromise = await this.getMatchingRemoteMap(actionableItems);

			const { suggestionCounts } = prsWithSuggestionCounts!;

			// Map from shared category label to local actionable category, and get suggested actions
			const categorized = (await Promise.all(
				actionableItems.map(async item => {
					const codeSuggestionsCount = suggestionCounts?.value?.[item.uuid]?.count ?? 0;

					let actionableCategory = sharedCategoryToFocusActionCategoryMap.get(item.suggestedActionCategory)!;
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
						currentViewer: myAccount!,
						codeSuggestionsCount: codeSuggestionsCount,
						isNew: this.isItemNewInGroup(item, actionableCategory),
						actionableCategory: actionableCategory,
						suggestedActions: suggestedActions,
						openRepository: openRepository,
					};
				}),
			)) satisfies FocusItem[];

			result = {
				items: categorized,
				timings: {
					prs: prsWithSuggestionCounts?.prs?.duration,
					codeSuggestionCounts: prsWithSuggestionCounts?.suggestionCounts?.duration,
					enrichedItems: enrichedItems?.duration,
				},
			};
			return result;
		} finally {
			if (result != null) {
				this.updateGroupedIds(result.items ?? []);
				this._onDidRefresh.fire(result);
			}
		}
	}

	private _groupedIds: Set<string> | undefined;

	private isItemNewInGroup(item: FocusPullRequest, actionableCategory: FocusActionCategory) {
		return (
			this._groupedIds != null &&
			!this._groupedIds.has(`${item.uuid}:${focusCategoryToGroupMap.get(actionableCategory)}`)
		);
	}

	private updateGroupedIds(items: FocusItem[]) {
		const groupedIds = new Set<string>();
		for (const item of items) {
			const group = focusCategoryToGroupMap.get(item.actionableCategory)!;
			const key = `${item.uuid}:${group}`;
			if (!groupedIds.has(key)) {
				groupedIds.add(key);
			}
		}

		this._groupedIds = groupedIds;
	}

	async hasConnectedIntegration(): Promise<boolean> {
		for (const integrationId of supportedFocusIntegrations) {
			const integration = await this.container.integrations.get(integrationId);
			if (integration.maybeConnected ?? (await integration.isConnected())) {
				return true;
			}
		}

		return false;
	}

	@log<FocusProvider['ensureFocusItemCodeSuggestions']>({
		args: { 0: i => `${i.id} (${i.provider.name} ${i.type})`, 1: o => `force=${o?.force}` },
	})
	async ensureFocusItemCodeSuggestions(
		item: FocusItem,
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
			'config.launchpad.ignoredRepositories': cfg.ignoredRepositories?.length ?? 0,
			'config.launchpad.indicator.enabled': cfg.indicator.enabled,
			'config.launchpad.indicator.openInEditor': cfg.indicator.openInEditor,
			'config.launchpad.indicator.icon': cfg.indicator.icon,
			'config.launchpad.indicator.label': cfg.indicator.label,
			'config.launchpad.indicator.useColors': cfg.indicator.useColors,
			'config.launchpad.indicator.groups': cfg.indicator.groups.join(','),
			'config.launchpad.indicator.polling.enabled': cfg.indicator.polling.enabled,
			'config.launchpad.indicator.polling.interval': cfg.indicator.polling.interval,
		});

		if (
			configuration.changed(e, 'launchpad.ignoredRepositories') ||
			configuration.changed(e, 'launchpad.staleThreshold')
		) {
			this.refresh();
			void this.getCategorizedItems({ force: true });
		}
	}
}

export function groupAndSortFocusItems(items?: FocusItem[]) {
	if (items == null || items.length === 0) return new Map<FocusGroup, FocusItem[]>();
	const grouped = new Map<FocusGroup, FocusItem[]>(focusGroups.map(g => [g, []]));

	sortFocusItems(items);

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
			const group = focusCategoryToGroupMap.get(item.actionableCategory)!;
			grouped.get(group)!.push(item);
		}
	}

	// Re-sort pinned and draft groups by updated date
	grouped.get('pinned')!.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());
	grouped.get('draft')!.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());
	return grouped;
}

export function countFocusItemGroups(items?: FocusItem[]) {
	if (items == null || items.length === 0) return new Map<FocusGroup, number>();
	const grouped = new Map<FocusGroup, number>(focusGroups.map(g => [g, 0]));

	function incrementGroup(group: FocusGroup) {
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
			incrementGroup(focusCategoryToGroupMap.get(item.actionableCategory)!);
		}
	}

	return grouped;
}

export function sortFocusItems(items: FocusItem[]) {
	return items.sort(
		(a, b) =>
			(a.viewer.pinned ? -1 : 1) - (b.viewer.pinned ? -1 : 1) ||
			focusActionCategories.indexOf(a.actionableCategory) - focusActionCategories.indexOf(b.actionableCategory) ||
			b.updatedDate.getTime() - a.updatedDate.getTime(),
	);
}

function ensureRemoteUrl(url: string) {
	if (url.startsWith('https')) {
		return url.endsWith('.git') ? url : `${url}.git`;
	}

	return url;
}

export function getFocusItemIdHash(item: FocusItem) {
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
