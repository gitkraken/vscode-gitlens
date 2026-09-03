import * as assert from 'node:assert/strict';
import { GitPullRequestMergeableState, GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId, providerFanOutConcurrency } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { AzureProjectDescriptor, AzureRemoteRepositoryDescriptor } from '../providers/azure/models.js';
import type { ProviderPullRequest, ProviderRepoInput } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

function session(domain: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'token',
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

function providerPullRequest(
	id: string,
	title: string,
	repository: { id: string; name: string; owner: string },
): ProviderPullRequest {
	const pr: ProviderPullRequest = {
		id: id,
		graphQLId: id,
		number: Number(id),
		title: title,
		description: null,
		url: `https://example.com/${repository.id}/pull/${id}`,
		state: GitPullRequestState.Open,
		isCrossRepository: false,
		isDraft: false,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		mergedDate: null,
		commentCount: null,
		upvoteCount: null,
		commitCount: null,
		fileCount: null,
		additions: null,
		deletions: null,
		author: {
			id: 'author',
			name: 'Author',
			username: 'author',
			email: null,
			avatarUrl: null,
			url: null,
		},
		assignees: null,
		baseRef: null,
		headRef: null,
		reviews: null,
		reviewDecision: null,
		headCommit: null,
		mergeableState: GitPullRequestMergeableState.Unknown,
		permissions: null,
		repository: {
			id: repository.id,
			name: repository.name,
			owner: { login: repository.owner },
			remoteInfo: null,
		},
		headRepository: null,
	};
	return pr;
}

suite('provider pull request search', () => {
	test('Azure resolves remote descriptors, scopes by repo id, and scans later pages', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		try {
			const integration = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
			assert.ok(integration != null);

			const projects: AzureProjectDescriptor[] = [
				{ id: 'project-a', key: 'project-a', name: 'Project A', resourceId: 'org-id', resourceName: 'org' },
				{ id: 'project-b', key: 'project-b', name: 'Project B', resourceId: 'org-id', resourceName: 'org' },
			];
			const repoA: AzureRemoteRepositoryDescriptor = {
				id: 'repo-a',
				key: 'repo-a',
				name: 'api',
				projectName: 'Project A',
				resourceName: 'org',
				cloneUrlHttps: 'https://example.com/project-a/api',
				cloneUrlSsh: 'ssh://example.com/project-a/api',
			};
			const repoB: AzureRemoteRepositoryDescriptor = {
				id: 'repo-b',
				key: 'repo-b',
				name: 'api',
				projectName: 'Project B',
				resourceName: 'org',
				cloneUrlHttps: 'https://example.com/project-b/api',
				cloneUrlSsh: 'ssh://example.com/project-b/api',
			};
			const calls: { page?: number; project: string; repo?: ProviderRepoInput }[] = [];
			const internal = integration as unknown as {
				getProviderResourcesForUser: () => Promise<{ id: string; key: string; name: string }[]>;
				getProviderProjectsForResources: () => Promise<{ values: AzureProjectDescriptor[] }>;
				getRepoDescriptorsForProjects: () => Promise<Map<string, AzureRemoteRepositoryDescriptor[]>>;
				getProvidersApi: () => Promise<{
					getPullRequestsForAzureProject: (
						token: unknown,
						project: { namespace: string; project: string },
						options: { page?: number; repo?: ProviderRepoInput },
					) => Promise<{ data: ProviderPullRequest[]; hasMore: boolean; nextPage: number | null }>;
				}>;
				searchProviderPullRequests: (
					session: ProviderAuthenticationSession,
					search: string,
					repos: { key: string; owner: string; name: string }[],
				) => Promise<PullRequest[] | undefined>;
			};
			internal.getProviderResourcesForUser = () =>
				Promise.resolve([{ id: 'org-id', key: 'org-id', name: 'org' }]);
			internal.getProviderProjectsForResources = () => Promise.resolve({ values: projects });
			internal.getRepoDescriptorsForProjects = () =>
				Promise.resolve(
					new Map([
						['project-a', [repoA]],
						['project-b', [repoB]],
					]),
				);
			internal.getProvidersApi = () =>
				Promise.resolve({
					getPullRequestsForAzureProject: (_token, project, options) => {
						calls.push({ page: options.page, project: project.project, repo: options.repo });
						return options.page == null
							? Promise.resolve({
									data: [
										providerPullRequest('1', 'unrelated', {
											id: 'repo-b',
											name: 'api',
											owner: 'org',
										}),
									],
									hasMore: true,
									nextPage: 2,
								})
							: Promise.resolve({
									data: [
										providerPullRequest('2', 'needle', { id: 'repo-b', name: 'api', owner: 'org' }),
									],
									hasMore: false,
									nextPage: null,
								});
					},
				});

			const result = await internal.searchProviderPullRequests(session('dev.azure.com'), 'needle', [
				{ key: 'remote', owner: 'org', name: 'Project B/_git/api' },
			]);

			assert.equal(calls.length, 2, 'the second provider page is read');
			assert.deepEqual(
				calls.map(call => [call.project, call.repo?.id]),
				[
					['Project B', 'repo-b'],
					['Project B', 'repo-b'],
				],
				'the composite descriptor selects only the requested same-named repository',
			);
			assert.equal(result?.length, 1);
			assert.equal(result?.[0].project?.name, 'Project B');
			assert.equal(result?.[0].refs?.base?.cloneHttps, 'https://example.com/project-b/api');
		} finally {
			manager.dispose();
		}
	});

	test('Azure bounds concurrent pull request reads across repositories', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const releases: (() => void)[] = [];
		try {
			const integration = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
			assert.ok(integration != null);

			const repoCount = providerFanOutConcurrency + 1;
			const projects: AzureProjectDescriptor[] = Array.from({ length: repoCount }, (_, i) => ({
				id: `project-${i}`,
				key: `project-${i}`,
				name: `Project ${i}`,
				resourceId: 'org-id',
				resourceName: 'org',
			}));
			const repos: AzureRemoteRepositoryDescriptor[] = projects.map((project, i) => ({
				id: `repo-${i}`,
				key: `repo-${i}`,
				name: `repo-${i}`,
				projectName: project.name,
				resourceName: project.resourceName,
				cloneUrlHttps: `https://example.com/project-${i}/repo-${i}`,
				cloneUrlSsh: `ssh://example.com/project-${i}/repo-${i}`,
			}));
			const calls: { project: string; repo?: ProviderRepoInput }[] = [];
			let inFlight = 0;
			let peakInFlight = 0;
			const internal = integration as unknown as {
				getProviderResourcesForUser: () => Promise<{ id: string; key: string; name: string }[]>;
				getProviderProjectsForResources: () => Promise<{ values: AzureProjectDescriptor[] }>;
				getRepoDescriptorsForProjects: () => Promise<Map<string, AzureRemoteRepositoryDescriptor[]>>;
				getProvidersApi: () => Promise<{
					getPullRequestsForAzureProject: (
						token: unknown,
						project: { namespace: string; project: string },
						options: { repo?: ProviderRepoInput },
					) => Promise<{ data: ProviderPullRequest[]; hasMore: boolean; nextPage: number | null }>;
				}>;
				searchProviderPullRequests: (
					session: ProviderAuthenticationSession,
					search: string,
					repos: { key: string; owner: string; name: string }[],
				) => Promise<PullRequest[] | undefined>;
			};
			internal.getProviderResourcesForUser = () =>
				Promise.resolve([{ id: 'org-id', key: 'org-id', name: 'org' }]);
			internal.getProviderProjectsForResources = () => Promise.resolve({ values: projects });
			internal.getRepoDescriptorsForProjects = () =>
				Promise.resolve(new Map(repos.map((repo, i) => [`project-${i}`, [repo]])));
			internal.getProvidersApi = () =>
				Promise.resolve({
					getPullRequestsForAzureProject: (_token, project, options) => {
						calls.push({ project: project.project, repo: options.repo });
						inFlight++;
						peakInFlight = Math.max(peakInFlight, inFlight);

						return new Promise(resolve => {
							releases.push(() => {
								inFlight--;
								resolve({ data: [], hasMore: false, nextPage: null });
							});
						});
					},
				});

			const pending = internal.searchProviderPullRequests(
				session('dev.azure.com'),
				'',
				repos.map(repo => ({
					key: repo.key,
					owner: repo.resourceName,
					name: `${repo.projectName}/_git/${repo.name}`,
				})),
			);
			await new Promise<void>(resolve => setTimeout(resolve, 0));

			assert.equal(calls.length, providerFanOutConcurrency);
			assert.equal(peakInFlight, providerFanOutConcurrency);

			const release = releases.shift();
			assert.ok(release != null);
			release();
			await new Promise<void>(resolve => setTimeout(resolve, 0));

			assert.equal(calls.length, repoCount);
			assert.equal(inFlight, providerFanOutConcurrency);
			assert.equal(peakInFlight, providerFanOutConcurrency);
			assert.deepEqual(
				calls.map(call => [call.project, call.repo?.id]),
				projects.map((project, i) => [project.name, `repo-${i}`]),
			);

			for (const release of releases.splice(0)) {
				release();
			}
			assert.deepEqual(await pending, []);
		} finally {
			for (const release of releases.splice(0)) {
				release();
			}
			manager.dispose();
		}
	});

	test('Bitbucket Cloud drains matching pull request pages per repository', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		try {
			const integration = await manager.get(GitCloudHostIntegrationId.Bitbucket);
			assert.ok(integration != null);

			const cursors: (string | undefined)[] = [];
			const internal = integration as unknown as {
				getProvidersApi: () => Promise<{
					getPullRequestsForRepo: (
						token: unknown,
						repo: ProviderRepoInput,
						options: { cursor?: string },
					) => Promise<PagedResult<ProviderPullRequest>>;
				}>;
				searchProviderPullRequests: (
					session: ProviderAuthenticationSession,
					search: string,
					repos: { key: string; owner: string; name: string }[],
				) => Promise<PullRequest[] | undefined>;
			};
			internal.getProvidersApi = () =>
				Promise.resolve({
					getPullRequestsForRepo: (_token, _repo, options) => {
						cursors.push(options.cursor);
						return Promise.resolve(
							options.cursor == null
								? {
										values: [
											providerPullRequest('1', 'needle one', {
												id: 'repo',
												name: 'repo',
												owner: 'team',
											}),
										],
										paging: { more: true, cursor: 'next' },
									}
								: {
										values: [
											providerPullRequest('2', 'needle two', {
												id: 'repo',
												name: 'repo',
												owner: 'team',
											}),
										],
										paging: { more: false, cursor: '{}' },
									},
						);
					},
				});

			const result = await internal.searchProviderPullRequests(session('bitbucket.org'), 'needle', [
				{ key: 'repo', owner: 'team', name: 'repo' },
			]);

			assert.deepEqual(cursors, [undefined, 'next']);
			assert.deepEqual(
				result?.map(pr => pr.id),
				['1', '2'],
			);
		} finally {
			manager.dispose();
		}
	});

	test('Bitbucket Server isolates hosts and filters after draining later pages', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		try {
			const serverA = await manager.get(GitSelfManagedHostIntegrationId.BitbucketServer, 'server-a.example.com');
			const serverB = await manager.get(GitSelfManagedHostIntegrationId.BitbucketServer, 'server-b.example.com');
			assert.ok(serverA != null);
			assert.ok(serverB != null);

			runtime.repositories.getOpenRemotes = () =>
				Promise.resolve([
					{
						provider: { owner: 'team', repoName: 'repo' },
					} as unknown as GitRemote,
				]);
			const internal = serverA as unknown as {
				authenticationService: { getByRemote: (remote: GitRemote) => Promise<unknown> };
				getWorkspaceRepoInputs: () => Promise<ProviderRepoInput[]>;
				getProvidersApi: () => Promise<{
					getPullRequestsForRepo: (
						token: unknown,
						repo: ProviderRepoInput,
						options: { cursor?: string },
					) => Promise<PagedResult<ProviderPullRequest>>;
				}>;
				searchProviderPullRequests: (
					session: ProviderAuthenticationSession,
					search: string,
					repos: { key: string; owner: string; name: string }[],
				) => Promise<PullRequest[] | undefined>;
			};
			internal.authenticationService.getByRemote = () => Promise.resolve(serverB);
			assert.deepEqual(await internal.getWorkspaceRepoInputs(), [], 'a remote from another host is excluded');

			const cursors: (string | undefined)[] = [];
			internal.getProvidersApi = () =>
				Promise.resolve({
					getPullRequestsForRepo: (_token, _repo, options) => {
						cursors.push(options.cursor);
						return Promise.resolve(
							options.cursor == null
								? {
										values: [
											providerPullRequest('1', 'unrelated', {
												id: 'repo',
												name: 'repo',
												owner: 'TEAM',
											}),
										],
										paging: { more: true, cursor: 'next' },
									}
								: {
										values: [
											providerPullRequest('2', 'needle', {
												id: 'repo',
												name: 'repo',
												owner: 'TEAM',
											}),
										],
										paging: { more: false, cursor: '{}' },
									},
						);
					},
				});

			const result = await internal.searchProviderPullRequests(session('server-a.example.com'), 'needle', [
				{ key: 'repo', owner: 'TEAM', name: 'repo' },
			]);

			assert.deepEqual(cursors, [undefined, 'next']);
			assert.deepEqual(
				result?.map(pr => pr.id),
				['2'],
			);
		} finally {
			manager.dispose();
		}
	});
});
