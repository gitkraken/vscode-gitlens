import type { IssueResourceDescriptor, ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import type { IntegrationIds } from '../constants.js';
import type { ProviderOrganization, ProviderResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';

/**
 * Mapping of a provider's own hierarchy vocabulary onto the single {@link ProviderOrganization} shape the facade
 * publishes.
 *
 * Providers disagree about what sits above a repo or an issue: git hosts have orgs (and Azure DevOps a project
 * tier below that), while issue trackers have "resources" (Jira sites, Linear orgs, Trello workspaces) with
 * projects beneath them. `listOrgs`/`listProjects` unify all of it, so these helpers exist to keep the
 * per-provider shape-guessing — which field is the id, which is the display label, which resource is a
 * project's parent — in one place instead of inline in those reads.
 *
 * Everything here reads through the base {@link ResourceDescriptor} (which only guarantees `key`) and casts to
 * the concrete {@link IssueResourceDescriptor} for the optional `id`/`name`. That cast is why the fallbacks are
 * spelled out rather than assumed.
 */

/** The label to show for a resource: its name, else its id, else the key that is always present. */
export function resourceLabel(resource: ResourceDescriptor): string {
	const typed = resource as IssueResourceDescriptor;
	return typed.name ?? typed.id ?? resource.key;
}

/** Whether `org` addresses this resource by any of the identifiers a caller could reasonably have. */
export function resourceMatchesOrg(resource: ResourceDescriptor, org: string): boolean {
	const typed = resource as IssueResourceDescriptor;
	return resource.key === org || typed.id === org || typed.name === org;
}

/**
 * The id of the RESOURCE a project belongs to, used to look up which account (and therefore which user) that
 * project's issues should be scoped to. Falls back through the project's own identifiers because some providers
 * (and test doubles) return project descriptors without naming their parent.
 */
export function resourceIdForProject(project: ResourceDescriptor): string | undefined {
	const typed = project as IssueResourceDescriptor & { resourceId?: string };
	return typed.resourceId ?? typed.id ?? project.key;
}

/**
 * A stable identity for one project across facade pages, for the retry/completed bookkeeping an issue-tracker
 * cursor carries. All three identifiers are included rather than one preferred value: two trackers can reuse the
 * same project id, so keying on a single field would collapse them into one entry.
 */
export function projectKey(project: ResourceDescriptor): string {
	const typed = project as IssueResourceDescriptor & { resourceId?: string };
	return JSON.stringify([typed.resourceId ?? '', typed.id ?? '', project.key]);
}

/**
 * Maps an issue-tracker resource descriptor to the unified {@link ProviderOrganization} org shape. `url` is
 * synthesized when the descriptor carries none, rather than widening the shared `ProviderOrganization.url` to
 * optional for the one provider family that may omit it.
 */
export function resourceToOrg(
	providerId: IntegrationIds,
	resource: ResourceDescriptor,
	org?: string,
): ProviderOrganization {
	const typed = resource as IssueResourceDescriptor & { url?: string };
	return {
		id: typed.id ?? resource.key,
		providerId: providerId,
		name: resourceLabel(resource),
		...(org != null ? { org: org } : {}),
		url: typed.url ?? '',
	};
}

/**
 * The resource a project belongs under, as a display label — the `org` of the project's unified org shape.
 *
 * A project doesn't reliably name its parent, so try each identifier it does carry against the resources that
 * were read alongside it. When none matches but only ONE resource was in scope, that resource is the parent by
 * construction. Trello is excluded: its boards have no enclosing resource to name.
 */
export function orgForProject(
	providerId: IntegrationIds,
	project: ResourceDescriptor,
	resources: ResourceDescriptor[],
): string | undefined {
	if (providerId === IssuesCloudHostIntegrationId.Trello) return undefined;

	const typedProject = project as IssueResourceDescriptor & { resourceId?: string };
	const parentMatch = [typedProject.resourceId, typedProject.id, project.key]
		.filter((value): value is string => value != null)
		.map(candidate => resources.find(resource => resourceMatchesOrg(resource, candidate)))
		.find((resource): resource is ResourceDescriptor => resource != null);

	return parentMatch != null
		? resourceLabel(parentMatch)
		: resources.length === 1
			? resourceLabel(resources[0])
			: undefined;
}

/**
 * Stamps the provider onto an org the provider's own client produced. A git host's client fills the rest of the
 * shape but doesn't know which integration id it was reached through — and on a self-managed host the same
 * client serves several — so the fan-out attributes it here.
 */
export function withProviderContext(providerId: IntegrationIds, item: ProviderOrganization): ProviderOrganization {
	return {
		...item,
		providerId: providerId,
		...(item.org != null ? { org: item.org } : {}),
	};
}

/**
 * Merges the per-provider slices of a hierarchy fan-out into one flat result.
 *
 * `ProviderResult` has no page object, so `fetchFailed` is its only non-authoritative signal — any slice that
 * failed or came back incomplete has to set it, or a caller would treat a short list as the whole account.
 * Warnings are deduped because the same account can surface under two ids in one fan-out.
 */
export function mergeHierarchyResults<T>(
	results: readonly ({ items: T[]; warnings: ProviderWarning[]; fetchFailed: boolean } | undefined)[],
): ProviderResult<T> {
	const items: T[] = [];
	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;
	for (const result of results) {
		if (result == null) continue;

		items.push(...result.items);
		for (const warning of result.warnings) {
			appendDedupedWarning(warnings, warning);
		}
		if (result.fetchFailed) {
			fetchFailed = true;
		}
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

/**
 * Rejects a hierarchy read whose scoped selectors have no provider to apply to. `connectionId` and `domain`
 * both select among the connections OF a provider, so either one without `providerId` is ambiguous rather than
 * merely redundant — the fan-out would have to guess which provider the caller meant, and silently picking one
 * would read that connection's data under another provider's name.
 */
export function assertHierarchyReadTarget(
	method: 'listOrgs' | 'listProjects',
	options: { providerId?: IntegrationIds; connectionId?: string; domain?: string } | undefined,
): void {
	if (options?.providerId == null && (options?.connectionId != null || options?.domain != null)) {
		throw new TypeError(`'${method}' requires 'providerId' when 'connectionId' or 'domain' is supplied`);
	}
}
