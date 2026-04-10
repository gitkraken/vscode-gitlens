import type { Uri } from 'vscode';
import { env } from 'vscode';
import type { URI } from 'vscode-uri';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { ParsedRemoteFileUri, RemoteProvider, RemoteProviderId } from '@gitlens/git/models/remoteProvider.js';
import type { CreatePullRequestRemoteResource, RemoteResource } from '@gitlens/git/models/remoteResource.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { ensureArray } from '@gitlens/utils/array.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { GitCloudHostIntegrationId } from '../../../constants.integrations.js';
import { Container } from '../../../container.js';
import type { GitHostIntegration } from '../../../plus/integrations/models/gitHostIntegration.js';
import {
	convertRemoteProviderIdToIntegrationId,
	getIntegrationConnectedKey,
	getIntegrationIdForRemote,
	isGitHostIntegration,
} from '../../../plus/integrations/utils/-webview/integration.utils.js';
import { openUrl } from '../../../system/-webview/vscode/uris.js';
import type { GlRepository } from '../../models/repository.js';
import { describePullRequestWithAI } from './pullRequest.utils.js';

export interface LocalInfoFromRemoteUriResult {
	uri: Uri;

	repoPath: string;
	rev: string | undefined;

	startLine?: number;
	endLine?: number;
}

/** Returns the integration for this remote, if any. Replaces `GitRemote.getIntegration()`. */
export async function getRemoteIntegration(remote: GitRemote): Promise<GitHostIntegration | undefined> {
	const integrationId = getIntegrationIdForRemote(remote.provider);
	return integrationId && Container.instance.integrations.get(integrationId, remote.provider?.domain);
}

/** Whether this remote has a supported integration provider. Replaces `GitRemote.supportsIntegration()`. */
export function remoteSupportsIntegration(remote: GitRemote): remote is GitRemote<RemoteProvider> {
	return Boolean(getIntegrationIdForRemote(remote.provider));
}

/** Whether the integration for this remote may be connected. Replaces `GitRemote.maybeIntegrationConnected`. */
export function isRemoteMaybeIntegrationConnected(remote: GitRemote): boolean | undefined {
	if (!remote.provider?.id) return false;

	const integrationId = getIntegrationIdForRemote(remote.provider);
	if (integrationId == null) return false;

	// Special case for GitHub, since we support the legacy GitHub integration
	if (integrationId === GitCloudHostIntegrationId.GitHub) {
		const configured = Container.instance.integrations.getConfiguredLite(integrationId, { cloud: true });
		if (configured.length) {
			return Container.instance.storage.getWorkspace(getIntegrationConnectedKey(integrationId)) !== false;
		}

		return undefined;
	}

	const configured = Container.instance.integrations.getConfiguredLite(
		integrationId,
		remote.provider.custom ? { domain: remote.provider.domain } : undefined,
	);

	if (configured.length) {
		return (
			Container.instance.storage.getWorkspace(
				getIntegrationConnectedKey(integrationId, remote.provider.domain),
			) !== false
		);
	}
	return false;
}

/** Sets this remote as the default for the repository. Replaces `GitRemote.setAsDefault()`. */
export async function setRemoteAsDefault(remote: GitRemote, value: boolean = true): Promise<void> {
	await Container.instance.git.getRepositoryService(remote.repoPath).remotes.setRemoteAsDefault(remote.name, value);
}

/**
 * Finds the best remote that has an active (or optionally disconnected) integration.
 * This is the single extension-level entry point for integration-aware remote selection.
 */
export async function getBestRemoteWithIntegration(
	repoPath: string,
	options?: {
		filter?: (remote: GitRemote<RemoteProvider>, integration: GitHostIntegration) => boolean;
		includeDisconnected?: boolean;
	},
	cancellation?: AbortSignal,
): Promise<GitRemote<RemoteProvider> | undefined> {
	const remotes = await Container.instance.git
		.getRepositoryService(repoPath)
		.remotes.getBestRemotesWithProviders(cancellation);

	const includeDisconnected = options?.includeDisconnected ?? false;
	for (const r of remotes) {
		if (remoteSupportsIntegration(r)) {
			const integration = await getRemoteIntegration(r);
			if (integration != null) {
				if (options?.filter?.(r, integration) === false) continue;

				if (includeDisconnected || integration.maybeConnected === true) return r;
				if (integration.maybeConnected === undefined && (r.default || remotes.length === 1)) {
					if (await integration.isConnected()) return r;
				}
			}
		}
	}

	return undefined;
}

