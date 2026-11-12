import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type {
	IssueOrPullRequest,
	IssueOrPullRequestState,
	IssueOrPullRequestType,
} from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestMergeQueueActionResult,
	PullRequestMergeQueueEntry,
	PullRequestStackInfo,
	PullRequestStackLayers,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type {
	GitCloudHostIntegrationId,
	IntegrationIds,
	IssuesCloudHostIntegrationId,
	IssuesHostIntegrationIds,
} from '../constants.js';
import type { ProviderRepositoriesInput } from '../manager.js';
import type { PullRequestFilter } from '../providerFilters.js';
import type { ProviderRepositoryShape } from '../results.js';
import type { Sources } from '../telemetry.js';
import { IntegrationBase } from './integration.js';

// The public, interface-only views of the integration classes: what a consumer of the `index.js` facade may call on
// an integration. They are written out member by member, in package-owned and `@gitlens/*` types only, so nothing
// a consumer can reach from them names `@gitkraken/provider-apis` or an internal class. The classes `implements`
// these views, so the compiler keeps each class member assignable to the view's.
// Code inside the package keeps importing the classes from `models/*`.
// The views' doc comments are the consumer contract; the classes' doc comments are maintainer notes.

/** The kind of an integration: a git host or an issue tracker. */
export type IntegrationType = 'git' | 'issues';

// Keep this in step with `isSelfManagedHostIntegrationId`: it is the type-level twin of that predicate, and a
// disagreement compiles cleanly while the runtime writes a domain-keyed key the type says is unkeyed (so the
// local-disconnect flag is written under one key and read under another).
export type IntegrationKey<T extends IntegrationIds = IntegrationIds> = T extends
	| GitCloudHostIntegrationId
	| IssuesCloudHostIntegrationId
	? `${T}`
	: `${T}:${string}`;

export type IntegrationConnectedKey<T extends IntegrationIds = IntegrationIds> = `connected:${IntegrationKey<T>}`;

/** A read's outcome: its value, or the error it failed with; `undefined` when there was nothing to read. */
export type IntegrationResult<T> =
	| { value: T; duration?: number; error?: Error }
	| { error: Error; duration?: number; value?: never }
	| undefined;

/** The credential an integration is connected with, for a consumer that has to hand it to another service. */
export interface IntegrationCredential {
	/** The id of the provider the token was issued for, which is the integration's own id. */
	readonly providerId: IntegrationIds;
	readonly accessToken: string;
}

/** Read options for {@link GitHostIntegration.searchMyPullRequests} and the provider hook behind it. */
export type SearchMyPullRequestsOptions = {
	/** Suppresses the user-facing notification when the read fails. */
	silent?: boolean;
	/**
	 * PR states to include (open/closed/merged/all). Providers that cannot express it in a single query
	 * filter the normalized results; omitted preserves the historical open-only behavior.
	 */
	state?: PullRequestStateFilter;
	includeReviewRequested?: boolean;
};

/** Read options for {@link GitHostIntegration.searchPullRequests} and the provider hook behind it. */
export type SearchPullRequestsOptions = {
	/** PR states to include; omitted preserves the provider's default. */
	include?: IssueOrPullRequestState[];
};

/** Read options for {@link GitHostIntegration.getMyPullRequestsForRepos}. */
export type MyPullRequestsForReposOptions = {
	filters?: PullRequestFilter[];
	cursor?: string;
	customUrl?: string;
	page?: number;
	pageSize?: number;
	/** PR states to include; when omitted the provider returns its default (open only). */
	state?: PullRequestStateFilter | PullRequestStateFilter[];
	/** Requests the lightweight row shape without per-row build status or commit count. */
	summary?: boolean;
	/**
	 * Most per-repository requests one provider read keeps in flight. Defaults to 6. Only hosts that read repository
	 * by repository fan out — GitLab, GitLab self-managed, Bitbucket Cloud, Bitbucket Data Center and Azure DevOps;
	 * GitHub/GHE send one query whatever the repo count. A value that isn't a finite number >= 1 falls back to the
	 * default.
	 */
	scopeConcurrency?: number;
	/**
	 * Azure DevOps only, repo-scoped: `false` skips the lookup that fills each row's clone URLs, saving one
	 * request per repository (and fork source) per page. Rows then carry no `refs.base.url`/`refs.head.url`
	 * (empty) and no `cloneHttps`/`cloneSsh`, so leave it on for rows that will be checked out or matched to local
	 * remotes. Defaults to `true`; other providers ignore it.
	 */
	includeRemoteInfo?: boolean;
};

