import type { CancellationToken } from 'vscode';
import { Disposable, env, EventEmitter, Uri } from 'vscode';
import type { Container } from '../../container';
import { CancellationError } from '../../errors';
import type { SearchedIssue } from '../../git/models/issue';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import type { ProviderReference } from '../../git/models/remoteProvider';
import type { GkProviderId, RepositoryIdentityDescriptor } from '../../gk/models/repositoryIdentities';
import { configuration } from '../../system/configuration';
import { getSettledValue } from '../../system/promise';
import type { UriTypes } from '../../uris/deepLinks/deepLink';
import { DeepLinkType } from '../../uris/deepLinks/deepLink';
import { categorizePullRequests, HostingIntegrationId, toProviderPullRequest } from '../integrations/providers/models';
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
	['unassigned-reviewers', 'needs-attention'],
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

export type FocusItem = {
	type: 'pullRequest' | 'issue';
	provider: ProviderReference;
	id: string;
	uniqueId: string;
	isNew: boolean;
	title: string;
	date: Date;
	author: string;
	avatarUrl?: string;
	repoAndOwner?: string;
	url: string;

	enrichable: EnrichableItem;
	enriched?: EnrichedItem;

	actionableCategory: FocusActionCategory;
	suggestedActions: FocusAction[];

	pinned: boolean;
	snoozed: boolean;
	sortTime: number;

	repositoryIdentity?: RepositoryIdentityDescriptor;
	ref?: {
		branchName: string;
		sha: string;
		remoteName: string;
	};
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
		item.pinned = true;
		this._onDidChange.fire();

		await this.container.enrichments.pinItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	async unpin(item: FocusItem) {
		item.pinned = false;
		this._onDidChange.fire();

		if (item.enriched == null) return;
		await this.container.enrichments.unpinItem(item.enriched.id);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	async snooze(item: FocusItem) {
		item.snoozed = true;
		this._onDidChange.fire();

		await this.container.enrichments.snoozeItem(item.enrichable);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	async unsnooze(item: FocusItem) {
		item.snoozed = false;
		this._onDidChange.fire();

		if (item.enriched == null) return;
		await this.container.enrichments.unsnoozeItem(item.enriched.id);
		this._enrichedItems = undefined;
		this._onDidChange.fire();
	}

	async merge(item: FocusItem): Promise<void> {
		if (item.uniqueId == null || item.ref?.sha == null) return;
		// TODO: Include other providers.
		if (item.provider.id !== 'github') return;
		const integrations = await this.container.integrations.get(HostingIntegrationId.GitHub);
		await integrations.mergePullRequest({ id: item.uniqueId, headRefSha: item.ref.sha });
		this.refresh();
	}

	async switchTo(item: FocusItem): Promise<void> {
		const deepLinkUrl = await this.getItemBranchDeepLink(item);
		if (deepLinkUrl == null) return;

		await env.openExternal(deepLinkUrl);
	}

	private async getItemBranchDeepLink(item: FocusItem): Promise<Uri | undefined> {
		if (item.type !== 'pullRequest' || item.ref == null || item.repositoryIdentity?.remote?.url == null)
			return undefined;
		const schemeOverride = configuration.get('deepLinks.schemeOverride');
		const scheme = !schemeOverride ? 'vscode' : schemeOverride === true ? env.uriScheme : schemeOverride;

		// TODO: Get the proper pull URL from the provider, rather than tacking .git at the end of the
		// url from the head ref.
		return env.asExternalUri(
			Uri.parse(
				`${scheme}://${this.container.context.extension.id}/${'link' satisfies UriTypes}/${
					DeepLinkType.Repository
				}/-/${DeepLinkType.Branch}/${item.ref.branchName}?url=${encodeURIComponent(
					ensureRemoteUrl(item.repositoryIdentity.remote.url),
				)}&action=switch`,
			),
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

		const enrichedItems = new Map(getSettledValue(enrichedItemsResult)?.map(i => [i.entityId, i]));

		const categorized: FocusItem[] = [];

		// TODO: Since this is all repos we probably should order by repos you are a contributor on (or even filter out one you aren't)

		const prs = getSettledValue(prsResult);
		if (prs != null) {
			const prsById = new Map(prs.map(pr => [pr.pullRequest.id, pr]));
			const github = await this.container.integrations.get(HostingIntegrationId.GitHub);
			const myAccount = await github.getCurrentAccount();
			if (myAccount?.username != null) {
				const bucketedPrs = categorizePullRequests(
					prs.map(pr => toProviderPullRequest(pr.pullRequest)),
					{ id: myAccount.username },
				);
				for (const bucket of Object.values(bucketedPrs)) {
					const actionCategory = sharedCategoryToFocusActionCategoryMap.get(bucket.id);
					for (const bucketedPullRequest of bucket.pullRequests) {
						const pr = prsById.get(bucketedPullRequest.id);
						const enrichedItem = enrichedItems.get(pr!.pullRequest.nodeId!);
						categorized.push(this.createFocusItem(actionCategory!, pr!, enrichedItem));
					}
				}
			}
		}

		/* if (prs != null) {
			outer: for (const pr of prs) {
				if (pr.pullRequest.isDraft) continue;

				const enrichedItem = enrichedItems.get(pr.pullRequest.nodeId!);

				if (pr.reasons.includes('authored')) {
					if (pr.pullRequest.statusCheckRollupState === PullRequestStatusCheckRollupState.Failed) {
						categorized.push(this.createFocusItem('failed-checks', pr, enrichedItem));
						continue;
					}

					const viewerHasMergeAccess =
						pr.pullRequest.viewerCanUpdate &&
						pr.pullRequest.repository.accessLevel != null &&
						pr.pullRequest.repository.accessLevel >= RepositoryAccessLevel.Write;

					switch (pr.pullRequest.mergeableState) {
						case PullRequestMergeableState.Mergeable:
							switch (pr.pullRequest.reviewDecision) {
								case PullRequestReviewDecision.Approved:
									if (viewerHasMergeAccess) {
										categorized.push(this.createFocusItem('mergeable', pr, enrichedItem));
									} // TODO: should it be on in any group if you can't merge? maybe need to check if you are a contributor to the repo or something
									continue outer;
								case PullRequestReviewDecision.ChangesRequested:
									categorized.push(this.createFocusItem('changes-requested', pr, enrichedItem));
									continue outer;
								case PullRequestReviewDecision.ReviewRequired:
									categorized.push(this.createFocusItem('waiting-for-review', pr, enrichedItem));
									continue outer;
								case undefined:
									if (pr.pullRequest.reviewRequests?.length) {
										categorized.push(this.createFocusItem('waiting-for-review', pr, enrichedItem));
										continue outer;
									} else {
										categorized.push(this.createFocusItem('waiting-for-review', pr, enrichedItem));
										continue outer;
									}
									break;
							}
							break;
						case PullRequestMergeableState.Conflicting:
							if (
								pr.pullRequest.reviewDecision === PullRequestReviewDecision.Approved &&
								viewerHasMergeAccess
							) {
								categorized.push(this.createFocusItem('mergeable-conflicts', pr, enrichedItem));
							} else {
								categorized.push(this.createFocusItem('conflicts', pr, enrichedItem));
							}
							continue outer;
					}
				}

				if (pr.reasons.includes('review-requested')) {
					// Skip adding if there are failed CI checks
					if (pr.pullRequest.statusCheckRollupState === PullRequestStatusCheckRollupState.Failed) continue;

					categorized.push(this.createFocusItem('needs-review', pr, enrichedItem));
					continue;
				}
			}
		} */

		// const issues = getSettledValue(issuesResult);
		// if (issues != null) {
		// 	for (const issue of issues.splice(0, 3)) {
		// 		let next = false;

		// 		const enrichedItem = enrichedItems.get(issue.issue.nodeId!);
		// 		if (enrichedItem != null) {
		// 			switch (enrichedItem.type) {
		// 				case 'pin':
		// 					addItemToGroup(grouped, 'Pinned', issue);
		// 					next = true;
		// 					break;
		// 				case 'snooze':
		// 					addItemToGroup(grouped, 'Snoozed', issue);
		// 					next = true;
		// 					break;
		// 			}

		// 			if (next) continue;
		// 		}

		// 		if (issue.reasons.includes('assigned')) {
		// 			addItemToGroup(grouped, 'In Progress', issue);
		// 			continue;
		// 		}
		// 	}
		// }

		// // Sort the grouped map by the order of the Groups array
		// const sorted = new Map<FocusActionCategory, FocusItem[]>();
		// for (const group of actionCategories) {
		// 	const items = categorized.get(group);
		// 	if (items == null) continue;

		// 	sorted.set(
		// 		group,
		// 		items.sort((a, b) => (a.pinned ? -1 : 1) - (b.pinned ? -1 : 1) || b.sortTime - a.sortTime),
		// 	);
		// }

		this.updateGroupedIds(categorized);
		this._onDidRefresh.fire({ items: categorized });
		return categorized;
	}

	private createFocusItem(
		category: FocusActionCategory,
		item: SearchedPullRequest | SearchedIssue,
		enriched?: EnrichedItem,
	): FocusItem {
		return 'pullRequest' in item
			? {
					type: 'pullRequest',
					provider: item.pullRequest.provider,
					id: item.pullRequest.id,
					uniqueId: item.pullRequest.nodeId!,
					isNew:
						this._groupedIds != null &&
						!this._groupedIds.has(`${item.pullRequest.nodeId!}:${focusCategoryToGroupMap.get(category)}`),
					title: item.pullRequest.title,
					date: item.pullRequest.updatedDate,
					author: item.pullRequest.author.name,
					avatarUrl: item.pullRequest.author.avatarUrl,
					repoAndOwner: `${item.pullRequest.repository.owner}/${item.pullRequest.repository.repo}`,
					url: item.pullRequest.url,

					enrichable: {
						type: 'pr',
						id: item.pullRequest.nodeId!,
						url: item.pullRequest.url,
						provider: 'github',
					},
					enriched: enriched,

					actionableCategory: category,
					suggestedActions: prActionsMap.get(category)!,

					pinned: enriched?.type === 'pin',
					snoozed: enriched?.type === 'snooze',
					sortTime: item.pullRequest.updatedDate.getTime(),
					repositoryIdentity: {
						remote: { url: item.pullRequest.refs?.head?.url },
						name: item.pullRequest.repository.repo,
						provider: {
							// TODO: fix this typing, set according to item
							id: 'github' as GkProviderId,
							repoDomain: item.pullRequest.repository.owner,
							repoName: item.pullRequest.repository.repo,
						},
					},
					ref:
						item.pullRequest.refs?.head != null
							? {
									branchName: item.pullRequest.refs.head.branch,
									sha: item.pullRequest.refs.head.sha,
									remoteName: item.pullRequest.refs.head.owner,
							  }
							: undefined,
			  }
			: {
					type: 'issue',
					provider: item.issue.provider,
					id: item.issue.id,
					uniqueId: item.issue.nodeId!,
					isNew:
						this._groupedIds != null &&
						!this._groupedIds.has(`${item.issue.nodeId!}:${focusCategoryToGroupMap.get(category)}`),
					title: item.issue.title,
					date: item.issue.updatedDate,
					author: item.issue.author.name,
					avatarUrl: item.issue.author.avatarUrl,
					repoAndOwner: `${item.issue.repository?.owner}/${item.issue.repository?.repo}`,
					url: item.issue.url,

					enrichable: {
						type: 'issue',
						id: item.issue.nodeId!,
						url: item.issue.url,
						provider: 'github',
					},
					enriched: enriched,

					actionableCategory: category,
					suggestedActions: [],

					pinned: enriched?.type === 'pin',
					snoozed: enriched?.type === 'snooze',
					sortTime: item.issue.updatedDate.getTime(),
					repositoryIdentity:
						item.issue.repository != null
							? {
									name: item.issue.repository?.repo,
									provider: {
										// TODO: fix this typing, set according to item
										id: 'github' as GkProviderId,
										repoDomain: item.issue.repository?.owner,
										repoName: item.issue.repository?.repo,
									},
							  }
							: undefined,
			  };
	}

	private updateGroupedIds(items: FocusItem[]) {
		const groupedIds = new Set<string>();
		for (const item of items) {
			const group = focusCategoryToGroupMap.get(item.actionableCategory)!;
			const key = `${item.uniqueId}:${group}`;
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
		if (item.pinned && !pinnedGroup.some(i => i.uniqueId === item.uniqueId)) {
			pinnedGroup.push(item);
		} else if (item.snoozed) {
			if (!snoozedGroup.some(i => i.uniqueId === item.uniqueId)) {
				snoozedGroup.push(item);
			}
			continue;
		}

		const group = focusCategoryToGroupMap.get(item.actionableCategory)!;
		grouped.get(group)!.push(item);
	}

	return grouped;
}

export function sortFocusItems(items: FocusItem[]) {
	return items.sort(
		(a, b) =>
			(a.pinned ? -1 : 1) - (b.pinned ? -1 : 1) ||
			focusActionCategories.indexOf(b.actionableCategory) - focusActionCategories.indexOf(a.actionableCategory) ||
			b.sortTime - a.sortTime,
	);
}

function ensureRemoteUrl(url: string) {
	if (url.startsWith('https')) {
		return url.endsWith('.git') ? url : `${url}.git`;
	}

	return url;
}