export function getRemoteProviderUrl(
	provider: RemoteProvider,
	resource: RemoteResource,
): Promise<string | undefined> | string | undefined {
	return provider.url(resource);
}

export async function copyRemoteProviderUrl(
	provider: RemoteProvider,
	resource: RemoteResource | RemoteResource[],
): Promise<void> {
	const urls = await getUrlsFromResources(provider, resource);
	if (!urls.length) return;

	await env.clipboard.writeText(urls.join('\n'));
}

export async function openRemoteProviderUrl(
	provider: RemoteProvider,
	resource: RemoteResource | RemoteResource[],
): Promise<boolean | undefined> {
	const urls = await getUrlsFromResources(provider, resource);
	if (!urls.length) return false;

	const results = await Promise.allSettled(urls.map(openUrl));
	return results.every(r => getSettledValue(r) === true);
}

async function getUrlsFromResources(
	provider: RemoteProvider,
	resource: RemoteResource | RemoteResource[],
): Promise<string[]> {
	const urlPromises: Promise<string | undefined>[] = [];

	for (const r of ensureArray(resource)) {
		// Resolve AI-generated PR details centrally before URL construction
		if (r.type === RemoteResourceType.CreatePullRequest) {
			urlPromises.push(resolveCreatePullRequestDetails(r).then(resolved => provider.url(resolved)));
		} else {
			urlPromises.push(Promise.resolve(provider.url(r)));
		}
	}

	const urls: string[] = (await Promise.allSettled(urlPromises)).map(r => getSettledValue(r)).filter(r => r != null);
	return urls;
}

/**
 * Shared resolver that uses a provider's `parseRemoteFileUri()` to parse the URL,
 * then resolves candidates against the local repository.
 * Replaces 8 near-identical `getLocalInfoFromRemoteUri()` implementations in extension providers.
 */
export async function resolveLocalInfoFromRemoteUri(
	provider: { parseRemoteFileUri?(uri: URI): ParsedRemoteFileUri | undefined },
	repo: GlRepository,
	uri: Uri,
): Promise<LocalInfoFromRemoteUriResult | undefined> {
	const parsed = provider.parseRemoteFileUri?.(uri as unknown as URI);
	if (parsed == null) return undefined;

	let fallback: LocalInfoFromRemoteUriResult | undefined;

	for (const candidate of parsed.candidates) {
		switch (candidate.type) {
			case 'sha': {
				const resolved = await repo.git.getAbsoluteOrBestRevisionUri(candidate.filePath, candidate.rev);
				if (resolved != null) {
					return {
						uri: resolved,
						repoPath: repo.path,
						rev: candidate.rev,
						startLine: parsed.startLine,
						endLine: parsed.endLine,
					};
				}
				break;
			}
			case 'shortSha': {
				const resolved = await repo.git.getAbsoluteOrBestRevisionUri(candidate.filePath, candidate.rev);
				if (resolved != null) {
					fallback = {
						uri: resolved,
						repoPath: repo.path,
						rev: candidate.rev,
						startLine: parsed.startLine,
						endLine: parsed.endLine,
					};
				}
				break;
			}
			case 'branches': {
				const { values: branches } = await repo.git.branches.getBranches({
					filter: b => b.remote && candidate.possibleBranches.has(b.nameWithoutRemote),
				});
				for (const branch of branches) {
					const filePath = candidate.possibleBranches.get(branch.nameWithoutRemote);
					if (filePath == null) continue;

					const resolved = await repo.git.getAbsoluteOrBestRevisionUri(filePath, branch.nameWithoutRemote);
					if (resolved != null) {
						return {
							uri: resolved,
							repoPath: repo.path,
							rev: branch.nameWithoutRemote,
							startLine: parsed.startLine,
							endLine: parsed.endLine,
						};
					}
				}
				break;
			}
			case 'tags': {
				const { values: tags } = await repo.git.tags.getTags({
					filter: t => candidate.possibleTags.has(t.name),
				});
				for (const tag of tags) {
					const filePath = candidate.possibleTags.get(tag.name);
					if (filePath == null) continue;

					const resolved = await repo.git.getAbsoluteOrBestRevisionUri(filePath, tag.name);
					if (resolved != null) {
						return {
							uri: resolved,
							repoPath: repo.path,
							rev: tag.name,
							startLine: parsed.startLine,
							endLine: parsed.endLine,
						};
					}
				}
				break;
			}
			case 'pathOnly': {
				const resolved = await repo.git.getAbsoluteOrBestRevisionUri(candidate.filePath, undefined);
				if (resolved != null) {
					return {
						uri: resolved,
						repoPath: repo.path,
						rev: undefined,
						startLine: parsed.startLine,
						endLine: parsed.endLine,
					};
				}
				break;
			}
		}
	}

	return fallback;
}

