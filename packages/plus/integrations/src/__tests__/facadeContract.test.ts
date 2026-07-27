import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type {
	ProviderIssue,
	ProviderPullRequest,
	ProviderReposInput,
	ProviderRepository,
} from '../providers/models.js';
import { PagingMode, providersMetadata, PullRequestFilter } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Contract regressions on the ProviderBackend facade: a `hasMore` a caller can actually act on, capability
 * guards before session-less reads, and a bounded fan-out width.
 */

function primarySession(token: string, domain = 'github.com'): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

function stubApi(integration: GitHostIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

async function connectedGitHub(runtime: ReturnType<typeof createFakeRuntime>) {
	const manager = createIntegrationManager(runtime);
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
	return { manager: manager, gh: gh };
}

const providerPr: ProviderPullRequest = {
	id: 'pr-1',
	repository: { owner: { login: 'octocat' }, name: 'hello' },
} as unknown as ProviderPullRequest;

suite('facade contract regressions', () => {
	test('listPullRequestsPage never reports hasMore without a usable cursor', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// GitHub's account-wide read is cursor-only. The paging layer seeds its next-cursor with the `'{}'`
		// sentinel and leaves it there when the provider reports another page with no `endCursor`, so `hasMore`
		// would otherwise be advertised with nothing to continue from.
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () =>
			Promise.resolve({ value: { values: [providerPr], paging: { more: true, cursor: '{}' } } });

		const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.GitHub });

		assert.equal(result.hasMore, false, 'no continuation → hasMore must be false');
		assert.equal(result.cursor, undefined);
		assert.equal(result.page.truncated, true, 'the incompleteness is reported as terminal truncation instead');

		manager.dispose();
	});

	test('listIssuesPage never reports hasMore without a usable cursor', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				searchMyIssuesWithTruncationResult: () => Promise<
					IntegrationResult<{ values: ProviderIssue[]; truncated: boolean; hasMore: boolean; cursor: string }>
				>;
			}
		).searchMyIssuesWithTruncationResult = () =>
			Promise.resolve({
				value: { values: [], truncated: false, hasMore: true, cursor: '{}' },
			});

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub });

		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);
		assert.equal(result.page.truncated, true);

		manager.dispose();
	});

	test('listProjects reports no projects (not a broken connection) for a provider with no project tier', async () => {
		const runtime = createFakeRuntime();
		const { manager } = await connectedGitHub(runtime);

		// GitHub has no project tier, so its `getProjectsForOrgResult` core resolves `undefined` — which is
		// indistinguishable from an unresolvable session unless the capability is checked first.
		const result = await manager.listProjects({ providerId: GitCloudHostIntegrationId.GitHub });

		assert.deepEqual(result.items, []);
		assert.deepEqual(result.warnings, [], 'a healthy provider must not surface a no-connection warning');
		assert.equal(result.fetchFailed, undefined, 'nor drive a reconnect prompt via fetchFailed');

		manager.dispose();
	});

	test('listPullRequestsPage rejects unsupported filters on the account-wide path, matching the sweep', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let read = false;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () => {
			read = true;
			return Promise.resolve({ value: { values: [providerPr] } });
		};

		// GitHub supports Author/Assignee/ReviewRequested/Mention, so use a provider-unsupported combination:
		// Bitbucket has no Assignee filter.
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t', 'bitbucket.org');
		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			filters: [PullRequestFilter.Assignee],
		});

		assert.equal(read, false, 'the unsupported set must not fall through to a differently-scoped read');
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0].message, /not supported/);

		manager.dispose();
	});

	test('broadenIssues caps the per-org fan-out width', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let inFlight = 0;
		let peakInFlight = 0;
		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = async (org: string) => {
			inFlight++;
			peakInFlight = Math.max(peakInFlight, inFlight);
			await new Promise<void>(resolve => setTimeout(resolve, 1));
			inFlight--;
			return { value: { values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository] } };
		};
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = () => Promise.resolve({ value: { values: [] } });

		const result = await manager.broadenIssues({
			orgs: Array.from({ length: 20 }, (_, i) => ({
				providerId: GitCloudHostIntegrationId.GitHub,
				name: `org-${i}`,
			})),
		});

		assert.equal(result.fanOutCount, 20, 'every org is still read');
		assert.ok(peakInFlight <= 6, `fan-out width capped (peak was ${peakInFlight})`);

		manager.dispose();
	});

	test('an unpinned self-managed resolveRepository does not resolve against a host derived from the remote', async () => {
		const runtime = createFakeRuntime();
		// Only ghe-a is configured; the remote points at ghe-b.
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'https://ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		const manager = createIntegrationManager(runtime);

		const result = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			remoteUrl: 'https://ghe-b.example.com/org/repo.git',
		});

		assert.equal(
			result.resolution.status,
			'host-mismatch',
			'repository data must not select the host to resolve against',
		);

		manager.dispose();
	});

	test('an unresolvable resolveRepository target carries a warning for auth recovery', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.resolveRepository({
			providerId: GitCloudHostIntegrationId.GitHub,
			remoteUrl: 'https://github.com/octocat/hello.git',
		});

		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.kind, 'no-connection');

		manager.dispose();
	});

	test('an Azure remote with no project is invalid, not unauthorized', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = primarySession(
			't',
			'dev.azure.com',
		);
		stubApi(azure, {});

		// Azure's repo lookup is project-scoped; a remote carrying no project can't address a repo at all, so
		// reporting it as `unauthorized` would drive a pointless reconnect.
		const result = await manager.resolveRepository({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			remoteUrl: 'https://dev.azure.com/org/_git/repo',
		});

		assert.notEqual(result.resolution.status, 'unauthorized');

		manager.dispose();
	});

	test('PagingMode.Repos issue reads synthesize no page cursor (they ignore page numbers)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: () => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = () =>
			Promise.resolve({ value: { values: [], paging: { more: true, cursor: '{}' } } });

		assert.equal(
			providersMetadata[GitCloudHostIntegrationId.GitHub]?.issuesPagingMode,
			PagingMode.Repos,
			'guard: GitHub is a cursor-only host for this read',
		);

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.equal(result.hasMore, false, 'a page-number cursor would be ignored, so none is synthesized');
		assert.equal(result.cursor, undefined);

		manager.dispose();
	});
});
