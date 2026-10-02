import type { IssueProjection, IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestProjection, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from './constants.js';

/**
 * Whether a row's read fetched a field group.
 *
 * - `fetched`: the read asked for it and surfaces it, so an empty value means "none".
 * - `not-requested`: this read didn't ask for it, or asked but doesn't surface it faithfully. Ignore the value even
 *   when one is present (some reads fill placeholders); another read may supply it.
 * - `unavailable`: this provider or host can't supply it on this read.
 */
export type FieldPresence = 'fetched' | 'not-requested' | 'unavailable';

/** A group is `fetched` only when every field in it is. */
export type PullRequestFieldGroup =
	/** `body`. */
	| 'description'
	/** `latestReviews`. */
	| 'reviews'
	/**
	 * `reviewRequests`: who is requested. Not each request's `isCodeOwner`, which only GitLens' own GitHub reads
	 * report; every other row leaves it undefined.
	 */
	| 'reviewRequests'
	/**
	 * `reviewDecision`. Only GitHub reports one; elsewhere it is derived from the reviewers' states on the row, which
	 * ignores the host's own approval rules, so it is never `fetched` there — derive it from `reviews` and
	 * `reviewRequests` instead.
	 */
	| 'reviewDecision'
	/** `assignees`. */
	| 'assignees'
	/** `statusCheckRollupState`, on the `PullRequest` class. */
	| 'checks'
	/** `mergeableState`. */
	| 'mergeable'
	/** `additions`, `deletions` and `filesChanged`. */
	| 'diffStats'
	/** `commitCount`, on the `PullRequest` class. */
	| 'commitCount'
	/** `commentsCount`. */
	| 'comments'
	/** `thumbsUpCount`. */
	| 'reactions'
	/** `viewerCanUpdate`, on the `PullRequest` class, and `repository.accessLevel`. */
	| 'access'
	/** `authoredByMe`, and the `viewer` it was matched against. */
	| 'authoredByMe'
	/** `stack`. */
	| 'stack';

/** A group is `fetched` only when every field in it is. */
export type IssueFieldGroup =
	/** `body`. */
	| 'description'
	/** `assignees`. */
	| 'assignees'
	/** `labels`. */
	| 'labels'
	/** `commentsCount`. */
	| 'comments'
	/** `thumbsUpCount`. */
	| 'reactions'
	/** `repository.accessLevel`. */
	| 'access';

type Presence<G extends string> = Readonly<Record<G, FieldPresence>>;
type PresenceTable<P extends string, G extends string> = Readonly<Partial<Record<P, Presence<G>>>>;

const pullRequestFieldGroups: readonly PullRequestFieldGroup[] = [
	'description',
	'reviews',
	'reviewRequests',
	'reviewDecision',
	'assignees',
	'checks',
	'mergeable',
	'diffStats',
	'commitCount',
	'comments',
	'reactions',
	'access',
	'authoredByMe',
	'stack',
];

const issueFieldGroups: readonly IssueFieldGroup[] = [
	'description',
	'assignees',
	'labels',
	'comments',
	'reactions',
	'access',
];

/** Every group in `groups` listed as neither `fetched` nor `unavailable` is `not-requested`. */
function presenceOf<G extends string>(
	groups: readonly G[],
	fetched: readonly G[],
	unavailable: readonly G[] = [],
): Presence<G> {
	return Object.freeze(
		Object.fromEntries(
			groups.map(
				group =>
					[
						group,
						fetched.includes(group)
							? 'fetched'
							: unavailable.includes(group)
								? 'unavailable'
								: 'not-requested',
					] as const,
			),
		) as Record<G, FieldPresence>,
	);
}

function pullRequestPresenceOf(
	fetched: readonly PullRequestFieldGroup[],
	unavailable?: readonly PullRequestFieldGroup[],
): Presence<PullRequestFieldGroup> {
	return presenceOf(pullRequestFieldGroups, fetched, unavailable);
}

function issuePresenceOf(
	fetched: readonly IssueFieldGroup[],
	unavailable?: readonly IssueFieldGroup[],
): Presence<IssueFieldGroup> {
	return presenceOf(issueFieldGroups, fetched, unavailable);
}

/** GitLens' own lite fragment (`fromGitHubPullRequestLite`). `stack` is only selected against github.com. */
const gitHubLite = pullRequestPresenceOf(['description', 'stack']);

/**
 * GitLens' own full fragment, which selects no reactions. The account-wide and batch reads return its rows as they
 * are, GitHub's own review decision included: none stays none, even while a review is requested.
 * `authoredByMe` needs the current account, which a read may fail to resolve, and the other reads never set it.
 */
const gitHubFull = pullRequestPresenceOf([
	'description',
	'reviews',
	'reviewRequests',
	'reviewDecision',
	'assignees',
	'checks',
	'mergeable',
	'diffStats',
	'commitCount',
	'comments',
	'access',
	'stack',
]);

const gitHubPullRequests: PresenceTable<PullRequestProjection, PullRequestFieldGroup> = {
	point: gitHubLite,
	search: gitHubFull,
	'search-summary': gitHubLite,
	'text-search': gitHubFull,
	account: gitHubFull,
	// The lite fragment's own rows.
	'account-summary': gitHubLite,
	// provider-apis' own fragment and normalizer. Its review-state map has no DISMISSED, so a dismissed review is
	// dropped (and none carries a `commitOid`); it removes code-owner requests; it derives the review decision from
	// that list rather than reading GitHub's; and it doesn't read `repository.accessLevel`.
	repos: pullRequestPresenceOf([
		'description',
		'assignees',
		'checks',
		'mergeable',
		'diffStats',
		'commitCount',
		'comments',
		'reactions',
	]),
	// `summary` drops the `commits` subtree that carries both the check rollup and the commit count.
	'repos-summary': pullRequestPresenceOf([
		'description',
		'assignees',
		'mergeable',
		'diffStats',
		'comments',
		'reactions',
	]),
	batch: gitHubFull,
};

/**
 * GitHub Enterprise Server rejects the stack selection, so a read that carries `stack` on github.com can't here.
 * provider-apis also gates check runs on the server version, which this table can't see, so its rollup on the
 * repository-scoped read may come from commit statuses alone.
 */
const gitHubEnterprisePullRequests: PresenceTable<PullRequestProjection, PullRequestFieldGroup> = Object.fromEntries(
	Object.entries(gitHubPullRequests).map(([projection, presence]) => {
		const enterprise: Record<PullRequestFieldGroup, FieldPresence> = { ...presence };
		if (enterprise.stack === 'fetched') {
			enterprise.stack = 'unavailable';
		}
		if (projection === 'repos') {
			enterprise.checks = 'not-requested';
		}
		return [projection, Object.freeze(enterprise)];
	}),
);

/** GitLens' own issue fragment, which every native read selects with the body. */
const gitHubNativeIssue = presenceOf(issueFieldGroups, issueFieldGroups);

const gitHubIssues: PresenceTable<IssueProjection, IssueFieldGroup> = {
	point: gitHubNativeIssue,
	search: gitHubNativeIssue,
	account: gitHubNativeIssue,
	// provider-apis' own fragment selects neither the body nor the repository's `viewerPermission`.
	repos: presenceOf(issueFieldGroups, ['assignees', 'labels', 'comments', 'reactions']),
	batch: gitHubNativeIssue,
};

/*
 * Every other provider. None of them reads the viewer's access (`repository.accessLevel` is absent on every row),
 * resolves `authoredByMe` reliably, or has stacks. provider-apis honors neither `summary` nor
 * `includeReviews` for them, so each `-summary` tag reads like its full one.
 */

/**
 * GitLens' own GitLab reads: the point reads, and the free-text search. They select the description but leave it,
 * and everything else beyond the merge request's identity and refs, off the row.
 */
const gitLabOwn = pullRequestPresenceOf([], ['stack']);

/**
 * provider-apis' merge request fragment and normalizer, which every other GitLab read goes through. It turns a null
 * count into 0: GitLab's schema makes `diffStatsSummary`, `commitCount` and `userNotesCount` nullable, so none is
 * promised — except that GitLab.com's comment count resolver answers 0 rather than null, which a self-managed
 * version may not.
 */
function gitLabProviderApis(comments: boolean): Presence<PullRequestFieldGroup> {
	return pullRequestPresenceOf(
		[
			'description',
			'reviews',
			'reviewRequests',
			'assignees',
			'checks',
			'mergeable',
			'reactions',
			...(comments ? (['comments'] as const) : []),
		],
		['stack'],
	);
}

function gitLabPullRequestsFor(
	providerApis: Presence<PullRequestFieldGroup>,
): PresenceTable<PullRequestProjection, PullRequestFieldGroup> {
	return {
		point: gitLabOwn,
		search: providerApis,
		'text-search': gitLabOwn,
		account: providerApis,
		'account-summary': providerApis,
		repos: providerApis,
		'repos-summary': providerApis,
		batch: providerApis,
	};
}

/**
 * Azure DevOps pull requests have no assignees (both converters fill `assignees` with the reviewers, which `reviews` and
 * `reviewRequests` already hold) and no reactions. Neither converter reads checks or counts.
 */
const azureUnavailable: readonly PullRequestFieldGroup[] = ['assignees', 'reactions', 'stack'];
/** Every list read: Azure truncates a listed pull request's description (to 400 characters). */
const azureListed = pullRequestPresenceOf(['reviews', 'reviewRequests', 'mergeable'], azureUnavailable);
/** The batch reads fetch each pull request by id, which returns the whole description. */
const azureById = pullRequestPresenceOf(['description', 'reviews', 'reviewRequests', 'mergeable'], azureUnavailable);

const azurePullRequests: PresenceTable<PullRequestProjection, PullRequestFieldGroup> = {
	// GitLens' own converter, which leaves the description off the row.
	point: azureListed,
	search: azureListed,
	'text-search': azureListed,
	account: azureListed,
	'account-summary': azureListed,
	repos: azureListed,
	'repos-summary': azureListed,
	batch: azureById,
};

const azureServerPullRequests: PresenceTable<PullRequestProjection, PullRequestFieldGroup> = {
	...azurePullRequests,
	'search-summary': azureListed,
};

/**
 * Bitbucket pull requests have no assignees or reactions. Neither provider-apis nor GitLens reads their build
 * statuses or mergeability: provider-apis fills a literal Mergeable, and GitLens' own converters leave it unset.
 */
const bitbucketUnavailable: readonly PullRequestFieldGroup[] = ['assignees', 'reactions', 'stack'];
const bitbucketProviderApis = pullRequestPresenceOf(
	['description', 'reviews', 'reviewRequests', 'comments'],
	bitbucketUnavailable,
);

const bitbucketPullRequests: PresenceTable<PullRequestProjection, PullRequestFieldGroup> = {
	// GitLens' own converter, which drops the comment count. The commit read selects `+values.*`, which isn't
	// known to bring the participants the reviews come from, as the other two point reads do.
	point: pullRequestPresenceOf(['description'], bitbucketUnavailable),
	search: bitbucketProviderApis,
	'text-search': bitbucketProviderApis,
	account: bitbucketProviderApis,
	'account-summary': bitbucketProviderApis,
	repos: bitbucketProviderApis,
	'repos-summary': bitbucketProviderApis,
	// GitLens' own converter over reads that do select the participants.
	batch: pullRequestPresenceOf(['description', 'reviews', 'reviewRequests'], bitbucketUnavailable),
};

/** provider-apis' and GitLens' own Data Center converters read the same fields. */
const bitbucketServerAll = pullRequestPresenceOf(
	['description', 'reviews', 'reviewRequests', 'comments'],
	bitbucketUnavailable,
);
const bitbucketServerPullRequests: PresenceTable<PullRequestProjection, PullRequestFieldGroup> = {
	point: bitbucketServerAll,
	search: bitbucketServerAll,
	'search-summary': bitbucketServerAll,
	'text-search': bitbucketServerAll,
	account: bitbucketServerAll,
	'account-summary': bitbucketServerAll,
	repos: bitbucketServerAll,
	'repos-summary': bitbucketServerAll,
	batch: bitbucketServerAll,
};

/**
 * provider-apis' GitLab issue reads (GraphQL, and REST for the account-wide one). The repository's access isn't read.
 * The GraphQL comment count is nullable like the merge request's, and passed through, so only GitLab.com's is
 * promised; the REST one is always a number.
 */
function gitLabIssuesFor(comments: boolean): PresenceTable<IssueProjection, IssueFieldGroup> {
	const graphQL = issuePresenceOf([
		'description',
		'assignees',
		'labels',
		'reactions',
		...(comments ? (['comments'] as const) : []),
	]);
	return {
		point: graphQL,
		account: issuePresenceOf(['description', 'assignees', 'labels', 'comments', 'reactions']),
		repos: graphQL,
		batch: graphQL,
	};
}

/**
 * Azure DevOps work items have no reactions (provider-apis' converter fills 0; GitLens' leaves it unset) and belong to
 * a project, not a repository.
 */
const azureWorkItemUnavailable: readonly IssueFieldGroup[] = ['reactions', 'access'];
/** provider-apis' work item converter, and GitLens' copy of it for the batch read. */
const azureWorkItem = issuePresenceOf(['description', 'assignees', 'labels', 'comments'], azureWorkItemUnavailable);
/** GitLens' own work item converter, which drops the tags. */
const azureOwnWorkItem = issuePresenceOf(['description', 'assignees', 'comments'], azureWorkItemUnavailable);

const azureIssues: PresenceTable<IssueProjection, IssueFieldGroup> = {
	point: azureOwnWorkItem,
	account: azureWorkItem,
	repos: azureWorkItem,
	batch: azureWorkItem,
};

const azureServerIssues: PresenceTable<IssueProjection, IssueFieldGroup> = {
	...azureIssues,
	search: azureOwnWorkItem,
};

/**
 * Bitbucket Cloud's legacy issues, which only the host's own `getIssue` and `searchMyIssues` read. They have no
 * labels, their votes aren't reactions, and neither a comment count nor the repository's access is read.
 */
const bitbucketIssue = issuePresenceOf(['description', 'assignees'], ['labels', 'reactions']);
const bitbucketIssues: PresenceTable<IssueProjection, IssueFieldGroup> = {
	point: bitbucketIssue,
	account: bitbucketIssue,
};

/**
 * Tracker issues belong to no repository, and a tracker's votes aren't reactions (and read 0 where voting is off), so
 * neither group can be supplied.
 */
const trackerUnavailable: readonly IssueFieldGroup[] = ['reactions', 'access'];
/**
 * provider-apis' Jira converter counts the comments embedded in the issue, which Jira may cap, rather than reading
 * their total.
 */
const jiraProviderApis = issuePresenceOf(['description', 'assignees', 'labels'], trackerUnavailable);

const jiraIssues: PresenceTable<IssueProjection, IssueFieldGroup> = {
	point: jiraProviderApis,
	account: jiraProviderApis,
	project: jiraProviderApis,
	// GitLens' own by-key read, which reads the comment total.
	batch: issuePresenceOf(['description', 'assignees', 'labels', 'comments'], trackerUnavailable),
};

const jiraServerIssues: PresenceTable<IssueProjection, IssueFieldGroup> = {
	...jiraIssues,
	batch: jiraProviderApis,
};

/** provider-apis' Linear fragment selects no labels (it fills an empty list), comments or reactions. */
const linearIssue = issuePresenceOf(['description', 'assignees'], ['access']);
const linearIssues: PresenceTable<IssueProjection, IssueFieldGroup> = {
	point: linearIssue,
	account: linearIssue,
	project: linearIssue,
	batch: linearIssue,
};

/** A Trello card's description is never read; its members are its assignees. */
const trelloCard = issuePresenceOf(['assignees', 'labels', 'comments'], trackerUnavailable);
const trelloIssues: PresenceTable<IssueProjection, IssueFieldGroup> = {
	point: trelloCard,
	project: trelloCard,
};

const pullRequestPresence = new Map<string, PresenceTable<PullRequestProjection, PullRequestFieldGroup>>([
	[GitCloudHostIntegrationId.GitHub, gitHubPullRequests],
	[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, gitHubEnterprisePullRequests],
	[GitCloudHostIntegrationId.GitLab, gitLabPullRequestsFor(gitLabProviderApis(true))],
	[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, gitLabPullRequestsFor(gitLabProviderApis(false))],
	[GitCloudHostIntegrationId.AzureDevOps, azurePullRequests],
	[GitSelfManagedHostIntegrationId.AzureDevOpsServer, azureServerPullRequests],
	[GitCloudHostIntegrationId.Bitbucket, bitbucketPullRequests],
	[GitSelfManagedHostIntegrationId.BitbucketServer, bitbucketServerPullRequests],
]);

const issuePresence = new Map<string, PresenceTable<IssueProjection, IssueFieldGroup>>([
	[GitCloudHostIntegrationId.GitHub, gitHubIssues],
	[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, gitHubIssues],
	[GitCloudHostIntegrationId.GitLab, gitLabIssuesFor(true)],
	[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, gitLabIssuesFor(false)],
	[GitCloudHostIntegrationId.AzureDevOps, azureIssues],
	[GitSelfManagedHostIntegrationId.AzureDevOpsServer, azureServerIssues],
	[GitCloudHostIntegrationId.Bitbucket, bitbucketIssues],
	[IssuesCloudHostIntegrationId.Jira, jiraIssues],
	[IssuesSelfManagedHostIntegrationId.JiraServer, jiraServerIssues],
	[IssuesCloudHostIntegrationId.Linear, linearIssues],
	[IssuesCloudHostIntegrationId.Trello, trelloIssues],
]);

function lookup<P extends string, G extends string>(
	tables: ReadonlyMap<string, PresenceTable<P, G>>,
	providerId: string,
	projection: P | undefined,
): Presence<G> | undefined {
	if (projection == null) return undefined;

	const table = tables.get(providerId);
	// `hasOwn` so a projection read off an untrusted row can't resolve to an `Object.prototype` member.
	return table != null && Object.hasOwn(table, projection) ? table[projection] : undefined;
}

/**
 * Which field groups the read that produced `pr` fetched, keyed by its provider and {@link PullRequestShape.projection}.
 * `undefined` when either is unknown or the provider has no table yet — then nothing can be said about any field.
 */
export function getPullRequestFieldPresence(
	pr: PullRequestShape,
): Readonly<Record<PullRequestFieldGroup, FieldPresence>> | undefined {
	return lookup(pullRequestPresence, pr.provider.id, pr.projection);
}

/**
 * Which field groups the read that produced `issue` fetched, keyed by its provider and {@link IssueShape.projection}.
 * `undefined` when either is unknown or the provider has no table yet — then nothing can be said about any field.
 */
export function getIssueFieldPresence(issue: IssueShape): Readonly<Record<IssueFieldGroup, FieldPresence>> | undefined {
	return lookup(issuePresence, issue.provider.id, issue.projection);
}
