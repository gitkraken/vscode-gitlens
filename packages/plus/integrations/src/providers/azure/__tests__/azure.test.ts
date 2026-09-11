import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { AzureDevOpsApi } from '../azure.js';
import type { AzurePullRequest, AzureRepositoryUrls } from '../models.js';
import { azureProvider, azureToken, createAzureForkSource, createAzurePullRequest } from './fixtures.js';

function pullRequest(): AzurePullRequest {
	return createAzurePullRequest(
		'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
		'Project',
		'Repo',
	);
}

function configForPullRequest(
	pr: AzurePullRequest,
	repositoryUrls: Readonly<Record<string, string | AzureRepositoryUrls>> = {},
): { config: ProviderApiConfig; requests: string[] } {
	const requests: string[] = [];
	return {
		requests: requests,
		config: {
			fetch: input => {
				const url = input.toString();
				requests.push(url);
				if (url.includes('/pullRequests?')) {
					return Promise.resolve(Response.json({ value: [pr] }));
				}

				const repositoryUrl = new URL(url);
				repositoryUrl.search = '';
				const urls = repositoryUrls[repositoryUrl.toString()];
				if (urls == null) throw new Error(`Unexpected request: ${url}`);
				if (urls === 'forbidden') {
					return Promise.resolve(new Response('{}', { status: 403, statusText: 'Forbidden' }));
				}

				return Promise.resolve(Response.json(typeof urls === 'string' ? { webUrl: urls } : urls));
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		},
	};
}

function getPullRequestForBranch(api: AzureDevOpsApi, baseUrl: string, owner: string = 'myorg') {
	return api.getPullRequestForBranch(azureProvider, azureToken, owner, 'Project/_git/Repo', 'feature', {
		baseUrl: baseUrl,
	});
}

const forkRepositoryRoute = 'https://dev.azure.com/myorg/_apis/git/repositories/fork-repository-id';

suite('AzureDevOpsApi pull requests', () => {
	test('builds the repository urls without any extra request', async () => {
		const { config, requests } = configForPullRequest(pullRequest());
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.deepEqual(requests, [
			'https://dev.azure.com/myorg/Project/_apis/git/repositories/Repo/pullRequests?searchCriteria.status=all&searchCriteria.sourceRefName=refs/heads/feature',
		]);
		assert.equal(pr?.refs?.base.url, 'https://dev.azure.com/myorg/Project/_git/Repo');
		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/Project/_git/Repo');
	});

	test('builds the repository urls on Azure DevOps Server without any extra request', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.url =
			'https://azure.example.com/collection/project-id/_apis/git/repositories/repository-id/pullRequests/5';
		const { config, requests } = configForPullRequest(azurePullRequest);
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://azure.example.com', 'collection');

		assert.equal(requests.length, 1);
		assert.equal(pr?.refs?.base.url, 'https://azure.example.com/collection/Project/_git/Repo');
	});

	test('resolves a fork repository once and reuses it', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config, requests } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo',
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');
		await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(
			requests.filter(r => r.includes('fork-repository-id')).length,
			1,
			'the fork repository is looked up once and cached',
		);
		assert.equal(pr?.refs?.base.url, 'https://dev.azure.com/myorg/Project/_git/Repo');
		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
	});

	test('shares one request between concurrent reads of the same fork', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config, requests } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo',
		});
		const api = new AzureDevOpsApi(config);

		await Promise.all([
			getPullRequestForBranch(api, 'https://dev.azure.com'),
			getPullRequestForBranch(api, 'https://dev.azure.com'),
		]);

		assert.equal(requests.filter(r => r.includes('fork-repository-id')).length, 1);
	});

	test('accepts a legacy visualstudio.com fork url when the configured baseUrl is dev.azure.com', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'https://myorg.visualstudio.com/ForkProject/_git/ForkRepo',
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.refs?.head.url, 'https://myorg.visualstudio.com/ForkProject/_git/ForkRepo');
	});

	test('resolves the fork by id instead of trusting the payload remote url', async () => {
		const azurePullRequest = pullRequest();
		const remoteUrl = new URL('https://dev.azure.com/myorg/ForkProject/_git/ForkRepo?token=secret#frag');
		remoteUrl.username = 'bot';
		remoteUrl.password = 'pat';
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest, remoteUrl.toString());
		const { config, requests } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'https://dev.azure.com/myorg/AuthoritativeProject/_git/AuthoritativeRepo',
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(requests.filter(r => r.includes('fork-repository-id')).length, 1);
		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/AuthoritativeProject/_git/AuthoritativeRepo');
	});

	test('falls back to the repository lookup when the payload remote url names a different host', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(
			azurePullRequest,
			'https://attacker.invalid/myorg/ForkProject/_git/ForkRepo',
		);
		const { config, requests } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo',
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.id, '5');
		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
		assert.equal(requests.filter(r => r.includes('fork-repository-id')).length, 1);
	});

	test('falls back to the repository lookup when the payload remote url names another organization', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(
			azurePullRequest,
			'https://dev.azure.com/attacker/ForkProject/_git/ForkRepo',
		);
		const { config } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo',
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.id, '5');
		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
	});

	test('returns the pull request when the fork lookup is forbidden, and does not re-ask', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config, requests } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'forbidden',
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');
		await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.id, '5');
		assert.equal(pr?.refs?.base.url, 'https://dev.azure.com/myorg/Project/_git/Repo');
		assert.equal(pr?.refs?.head.url, undefined);
		assert.equal(requests.filter(r => r.includes('fork-repository-id')).length, 1);
	});

	test('retries a fork lookup that failed for a transient reason', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const requests: string[] = [];
		let failed = false;
		const config: ProviderApiConfig = {
			fetch: input => {
				const url = input.toString();
				requests.push(url);
				if (url.includes('/pullRequests?')) {
					return Promise.resolve(Response.json({ value: [azurePullRequest] }));
				}
				if (!failed) {
					failed = true;
					return Promise.reject(new Error('socket hang up'));
				}

				return Promise.resolve(
					Response.json({ webUrl: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo' }),
				);
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		};
		const api = new AzureDevOpsApi(config);

		const first = await getPullRequestForBranch(api, 'https://dev.azure.com');
		const second = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(first?.refs?.head.url, undefined);
		assert.equal(second?.refs?.head.url, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
		assert.equal(requests.filter(r => r.includes('fork-repository-id')).length, 2);
	});

	test('returns the pull request when the fork url is on a different origin', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'https://attacker.invalid/myorg/ForkProject/_git/ForkRepo',
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.id, '5');
		assert.equal(pr?.refs?.head.url, undefined);
	});

	test('uses a valid remote url when the repository response web url is untrusted', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: {
				webUrl: 'https://attacker.invalid/myorg/ForkProject/_git/ForkRepo',
				remoteUrl: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo',
			},
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
	});

	test('does not follow the pull request query payload url', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.url = 'https://attacker.invalid/evil/_apis/git/repositories/repository-id/pullRequests/5';
		const requests: string[] = [];
		const config: ProviderApiConfig = {
			fetch: input => {
				const url = input.toString();
				requests.push(url);
				if (url.includes('/pullrequestquery?')) {
					return Promise.resolve(Response.json({ results: [{ commit: [azurePullRequest] }] }));
				}
				if (url.endsWith('/pullRequests/5')) {
					return Promise.resolve(Response.json(azurePullRequest));
				}

				throw new Error(`Unexpected request: ${url}`);
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		};
		const api = new AzureDevOpsApi(config);

		const pr = await api.getPullRequestForCommit(
			azureProvider,
			azureToken,
			'myorg',
			'Project/_git/Repo',
			'commit',
			'https://dev.azure.com',
		);

		assert.equal(pr?.id, '5');
		assert.deepEqual(requests, [
			'https://dev.azure.com/myorg/Project/_apis/git/repositories/Repo/pullrequestquery?api-version=4.1',
			'https://dev.azure.com/myorg/project-id/_apis/git/repositories/repository-id/pullRequests/5',
		]);
	});
});