/** The members shared by every integration view. */
interface IntegrationViewBase {
	readonly type: IntegrationType;
	readonly id: IntegrationIds;
	readonly name: string;
	/**
	 * The `gl-provider-<key>` glicon key for this provider, which is NOT always its id: a self-managed variant
	 * draws with its cloud family's glyph.
	 */
	readonly icon: string;
	readonly domain: string;
	/** Whether the integration has a session; `undefined` until it has looked. */
	readonly maybeConnected: boolean | undefined;

	/** Whether the user's plan allows this integration (a trial or paid account; GitHub and GitLab cloud always do). */
	access(): Promise<boolean>;
	autolinks():
		| (AutolinkReference | DynamicAutolinkReference)[]
		| Promise<(AutolinkReference | DynamicAutolinkReference)[]>;
	/** Connects the integration, prompting the user if needed; whether it became connected. */
	connect(source: Sources): Promise<boolean>;
	isConnected(): Promise<boolean>;
	/**
	 * The credential the integration is connected with, refreshed first when it has expired; `undefined` when it isn't
	 * connected or the refresh failed. An unexpired token is returned as is, so one the provider has since revoked still
	 * comes back.
	 */
	getCredential(source: Sources): Promise<IntegrationCredential | undefined>;
	getIssue(
		resource: ResourceDescriptor,
		id: string,
		options?: { connectionId?: string; expiryOverride?: boolean | number },
	): Promise<Issue | undefined>;
	getLinkedIssueOrPullRequest(
		resource: ResourceDescriptor,
		link: { id: string; key: string },
		options?: { expiryOverride?: boolean | number; type?: IssueOrPullRequestType; throwOnError?: boolean },
	): Promise<IssueOrPullRequest | undefined>;
}

/** A git host integration (GitHub, GitLab, Bitbucket, Azure DevOps, and their self-managed variants). */
export interface GitHostIntegration extends IntegrationViewBase {
	readonly type: 'git';

