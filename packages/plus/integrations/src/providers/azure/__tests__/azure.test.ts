import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createRemoteProviderMatcher } from '@gitlens/git/remotes/matcher.js';
import { advanceClock, restoreClock } from '../../../__tests__/clock.js';
import { createFakeRuntime } from '../../../__tests__/fakeRuntime.js';
import { connectedAzure, primarySession, watchRequestFailures } from '../../../__tests__/sweepHelpers.js';
import { GitCloudHostIntegrationId } from '../../../constants.js';
import { AuthenticationError } from '../../../errors.js';
import { createIntegrationService } from '../../../integrationService.js';
import { failureBackoffMaxMs } from '../../../utils/failureBackoff.js';
import type { ApiClients } from '../../apiClients.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { AzureDevOpsApi } from '../azure.js';
import type { AzurePullRequest, AzureRepositoryUrls } from '../models.js';
import { AzureWorkItemDescriptionsCache } from '../workItemDescriptions.js';
import { AzureWorkItemStatesCache } from '../workItemStateCategories.js';
import {
	azureProvider,
	azureRestDiscoveryResponse,
	azureToken,
	createAzureForkSource,
	createAzurePullRequest,
} from './fixtures.js';

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
			'https://dev.azure.com/myorg/Project/_apis/git/repositories/Repo/pullRequests?searchCriteria.status=all&searchCriteria.sourceRefName=refs%2Fheads%2Ffeature',
		]);
		assert.equal(pr?.refs?.base.url, 'https://dev.azure.com/myorg/Project/_git/Repo');
		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/Project/_git/Repo');
	});

	test('builds the repository urls on Azure DevOps Server behind a virtual directory', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.url =
			'https://azure.example.com/tfs/collection/project-id/_apis/git/repositories/repository-id/pullRequests/5';
		const { config, requests } = configForPullRequest(azurePullRequest);
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://azure.example.com/tfs', 'collection');

		assert.deepEqual(requests, [
			'https://azure.example.com/tfs/collection/Project/_apis/git/repositories/Repo/pullRequests?searchCriteria.status=all&searchCriteria.sourceRefName=refs%2Fheads%2Ffeature',
		]);
		assert.equal(pr?.refs?.base.url, 'https://azure.example.com/tfs/collection/Project/_git/Repo');
	});

	test('rejects malformed repository descriptors before issuing a request', async () => {
		const requests: string[] = [];
		const api = new AzureDevOpsApi({
			fetch: input => {
				requests.push(input.toString());
				return Promise.resolve(Response.json({}));
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		});
		const repo = 'Project/not-git/Repo';
		const baseUrl = 'https://dev.azure.com';

		await assert.rejects(
			api.getPullRequestForBranch(azureProvider, azureToken, 'myorg', repo, 'feature', { baseUrl: baseUrl }),
			/Invalid Azure repository descriptor/,
		);
		await assert.rejects(
			api.getPullRequestForCommit(azureProvider, azureToken, 'myorg', repo, 'commit', baseUrl),
			/Invalid Azure repository descriptor/,
		);
		await assert.rejects(
			api.getIssueOrPullRequest(azureProvider, azureToken, 'myorg', repo, '5', { baseUrl: baseUrl }),
			/Invalid Azure repository descriptor/,
		);
		await assert.rejects(
			api.getAccountForCommit(azureProvider, azureToken, 'myorg', repo, 'commit', baseUrl),
			/Invalid Azure repository descriptor/,
		);
		assert.deepEqual(requests, []);
	});

	test('reads pull requests for legacy and short visualstudio.com / dev.azure.com remotes (#5999)', async () => {
		const matcher = createRemoteProviderMatcher();
		for (const { remoteUrl, route } of [
			{
				remoteUrl: 'https://myorg.visualstudio.com/DefaultCollection/Project/_git/Repo',
				route: 'Project/_apis/git/repositories/Repo',
			},
			{
				remoteUrl: 'https://myorg.visualstudio.com/defaultcollection/Project/_git/Repo',
				route: 'Project/_apis/git/repositories/Repo',
			},
			{
				remoteUrl: 'https://myorg.visualstudio.com/DefaultCollection/_git/Repo',
				route: 'Repo/_apis/git/repositories/Repo',
			},
			{ remoteUrl: 'https://myorg.visualstudio.com/_git/Repo', route: 'Repo/_apis/git/repositories/Repo' },
			{ remoteUrl: 'https://dev.azure.com/myorg/_git/Repo', route: 'Repo/_apis/git/repositories/Repo' },
		]) {
			const { hostname, pathname } = new URL(remoteUrl);
			const remote = matcher(remoteUrl, hostname, pathname.substring(1), 'https');
			assert.ok(remote?.owner != null && remote.repoName != null, remoteUrl);

			const { config, requests } = configForPullRequest(pullRequest());
			const api = new AzureDevOpsApi(config);
			await api.getPullRequestForBranch(azureProvider, azureToken, remote.owner, remote.repoName, 'feature', {
				baseUrl: 'https://dev.azure.com',
			});

			assert.deepEqual(
				requests.map(r => r.split('?')[0]),
				[`https://dev.azure.com/myorg/${route}/pullRequests`],
				remoteUrl,
			);
		}
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
		assert.equal(pr?.refs?.head.cloneHttps, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
	});

	test('carries the clone url of each ref, the head one off the fork lookup', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.repository.remoteUrl = 'https://myorg@dev.azure.com/myorg/Project/_git/Repo';
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: {
				webUrl: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo',
				remoteUrl: 'https://myorg@dev.azure.com/myorg/ForkProject/_git/ForkRepo',
			},
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.refs?.base.cloneHttps, 'https://dev.azure.com/myorg/Project/_git/Repo');
		assert.equal(pr?.refs?.head.cloneHttps, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
	});

	// An older `api-version` promises neither URL field, so the clone URL has to be able to name the fork on its own.
	test('names the fork by its clone url when the lookup reports no web url', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: { remoteUrl: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo' },
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
		assert.equal(pr?.refs?.head.cloneHttps, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
	});

	test('leaves the fork clone url unset when the lookup reports only a web url', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo',
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
		assert.equal(pr?.refs?.head.cloneHttps, undefined);
	});

	test('drops a fork clone url that sits outside the collection, keeping the web url', async () => {
		const azurePullRequest = pullRequest();
		azurePullRequest.forkSource = createAzureForkSource(azurePullRequest);
		const { config } = configForPullRequest(azurePullRequest, {
			[forkRepositoryRoute]: {
				webUrl: 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo',
				remoteUrl: 'https://dev.azure.com/attacker/ForkProject/_git/ForkRepo',
			},
		});
		const api = new AzureDevOpsApi(config);

		const pr = await getPullRequestForBranch(api, 'https://dev.azure.com');

		assert.equal(pr?.refs?.head.url, 'https://dev.azure.com/myorg/ForkProject/_git/ForkRepo');
		assert.equal(pr?.refs?.head.cloneHttps, undefined);
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

suite('AzureDevOpsApi.getPullRequest', () => {
	function completedPullRequest(): AzurePullRequest {
		const pr = pullRequest();
		pr.status = 'completed';
		pr.closedDate = '2026-09-12T00:00:00Z';
		return pr;
	}

	function configForOrgPullRequest(pr: AzurePullRequest | undefined): {
		config: ProviderApiConfig;
		requests: string[];
	} {
		const requests: string[] = [];
		return {
			requests: requests,
			config: {
				fetch: input => {
					requests.push(input.toString());
					if (pr == null) {
						return Promise.resolve(new Response('{}', { status: 404, statusText: 'Not Found' }));
					}

					return Promise.resolve(Response.json(pr));
				},
				wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
			},
		};
	}

	test('reads by id at the org/project level and reports state, mergedDate and closedDate', async () => {
		const { config, requests } = configForOrgPullRequest(completedPullRequest());
		const api = new AzureDevOpsApi(config);

		const pr = await api.getPullRequest(azureProvider, azureToken, 'myorg', 'Project', '5', {
			baseUrl: 'https://dev.azure.com',
		});

		assert.deepEqual(requests, ['https://dev.azure.com/myorg/Project/_apis/git/pullrequests/5']);
		assert.equal(pr?.state, 'merged');
		assert.ok(pr?.mergedDate instanceof Date, 'mergedDate is set for a completed pull request');
		assert.ok(pr?.closedDate instanceof Date, 'closedDate is set for a completed pull request');
	});

	test('resolves the project from a {project}/_git/{repo} descriptor the same way as a bare project name', async () => {
		const { config, requests } = configForOrgPullRequest(completedPullRequest());
		const api = new AzureDevOpsApi(config);

		await api.getPullRequest(azureProvider, azureToken, 'myorg', 'Project/_git/Repo', '5', {
			baseUrl: 'https://dev.azure.com',
		});

		assert.deepEqual(requests, ['https://dev.azure.com/myorg/Project/_apis/git/pullrequests/5']);
	});

	test('a missing pull request resolves to undefined', async () => {
		const { config } = configForOrgPullRequest(undefined);
		const api = new AzureDevOpsApi(config);

		const pr = await api.getPullRequest(azureProvider, azureToken, 'myorg', 'Project', '5', {
			baseUrl: 'https://dev.azure.com',
		});

		assert.equal(pr, undefined);
	});

	test('an authentication failure is rethrown rather than swallowed', async () => {
		const api = new AzureDevOpsApi({
			fetch: () => Promise.resolve(new Response('{}', { status: 401, statusText: 'Unauthorized' })),
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		});

		await assert.rejects(
			api.getPullRequest(azureProvider, azureToken, 'myorg', 'Project', '5', {
				baseUrl: 'https://dev.azure.com',
			}),
			(ex: unknown) => ex instanceof AuthenticationError,
		);
	});
});

suite('AzureDevOpsIntegration.getPullRequest', () => {
	test('requests the descriptor project instead of the repository name when both are set', async () => {
		const runtime = createFakeRuntime();
		// Not implemented by the fake runtime yet (see fakeRuntime.ts); a pass-through is enough to exercise the
		// integration's own read path without a real cache.
		runtime.cache.getPullRequest = (_id, _resource, _integration, cacheable) =>
			cacheable({ invalidate: () => {} } as never).value;

		const service = createIntegrationService(runtime);
		const azure = await service.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: unknown })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		const requests: string[] = [];
		const api = new AzureDevOpsApi({
			fetch: input => {
				requests.push(input.toString());
				return Promise.resolve(Response.json(pullRequest()));
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		});
		const apis: ApiClients = {
			azureWorkItemStates: new AzureWorkItemStatesCache(),
			azureWorkItemDescriptions: new AzureWorkItemDescriptionsCache(),
			github: Promise.resolve(undefined),
			gitlab: Promise.resolve(undefined),
			bitbucket: Promise.resolve(undefined),
			azure: Promise.resolve(api),
		};
		Object.defineProperty((azure as unknown as { authenticationService: object }).authenticationService, 'apis', {
			configurable: true,
			value: apis,
		});

		await azure.getPullRequest({ key: 'org/Repo', owner: 'org', name: 'Repo', project: 'Proj' }, '5');

		assert.deepEqual(requests, ['https://dev.azure.com/org/Proj/_apis/git/pullrequests/5']);

		service.dispose();
	});
});

suite('AzureDevOpsIntegration.getPullRequestForCommit', () => {
	const sha = 'a'.repeat(40);
	const repo = { key: 'org/proj/r', owner: 'org', name: 'proj/_git/r', project: 'proj' };

	function json(status: number, body: unknown): Response {
		return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
	}

	async function lookUps(responses: readonly ((url: URL) => Response)[]): Promise<{
		invalidated: number[];
		strikes: number;
		expired: boolean | undefined;
	}> {
		const runtime = createFakeRuntime();
		let respond = responses[0];
		runtime.http.fetch = input => {
			const discovery = azureRestDiscoveryResponse(input);
			if (discovery != null) return Promise.resolve(discovery);

			return Promise.resolve(respond(new URL(input.toString())));
		};
		let invalidated = 0;
		runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
			loader({ invalidate: () => void invalidated++ } as never).value;
		const { manager, azure } = await connectedAzure(runtime);
		try {
			const after: number[] = [];
			for (const response of responses) {
				advanceClock(failureBackoffMaxMs);
				respond = response;
				assert.equal(await azure.getPullRequestForCommit(repo, sha), undefined);
				after.push(invalidated);
			}
			const strikes = (azure as unknown as { requestExceptionCount: number }).requestExceptionCount;
			return { invalidated: after, strikes: strikes, expired: azure.connectionExpired };
		} finally {
			restoreClock();
			manager.dispose();
		}
	}

	test('a failed query is not kept as a commit without a pull request, while a 404 still answers none', async () => {
		const { invalidated } = await lookUps([
			() => json(500, { message: 'boom' }),
			() => json(404, { message: 'TF401019: The Git repository does not exist.' }),
		]);

		assert.deepEqual(invalidated, [1, 1]);
	});

	test('a query answer without the results of its query is a failure, while an empty result is none', async () => {
		const { invalidated } = await lookUps([() => json(200, { results: [] }), () => json(200, { results: [{}] })]);

		assert.deepEqual(invalidated, [1, 1]);
	});

	test("a repository's refusal costs the connection nothing and is not kept", async () => {
		const forbidden = () => json(403, { message: 'TF401027: You need the Git GenericRead permission.' });
		const { invalidated, strikes, expired } = await lookUps([forbidden, forbidden, forbidden]);

		assert.deepEqual(invalidated, [1, 2, 3]);
		assert.equal(strikes, 0);
		assert.notEqual(expired, true, 'the session is not expired');
	});

	test('a pull request the query found but that reads back empty is a failure, not a commit without one', async () => {
		const { invalidated } = await lookUps([
			url =>
				url.pathname.toLowerCase().endsWith('/pullrequestquery')
					? json(200, {
							results: [
								{
									[sha]: [
										{ pullRequestId: 5, repository: { id: 'repo-id', project: { id: 'proj-id' } } },
									],
								},
							],
						})
					: json(200, null),
		]);

		assert.deepEqual(invalidated, [1]);
	});

	test('a client that failed to construct is a failure, not a commit without a pull request', async () => {
		const runtime = createFakeRuntime();
		let invalidated = 0;
		runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
			loader({ invalidate: () => void invalidated++ } as never).value;
		const { manager, azure } = await connectedAzure(runtime);
		const { apis } = (azure as unknown as { authenticationService: { apis: object } }).authenticationService;
		Object.defineProperty(apis, 'azure', { get: () => Promise.resolve(undefined) });
		try {
			assert.equal(await azure.getPullRequestForCommit(repo, sha), undefined);
			assert.equal(invalidated, 1);
			assert.equal((azure as unknown as { requestExceptionCount: number }).requestExceptionCount, 0);
		} finally {
			manager.dispose();
		}
	});
});

suite('AzureDevOpsIntegration.getPullRequestsForCommits fork lookups', () => {
	const shas = Array.from({ length: 10 }, (_, i) => `a${(i + 1).toString(16).padStart(39, '0')}`);

	function json(status: number, body: unknown): Response {
		return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
	}

	async function readForkedPullRequests(forkStatus: number) {
		const runtime = createFakeRuntime();
		const requests = { pullRequests: 0, forks: 0 };
		runtime.http.fetch = (input, init) => {
			const discovery = azureRestDiscoveryResponse(input);
			if (discovery != null) return Promise.resolve(discovery);

			const url = new URL(input.toString());
			if (url.pathname.toLowerCase().endsWith('/pullrequestquery')) {
				const body = typeof init?.body === 'string' ? init.body : '{}';
				const items = (JSON.parse(body) as { queries: { items: string[] }[] }).queries[0].items;
				return Promise.resolve(
					json(200, {
						results: [
							Object.fromEntries(
								items.map(rev => [
									rev,
									[
										{
											pullRequestId: shas.indexOf(rev) + 1,
											repository: { id: 'repo-id', project: { id: 'proj-id' } },
										},
									],
								]),
							),
						],
					}),
				);
			}

			const pullRequestId = /\/pullRequests\/(\d+)$/i.exec(url.pathname)?.[1];
			if (pullRequestId != null) {
				requests.pullRequests++;
				const pr = { ...createAzurePullRequest(url.href, 'proj', 'r'), pullRequestId: Number(pullRequestId) };
				const forkSource = createAzureForkSource(pr)!;
				return Promise.resolve(
					json(200, {
						...pr,
						forkSource: {
							...forkSource,
							repository: { ...forkSource.repository, id: `fork-${pullRequestId}` },
						},
					}),
				);
			}

			requests.forks++;
			return Promise.resolve(json(forkStatus, { message: 'fork lookup failed' }));
		};
		const { manager, azure } = await connectedAzure(runtime);
		const watched = watchRequestFailures(runtime);
		try {
			const result = await manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				owner: 'org',
				repo: 'r',
				project: 'proj',
				shas: shas,
			});
			const strikes = (azure as unknown as { requestExceptionCount: number }).requestExceptionCount;
			return {
				result: result,
				requests: requests,
				notices: watched.notices,
				strikes: strikes,
				expired: azure.connectionExpired,
			};
		} finally {
			manager.dispose();
		}
	}

	test("a rate limit on a fork lookup stops the call's fan-out", async () => {
		const { result, requests } = await readForkedPullRequests(429);

		assert.ok(requests.pullRequests < shas.length, `${requests.pullRequests} pull request reads for 10 commits`);
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.some(w => w.kind === 'rate-limit'));
	});

	test('a fork the token cannot read costs the pull requests and the credential nothing', async () => {
		const { result, requests, strikes, expired } = await readForkedPullRequests(401);

		assert.equal(requests.pullRequests, shas.length);
		assert.equal(result.items.length, shas.length);
		assert.deepEqual(
			result.warnings.filter(w => w.kind === 'auth'),
			[],
		);
		assert.equal(strikes, 0);
		assert.notEqual(expired, true, 'the session is not expired');
	});

	test('fork lookups failing with 500 show one notice for the call and cost the pull requests nothing', async () => {
		const { result, requests, notices, strikes } = await readForkedPullRequests(500);

		assert.equal(requests.forks, shas.length);
		assert.equal(result.items.length, shas.length, 'a fork lookup is best-effort');
		assert.equal(notices.length, 1);
		assert.equal(strikes, 0);
	});
});
