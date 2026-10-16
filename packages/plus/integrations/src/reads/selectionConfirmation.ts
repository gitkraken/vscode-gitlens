import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { assessCollectionMetadata } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderWarning, ProviderWarningSelector } from '../results.js';
import { runCaptured } from './drains.js';
import { selectorMatches } from './hierarchy.utils.js';

/**
 * What the provider lists now for a selection the cached discovery matched nothing for:
 * - `missing`: the lists, complete, match nothing. `missed` is the selector they miss, the org when it is gone
 *   whichever the cache missed, and `resource` a resource they name, for {@link confirmCredential};
 * - `stale`: they match it, so the cache predates it;
 * - `unknown`: they could not be listed completely, and `warnings` say why, as the failed read classified it (an
 *   `auth` or `rate-limit` refusal stays one).
 */
export type SelectionConfirmation =
	| { verdict: 'missing'; missed: ProviderWarningSelector['kind']; resource: ResourceDescriptor | undefined }
	| { verdict: 'stale' }
	| { verdict: 'unknown'; warnings: ProviderWarning[] };

/**
 * What a read does with a {@link SelectionConfirmation}: report the selection missing, read once more over fresh
 * lists, or report that the selection could not be confirmed, with a retry cursor.
 */
export type SelectionAction =
	| { action: 'report-missing'; missed: ProviderWarningSelector['kind']; resource: ResourceDescriptor | undefined }
	| { action: 'unconfirmed'; warnings: ProviderWarning[] }
	| { action: 'refresh' };

/** The action for `confirmation`. A read already made over refreshed lists (`refreshed`) is not made again. */
export function toSelectionAction(confirmation: SelectionConfirmation, refreshed: boolean): SelectionAction {
	switch (confirmation.verdict) {
		case 'missing':
			return { action: 'report-missing', missed: confirmation.missed, resource: confirmation.resource };
		case 'unknown':
			return { action: 'unconfirmed', warnings: confirmation.warnings };
		case 'stale':
			return refreshed ? { action: 'unconfirmed', warnings: [] } : { action: 'refresh' };
	}
}

/** Where a read's selection lives: the tracker, its connection, and what the caller selected. */
export interface SelectionTarget {
	integration: IssuesIntegration;
	providerId: IntegrationIds;
	domain: string | undefined;
	connectionId: string | undefined;
	org: string | undefined;
	project: string | undefined;
}

/**
 * Lists the selection as the provider holds it now, through discovery that shares nothing with the cache: it joins no
 * read in flight, so a read started before what the caller needs to see can't answer it, and stores nothing. A
 * selection is reported missing only from this, never from the cached lists, which can predate what was created or
 * deleted since, and which a read made right after dropping them can still be served from a read started before.
 */
export async function confirmSelection(
	target: SelectionTarget,
	missed: ProviderWarningSelector['kind'],
): Promise<SelectionConfirmation> {
	const { integration, providerId, domain, connectionId, org, project } = target;
	const { value: discovery, warning } = await runCaptured(providerId, domain, connectionId, () =>
		integration.getUncachedDiscoveryResult(r => org == null || selectorMatches(providerId, r, org), connectionId),
	);
	const resources = discovery?.resources;
	if (resources == null) return { verdict: 'unknown', warnings: warning != null ? [warning] : [] };

	const selected = org != null ? resources.filter(r => selectorMatches(providerId, r, org)) : resources;
	// The account is confirmed on a resource the lists name now, which a revoked one in the cache may not be.
	const resource = selected[0] ?? resources[0];
	if (selected.length === 0) return { verdict: 'missing', missed: 'org', resource: resource };
	// The org the cache missed is listed now: what it holds is for a read over fresh lists to find.
	if (missed === 'org' || project == null) return { verdict: 'stale' };

	const projects = discovery?.projects;
	if (projects == null) return { verdict: 'unknown', warnings: [] };

	const assessed = assessCollectionMetadata(providerId, domain, connectionId, projects.metadata);
	if (assessed.fetchFailed || assessed.truncated) return { verdict: 'unknown', warnings: assessed.warnings };

	return projects.values.some(p => selectorMatches(providerId, p, project))
		? { verdict: 'stale' }
		: { verdict: 'missing', missed: 'project', resource: resource };
}

/**
 * Whether the tracker accepted the connection's credential, which alone proves a selection gone: Jira Data Center
 * serves a rejected one as the anonymous user, whose project list is empty, and nothing tells them apart once a proxy
 * strips `X-AUSERNAME`; its account lookup fails. Looked up past any lookup in flight, which may predate a revocation.
 * An account whose lists name no resource has none to look up on, and is judged on its lists alone.
 */
export async function confirmCredential(
	target: Pick<SelectionTarget, 'integration' | 'providerId' | 'domain' | 'connectionId'>,
	resource: ResourceDescriptor | undefined,
): Promise<{ confirmed: true } | { confirmed: false; warning: ProviderWarning | undefined }> {
	if (resource == null) return { confirmed: true };

	const { integration, providerId, domain, connectionId } = target;
	const { value: account, warning } = await runCaptured(providerId, domain, connectionId, () =>
		integration.getUncachedAccountForResourceResult(resource, connectionId),
	);
	return (account?.username ?? account?.name) != null ? { confirmed: true } : { confirmed: false, warning: warning };
}