	/**
	 * Removes a queued pull request from its base branch's merge queue, losing its place there. Results, failures and
	 * cancellation as {@link GitHostIntegration.enqueuePullRequest}.
	 */
	dequeuePullRequest(pr: PullRequest, cancellation?: AbortSignal): Promise<PullRequestMergeQueueActionResult>;
	disconnect(options?: { silent?: boolean; currentSessionOnly?: boolean }): Promise<void>;
	/**
	 * Adds a pull request to its base branch's merge queue (where `mergeQueueRequired` says merging means queueing).
	 * The result says why on failure: the host's refusal (`already-queued`, `head-changed`, `permission`, …),
	 * `unsupported` where this host has no merge queue to act on (only GitHub.com's is), or `unknown` for anything
	 * else, including no connection or a failure to reach the host; the provider's message rides along for logs, not
	 * for display. Cancellation throws `CancellationError`.
	 */
	enqueuePullRequest(pr: PullRequest, cancellation?: AbortSignal): Promise<PullRequestMergeQueueActionResult>;
	getAccountForCommit(
		repo: ResourceDescriptor,
		rev: string,
		options?: { avatarSize?: number },
	): Promise<Account | UnidentifiedAuthor | undefined>;
	getCurrentAccount(options?: {
		avatarSize?: number;
		connectionId?: string;
		expiryOverride?: boolean | number;
	}): Promise<Account | undefined>;
	getDefaultBranch(
		repo: ResourceDescriptor,
		options?: { cancellation?: AbortSignal; expiryOverride?: boolean | number },
	): Promise<DefaultBranch | undefined>;
	/**
	 * Merge-queue entries for the given base branches of the repository, keyed by pull request number, for rows from a
	 * read that selects no merge queue. Only hosts with a readable merge queue implement this (currently GitHub.com);
	 * `undefined` means unavailable. Interim: expect it to go once every pull request read can carry its entry.
	 */
	getMergeQueueEntriesByPullRequestNumber?(
		owner: string,
		repo: string,
		branches: readonly string[],
		cancellation?: AbortSignal,
	): Promise<Map<number, PullRequestMergeQueueEntry> | undefined>;
	/**
	 * The current user's pull requests (or, without `filters`, every pull request) in `reposOrRepoIds`, one page at a
	 * time; `undefined` when the read failed.
	 */
	getMyPullRequestsForRepos(
		reposOrRepoIds: ProviderRepositoriesInput,
		options?: MyPullRequestsForReposOptions,
		connectionId?: string,
	): Promise<PagedResult<PullRequest> | undefined>;
	getPullRequest(
		resource: ResourceDescriptor,
		id: string,
		options?: { expiryOverride?: boolean | number; throwOnError?: boolean },
	): Promise<PullRequest | undefined>;
	getPullRequestForBranch(
		repo: ResourceDescriptor,
		branch: string,
		options?: {
			avatarSize?: number;
			expiryOverride?: boolean | number;
			include?: IssueOrPullRequestState[];
			/**
			 * Rethrow a failed lookup instead of folding it into `undefined`, for callers that must tell
			 * "no pull request" apart from "couldn't ask".
			 */
			throwOnError?: boolean;
		},
	): Promise<PullRequest | undefined>;
	getPullRequestForCommit(
		repo: ResourceDescriptor,
		rev: string,
		options?: { expiryOverride?: boolean | number; throwOnError?: boolean },
	): Promise<PullRequest | undefined>;
	getPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined;
	/**
	 * The repository a host reports for `repo`, or `undefined` when it can't be read. Only the hosts that can look a
	 * repository up implement it.
	 */
	getRepoInfo?(repo: {
		owner: string;
		name: string;
		project?: string;
		connectionId?: string;
	}): Promise<Pick<ProviderRepositoryShape, 'id' | 'namespace' | 'name' | 'project'> | undefined>;
	getRepositoryMetadata(
		repo: ResourceDescriptor,
		options?: { cancellation?: AbortSignal; expiryOverride?: boolean | number },
	): Promise<RepositoryMetadata | undefined>;
	/**
	 * The SSH signing keys (full OpenSSH-format `<type> <key> [comment]` strings) registered by the accounts matching
	 * `emails`, for building an `allowed_signers` file. Keyed by lowercased email; an email with no match is absent.
	 * A provider that doesn't expose signing keys (or isn't connected, or fails the read) returns an empty map.
	 */
	getSshSigningKeysForEmails(repo: ResourceDescriptor, emails: string[]): Promise<Map<string, string[]>>;
	/**
	 * The ordered layers of the stack the given pull request belongs to, bottom to top. `undefined` when the host
	 * has no stacks concept, the repository isn't enrolled, or the pull request isn't stacked.
	 */
	getStackLayersForPullRequest?(
		owner: string,
		repo: string,
		pullRequestNumber: number,
		cancellation?: AbortSignal,
	): Promise<PullRequestStackLayers | undefined>;
	/**
	 * Stack membership for every stacked pull request in the repository, keyed by pull request number. Only hosts
	 * with a stacks concept implement this (currently GitHub).
	 */
	getStacksByPullRequestNumber?(
		owner: string,
		repo: string,
		cancellation?: AbortSignal,
	): Promise<Map<number, PullRequestStackInfo> | undefined>;
	mergePullRequest(
		pr: PullRequest,
		options?: { mergeMethod?: PullRequestMergeMethod },
		cancellation?: AbortSignal,
	): Promise<boolean>;
	/** Account-wide (or repo-scoped) search for the current user's pull requests. */
	searchMyPullRequests(
		repos?: ResourceDescriptor | ResourceDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyPullRequestsOptions & { connectionId?: string },
	): Promise<IntegrationResult<PullRequest[] | undefined>>;
	/** Free-text search across pull requests, optionally narrowed to `repos`. */
	searchPullRequests(
		searchQuery: string,
		repos?: ResourceDescriptor | ResourceDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchPullRequestsOptions & { connectionId?: string },
	): Promise<PullRequest[] | undefined>;
}

/** An issue tracker integration (Jira, Linear, Trello, and their self-managed variants). */
export interface IssuesIntegration extends IntegrationViewBase {
	readonly type: 'issues';
}

export type Integration = GitHostIntegration | IssuesIntegration;

export type IntegrationById<T extends IntegrationIds> = T extends IssuesHostIntegrationIds
	? IssuesIntegration
	: GitHostIntegration;

/**
 * What a consumer-owned cache is told about the integration a cached value was read through: enough to key the value
 * by host and to invalidate it when the connection or its credential changes.
 */
export interface IntegrationCacheDescriptor {
	readonly id: IntegrationIds;
	readonly domain?: string;
	/** Whether the integration has a session; `undefined` until it has looked. */
	readonly maybeConnected?: boolean;
	/** A hash of the current session's token, which changes when the account or token does. */
	readonly sessionFingerprint?: string;
}

/** Whether `value` is an integration. Replaces an `instanceof` check against the internal base class. */
export function isIntegration(value: unknown): value is Integration {
	return value instanceof IntegrationBase;
}

/**
 * Whether `integration` is a git host. Generic so it narrows whatever integration type it is handed: the public
 * {@link Integration} views, or (inside the package) the classes, which implement them.
 */
export function isGitHostIntegration<T extends Integration>(
	integration: T,
): integration is Extract<T, { readonly type: 'git' }> {
	return integration.type === 'git';
}

/** Whether `integration` is an issue tracker. Generic for the same reason as {@link isGitHostIntegration}. */
export function isIssuesIntegration<T extends Integration>(
	integration: T,
): integration is Extract<T, { readonly type: 'issues' }> {
	return integration.type === 'issues';
}
