import * as assert from 'node:assert/strict';
import { GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderIssue, ProviderPullRequest, ProviderRepoInput } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * A repo-by-repo host used to open one request per repository at once. These pin the bound on the three fan-outs
 * (PR per repo, issue per repo, Azure issue per project): in-flight never exceeds it, input order is kept, and a
 * value that would starve the pool (0, NaN) falls back to the default instead of returning holes.
 */

const defaultBound = 6;

function session(domain: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 't',
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

function stubApi(gh: GitHostIntegration, api: Record<string, unknown>): void {
	(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () => Promise.resolve(api);
}

/** Counts overlap; each call settles on a later tick so concurrent callers actually overlap. */
function createGauge() {
	let inFlight = 0;
	const gauge = {
		peak: 0,
		calls: 0,
		track: async <T>(value: T): Promise<T> => {
			gauge.calls++;
			inFlight++;
			gauge.peak = Math.max(gauge.peak, inFlight);
			try {
				await new Promise<void>(resolve => setTimeout(resolve, 1));
				return value;
			} finally {
				inFlight--;
			}
		},
	};
	return gauge;
}

function providerPr(id: string): ProviderPullRequest {
	return {
		id: id,
		number: 1,
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
		changedFileCount: null,
		additions: null,
		deletions: null,
		author: { id: 'a', name: 'a', avatarUrl: null, url: null },
		assignees: null,
		reviews: null,
		reviewDecision: null,
		repository: { id: 'r', name: 'r', owner: { login: 'o' }, remote: { url: 'u' } },
		headRepository: null,
		isMergeable: null,
		mergeableState: null,
		viewerCanUpdate: null,
		viewerCanMerge: null,
		statusCheckRollup: null,
		versionUpdatedDate: null,
	} as unknown as ProviderPullRequest;
}

function providerIssue(id: string): ProviderIssue {
	return {
		id: id,
		number: 1,
		title: `Issue ${id}`,
		url: `https://example.com/issues/${id}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		state: 'opened',
		author: null,
		assignees: [],
		repository: { id: 'r', name: 'r', owner: { login: 'o' } },
		commentCount: 0,
		upvoteCount: 0,
		body: null,
	} as unknown as ProviderIssue;
}

function reposFor(count: number, project?: boolean): ProviderRepoInput[] {
	return Array.from({ length: count }, (_, i) => ({
		namespace: 'org',
		name: `repo${i}`,
		project: project ? `project${i}` : undefined,
	}));
}

type Reads = {
	getMyPullRequestsForReposResult: (
		repos: unknown[],
		options?: unknown,
	) => Promise<{ value?: { values: unknown[] } }>;
	getMyIssuesForReposResult: (repos: unknown[], options?: unknown) => Promise<{ value?: { values: unknown[] } }>;
};

async function connected(id: GitCloudHostIntegrationId, domain: string) {
	const manager = createIntegrationManager(createFakeRuntime());
	const host = await manager.get(id);
	(host as unknown as { _session: ProviderAuthenticationSession })._session = session(domain);
	return { manager: manager, host: host, reads: host as unknown as Reads };
}

suite('Scope concurrency bound', () => {
	async function prRead(repoCount: number, scopeConcurrency?: number) {
		const { manager, host, reads } = await connected(GitCloudHostIntegrationId.GitLab, 'gitlab.com');
		try {
			const gauge = createGauge();
			stubApi(host, {
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repo,
				getPullRequestsForRepo: (_t: unknown, repo: ProviderRepoInput) =>
					gauge.track({
						values: [providerPr(repo.name)],
						paging: { more: false, cursor: '{}' },
					}),
			});
			const result = await reads.getMyPullRequestsForReposResult(reposFor(repoCount), {
				scopeConcurrency: scopeConcurrency,
			});
			return { gauge: gauge, ids: (result.value?.values ?? []).map(v => (v as { id: string }).id) };
		} finally {
			manager.dispose();
		}
	}

	const expectedIds = (n: number) => Array.from({ length: n }, (_, i) => `repo${i}`);

	test('PR repo fan-out never exceeds the default bound and keeps every row in order', async () => {
		const { gauge, ids } = await prRead(20);
		assert.equal(gauge.calls, 20);
		assert.equal(gauge.peak, defaultBound);
		assert.deepEqual(ids, expectedIds(20));
	});

	test('PR repo fan-out honors a caller `scopeConcurrency`', async () => {
		const { gauge, ids } = await prRead(12, 2);
		assert.equal(gauge.peak, 2);
		assert.deepEqual(ids, expectedIds(12));
	});

	for (const invalid of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
		test(`PR repo fan-out falls back to the default for ${invalid}`, async () => {
			const { gauge, ids } = await prRead(14, invalid);
			assert.equal(gauge.peak, defaultBound);
			assert.deepEqual(ids, expectedIds(14));
		});
	}

	test('PR repo fan-out truncates a fractional bound', async () => {
		const { gauge } = await prRead(10, 3.9);
		assert.equal(gauge.peak, 3);
	});

	async function issueRead(scopeConcurrency: number | undefined, repoCount: number, mode: 'repo' | 'azure-project') {
		const azure = mode === 'azure-project';
		const { manager, host, reads } = await connected(
			azure ? GitCloudHostIntegrationId.AzureDevOps : GitCloudHostIntegrationId.GitLab,
			azure ? 'dev.azure.com' : 'gitlab.com',
		);
		try {
			const gauge = createGauge();
			const read = (name: string) =>
				gauge.track({ values: [providerIssue(name)], paging: { more: false, cursor: '{}' } });
			stubApi(host, {
				isRepoIdsInput: () => false,
				getProviderIssuesPagingMode: () => (azure ? PagingMode.Project : PagingMode.Repo),
				getIssuesForRepo: (_t: unknown, repo: ProviderRepoInput) => read(repo.name),
				getIssuesForAzureProject: (_t: unknown, _ns: string, project: string) => read(project),
			});
			const result = await reads.getMyIssuesForReposResult(reposFor(repoCount, azure), {
				scopeConcurrency: scopeConcurrency,
			});
			return { gauge: gauge, ids: (result.value?.values ?? []).map(v => (v as { id: string }).id) };
		} finally {
			manager.dispose();
		}
	}

	test('issue repo fan-out is bounded by default and by `scopeConcurrency`', async () => {
		const byDefault = await issueRead(undefined, 18, 'repo');
		assert.equal(byDefault.gauge.peak, defaultBound);
		assert.deepEqual(byDefault.ids, expectedIds(18));

		const two = await issueRead(2, 9, 'repo');
		assert.equal(two.gauge.peak, 2);
		assert.deepEqual(two.ids, expectedIds(9));
	});

	test('Azure DevOps issue project fan-out is bounded by default and by `scopeConcurrency`', async () => {
		const expectedProjects = (n: number) => Array.from({ length: n }, (_, i) => `project${i}`);

		const byDefault = await issueRead(undefined, 18, 'azure-project');
		assert.equal(byDefault.gauge.peak, defaultBound);
		assert.deepEqual(byDefault.ids, expectedProjects(18));

		const three = await issueRead(3, 9, 'azure-project');
		assert.equal(three.gauge.peak, 3);
		assert.deepEqual(three.ids, expectedProjects(9));
	});

	test('issue fan-outs fall back to the default for 0 and NaN', async () => {
		for (const invalid of [0, Number.NaN]) {
			const repo = await issueRead(invalid, 14, 'repo');
			assert.equal(repo.gauge.peak, defaultBound);
			assert.equal(repo.ids.length, 14);

			const project = await issueRead(invalid, 14, 'azure-project');
			assert.equal(project.gauge.peak, defaultBound);
			assert.equal(project.ids.length, 14);
		}
	});
});

suite('Azure DevOps includeRemoteInfo opt-out', () => {
	async function remoteInfoRequests(
		read: (manager: Awaited<ReturnType<typeof connected>>['manager']) => Promise<unknown>,
	): Promise<unknown[]> {
		const { manager, host } = await connected(GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com');
		try {
			const requested: unknown[] = [];
			stubApi(host, {
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repo,
				getPullRequestsForRepo: (
					_t: unknown,
					repo: ProviderRepoInput,
					options: { includeRemoteInfo?: boolean },
				) => {
					requested.push(options.includeRemoteInfo);
					return Promise.resolve({
						values: [providerPr(repo.name)],
						paging: { more: false, cursor: '{}' },
					});
				},
			});
			await read(manager);
			return requested;
		} finally {
			manager.dispose();
		}
	}

	const repos = reposFor(2, true);
	const providerId = GitCloudHostIntegrationId.AzureDevOps;

	test('listPullRequestsPage passes the opt-out to every per-repository read', async () => {
		assert.deepEqual(
			await remoteInfoRequests(m => m.listPullRequestsPage({ providerId: providerId, repos: repos })),
			[true, true],
		);
		assert.deepEqual(
			await remoteInfoRequests(m =>
				m.listPullRequestsPage({ providerId: providerId, repos: repos, includeRemoteInfo: false }),
			),
			[undefined, undefined],
		);
	});

	test('sweepPullRequests passes the opt-out to every per-repository read', async () => {
		assert.deepEqual(
			await remoteInfoRequests(m => m.sweepPullRequests({ providerIds: [providerId], repos: repos })),
			[true, true],
		);
		assert.deepEqual(
			await remoteInfoRequests(m =>
				m.sweepPullRequests({ providerIds: [providerId], repos: repos, includeRemoteInfo: false }),
			),
			[undefined, undefined],
		);
	});
});
