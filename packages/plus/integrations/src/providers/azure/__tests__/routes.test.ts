import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { AzureDevOpsApi } from '../azure.js';
import { azureProject, azureProvider, azureToken, createAzureForkSource, createAzurePullRequest } from './fixtures.js';

async function readRoutes(
	api: AzureDevOpsApi,
	baseUrl: string,
	owner: string,
	project: string,
	repository: string,
	value: string,
): Promise<void> {
	const repo = `${project}/_git/${repository}`;
	await api.getPullRequestForBranch(azureProvider, azureToken, owner, repo, value, { baseUrl: baseUrl });
	await api.getPullRequestForCommit(azureProvider, azureToken, owner, repo, value, baseUrl);
	await api.getIssueOrPullRequest(azureProvider, azureToken, owner, repo, value, {
		baseUrl: baseUrl,
		type: 'issue',
	});
	await api.getIssueOrPullRequest(azureProvider, azureToken, owner, repo, value, {
		baseUrl: baseUrl,
		type: 'pullrequest',
	});
	await api.getIssue(azureProvider, azureToken, { ...azureProject, resourceName: owner, name: project }, value, {
		baseUrl: baseUrl,
	});
	await api.getAccountForCommit(azureProvider, azureToken, owner, repo, value, baseUrl);
	await api.getWorkItemStateCategory(value, 'Active', azureProvider, azureToken, owner, project, {
		baseUrl: baseUrl,
	});
	await api.getRepositoryMetadata(azureProvider, azureToken, owner, repo, { baseUrl: baseUrl });
	await api.getDefaultBranch(azureProvider, azureToken, owner, repo, { baseUrl: baseUrl });
}

suite('Azure REST route encoding', () => {
	for (const baseUrl of ['https://server.test/tfs', 'https://dev.azure.com']) {
		for (const name of ['Name', 'Name with spaces', 'Name#?%&+', '%2e%2e', '.%2E', '%2e.']) {
			test(`keeps ${name} as a literal segment below ${baseUrl} for every read`, async () => {
				const requests: { url: URL; init: RequestInit | undefined }[] = [];
				const api = new AzureDevOpsApi({
					fetch: (input, init) => {
						requests.push({ url: new URL(input.toString()), init: init });
						return Promise.resolve(Response.json(null));
					},
					wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
				});
				const value = 'feature/bug#42?status=active&searchCriteria.status=completed+%';
				await readRoutes(api, baseUrl, name, name, name, value);

				const prefix = [...new URL(baseUrl).pathname.split('/').filter(Boolean), name, name, '_apis'];
				assert.deepEqual(
					requests.map(r => r.url.pathname.slice(1).split('/').map(decodeURIComponent)),
					[
						[...prefix, 'git', 'repositories', name, 'pullRequests'],
						[...prefix, 'git', 'repositories', name, 'pullrequestquery'],
						[...prefix, 'wit', 'workItems', value],
						[...prefix, 'git', 'repositories', name, 'pullRequests', value],
						[...prefix, 'wit', 'workItems', value],
						[...prefix, 'git', 'repositories', name, 'commits', value],
						[...prefix, 'wit', 'workItemTypes', value, 'states'],
						[...prefix, 'git', 'repositories', name],
						[...prefix, 'git', 'repositories', name],
					],
				);
				assert.deepEqual(
					[...requests[0].url.searchParams],
					[
						['searchCriteria.status', 'all'],
						['searchCriteria.sourceRefName', `refs/heads/${value}`],
					],
				);
				const queryBody = requests[1].init?.body;
				assert.ok(typeof queryBody === 'string');
				assert.deepEqual(JSON.parse(queryBody), {
					queries: [{ items: [value], type: 'commit' }],
				});
				for (const request of requests) {
					assert.equal(request.url.origin, new URL(baseUrl).origin);
					assert.equal(request.url.hash, '');
					assert.equal(new Headers(request.init?.headers).get('authorization'), 'Basic UEFUOnRva2Vu');
				}
			});
		}
	}

	for (const dot of ['.', '..']) {
		for (const position of ['owner', 'project', 'repository'] as const) {
			test(`rejects a literal ${dot} in the ${position} before sending credentials`, async () => {
				const requests: string[] = [];
				const api = new AzureDevOpsApi({
					fetch: input => {
						requests.push(input.toString());
						return Promise.resolve(Response.json(null));
					},
					wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
				});
				await readRoutes(
					api,
					'https://server.test/tfs',
					position === 'owner' ? dot : 'owner',
					position === 'project' ? dot : 'project',
					position === 'repository' ? dot : 'repo',
					'42',
				);

				const repositoryIndependentReads = position === 'repository' ? 3 : 0;
				assert.equal(requests.length, repositoryIndependentReads);
				assert.ok(requests.every(url => !url.includes(`/${dot}/`)));
			});
		}
	}

	test('encodes the owner and returned identifiers on PR and fork follow-up requests', async () => {
		const baseUrl = 'https://server.test/tfs';
		const owner = '%2e%2e';
		const projectId = 'project/#?%';
		const repositoryId = 'repository/#?%';
		const pr = createAzurePullRequest('https://untrusted.test/pr', 'Project', 'Repo', projectId);
		pr.repository.id = repositoryId;
		pr.forkSource = createAzureForkSource(pr);
		pr.forkSource!.repository.id = 'fork/#?%';
		const requests: URL[] = [];
		const api = new AzureDevOpsApi({
			fetch: input => {
				const url = new URL(input.toString());
				requests.push(url);
				if (url.pathname.endsWith('/pullrequestquery')) {
					return Promise.resolve(Response.json({ results: [{ commit: [pr] }] }));
				}
				if (url.pathname.endsWith('/pullRequests/5')) return Promise.resolve(Response.json(pr));

				return Promise.resolve(Response.json(null));
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		});
		const result = await api.getPullRequestForCommit(
			azureProvider,
			azureToken,
			owner,
			'Project/_git/Repo',
			'commit',
			baseUrl,
		);

		assert.equal(result?.id, '5');
		assert.deepEqual(
			requests.map(url => url.pathname.slice(1).split('/').map(decodeURIComponent)),
			[
				['tfs', owner, 'Project', '_apis', 'git', 'repositories', 'Repo', 'pullrequestquery'],
				['tfs', owner, projectId, '_apis', 'git', 'repositories', repositoryId, 'pullRequests', '5'],
				['tfs', owner, '_apis', 'git', 'repositories', 'fork/#?%'],
			],
		);
	});
});
