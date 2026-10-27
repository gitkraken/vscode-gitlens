import type { RefSet } from '@gitlens/git/models/autolink.js';
import { isIncompleteCollection } from '../collectionMetadata.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import type { GetAutolinkReferencesOptions } from '../manager.js';
import { isIssuesIntegration } from '../models/issuesIntegration.js';
import { createIssueAutolinkReferences } from '../providers/utils/issueAutolinks.js';
import type { ProviderReadContext } from './context.js';

export async function getAutolinkReferences(
	ctx: ProviderReadContext,
	options: GetAutolinkReferencesOptions,
): Promise<RefSet | undefined> {
	if (
		options.providerId !== IssuesCloudHostIntegrationId.Jira &&
		options.providerId !== IssuesSelfManagedHostIntegrationId.JiraServer
	) {
		return undefined;
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null || !isIssuesIntegration(integration)) return undefined;

	try {
		await ctx.forceRefreshIfRequested(integration, options.forceSync, options.connectionId, {
			throwOnFailure: true,
		});
	} catch {
		return undefined;
	} finally {
		if (options.forceSync) {
			// Completion retires reads started during the refresh, including when it failed.
			integration.invalidateDiscoveryForConnection(options.connectionId);
		}
	}

	const result = await integration.getUncachedDiscoveryResult(() => true, options.connectionId);
	const discovery = result?.value;
	if (
		result?.error != null ||
		discovery?.resources == null ||
		discovery.projects == null ||
		discovery.generation !==
			integration.getSessionDiscoveryGeneration(
				discovery.sessionId,
				options.connectionId,
				discovery.sessionCloud,
			) ||
		isIncompleteCollection(discovery.projects.metadata)
	) {
		return undefined;
	}

	const refs: RefSet[1] = [];
	for (const project of discovery.projects.values) {
		if (options.providerId === IssuesSelfManagedHostIntegrationId.JiraServer && project.key === project.id) {
			continue;
		}

		const resource = discovery.resources.find(r => r.id === project.resourceId);
		if (resource == null || typeof resource.name !== 'string' || typeof resource.url !== 'string') return undefined;

		refs.push(
			...createIssueAutolinkReferences(project.key, `${resource.url}/browse/${project.key}-<num>`, {
				...resource,
				name: resource.name,
			}),
		);
	}

	return [{ id: integration.id, name: integration.name, domain: integration.domain, icon: integration.icon }, refs];
}
