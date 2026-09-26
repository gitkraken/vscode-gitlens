import assert from 'node:assert/strict';
import { GitPullRequestMergeableState, GitPullRequestState } from '@gitkraken/provider-apis';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderPullRequest } from '../providers/models.js';
import type { createFakeRuntime } from './fakeRuntime.js';

/**
 * Fixtures for the suites covering the pull request sweeps, the broaden fan-out, the per-provider account-wide
 * reads, the sweep target observer and the batch reads — a connected manager per host, a session, a provider pull
 * request, and the SDK-surface swap they all read through. Not named `*.test.ts` so the runner's glob leaves it
 * alone.
 */

export function primarySession(token: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: 'github.com',
	};
}

/**
 * Swap a provider's SDK surface for a literal. The cast is the point: `getProvidersApi` is private, and going
 * through it keeps the integration's own read path — paging mode, filter validation, mapping — under test.
 */
export function stubApi(gh: GitHostIntegration, api: Record<string, unknown>): void {
	(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () => Promise.resolve(api);
}

export function providerPr(id: string, overrides?: Partial<ProviderPullRequest>): ProviderPullRequest {
	return {
		id: id,
		number: Number.parseInt(id.split('-').at(-1) ?? id, 10) || 1,
		title: `PR ${id}`,
		description: null,
		url: `https://example.com/pull/${id}`,
		state: GitPullRequestState.Open,
		isCrossRepository: false,
		isDraft: false,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		mergedDate: null,
		baseRef: null,
		headRef: null,
		commentCount: null,
		upvoteCount: null,
		commitCount: null,
		fileCount: null,
		additions: null,
		deletions: null,
		author: null,
		assignees: null,
		reviews: null,
		reviewDecision: null,
		repository: { id: `repo-${id}`, name: 'hello', owner: { login: 'octocat' }, remoteInfo: null },
		headRepository: null,
		headCommit: null,
		mergeableState: GitPullRequestMergeableState.Unknown,
		permissions: null,
		...overrides,
	};
}

export async function connectedGitHub(
	runtime: ReturnType<typeof createFakeRuntime>,
): Promise<{ manager: ReturnType<typeof createIntegrationManager>; gh: GitHostIntegration }> {
	const manager = createIntegrationManager(runtime);
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
	return { manager: manager, gh: gh };
}

/**
 * A connected GitLab manager, for the broaden tests that must exercise the REPOSITORY DRAIN engine.
 *
 * GitLab is the fixture for that path because it declares no filtered issue search
 * (`supportedIssueSearch`), which is exactly what makes `broadenIssues` fall back to draining the org's
 * repositories — the same condition in production, rather than a stub arranged to look like it.
 */
export async function connectedGitLab(
	runtime: ReturnType<typeof createFakeRuntime>,
): Promise<{ manager: ReturnType<typeof createIntegrationManager>; gl: GitHostIntegration }> {
	const manager = createIntegrationManager(runtime);
	const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
	(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'gitlab.com',
	};
	return { manager: manager, gl: gl };
}

export async function connectedAzure(
	runtime: ReturnType<typeof createFakeRuntime>,
): Promise<{ manager: ReturnType<typeof createIntegrationManager>; azure: GitHostIntegration }> {
	const manager = createIntegrationManager(runtime);
	const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
	(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'dev.azure.com',
	};
	return { manager: manager, azure: azure };
}

export async function connectedBitbucket(
	runtime: ReturnType<typeof createFakeRuntime>,
): Promise<{ manager: ReturnType<typeof createIntegrationManager>; integration: GitHostIntegration }> {
	const manager = createIntegrationManager(runtime);
	const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
	(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'bitbucket.org',
	};
	return { manager: manager, integration: bb };
}

export async function connectedBitbucketServer(
	runtime: ReturnType<typeof createFakeRuntime>,
): Promise<{ manager: ReturnType<typeof createIntegrationManager>; integration: GitHostIntegration }> {
	await runtime.storage.store('integrations:configured', {
		[GitSelfManagedHostIntegrationId.BitbucketServer]: [
			{
				id: 'bbs-1',
				cloud: true,
				integrationId: GitSelfManagedHostIntegrationId.BitbucketServer,
				domain: 'https://bbs.example.com',
				scopes: 'repo',
				primary: true,
			},
		],
	});
	const manager = createIntegrationManager(runtime);
	const bbs = await manager.get(GitSelfManagedHostIntegrationId.BitbucketServer, 'bbs.example.com');
	assert.ok(bbs != null);
	(bbs as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'bbs.example.com',
	};
	return { manager: manager, integration: bbs };
}
