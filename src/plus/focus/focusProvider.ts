import type { CancellationToken } from 'vscode';
import { Disposable, env, EventEmitter, Uri } from 'vscode';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import type { SearchedIssue } from '../../git/models/issue';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import { configuration } from '../../system/configuration';
import { getSettledValue } from '../../system/promise';
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
	'changes-requested',
	'reviewer-commented',
	'waiting-for-review',
	'draft',
	'other',
] as const;
export type FocusActionCategory = (typeof focusActionCategories)[number];

export const focusGroups = [
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

const prActionsMap = new Map<FocusActionCategory, FocusAction[]>([
	['mergeable', ['merge', 'switch', 'open']],
	['unassigned-reviewers', ['switch', 'open']],
	['failed-checks', ['switch', 'open']],
	['conflicts', ['switch', 'open']],
	['needs-my-review', ['review', /* 'decline-review', */ 'open']],
	['changes-requested', ['switch', 'open']],
	['reviewer-commented', ['switch', 'open']],
	['waiting-for-review', [/* 'nudge', 'change-reviewers', */ 'switch', 'open']],
	['draft', ['switch', 'open']],
	['other', ['switch', 'open']],
]);

export type FocusPullRequest = EnrichablePullRequest & ProviderActionablePullRequest;

export type FocusItem = FocusPullRequest & {
	isNew: boolean;
	actionableCategory: FocusActionCategory;
	suggestedActions: FocusAction[];
};

type CachedFocusPromise<T> = {
	expiresAt: number;
	promise: Promise<T | undefined>;
};

const cacheExpiration = 1000 * 60 * 30; // 30 minutes

export interface FocusRefreshEvent {
	items: FocusItem[];
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

	private _prs: CachedFocusPromise<SearchedPullRequest[]> | undefined;
	private async getPullRequests(options?: { cancellation?: CancellationToken; force?: boolean }) {
		if (options?.force || this._prs == null || this._prs.expiresAt < Date.now()) {
			this._prs = {
				promise: this.container.integrations.getMyPullRequests(
					[HostingIntegrationId.GitHub],
					options?.cancellation,
				),
				expiresAt: Date.now() + cacheExpiration,
			};
		}

		return this._prs?.promise;
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

	refresh() {
		this._issues = undefined;
		this._prs = undefined;
		this._enrichedItems = undefined;

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

	async switchTo(item: FocusItem): Promise<void> {
		const deepLinkUrl = this.getItemBranchDeepLink(item);
		if (deepLinkUrl == null) return;

		await env.openExternal(deepLinkUrl);
	}

	private getItemBranchDeepLink(item: FocusItem): Uri | undefined {
		if (item.type !== 'pullRequest' || item.headRef == null || item.repoIdentity?.remote?.url == null)
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

	/* async locateItemRepository(
		item: FocusItem,
		options?: { force?: boolean; openIfNeeded?: boolean; keepOpen?: boolean; prompt?: boolean },
	): Promise<Repository | undefined> {
		if (item.repository != null && !options?.force) return item.repository;
		if (item.repositoryIdentity == null) return undefined;

		return this.container.repositoryIdentity.getRepository(item.repositoryIdentity, {
			...options,
			skipRefValidation: true,
		});
	}

	async getItemBranchRef(item: FocusItem): Promise<GitBranchReference | undefined> {
		if (item.ref?.remoteName == null || item.repository == null) return undefined;

		const remoteName = item.ref.remoteName;
		const remotes = await item.repository.getRemotes({ filter: r => r.provider?.owner === remoteName });
		const matchingRemote = remotes.length > 0 ? remotes[0] : undefined;
		let remoteBranchName = `${item.ref.remoteName}/${item.ref.branchName}`;
		if (matchingRemote != null) {
			remoteBranchName = `${matchingRemote.name}/${item.ref.branchName}`;
			const matchingRemoteBranches = (
				await item.repository.getBranches({ filter: b => b.remote && b.name === remoteBranchName })
			)?.values;
			if (matchingRemoteBranches?.length) return matchingRemoteBranches[0];
		}

		return createReference(remoteBranchName, item.repository.path, {
			refType: 'branch',
			id: getBranchId(item.repository.path, true, remoteBranchName),
			name: remoteBranchName,
			remote: true,
		});
	} */

	async getCategorizedItems(
		options?: { force?: boolean; issues?: boolean; prs?: boolean },
		cancellation?: CancellationToken,
	): Promise<FocusItem[]> {
		const enrichedItemsPromise = this.getEnrichedItems({ force: options?.force, cancellation: cancellation });

		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		if (cancellation?.isCancellationRequested) throw new CancellationError();

		const [enrichedItemsResult, /*issuesResult,*/ prsResult] = await Promise.allSettled([
			enrichedItemsPromise,
			// options?.issues !== false
			// 	? this.getIssues({ force: options?.force, cancellation: cancellation })
			// 	: undefined,
			options?.prs !== false
				? this.getPullRequests({ force: options?.force, cancellation: cancellation })
				: undefined,
		]);

		if (cancellation?.isCancellationRequested) throw new CancellationError();
		let categorized: FocusItem[] = [];

		// TODO: Since this is all repos we probably should order by repos you are a contributor on (or even filter out one you aren't)
		const prs = getSettledValue(prsResult);
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

		if (prs != null) {
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
					type: 'pullRequest',
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
			categorized = actionableItems.map(item => {
				const actionableCategory = sharedCategoryToFocusActionCategoryMap.get(item.suggestedActionCategory)!;
				const suggestedActions = prActionsMap.get(actionableCategory)!;
				return {
					...item,
					isNew:
						this._groupedIds != null &&
						!this._groupedIds.has(`${item.uuid}:${focusCategoryToGroupMap.get(actionableCategory)}`),
					actionableCategory: actionableCategory,
					suggestedActions: suggestedActions,
				};
			}) satisfies FocusItem[];
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

		const group = focusCategoryToGroupMap.get(item.actionableCategory)!;
		grouped.get(group)!.push(item);

		const draftGroup = grouped.get('draft')!;
		if (item.isDraft && !draftGroup.some(i => i.uuid === item.uuid)) {
			draftGroup.push(item);
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