/**
 * Checks whether the integration for the given remote provider is connected,
 * which is required for constructing cross-fork pull request URLs.
 * Consolidates identical implementations from Azure DevOps, GitLab, and Bitbucket Server.
 */
export async function isRemoteProviderReadyForCrossForkPullRequestUrls(providerId: RemoteProviderId): Promise<boolean> {
	const integrationId = convertRemoteProviderIdToIntegrationId(providerId);
	const integration = integrationId && (await Container.instance.integrations.get(integrationId));
	return integration?.maybeConnected ?? integration?.isConnected() ?? false;
}

/**
 * Retrieves repository info from the host's integration system for a given provider and target descriptor.
 * Used by the remotes provider context to support cross-fork PR creation URLs.
 */
export async function getIntegrationRepositoryInfo(
	container: Container,
	providerId: RemoteProviderId,
	target: { owner: string; name: string; project?: string },
): Promise<{ id: string } | undefined> {
	const integrationId = convertRemoteProviderIdToIntegrationId(providerId);
	const integration = integrationId && (await container.integrations.get(integrationId));
	if (!integration?.isConnected || !isGitHostIntegration(integration)) return undefined;

	const repo = await integration.getRepoInfo?.(target);
	return repo != null ? { id: repo.id } : undefined;
}

/**
 * Resolves AI-generated pull request details (title/description) if requested.
 * Returns the resource unchanged if AI description is not requested.
 * Consolidates identical patterns from GitHub, GitLab, Bitbucket Server, and Gitea.
 */
export async function resolveCreatePullRequestDetails(
	resource: CreatePullRequestRemoteResource,
): Promise<CreatePullRequestRemoteResource> {
	if (!resource.details?.describeWithAI) return resource;

	const details = await describePullRequestWithAI(Container.instance, resource.repoPath, resource, { source: 'ai' });
	if (details == null) return resource;
	return { ...resource, details: details };
}

/**
 * Sorts remotes by priority using name heuristics and integration metadata.
 * Used as the host's `RemotesProvider.sort` implementation.
 */
export async function sortRemotes(
	container: Container,
	remotes: GitRemote<RemoteProvider>[],
	cancellation?: AbortSignal,
): Promise<GitRemote<RemoteProvider>[]> {
	const defaultRemote = remotes.find(r => r.default)?.name;
	const currentBranchRemote = (await container.git.getRepository(remotes[0].repoPath)?.git.branches.getBranch())
		?.remoteName;

	const weighted: [number, GitRemote<RemoteProvider>][] = [];
	let originalFound = false;

	for (const remote of remotes) {
		let weight;
		switch (remote.name) {
			case defaultRemote:
				weight = 1000;
				break;
			case currentBranchRemote:
				weight = 6;
				break;
			case 'upstream':
				weight = 5;
				break;
			case 'origin':
				weight = 4;
				break;
			default:
				weight = 0;
		}

		// Ask integrations for fork metadata to refine ranking
		if (weight > 0 && weight < 1000 && !originalFound && !cancellation?.aborted) {
			const integrationId = getIntegrationIdForRemote(remote.provider);
			if (integrationId != null) {
				const integration = await container.integrations.get(integrationId, remote.provider?.domain);
				if (integration != null) {
					const connected =
						integration.maybeConnected ??
						(integration.maybeConnected === undefined ? await integration.isConnected() : false);
					if (connected) {
						const metadata = await integration.getRepositoryMetadata(remote.provider.repoDesc);
						if (metadata?.isFork != null) {
							weight += metadata.isFork ? -3 : 3;
							originalFound = !metadata.isFork;
						}
					}
				}
			}
		}

		weighted.push([weight, remote]);
	}

	weighted.sort(([aw, ar], [bw, br]) => (bw === 0 && aw === 0 ? ar.name.localeCompare(br.name) : bw - aw));
	return weighted.map(wr => wr[1]);
}
