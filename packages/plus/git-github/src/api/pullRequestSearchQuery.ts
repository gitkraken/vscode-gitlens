import type { PullRequestSearchCriteria, PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
import { PullRequestFilter } from '@gitlens/git/models/pullRequest.js';
import { sanitizeGitHubSearchText } from './issueSearchQuery.js';

export type GitHubPullRequestSearchFacet = {
	/** Stable GraphQL alias and composite-cursor key. */
	alias: string;
	qualifiers: string[];
};

const relationshipQualifier: Record<PullRequestFilter, string> = {
	[PullRequestFilter.Author]: 'author:@me',
	[PullRequestFilter.Assignee]: 'assignee:@me',
	[PullRequestFilter.ReviewRequested]: 'review-requested:@me',
	[PullRequestFilter.Mention]: 'mentions:@me',
};

const relationshipAlias: Record<PullRequestFilter, string> = {
	[PullRequestFilter.Author]: 'author',
	[PullRequestFilter.Assignee]: 'assignee',
	[PullRequestFilter.ReviewRequested]: 'reviewRequested',
	[PullRequestFilter.Mention]: 'mention',
};

const stateAlias: Record<PullRequestStateFilter, string> = {
	open: 'Open',
	closed: 'Closed',
	merged: 'Merged',
	all: 'All',
};

function stateQualifiers(state: PullRequestStateFilter): string[] {
	switch (state) {
		case 'closed':
			// GitHub's `is:closed` includes merged PRs; `is:unmerged` removes that subset.
			return ['is:closed', 'is:unmerged'];
		case 'merged':
			return ['is:merged'];
		case 'all':
			return [];
		case 'open':
			return ['is:open'];
	}
}

/**
 * Translates provider-neutral PR criteria into the independent GitHub searches whose union answers the request.
 *
 * GitHub's API search syntax ANDs repeated relationship/state qualifiers and does not implement the boolean
 * groups accepted by the newer web UI. Each requested relationship × state pair therefore becomes one GraphQL
 * alias; the API client sends every active alias in a single document, preserving one HTTP request per page.
 * An omitted relationship is the explicitly unfiltered repository/organization scope, never `involves:@me`.
 */
export function toGitHubPullRequestSearchFacets(
	criteria: PullRequestSearchCriteria | undefined,
): GitHubPullRequestSearchFacet[] {
	const relationships: (PullRequestFilter | undefined)[] = criteria?.relationships?.length
		? [...new Set(criteria.relationships)]
		: [undefined];
	const requestedStates: PullRequestStateFilter[] = criteria?.states?.length
		? [...new Set(criteria.states)]
		: ['open'];
	const states: PullRequestStateFilter[] = requestedStates.includes('all') ? ['all'] : requestedStates;
	const text = criteria?.text != null ? sanitizeGitHubSearchText(criteria.text) : '';

	return relationships.flatMap(relationship =>
		states.map(state => ({
			alias: `${relationship != null ? relationshipAlias[relationship] : 'scope'}${stateAlias[state]}`,
			qualifiers: [
				'is:pr',
				...(relationship != null ? [relationshipQualifier[relationship]] : []),
				...stateQualifiers(state),
				// `!= null`, not truthy: `draft:false` narrows to ready-for-review PRs just as `draft:true` narrows to drafts.
				...(criteria?.draft != null ? [`draft:${criteria.draft}`] : []),
				...(criteria?.includeArchived === true ? [] : ['archived:false']),
				...(text.length > 0 ? [text] : []),
				// Contract, not an option: a capped result is the N most recently updated only under this order.
				'sort:updated',
			],
		})),
	);
}
