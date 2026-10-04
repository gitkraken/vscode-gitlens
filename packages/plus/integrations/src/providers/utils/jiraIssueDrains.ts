import type { CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import { Logger } from '@gitlens/utils/logger.js';
import { throwIfCallerContractError, toCollectionScopeFailure } from '../../collectionMetadata.js';
import { splitProjectIssuesSearch } from '../../models/issuesIntegration.js';
import { IssueFilter } from '../../providerFilters.js';
import type { ProviderIssue } from '../models.js';
import { toIssueShape } from '../models.js';
import { mergeCollectionMetadata } from './providerPaging.js';

/**
 * The issue drains Jira Cloud and Jira Server share. Their reads differ only in how a page is addressed (a site's
 * `resourceId` vs an instance's `baseUrl`) and in which identity a user field takes, so the page fetch and the
 * identities come in as arguments and the bookkeeping is written once.
 */

export type JiraUserScope = { authorLogin?: string; assigneeLogins?: string[]; mentionLogin?: string };

/** One page of a Jira issue search, whether it names one project or several. */
export type JiraIssuePage = { data: ProviderIssue[]; hasMore: boolean; nextCursor: string | undefined } | undefined;
export type JiraIssuePageFetcher = (scope: JiraUserScope, cursor: string | undefined) => Promise<JiraIssuePage>;

/**
 * Three states rather than a boolean: the backstop is recoverable by narrowing the scope, a page error or a stalled
 * cursor is not, and `ProjectIssuesDrain` makes the caller say which.
 */
export type JiraIssuesDrain = {
	issues: ProviderIssue[];
	status: 'complete' | 'backstop' | 'incomplete';
	metadata?: CollectionMetadata;
};

export type JiraUserScopedRead = { issues: ProviderIssue[]; truncated: boolean; metadata?: CollectionMetadata };

export type JiraDrainOptions = {
	maxPages: number;
	/** Where a failure that stops the drain is recorded. */
	failureScope: CollectionScopeFailure['scope'];
	/** Names the provider in the failures this drain synthesizes. */
	providerName: string;
	/**
	 * A failure before anything was read that means "no issues here" rather than a failed read, e.g. a project this
	 * connection can no longer see (#5907). Returning true serves the drain as complete and empty.
	 */
	isEmptyFailure?: (ex: unknown) => boolean;
};

/**
 * Follows a search's cursor up to `maxPages`. A page failure after the first page leaves the already-drained prefix
 * intact and records the failure instead of re-throwing and discarding the prefix; if nothing was fetched yet, the
 * throw propagates so the caller sees a hard error rather than an empty partial success.
 */
export async function drainJiraIssues(
	fetchPage: JiraIssuePageFetcher,
	scope: JiraUserScope,
	options: JiraDrainOptions,
): Promise<JiraIssuesDrain> {
	const issues: ProviderIssue[] = [];
	let cursor: string | undefined;
	let status: JiraIssuesDrain['status'] = 'complete';
	let metadata: CollectionMetadata | undefined;
	const stopIncomplete = (ex: unknown): void => {
		status = 'incomplete';
		metadata = mergeCollectionMetadata(metadata, {
			completeness: 'partial',
			failures: [toCollectionScopeFailure(options.failureScope, ex)],
		});
	};
	for (let i = 0; i < options.maxPages; i++) {
		let result: JiraIssuePage;
		try {
			result = await fetchPage(scope, cursor);
		} catch (ex) {
			if (issues.length === 0) {
				if (options.isEmptyFailure?.(ex)) return { issues: [], status: 'complete' };

				throw ex;
			}

			stopIncomplete(ex);
			break;
		}
		if (result == null) {
			if (cursor == null) break;

			stopIncomplete(new Error(`${options.providerName} returned no page after advertising a continuation`));
			break;
		}

		issues.push(...result.data);
		if (!result.hasMore) break;

		// The provider claims more pages but gave no advancing cursor: we can't continue, so the drain
		// is incomplete — flag it rather than silently stopping (matches drainPullRequests/Repositories).
		if (result.nextCursor == null || result.nextCursor === cursor) {
			stopIncomplete(new Error(`${options.providerName} returned no advancing issue continuation`));
			break;
		}

		cursor = result.nextCursor;
		// Pages remain but this was the last allowed iteration: the backstop stopped the drain, which a
		// narrower scope would avoid.
		if (i === options.maxPages - 1) {
			status = 'backstop';
		}
	}
	return { issues: issues, status: status, metadata: metadata };
}

/**
 * Runs one drain per requested relationship and keeps whatever succeeded. Throws only when every relationship failed,
 * so the caller sees a hard error rather than an empty success.
 *
 * `identities` are the values each kind of clause takes, which the providers resolve differently: `userField` scopes
 * `assignee`/`creator`, which are user fields, and `mention` scopes `comment ~ "..."`, a free-text search over comment
 * bodies, which only a name can match.
 */
export async function readUserScopedJiraIssues(
	fetchPage: JiraIssuePageFetcher,
	requestedFilters: readonly IssueFilter[] | undefined,
	identities: { userField: string; mention: string },
	options: JiraDrainOptions,
): Promise<JiraUserScopedRead> {
	// A resolved user always scopes the read. Default to the assignee filter ("my issues") when no explicit filters
	// are given — otherwise a caller that scopes by user but omits filters would fall through to an unscoped fetch
	// and get every issue in the project instead of the user's (#5438).
	const filters = requestedFilters?.length ? requestedFilters : [IssueFilter.Assignee];
	const settled = await Promise.allSettled(
		filters.map(filter =>
			drainJiraIssues(
				fetchPage,
				{
					authorLogin: filter === IssueFilter.Author ? identities.userField : undefined,
					assigneeLogins: filter === IssueFilter.Assignee ? [identities.userField] : undefined,
					mentionLogin: filter === IssueFilter.Mention ? identities.mention : undefined,
				},
				options,
			),
		),
	);

	// If every filter branch rejected, the read failed outright — propagate the first rejection instead
	// of returning an empty list, which the facade (getIssuesForProjectResult → runCaptured) would
	// otherwise surface as a successful "no issues" rather than a warning + fetchFailed. The first
	// reason is re-thrown as-is (not wrapped in an AggregateError) so the facade can still classify it
	// by type (auth/rate-limit) — wrapping would collapse every failure to a generic 'other'. The
	// remaining reasons would otherwise be discarded, so log them here to keep them diagnosable.
	if (settled.every(r => r.status === 'rejected')) {
		for (let i = 1; i < settled.length; i++) {
			const outcome = settled[i];
			if (outcome.status === 'rejected') {
				Logger.error(outcome.reason, `readUserScopedJiraIssues: filter '${filters[i]}' failed`);
			}
		}
		throw settled[0].status === 'rejected'
			? settled[0].reason
			: new Error(`${options.providerName} issue read failed`);
	}

	let truncated = false;
	let metadata: CollectionMetadata | undefined;
	const issues: ProviderIssue[] = [];
	for (let i = 0; i < settled.length; i++) {
		const outcome = settled[i];
		const filter = filters[i];
		// A rejected filter branch (with at least one sibling succeeding) means these issues are incomplete:
		// keep the sibling results but record a structured failure so the facade can warn on the specific
		// filter (auth/rate-limit) instead of just a generic truncation flag.
		if (outcome.status !== 'fulfilled') {
			// Identical for every filter branch, so degrading it would report one failure per branch for a
			// single invalid call — see `throwIfCallerContractError`.
			throwIfCallerContractError(outcome.reason);

			truncated = true;
			const failure = toCollectionScopeFailure(options.failureScope, outcome.reason);
			metadata = mergeCollectionMetadata(metadata, {
				completeness: 'partial',
				failures: [
					{
						...failure,
						message: `Issue filter '${filter}' could not be read${
							failure.message != null ? `: ${failure.message}` : ''
						}`,
					},
				],
			});
			continue;
		}

		if (outcome.value.status !== 'complete') {
			truncated = true;
		}
		if (outcome.value.metadata != null) {
			metadata = mergeCollectionMetadata(metadata, outcome.value.metadata);
		}
		issues.push(...outcome.value.issues);
	}
	return { issues: issues, truncated: truncated, metadata: metadata };
}

/**
 * Each relationship is its own search, so an issue matching two of them arrives twice. Every caller is a tracker
 * project read, so the rows carry the `project` projection.
 */
export function toUniqueJiraIssueShapes(issues: readonly ProviderIssue[], provider: ProviderReference): IssueShape[] {
	const resultsById = new Map<string, IssueShape>();
	for (const issue of issues) {
		const shape = toIssueShape(issue, provider, { projection: 'project' });
		if (shape != null && !resultsById.has(shape.id)) {
			resultsById.set(shape.id, shape);
		}
	}
	return [...resultsById.values()];
}

/**
 * Reads the current user's issues of several projects with one search per relationship, split back to the projects
 * in `projectIds` order by each issue's `project.id`. Undefined when the search did not complete or an issue belongs
 * to no requested project, so the caller reads them one by one: a search's pages are global to its project set, and
 * an incomplete one says nothing about which of its projects it covered. Its failures are therefore never
 * published, and the waste is bounded by one project's page budget, paid only by a search that needed more than
 * that or failed partway.
 */
export async function searchJiraProjectIssues(
	fetchPage: JiraIssuePageFetcher,
	projectIds: readonly string[],
	filters: readonly IssueFilter[] | undefined,
	identities: { userField: string; mention: string },
	options: JiraDrainOptions,
	provider: ProviderReference,
): Promise<IssueShape[][] | undefined> {
	const read = await readUserScopedJiraIssues(fetchPage, filters, identities, options);
	if (read.truncated) return undefined;

	const split = splitProjectIssuesSearch(projectIds, read.issues, issue => issue.project?.id ?? undefined);
	return split?.map(issues => toUniqueJiraIssueShapes(issues, provider));
}
