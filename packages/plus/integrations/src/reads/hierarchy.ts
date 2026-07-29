import { mapBounded } from '@gitlens/utils/promise.js';
import { mergeAssessmentInto } from '../collectionMetadata.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	type IntegrationIds,
	providerFanOutConcurrency,
	supportedOrderedCloudIntegrationIds,
	supportedOrderedCloudIssuesIntegrationIds,
} from '../constants.js';
import type { ListOrgsOptions, ListProjectsOptions } from '../manager.js';
import { isIssuesIntegration } from '../models/issuesIntegration.js';
import { toProviderRepositoryShape } from '../providers/models.js';
import type {
	ProviderOrganization,
	ProviderPagedResult,
	ProviderRepositoryShape,
	ProviderResult,
	ProviderWarning,
} from '../results.js';
import { appendDedupedWarning } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import {
	assertHierarchyReadTarget,
	orgForProject,
	resourceMatchesOrg,
	resourceToOrg,
	withProviderContext,
} from './hierarchy.utils.js';
import { pageToCursor, refusedPage, resolveContinuation, resolveCurrentPage, toProviderPageInfo } from './paging.js';
import { gitHostOnlySurfaceWarning, otherWarning } from './warnings.js';

export async function listOrgs(
	ctx: ProviderReadContext,
	options?: ListOrgsOptions,
): Promise<ProviderResult<ProviderOrganization>> {
	assertHierarchyReadTarget('listOrgs', options);
	const ids = options?.providerId != null ? [options.providerId] : supportedOrderedCloudIntegrationIds;
	const singleProvider = ids.length === 1;
	const connectionId = singleProvider ? options?.connectionId : undefined;
	const requestedDomain = singleProvider ? options?.domain : undefined;

	const results = await mapBounded(ids, providerFanOutConcurrency, async id => {
		const integration = await ctx.getIntegrationForRead(id, connectionId, requestedDomain);
		if (integration == null) {
			// A specifically requested connection that can't be resolved is a broken connection, not a
			// provider with no orgs — surface it (warning + fetchFailed) instead of dropping the id
			// silently, so a caller can tell it apart from an account that genuinely has no orgs.
			const early = ctx.earlyReturnConnectionWarnings(id, connectionId, requestedDomain);
			return {
				items: [] as ProviderOrganization[],
				warnings: early.warnings,
				fetchFailed: early.fetchFailed,
			};
		}

		const items: ProviderOrganization[] = [];
		const warnings: ProviderWarning[] = [];
		let fetchFailed = false;
		const domain = ctx.domainForRead(integration, id, connectionId, requestedDomain);
		const warnOnMissingSession = warnOnMissingSessionForDomain(id, requestedDomain);
		if (isIssuesIntegration(integration)) {
			// Issue trackers expose "resources" (Jira sites, Linear orgs, …) as their org analogue.
			const { value: resources, warning } = await runCaptured(
				id,
				domain,
				connectionId,
				() => integration.getResourcesForUserResult(connectionId),
				{ warnOnMissingSession: warnOnMissingSession },
			);
			if (resources != null) {
				items.push(...resources.map(r => resourceToOrg(id, r)));
			}
			if (warning != null) {
				warnings.push(warning);
				// A warning with no value is a hard read failure, not an empty account.
				if (resources == null) {
					fetchFailed = true;
				}
			}
		} else if (!integration.supportsOrganizationDiscovery) {
			// The provider registers no org-discovery hook (e.g. Bitbucket Data Center). Report it as
			// explicitly unsupported rather than contributing a silent empty list that a caller can't
			// tell apart from "this account has no orgs".
			fetchFailed = true;
			warnings.push(
				otherWarning(id, domain, connectionId, `Organization discovery is not supported by '${id}'.`),
			);
		} else {
			const { value, warning } = await runCaptured(
				id,
				domain,
				connectionId,
				() => integration.getOrganizationsForUserResult(connectionId),
				{ warnOnMissingSession: warnOnMissingSession },
			);
			if (value != null) {
				items.push(...value.values.map(org => withProviderContext(id, org)));
				if (value.truncated) {
					warnings.push(
						otherWarning(
							id,
							domain,
							connectionId,
							'Organization listing was truncated before the upstream results were exhausted.',
						),
					);
					// `ProviderResult` has no page object on which to carry truncation. Mark the flat
					// hierarchy result incomplete so consumers don't treat omitted orgs as authoritative.
					fetchFailed = true;
				}

				const assessment = mergeAssessmentInto(warnings, id, domain, connectionId, value.metadata);
				if (assessment.fetchFailed || assessment.truncated) {
					fetchFailed = true;
				}
			}
			if (warning != null) {
				warnings.push(warning);
				if (value == null) {
					fetchFailed = true;
				}
			}
		}

		return { items: items, warnings: warnings, fetchFailed: fetchFailed };
	});

	const items: ProviderOrganization[] = [];
	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;
	for (const result of results) {
		if (result == null) {
			continue;
		}

		items.push(...result.items);
		// Dedupe across the multi-provider fan-out (matches listProjects): a warning that repeats verbatim
		// across scopes — e.g. the same account surfaced under two ids — shouldn't be reported twice.
		for (const w of result.warnings) {
			appendDedupedWarning(warnings, w);
		}
		if (result.fetchFailed) {
			fetchFailed = true;
		}
	}
	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

export async function listProjects(
	ctx: ProviderReadContext,
	options?: ListProjectsOptions,
): Promise<ProviderResult<ProviderOrganization>> {
	assertHierarchyReadTarget('listProjects', options);
	const ids =
		options?.providerId != null
			? [options.providerId]
			: [
					...supportedOrderedCloudIssuesIntegrationIds,
					GitCloudHostIntegrationId.AzureDevOps,
					GitSelfManagedHostIntegrationId.AzureDevOpsServer,
				];
	const singleProvider = ids.length === 1;
	const connectionId = singleProvider ? options?.connectionId : undefined;
	const requestedDomain = singleProvider ? options?.domain : undefined;

	const results = await mapBounded(ids, providerFanOutConcurrency, async id => {
		const integration = await ctx.getIntegrationForRead(id, connectionId, requestedDomain);
		if (integration == null) {
			// A requested connection that can't be resolved is a broken connection, not a provider with
			// no projects — surface it (warning + fetchFailed) instead of dropping the id silently.
			const early = ctx.earlyReturnConnectionWarnings(id, connectionId, requestedDomain);
			return {
				items: [] as ProviderOrganization[],
				warnings: early.warnings,
				fetchFailed: early.fetchFailed,
			};
		}

		const items: ProviderOrganization[] = [];
		const warnings: ProviderWarning[] = [];
		let fetchFailed = false;
		const domain = ctx.domainForRead(integration, id, connectionId, requestedDomain);
		const org = options?.org;
		const warnOnMissingSession = warnOnMissingSessionForDomain(id, requestedDomain);

		// Git hosts with a project tier (Azure DevOps) read projects through their own hierarchy hook,
		// scoped to `org` when given. Non-Azure git hosts have no project tier and return undefined.
		if (!isIssuesIntegration(integration)) {
			// Check the capability first, like listOrgs/listRepos/listIssuesPage do. Without it, a host
			// with no project tier returns `undefined` from a successful read, which `runCaptured` can't
			// tell apart from an unresolvable session — turning a healthy provider into a `no-connection`
			// warning + `fetchFailed` (and, in Kepler, a spurious reconnect prompt).
			if (!integration.supportsProjectDiscovery) {
				return { items: items, warnings: warnings, fetchFailed: false };
			}

			const { value: projects, warning } = await runCaptured(
				id,
				domain,
				connectionId,
				() => integration.getProjectsForOrgResult(org, connectionId),
				{ warnOnMissingSession: warnOnMissingSession },
			);
			if (warning != null) {
				warnings.push(warning);
				if (projects == null) {
					fetchFailed = true;
				}
			}
			if (projects != null) {
				items.push(...projects.values.map(project => withProviderContext(id, project)));

				if (projects.truncated) {
					warnings.push(
						otherWarning(
							id,
							domain,
							connectionId,
							'Project listing was truncated before the upstream results were exhausted.',
						),
					);
					// Unlike paged repository reads, this flattened hierarchy result has no continuation
					// or page metadata. `fetchFailed` is its structural non-authoritative signal.
					fetchFailed = true;
				}

				const assessment = mergeAssessmentInto(warnings, id, domain, connectionId, projects.metadata);
				if (assessment.fetchFailed || assessment.truncated) {
					fetchFailed = true;
				}
			}
			return { items: items, warnings: warnings, fetchFailed: fetchFailed };
		}

		const { value: resources, warning: resourcesWarning } = await runCaptured(
			id,
			domain,
			connectionId,
			() => integration.getResourcesForUserResult(connectionId),
			{ warnOnMissingSession: warnOnMissingSession },
		);
		if (resourcesWarning != null) {
			warnings.push(resourcesWarning);
			if (resources == null) {
				fetchFailed = true;
			}
		}

		const scopedResources =
			org != null ? resources?.filter(resource => resourceMatchesOrg(resource, org)) : resources;
		if (scopedResources != null && scopedResources.length !== 0) {
			const { value: projects, warning: projectsWarning } = await runCaptured(id, domain, connectionId, () =>
				integration.getProjectsForResourcesWithMetadataResult(scopedResources, connectionId),
			);
			if (projectsWarning != null) {
				warnings.push(projectsWarning);
				if (projects == null) {
					fetchFailed = true;
				}
			}
			if (projects != null) {
				items.push(
					...projects.values.map(project =>
						resourceToOrg(id, project, orgForProject(id, project, scopedResources)),
					),
				);
			}
			const assessment = mergeAssessmentInto(warnings, id, domain, connectionId, projects?.metadata);
			if (assessment.fetchFailed || assessment.truncated) {
				fetchFailed = true;
			}
		}

		return { items: items, warnings: warnings, fetchFailed: fetchFailed };
	});

	const items: ProviderOrganization[] = [];
	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;
	for (const result of results) {
		if (result == null) {
			continue;
		}

		items.push(...result.items);
		for (const w of result.warnings) {
			appendDedupedWarning(warnings, w);
		}
		if (result.fetchFailed) {
			fetchFailed = true;
		}
	}
	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

export async function listRepos(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		connectionId?: string;
		domain?: string;
	},
): Promise<ProviderPagedResult<ProviderRepositoryShape>> {
	const page = Math.max(1, options.page ?? 1);
	if (isIssuesHostIntegrationId(options.providerId)) {
		return refusedPage(
			page,
			[gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'repository discovery')],
			true,
		);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		// A supplied connection or domain that no longer resolves is a broken target, not an empty account —
		// surface a no-connection warning + fetchFailed rather than a silent empty page.
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId, options.domain);
		return refusedPage(page, early.warnings, early.fetchFailed);
	}
	if (!isGitHostIntegration(integration)) {
		return refusedPage(
			page,
			[gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'repository discovery')],
			true,
		);
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);

	const accountWide = options.org == null;
	const supported = accountWide
		? integration.supportsUserRepositoryDiscovery
		: integration.supportsRepositoryDiscovery;
	if (!supported) {
		// No matching repo-discovery hook — org-scoped (e.g. Bitbucket Data Center) or account-wide (e.g.
		// Bitbucket/Azure, whose repos can only be walked per workspace/org). Report unsupported rather than
		// a silent empty page indistinguishable from "no repos"; for the account-wide case the caller should
		// fan out per org from listOrgs instead.
		return refusedPage(
			page,
			[
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					accountWide
						? `Account-wide repository discovery is not supported by '${options.providerId}'; list repositories per org instead.`
						: `Repository discovery is not supported by '${options.providerId}'.`,
				),
			],
			true,
		);
	}

	const org = options.org;
	const cursor = options.cursor ?? pageToCursor(page);
	const { value, warning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() =>
			org == null
				? integration.getRepositoriesForUserResult({
						cursor: cursor,
						connectionId: options.connectionId,
					})
				: integration.getRepositoriesForOrgResult(org, {
						project: options.project,
						cursor: cursor,
						connectionId: options.connectionId,
					}),
		{ warnOnMissingSession: warnOnMissingSessionForDomain(options.providerId, options.domain) },
	);

	const items = value?.values ?? [];
	const warnings = warning != null ? [warning] : [];
	// The repos read core is cursor-only and can't accept a page size, so don't echo the requested
	// `itemsPerPage` as if it were applied — report what the provider returned (its own pageSize when
	// available, else the actual item count).
	const paged = toProviderPageInfo(items.length, value?.paging);
	// Convert the SDK collection metadata into scope-aware warnings + failure/truncation flags, appending
	// them to any captured thrown-error warning without discarding the partial result's items.
	const assessment = mergeAssessmentInto(warnings, options.providerId, domain, options.connectionId, value?.metadata);
	// Whether this read honors a page NUMBER, decided from what the provider actually reported rather than
	// guessed from the absence of a cursor. A numbered-page repos host reports its position (`paging.page`)
	// and/or its successor (`paging.nextPage`) — Bitbucket's workspace walk consumes `page` as a real 1-based
	// page and reports `nextPage` without echoing `currentPage`, so both signals have to count. Every wired
	// cursor-based repos read (GitHub's org/user walks, GitLab's user walk, Bitbucket's cursor read) reports
	// neither. Keying off `paged.cursor == null` instead read the paging layer's "reported another page,
	// handed back no continuation" sentinel as evidence of a numbered host, which is exactly backwards.
	const pageAdvanceable = value?.paging?.page != null || value?.paging?.nextPage != null;
	// Numbered-page hosts that don't echo `currentPage` may still be advanced by the requested `page` (initial
	// read) or by the cursor the caller threaded back. A cursor-only host ignores an UNTHREADED `page`
	// request, so its page-less first page is page 1.
	const currentPage = resolveCurrentPage({
		providerPage: paged.page.currentPage,
		requestedPage: page,
		suppliedCursor: options.cursor,
		pageAdvanceable: pageAdvanceable,
	});
	// Never advertise `hasMore` without a continuation the caller can act on — the same contract
	// `listPullRequestsPage`, `listIssuesPage` and `broadenIssues` hold, via the same helper. A provider that
	// reports another page but hands back neither `endCursor` nor `nextPage` (surfaced as the `'{}'` sentinel,
	// which `toProviderPageInfo` drops) is terminal-but-incomplete: `hasMore: false` + `page.truncated`.
	// Synthesizing a page-number cursor for a cursor-only host instead — which is what this read used to do
	// unconditionally — handed back a continuation the provider ignores, so it answered with its FIRST page
	// again while still reporting `hasMore: true`. A consumer draining until `hasMore` clears (Kepler's repo
	// drain does exactly that) then looped to its own page cap, accumulating a duplicate copy of every repo
	// per round, and never saw a truncation signal.
	const continuation = resolveContinuation(paged, pageAdvanceable ? currentPage + 1 : undefined);
	// The org-hierarchy read can also stop at a defensive backstop with more repos unlisted and no cursor to
	// resume (top-level `truncated`, or `paging.truncated` on a single-page read). Metadata incompleteness and
	// a demoted continuation are two further, independent sources of the same signal.
	const truncated =
		(value?.truncated ?? false) ||
		(value?.paging?.truncated ?? false) ||
		assessment.truncated ||
		continuation.truncated;
	const result: ProviderPagedResult<ProviderRepositoryShape> = {
		// Normalize the raw provider-apis repos to the GitLens-owned shape at the surface boundary.
		items: items.map(toProviderRepositoryShape),
		warnings: warnings,
		page: { ...paged.page, currentPage: currentPage, truncated: truncated || undefined },
		hasMore: continuation.hasMore,
		cursor: continuation.cursor,
		fetchFailed: assessment.fetchFailed || (warning != null && value == null) || undefined,
	};

	// A cursor-only host ignores the synthesized page cursor above and returns page 1. Detect that from
	// the provider's own paging metadata, then advance through its real continuations. Numbered hosts
	// keep their one-request path because `pageAdvanceable` is true.
	if (options.cursor == null && page > 1 && !pageAdvanceable) {
		const traversalWarnings = [...result.warnings];
		let traversalFetchFailed = result.fetchFailed === true;
		let traversalTruncated = result.page.truncated === true;
		let previous = result;

		for (let currentPage = 2; currentPage <= page; currentPage++) {
			if (!previous.hasMore || previous.cursor == null) {
				return {
					items: [],
					warnings: traversalWarnings,
					page: {
						currentPage: page,
						itemsPerPage: 0,
						truncated: traversalTruncated || undefined,
					},
					hasMore: false,
					fetchFailed: traversalFetchFailed || undefined,
				};
			}

			const requested = await listRepos(ctx, {
				...options,
				page: currentPage,
				cursor: previous.cursor,
			});
			for (const traversalWarning of requested.warnings) {
				appendDedupedWarning(traversalWarnings, traversalWarning);
			}
			traversalFetchFailed ||= requested.fetchFailed === true;
			traversalTruncated ||= requested.page.truncated === true;

			if (currentPage === page) {
				return {
					...requested,
					warnings: traversalWarnings,
					page: {
						...requested.page,
						truncated: traversalTruncated || undefined,
					},
					fetchFailed: traversalFetchFailed || undefined,
				};
			}

			previous = requested;
		}
	}

	return result;
}
