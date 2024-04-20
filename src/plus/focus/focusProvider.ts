import type { CancellationToken } from 'vscode';
import { Disposable, env, EventEmitter, Uri } from 'vscode';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import type { Account } from '../../git/models/author';
import type { GitBranch } from '../../git/models/branch';
import type { SearchedIssue } from '../../git/models/issue';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { Repository } from '../../git/models/repository';
import type { CodeSuggestionCounts, Draft } from '../../gk/models/drafts';
import { executeCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { getSettledValue } from '../../system/promise';
import { openUrl } from '../../system/utils';
import type { UriTypes } from '../../uris/deepLinks/deepLink';
import { DeepLinkActionType, DeepLinkType } from '../../uris/deepLinks/deepLink';
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
	'needs-attention',
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

export type FocusAction = 'open' | 'merge' | 'review' | 'switch' | 'change-reviewers' | 'nudge' | 'decline-review';
export type FocusTargetAction = {
	action: 'open-suggestion';
	target: string;
};

const prActionsMap = new Map<FocusActionCategory, FocusAction[]>([
	['mergeable', ['merge', 'switch', 'open']],
	['unassigned-reviewers', ['switch', 'open']],
	['failed-checks', ['switch', 'open']],
	['conflicts', ['switch', 'open']],
	['needs-my-review', ['review', /* 'decline-review', */ 'open']],
	['code-suggestions', ['switch', 'open']],
	['changes-requested', ['switch', 'open']],
	['reviewer-commented', ['switch', 'open']],
	['waiting-for-review', [/* 'nudge', 'change-reviewers', */ 'switch', 'open']],
	['draft', ['switch', 'open']],
	['other', ['switch', 'open']],
]);

export type FocusPullRequest = EnrichablePullRequest & ProviderActionablePullRequest;

export type FocusItem = FocusPullRequest & {
	currentViewer: Account;
	codeSuggestionsCount: number;
	codeSuggestions?: Draft[];
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
	prs: SearchedPullRequest[] | undefined;
	suggestionCounts: CodeSuggestionCounts | undefined;
};

export interface FocusRefreshEvent {
	items: FocusItem[];
}

export const supportedFocusIntegrations = [HostingIntegrationId.GitHub];

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
		this._disposable = Disposable
			.from
			// configuration.onDidChange(this.onConfigurationChanged, this),
			();
	}

	dispose() {
		this._disposable.dispose();
	}

	private _issues: CachedFocusPromise<SearchedIssue[]> | undefined;
	private async getIssues(options?: { cancellation?: CancellationToken; force?: boolean }) {
		if (options?.force || this._issues == null || this._issues.expiresAt < Date.now()) {
			this._issues = {
				promise: this.container.integrations.getMyIssues([HostingIntegrationId.GitHub], options?.cancellation),
				expiresAt: Date.now() + cacheExpiration,
			};
		}

		return this._issues?.promise;
	}

	private _prs: CachedFocusPromise<PullRequestsWithSuggestionCounts> | undefined;
	private async getPullRequestsWithSuggestionCounts(options?: { cancellation?: CancellationToken; force?: boolean }) {
		if (options?.force || this._prs == null || this._prs.expiresAt < Date.now()) {
			this._prs = {
				promise: this.fetchPullRequestsWithSuggestionCounts(options?.cancellation),
				expiresAt: Date.now() + cacheExpiration,
			};
		}

		return this._prs?.promise;
	}

	private async fetchPullRequestsWithSuggestionCounts(cancellation?: CancellationToken) {
		const prs = await this.container.integrations.getMyPullRequests([HostingIntegrationId.GitHub], cancellation);
		const suggestionCounts =
			prs != null && prs.length > 0
				? await this.container.drafts.getCodeSuggestionCounts(prs.map(pr => pr.pullRequest))
				: undefined;

		return { prs: prs, suggestionCounts: suggestionCounts };
	}

	private _enrichedItems: CachedFocusPromise<EnrichedItem[]> | undefined;
	private async getEnrichedItems(options?: { cancellation?: CancellationToken; force?: boolean }) {
		if (options?.force || this._enrichedItems == null || this._enrichedItems.expiresAt < Date.now()) {
			this._enrichedItems = {
				promise: this.container.enrichments.get(undefined, options?.cancellation),
				expiresAt: Date.now() + cacheExpiration,
			};
		}

		return this._enrichedItems?.promise;
	}

	private _groupedIds: Set<string> | undefined;

	private _codeSuggestions: Map<string, CachedFocusPromise<Draft[]>> | undefined;
	private async getCodeSuggestions(item: FocusItem, options?: { force?: boolean }) {
		if (item.codeSuggestionsCount < 1) return undefined;
		if (this._codeSuggestions == null || options?.force) {
			this._codeSuggestions = new Map<string, CachedFocusPromise<Draft[]>>();
		}

		if (
			options?.force ||
			!this._codeSuggestions.has(item.uuid) ||
			this._codeSuggestions.get(item.uuid)!.expiresAt < Date.now()
		) {
			this._codeSuggestions.set(item.uuid, {
				promise: this.container.drafts.getCodeSuggestions(item, HostingIntegrationId.GitHub),
				expiresAt: Date.now() + cacheExpiration,
			});
		}

		return this._codeSuggestions.get(item.uuid)!.promise;
	}

	refresh() {
		this._issues = undefined;
		this._prs = undefined;
		this._enrichedItems = undefined;
		this._codeSuggestions = undefined;

		this._onDidChange.fire();
	}

	async pin(item: FocusItem) {
		item.viewer.pinned = true;
		this._onDidChange.fire();

		await this.container.enrichments.pinItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

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

	async snooze(item: FocusItem) {
		item.viewer.snoozed = true;
		this._onDidChange.fire();

		await this.container.enrichments.snoozeItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

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

	async merge(item: FocusItem): Promise<void> {
		if (item.graphQLId == null || item.headRef?.oid == null) return;
		// TODO: Include other providers.
		if (item.provider.id !== 'github') return;
		const integrations = await this.container.integrations.get(HostingIntegrationId.GitHub);
		await integrations.mergePullRequest({ id: item.graphQLId, headRefSha: item.headRef.oid });
		this.refresh();
	}

	open(item: FocusItem): void {
		if (item.url == null) return;
		void openUrl(item.url);
		this._prs = undefined;
	}

	openCodeSuggestion(item: FocusItem, target: string) {
		const draft = item.codeSuggestions?.find(d => d.id === target);
		if (draft == null) return;
		this._codeSuggestions?.delete(item.uuid);
		this._prs = undefined;
		void executeCommand(Commands.OpenCloudPatch, {
			draft: draft,
		});
	}

	async switchTo(item: FocusItem): Promise<void> {
		const deepLinkUrl = this.getItemBranchDeepLink(item);
		if (deepLinkUrl == null) return;

		await env.openExternal(deepLinkUrl);
	}

	private getItemBranchDeepLink(item: FocusItem): Uri | undefined {
		if (item.type !== 'pullrequest' || item.headRef == null || item.repoIdentity?.remote?.url == null)
			return undefined;
		const schemeOverride = configuration.get('deepLinks.schemeOverride');
		const scheme = typeof schemeOverride === 'string' ? schemeOverride : env.uriScheme;

		// TODO: Get the proper pull URL from the provider, rather than tacking .git at the end of the
		// url from the head ref.
		return Uri.parse(
			`${scheme}://${this.container.context.extension.id}/${'link' satisfies UriTypes}/${
				DeepLinkType.Repository
			}/-/${DeepLinkType.Branch}/${item.headRef.name}?url=${encodeURIComponent(
				ensureRemoteUrl(item.repoIdentity.remote.url),
			)}&action=${DeepLinkActionType.SwitchToPullRequest}`,
		);
	}

	async getMatchingOpenRepository(pr: EnrichablePullRequest): Promise<OpenRepository | undefined> {
		for (const repo of this.container.git.openRepositories) {
			const matchingRemote = (
				await repo.getRemotes({
					filter: r =>
						r.matches(pr.repoIdentity.remote.url!) ||
						r.matches(pr.repoIdentity.provider.repoDomain, pr.repoIdentity.provider.repoName),
				})
			)?.[0];
			if (matchingRemote == null) continue;

			const matchingRemoteBranch = (
				await repo.getBranches({
					filter: b =>
						b.remote &&
						b.getRemoteName() === matchingRemote.name &&
						b.getNameWithoutRemote() === pr.headRef?.name,
				})
			)?.values[0];
			if (matchingRemoteBranch == null) continue;

			const matchingLocalBranches = (
				await repo.getBranches({ filter: b => b.upstream?.name === matchingRemoteBranch.name })
			)?.values;
			const matchingLocalBranch = matchingLocalBranches?.find(b => b.current) ?? matchingLocalBranches?.[0];

			return { repo: repo, remote: matchingRemote, localBranch: matchingLocalBranch };
		}

		return undefined;
	}

	async getCategorizedItems(
		options?: { force?: boolean; issues?: boolean; prs?: boolean },
		cancellation?: CancellationToken,
	): Promise<FocusItem[]> {
		const enrichedItemsPromise = this.getEnrichedItems({ force: options?.force, cancellation: cancellation });

		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		if (cancellation?.isCancellationRequested) throw new CancellationError();

		const [enrichedItemsResult, /*issuesResult,*/ prsWithCountsResult] = await Promise.allSettled([
			enrichedItemsPromise,
			// options?.issues !== false
			// 	? this.getIssues({ force: options?.force, cancellation: cancellation })
			// 	: undefined,
			options?.prs !== false
				? this.getPullRequestsWithSuggestionCounts({ force: options?.force, cancellation: cancellation })
				: undefined,
		]);

		if (cancellation?.isCancellationRequested) throw new CancellationError();
		let categorized: FocusItem[] = [];

		// TODO: Since this is all repos we probably should order by repos you are a contributor on (or even filter out one you aren't)
		const prsWithSuggestionCounts = getSettledValue(prsWithCountsResult);
		const enrichedItems = getSettledValue(enrichedItemsResult);
		// Multiple enriched items can have the same entityId. Map by entityId to an array of enriched items.
		const enrichedItemsByEntityId: { [id: string]: EnrichedItem[] } = {};
		if (enrichedItems != null) {
			for (const enrichedItem of enrichedItems) {
				if (enrichedItem.entityId in enrichedItemsByEntityId) {
					enrichedItemsByEntityId[enrichedItem.entityId].push(enrichedItem);
				} else {
					enrichedItemsByEntityId[enrichedItem.entityId] = [enrichedItem];
				}
			}
		}

		if (prsWithSuggestionCounts != null) {
			const { prs, suggestionCounts } = prsWithSuggestionCounts;
			if (prs == null) return categorized;
			const github = await this.container.integrations.get(HostingIntegrationId.GitHub);
			const myAccount = await github.getCurrentAccount();
			const inputPrs: EnrichablePullRequest[] = prs.map(pr => {
				const providerPr = toProviderPullRequestWithUniqueId(pr.pullRequest);
				const enrichable = {
					type: 'pr',
					id: providerPr.uuid,
					url: pr.pullRequest.url,
					provider: 'github',
				} satisfies EnrichableItem;
				const repoIdentity = {
					remote: { url: pr.pullRequest.refs?.head?.url },
					name: pr.pullRequest.repository.repo,
					provider: {
						id: pr.pullRequest.provider.id,
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
				};
			}) satisfies EnrichablePullRequest[];

			// Note: The expected output of this is ActionablePullRequest[], but we are passing in EnrichablePullRequest,
			// so we need to cast the output as FocusPullRequest[].
			const actionableItems = getActionablePullRequests(
				inputPrs,
				{ id: myAccount!.username! },
				{ enrichedItemsByUniqueId: enrichedItemsByEntityId },
			) as FocusPullRequest[];
			// Map from shared category label to local actionable category, and get suggested actions
			categorized = (await Promise.all(
				actionableItems.map(async item => {
					const codeSuggestionsCount = suggestionCounts?.[item.uuid]?.count ?? 0;
					const actionableCategory =
						codeSuggestionsCount > 0
							? 'code-suggestions'
							: sharedCategoryToFocusActionCategoryMap.get(item.suggestedActionCategory)!;
					const suggestedActions = prActionsMap.get(actionableCategory)!;
					return {
						...item,
						currentViewer: myAccount!,
						codeSuggestionsCount: codeSuggestionsCount,
						isNew:
							this._groupedIds != null &&
							!this._groupedIds.has(`${item.uuid}:${focusCategoryToGroupMap.get(actionableCategory)}`),
						actionableCategory: actionableCategory,
						suggestedActions: suggestedActions,
						openRepository: await this.getMatchingOpenRepository(item),
					};
				}),
			)) satisfies FocusItem[];
		}

		this.updateGroupedIds(categorized);
		this._onDidRefresh.fire({ items: categorized });
		return categorized;
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

	async ensureFocusItemCodeSuggestions(item: FocusItem, options?: { force?: boolean }): Promise<Draft[] | undefined> {
		item.codeSuggestions ??= await this.getCodeSuggestions(item, options);
		return item.codeSuggestions;
	}
}

export function groupAndSortFocusItems(items?: FocusItem[]) {
	if (items == null || items.length === 0) return new Map<FocusGroup, FocusItem[]>();
	const grouped = new Map<FocusGroup, FocusItem[]>(focusGroups.map(g => [g, []]));

	sortFocusItems(items);

	const pinnedGroup = grouped.get('pinned')!;
	const snoozedGroup = grouped.get('snoozed')!;

	for (const item of items) {
		if (item.viewer.snoozed) {
			if (!snoozedGroup.some(i => i.uuid === item.uuid)) {
				snoozedGroup.push(item);
			}

			continue;
		} else if (item.viewer.pinned && !pinnedGroup.some(i => i.uuid === item.uuid)) {
			pinnedGroup.push(item);
		}

		const currentBranchGroup = grouped.get('current-branch')!;
		if (item.openRepository?.localBranch?.current) {
			currentBranchGroup.push(item);
		}

		const draftGroup = grouped.get('draft')!;
		if (item.isDraft) {
			if (!draftGroup.some(i => i.uuid === item.uuid)) {
				draftGroup.push(item);
			}
		} else {
			const group = focusCategoryToGroupMap.get(item.actionableCategory)!;
			grouped.get(group)!.push(item);
		}
	}

	return grouped;
}

export function sortFocusItems(items: FocusItem[]) {
	return items.sort(
		(a, b) =>
			(a.viewer.pinned ? -1 : 1) - (b.viewer.pinned ? -1 : 1) ||
			focusActionCategories.indexOf(b.actionableCategory) - focusActionCategories.indexOf(a.actionableCategory) ||
			b.updatedDate.getTime() - a.updatedDate.getTime(),
	);
}

function ensureRemoteUrl(url: string) {
	if (url.startsWith('https')) {
		return url.endsWith('.git') ? url : `${url}.git`;
	}

	return url;
}
