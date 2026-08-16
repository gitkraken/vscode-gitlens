import type { CollectionMetadata } from '@gitkraken/provider-apis';
import type { IssueShape, IssueSorting } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import { mergeAssessmentInto } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import { isIssuesIntegration } from '../models/issuesIntegration.js';
import { IssueFilter, providersMetadata } from '../providers/models.js';
import { mergeCollectionMetadata, parsePageCursor } from '../providers/utils/providerPaging.js';
import type { ProviderPagedResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning, reconcileOmissionsWithFailure } from '../results.js';
import { isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { parseIssueTrackerPageCursor, toIssueTrackerPageCursor } from './cursors.js';
import { runCaptured } from './drains.js';
import { projectKey, resourceIdForProject, resourceLabel, resourceMatchesOrg } from './hierarchy.utils.js';
import { resolveIssueSort, toIssueOrdering } from './ordering.js';
import {
	incompleteReadWarning,
	issueTrackerOnlySurfaceWarning,
	otherWarning,
	unmergeableIssueSortWarning,
	unsupportedIssueSortWarning,
} from './warnings.js';

export async function listIssueTrackerIssuesPage(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		filters?: IssueFilter[];
		/** Broadens the read to every assignee. Scopes to user-assigned issues when omitted. */
		includeAllAssignees?: boolean;
		/**
		 * How to order the issues, as `field:direction`. Omitted orders most-recently-updated-first where the
		 * tracker can express it.
		 *
		 * Validated against `getSupportedFilters().issues`' sibling `issueSorts` — a tracker reports there, not
		 * under the account-wide table, because resource -> project IS its only issue surface. A key it can't
		 * express refuses the read rather than serving a differently-ordered list.
		 *
		 * One page can span SEVERAL projects, whose issues are merged here, so a key no normalized issue carries
		 * (`priority`, `dueDate`, `resolved`) is refused for a multi-project page even though the tracker orders by
		 * it perfectly well within one project.
		 *
		 * Unlike the git-host reads this one is safe to change mid-pagination: its cursor windows PROJECTS and
		 * drains each to exhaustion, so which projects a round covers doesn't depend on how their issues are
		 * ordered. Only the order within a page changes.
		 */
		sort?: IssueSorting;
		forceSync?: boolean;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		connectionId?: string;
	},
): Promise<ProviderPagedResult<IssueShape>> {
	// Pagination is opt-in: only window the projects when the caller actually asked to page. A caller that
	// passes none of page/cursor/itemsPerPage keeps the "aggregate every matched project" contract, so an
	// existing consumer that doesn't inspect `hasMore` never silently loses projects past a default window.
	const compositeCursor = parseIssueTrackerPageCursor(options.cursor);
	const paginated =
		compositeCursor?.unpaged !== true &&
		(options.page != null || options.cursor != null || options.itemsPerPage != null);
	// A composite cursor can carry retries from earlier project windows alongside the next untouched window.
	// `currentPage` remains the caller-facing position; `nextPage` is the window this round should advance.
	const page = Math.max(
		1,
		Math.trunc(compositeCursor?.currentPage ?? parsePageCursor(options.cursor) ?? options.page ?? 1),
	);
	const projectsPerPage = Math.max(1, Math.trunc(options.itemsPerPage ?? 20));

	const items: IssueShape[] = [];
	const warnings: ProviderWarning[] = [];
	const emptyPage = (
		fetchFailed?: boolean,
		truncated?: boolean,
		retry?: {
			nextPage?: number;
			pages?: readonly number[];
			projects?: readonly string[];
			completedProjects?: readonly string[];
		},
	): ProviderPagedResult<IssueShape> => {
		const cursor =
			retry != null
				? toIssueTrackerPageCursor({
						currentPage: page + 1,
						unpaged: !paginated,
						nextPage: retry.nextPage,
						retryPages: retry.pages ?? [],
						retryProjects: retry.projects ?? [],
						completedProjects: retry.completedProjects ?? [],
					})
				: undefined;
		return {
			items: items,
			warnings: warnings,
			page: { currentPage: page, itemsPerPage: items.length, truncated: truncated || undefined },
			// Retry-only state is deliberately manual: advertising it as forward progress would make a
			// persistent provider failure spin forever in a normal `while (hasMore)` consumer. An untouched
			// project window remains normal forward progress even when this window failed completely.
			hasMore: retry?.nextPage != null && cursor != null,
			cursor: cursor,
			fetchFailed: fetchFailed || undefined,
		};
	};
	const normalWindowPage = paginated
		? (compositeCursor?.nextPage ?? (compositeCursor == null ? page : undefined))
		: undefined;
	const priorRetryPages = compositeCursor?.retryPages ?? [];
	const priorRetryProjects = compositeCursor?.retryProjects ?? [];
	const priorCompletedProjects = compositeCursor?.completedProjects ?? [];
	const trackCompletedProjects =
		priorCompletedProjects.length > 0 || priorRetryPages.length > 0 || compositeCursor?.completedProjects != null;
	const retryPagesForDiscoveryFailure = (): number[] => [
		...priorRetryPages,
		...(normalWindowPage != null ? [normalWindowPage] : compositeCursor == null ? [1] : []),
	];
	const discoveryFailureRetry = (): {
		pages: readonly number[];
		projects: readonly string[];
		completedProjects: readonly string[];
	} => ({
		pages: retryPagesForDiscoveryFailure(),
		projects: priorRetryProjects,
		completedProjects: priorCompletedProjects,
	});

	if (!isIssuesHostIntegrationId(options.providerId)) {
		warnings.push(
			issueTrackerOnlySurfaceWarning(options.providerId, options.connectionId, 'Issue-tracker project reads'),
		);
		return emptyPage(true);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId);
	if (integration == null) {
		// A supplied connectionId that no longer resolves is a broken connection, not an empty account.
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId);
		warnings.push(...early.warnings);
		return emptyPage(early.fetchFailed);
	}
	if (!isIssuesIntegration(integration)) {
		warnings.push(
			issueTrackerOnlySurfaceWarning(options.providerId, options.connectionId, 'Issue-tracker project reads'),
		);
		return emptyPage(true);
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId);

	// Before any upstream request: the discovery fan-outs below (resources, projects, per-resource accounts) are
	// three round trips, and an order this tracker can't express refuses the read whatever they return. Placed after
	// `domain` only because every warning carries it.
	const resolvedSort = resolveIssueSort(providersMetadata[options.providerId]?.supportedIssueSorts, options.sort);
	if (resolvedSort.rejection != null) {
		warnings.push(
			unsupportedIssueSortWarning(options.providerId, domain, options.connectionId, resolvedSort.rejection),
		);
		return emptyPage(true);
	}

	const sort = resolvedSort.sort;

	await ctx.forceRefreshIfRequested(integration, options.forceSync, options.connectionId);

	const { value: resources, warning: resourcesWarning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() => integration.getResourcesForUserResult(options.connectionId),
	);
	if (resourcesWarning != null) {
		warnings.push(resourcesWarning);
	}
	if (resources == null || resources.length === 0) {
		const fetchFailed = resourcesWarning != null && resources == null;
		return emptyPage(fetchFailed, false, fetchFailed ? discoveryFailureRetry() : undefined);
	}

	const scopedResources =
		options.org != null ? resources.filter(r => resourceMatchesOrg(r, options.org!)) : resources;
	if (scopedResources.length === 0) {
		return emptyPage();
	}

	const { value: projectsResult, warning: projectsWarning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() => integration.getProjectsForResourcesWithMetadataResult(scopedResources, options.connectionId),
	);
	if (projectsWarning != null) {
		warnings.push(projectsWarning);
	}
	// Partial project discovery: continue with the resources that succeeded, but surface per-resource
	// failures as warnings and remember to mark the page fetchFailed so the caller knows some issues may be
	// missing. `projectDiscoveryFailed`/`projectDiscoveryTruncated` are OR-ed into the page's
	// fetchFailed/truncated at every return below (a truncated-but-not-failed discovery, e.g. a paging
	// backstop, still means the project set is incomplete).
	const projectDiscoveryAssessment = mergeAssessmentInto(
		warnings,
		options.providerId,
		domain,
		options.connectionId,
		projectsResult?.metadata,
	);
	const projectDiscoveryFailed = projectDiscoveryAssessment.fetchFailed;
	const projectDiscoveryTruncated = projectDiscoveryAssessment.truncated;
	const projects = projectsResult?.values;
	if (projects == null || projects.length === 0) {
		const fetchFailed = (projectsWarning != null && projectsResult == null) || projectDiscoveryFailed;
		return emptyPage(
			fetchFailed,
			projectDiscoveryTruncated,
			fetchFailed || projectDiscoveryTruncated ? discoveryFailureRetry() : undefined,
		);
	}

	const matchedProjects =
		options.project != null ? projects.filter(p => resourceMatchesOrg(p, options.project!)) : projects;

	// Validate the requested filters against what this provider supports (e.g. Linear/Trello support only
	// Assignee). An unsupported filter must not silently degrade — Linear/Trello ignore the requested type
	// and apply Assignee regardless — so warn + fetchFailed instead of returning a differently-scoped set.
	if (options.filters?.length) {
		const supported = providersMetadata[options.providerId]?.supportedIssueFilters;
		const allSupported = supported != null && options.filters.every(f => supported.includes(f));
		if (!allSupported) {
			warnings.push(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					`One or more requested issue filters are not supported by '${options.providerId}'.`,
				),
			);
			return emptyPage(true);
		}
	}

	// `includeAllAssignees` drops the user scope, but a user-relative filter (Author/Mention) is meaningless
	// without a user. Passing both to the provider degrades silently: Jira, seeing no user, falls through to
	// an unscoped project fetch and returns EVERY issue instead of the requested author's/mentions. Reject
	// the incompatible combination up front rather than publishing a differently-scoped set as the result.
	if (options.includeAllAssignees === true && options.filters?.some(f => f !== IssueFilter.Assignee)) {
		warnings.push(
			otherWarning(
				options.providerId,
				domain,
				options.connectionId,
				`\`includeAllAssignees\` cannot be combined with an author/mention filter for '${options.providerId}' (those filters require a user scope).`,
			),
		);
		return emptyPage(true);
	}

	// Scope to the current user's assigned issues unless the caller broadens to all assignees. Resolve the
	// handle from each resource's own account (multi-account safe), capturing any error so its kind
	// (e.g. auth) is preserved rather than collapsed to a generic warning.
	let usersByResourceId: Map<string, string> | undefined;
	let accountLookupFailed = false;
	if (options.includeAllAssignees !== true) {
		usersByResourceId = new Map<string, string>();
		const accounts = await mapBounded(scopedResources, providerFanOutConcurrency, async resource => ({
			resource: resource,
			...(await runCaptured(options.providerId, domain, options.connectionId, () =>
				integration.getAccountForResourceResult(resource, options.connectionId),
			)),
		}));

		for (const { resource, value: account, warning: accountWarning } of accounts) {
			const user = account?.username ?? account?.name ?? undefined;
			if (user != null) {
				usersByResourceId.set(resourceIdForProject(resource) ?? resource.key, user);
				continue;
			}

			// Deduped: a captured `accountWarning` carries only the provider error, with no resource in its
			// message, so one expired token across N resources would otherwise repeat verbatim N times. The
			// synthesized fallback names the resource, so those stay distinct on their own.
			appendDedupedWarning(
				warnings,
				accountWarning ??
					otherWarning(
						options.providerId,
						domain,
						options.connectionId,
						`Could not resolve the current user for '${resourceLabel(resource)}'; skipping that resource to avoid returning issues assigned to others.`,
					),
			);
			accountLookupFailed = true;
		}
	}

	const fallbackUserForUnscopedProject =
		scopedResources.length === 1 && usersByResourceId?.size === 1
			? usersByResourceId.values().next().value
			: undefined;
	const userForProject = (project: ResourceDescriptor): string | undefined => {
		const resourceId = resourceIdForProject(project);
		if (resourceId != null) {
			const user = usersByResourceId?.get(resourceId);
			if (user != null) {
				return user;
			}
		}

		// Some providers/tests return project descriptors without their parent resource id. When we have only
		// one scoped resource, re-use that sole resolved user rather than silently dropping every project.
		return fallbackUserForUnscopedProject;
	};

	const retryProjectKeys = new Set<string>();
	const completedProjectKeys = new Set(priorCompletedProjects);
	for (const retryProject of priorRetryProjects) {
		completedProjectKeys.delete(retryProject);
	}
	const scopedProjectsWithUsers =
		usersByResourceId != null
			? matchedProjects.filter(project => {
					if (userForProject(project) != null) return true;

					const key = projectKey(project);
					retryProjectKeys.add(key);
					completedProjectKeys.delete(key);
					return false;
				})
			: matchedProjects;

	// Select the untouched window plus any earlier windows/projects that explicitly need retrying. Keys
	// include the parent resource so two trackers can reuse the same project id without collapsing.
	const projectsByRetryKey = new Map(scopedProjectsWithUsers.map(project => [projectKey(project), project]));
	const scopedProjectsByKey = new Map<string, ResourceDescriptor>();
	const addScopedProject = (project: ResourceDescriptor): void => {
		const key = projectKey(project);
		if (completedProjectKeys.has(key)) return;

		scopedProjectsByKey.set(key, project);
	};
	for (const retryProject of priorRetryProjects) {
		const project = projectsByRetryKey.get(retryProject);
		if (project != null) {
			addScopedProject(project);
		} else if (projectDiscoveryFailed || projectDiscoveryTruncated) {
			retryProjectKeys.add(retryProject);
		}
	}
	const windowPages = new Set<number>(priorRetryPages);
	if (normalWindowPage != null) {
		windowPages.add(normalWindowPage);
	}
	if (!paginated && (projectDiscoveryFailed || projectDiscoveryTruncated)) {
		windowPages.add(1);
	}
	if (paginated) {
		for (const windowPage of windowPages) {
			const windowStart = (windowPage - 1) * projectsPerPage;
			for (const project of scopedProjectsWithUsers.slice(windowStart, windowStart + projectsPerPage)) {
				addScopedProject(project);
			}
		}
	} else if (compositeCursor == null || priorRetryPages.length > 0) {
		// An unpaged retry-only cursor should re-read only the explicitly failed projects already added
		// above. Discovery retries still rescan the aggregate set so newly recovered projects are included.
		for (const project of scopedProjectsWithUsers) {
			addScopedProject(project);
		}
	}
	const scopedProjects = [...scopedProjectsByKey.values()];
	const furthestWindowPage = windowPages.size > 0 ? Math.max(...windowPages) : normalWindowPage;
	const normalWindowEnd =
		furthestWindowPage != null ? furthestWindowPage * projectsPerPage : scopedProjectsWithUsers.length;
	const nextPage =
		paginated && furthestWindowPage != null && scopedProjectsWithUsers.length > normalWindowEnd
			? furthestWindowPage + 1
			: undefined;
	const retryWindowPages = (): number[] => {
		if (!projectDiscoveryFailed && !projectDiscoveryTruncated && retryProjectKeys.size === 0) {
			return [];
		}

		const pages = new Set(windowPages);
		if (pages.size === 0) {
			// A terminal retry has no untouched next window to identify its origin. Keep a manual window
			// marker so a later partial discovery can reconcile against the projects already emitted.
			pages.add(paginated ? Math.max(1, page - 1) : 1);
		}
		return [...pages];
	};
	if (scopedProjects.length === 0) {
		// The discovered projects didn't intersect the requested filter/window, or every matching resource
		// failed user resolution. If discovery or account lookup was partial, the empty result is not a
		// proven-empty account — carry `fetchFailed` so the caller knows issues may be missing.
		return emptyPage(projectDiscoveryFailed || accountLookupFailed, projectDiscoveryTruncated, {
			nextPage: nextPage,
			pages: retryWindowPages(),
			projects: [...retryProjectKeys],
			completedProjects: [...completedProjectKeys],
		});
	}

	// A read spanning several projects is a merge, so it can only honor a key a normalized issue carries. Bound here
	// rather than next to the key's validation above, because the project count is only known now — while still
	// before any project read, so a refusal costs no request. Refused rather than served as concatenated
	// per-project runs, which would look ordered without being so.
	//
	// Counted over every project the READ covers, not the `scopedProjects` window this page happens to hold: the
	// window is `itemsPerPage` projects wide, so counting it would refuse a 20-project page and then serve the
	// final 1-project page of the same paginated call — the same key answered two ways, with the earlier pages'
	// issues missing from a read that reported success.
	//
	// Projects are not the only thing a tracker read merges: a user-scoped read asking for several relationships
	// issues one provider query PER relationship and unions them within each project (Jira runs one JQL drain per
	// filter and folds them into one map, in filter order), so a single-project page of two filters is just as
	// concatenated as a two-project one. Counting only projects published those runs under the requested key.
	// Not gated on the provider: the two trackers that don't fan out (Linear, Trello) declare `Assignee` as their
	// only supported filter, so a multi-filter read is already refused above and can never reach this.
	const mergesFilters = options.includeAllAssignees !== true && (options.filters?.length ?? 0) > 1;
	const ordering = toIssueOrdering(sort, scopedProjectsWithUsers.length > 1 || mergesFilters);
	if (ordering.unmergeable != null) {
		warnings.push(
			unmergeableIssueSortWarning(
				options.providerId,
				domain,
				options.connectionId,
				ordering.unmergeable,
				scopedProjectsWithUsers.length > 1 ? 'projects' : 'filters',
			),
		);
		return emptyPage(true);
	}

	const perProject = await mapBounded(scopedProjects, providerFanOutConcurrency, async project => ({
		project: project,
		...(await runCaptured(options.providerId, domain, options.connectionId, () =>
			integration.getIssuesForProjectWithTruncationResult(
				project,
				{
					user: userForProject(project),
					filters: options.filters,
					sort: sort,
				},
				options.connectionId,
			),
		)),
	}));

	// Partial project discovery means some projects' issues are missing from this page; propagate it so the
	// page reports fetchFailed even when every discovered project's own read succeeded.
	let fetchFailed = projectDiscoveryFailed || accountLookupFailed;
	// A project whose internal page-drain hit its backstop (Jira/Linear cap at maxPagesPerRequest) reports
	// `truncated`; surface it as `page.truncated` so a windowed read isn't published as having drained each
	// project completely.
	let projectTruncated = projectDiscoveryTruncated;
	let drainMetadata: CollectionMetadata | undefined;
	for (const { project, value: result, warning } of perProject) {
		const key = projectKey(project);
		const retryProject = result == null;
		if (warning != null) {
			// Deduped: the per-project warning is built from the provider error alone and names no project, so a
			// single failing token repeats verbatim once per project in the window.
			appendDedupedWarning(warnings, warning);
			fetchFailed = true;
			projectTruncated = true;
		}
		// A thrown/unsupported read (e.g. Linear not-implemented) surfaces as a warning with no value;
		// mark the aggregate as fetchFailed so an empty result isn't mistaken for "no issues".
		if (result == null) {
			fetchFailed = true;
		}
		if (result != null) {
			items.push(...result.values);
			if (result.truncated) {
				projectTruncated = true;
			}
			if (result.metadata != null) {
				drainMetadata = mergeCollectionMetadata(drainMetadata, result.metadata);
			}
		}
		if (retryProject) {
			retryProjectKeys.add(key);
			completedProjectKeys.delete(key);
		} else {
			// A usable partial/truncated project is emitted once and remains structurally incomplete.
			// Re-running the same project cursor would normally return the same prefix and duplicate it
			// across facade pages; only a project that returned no value is safe to retry automatically.
			completedProjectKeys.add(key);
		}
	}

	// Each provider query arrived ordered by the tracker; the union of them — across projects, and across the
	// per-relationship queries a multi-filter read fans out into — is not, and the union is what this read
	// publishes. A no-op when nothing merged, since the tracker already ordered that single run.
	const orderedItems = ordering.order(items);

	const drainAssessment = mergeAssessmentInto(
		warnings,
		options.providerId,
		domain,
		options.connectionId,
		drainMetadata,
	);
	fetchFailed = fetchFailed || drainAssessment.fetchFailed;
	projectTruncated = projectTruncated || drainAssessment.truncated;

	// A per-project read that returned data but couldn't confirm completeness (e.g. Trello's provider-native
	// cap) sets `truncated` without a structured failure. Add one provider-neutral incompleteness warning so
	// the caller sees the truncation, but only when no warning already explains it (avoid duplicate noise).
	if (projectTruncated && warnings.length === 0) {
		warnings.push(
			incompleteReadWarning(
				options.providerId,
				domain,
				options.connectionId,
				'Some issues were omitted; the provider returned an incomplete result.',
				// `exhausted`, not `page-budget`: the per-project drain's backstop is an internal constant
				// (`maxPagesPerRequest`), not an option this read exposes, so no caller can raise it.
				fetchFailed ? 'interrupted' : 'exhausted',
			),
		);
	}
	// A metadata omission from an earlier project asserts the read succeeded; a later one may since have failed.
	reconcileOmissionsWithFailure(warnings, fetchFailed);

	const retryPages = retryWindowPages();
	const cursor = toIssueTrackerPageCursor({
		currentPage: page + 1,
		unpaged: !paginated,
		nextPage: nextPage,
		retryPages: retryPages,
		retryProjects: [...retryProjectKeys],
		completedProjects:
			(trackCompletedProjects ||
				projectDiscoveryFailed ||
				projectDiscoveryTruncated ||
				retryProjectKeys.size > 0) &&
			(retryPages.length > 0 || nextPage != null)
				? [...completedProjectKeys]
				: [],
	});
	return {
		items: orderedItems,
		warnings: warnings,
		page: { currentPage: page, itemsPerPage: orderedItems.length, truncated: projectTruncated || undefined },
		// Failed-project retries alone are manual. Only an untouched project window is automatic progress.
		hasMore: nextPage != null && cursor != null,
		cursor: cursor,
		fetchFailed: fetchFailed || undefined,
	};
}
