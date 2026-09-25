import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../../__tests__/fakeRuntime.js';
import { primarySession } from '../../../__tests__/sweepHelpers.js';
import { GitSelfManagedHostIntegrationId } from '../../../constants.js';
import { createIntegrationService } from '../../../integrationService.js';
import type { ApiClients } from '../../apiClients.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { BitbucketApi } from '../bitbucket.js';
import type { BitbucketPullRequest } from '../models.js';
import { bitbucketProvider, bitbucketToken, createBitbucketPullRequest } from './fixtures.js';

suite('BitbucketApi.getPullRequest', () => {
	function configFor(pr: BitbucketPullRequest | undefined): { config: ProviderApiConfig; requests: string[] } {
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

	test('reads a pull request by id and reports it merged', async () => {
		const { config, requests } = configFor(createBitbucketPullRequest());
		const api = new BitbucketApi(config);

		const pr = await api.getPullRequest(
			bitbucketProvider,
			bitbucketToken,
			'myworkspace',
			'myrepo',
			'5',
			'https://api.bitbucket.org/2.0',
		);

		assert.deepEqual(requests, [
			'https://api.bitbucket.org/2.0/repositories/myworkspace/myrepo/pullrequests/5?fields=%2Bvalues.reviewers,%2Bvalues.participants',
		]);
		assert.equal(pr?.state, 'merged');
		assert.ok(pr?.mergedDate instanceof Date, 'mergedDate is set for a merged pull request');
	});

	test('a missing pull request resolves to undefined', async () => {
		const { config } = configFor(undefined);
		const api = new BitbucketApi(config);

		const pr = await api.getPullRequest(
			bitbucketProvider,
			bitbucketToken,
			'myworkspace',
			'myrepo',
			'5',
			'https://api.bitbucket.org/2.0',
		);

		assert.equal(pr, undefined);
	});

	// Decision 3 has `getIssueOrPullRequest` call the new `getPullRequest` instead of keeping its own copy; this
	// guards that refactor against dropping the merged state or mergedDate it already reports today.
	test('getIssueOrPullRequest still returns a merged pull request', async () => {
		const { config } = configFor(createBitbucketPullRequest());
		const api = new BitbucketApi(config);

		const result = await api.getIssueOrPullRequest(
			bitbucketProvider,
			bitbucketToken,
			'myworkspace',
			'myrepo',
			'5',
			'https://api.bitbucket.org/2.0',
		);

		assert.equal(result?.type, 'pullrequest');
		assert.equal(result?.state, 'merged');
	});

	// A non-404 pull request failure (e.g. a 500) is not a "missing pull request" — it must not fall through to the
	// issue lookup, unlike a 404 which does.
	test('getIssueOrPullRequest does not request the issue endpoint when the pull request fails with a non-404 status', async () => {
		const requests: string[] = [];
		const config: ProviderApiConfig = {
			fetch: input => {
				const url = input.toString();
				requests.push(url);
				if (url.includes('/pullrequests/')) {
					return Promise.resolve(new Response('{}', { status: 500, statusText: 'Internal Server Error' }));
				}

				return Promise.resolve(
					Response.json({
						id: 7,
						title: 'An issue',
						state: 'open',
						created_on: '2026-01-01T00:00:00Z',
						updated_on: '2026-01-01T00:00:00Z',
						links: { html: { href: 'https://bitbucket.org/myworkspace/myrepo/issues/7' } },
					}),
				);
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		};
		const api = new BitbucketApi(config);

		const result = await api.getIssueOrPullRequest(
			bitbucketProvider,
			bitbucketToken,
			'myworkspace',
			'myrepo',
			'7',
			'https://api.bitbucket.org/2.0',
		);

		assert.equal(result, undefined);
		assert.equal(requests.length, 1, 'the issue endpoint is not requested after a non-404 pull request failure');
	});
});

suite('BitbucketServerIntegration.getPullRequest', () => {
	test('returns the pull request the client resolves through getServerPullRequestById', async () => {
		const runtime = createFakeRuntime();
		// Not implemented by the fake runtime yet (see fakeRuntime.ts); a pass-through is enough to exercise the
		// integration's own read path without a real cache.
		runtime.cache.getPullRequest = (_id, _resource, _integration, cacheable) =>
			cacheable({ invalidate: () => {} } as never).value;

		const service = createIntegrationService(runtime);
		const server = await service.get(GitSelfManagedHostIntegrationId.BitbucketServer, 'bb.example.com');
		assert.ok(server, 'the Bitbucket Server integration resolves');
		(server as unknown as { _session: unknown })._session = {
			...primarySession('token'),
			domain: 'bb.example.com',
		};

		const expectedPr = { id: '7', state: 'merged' };
		let capturedArgs: unknown[] | undefined;
		const apis: ApiClients = {
			github: Promise.resolve(undefined),
			gitlab: Promise.resolve(undefined),
			azure: Promise.resolve(undefined),
			bitbucket: Promise.resolve({
				getServerPullRequestById: (...args: unknown[]) => {
					capturedArgs = args;
					return Promise.resolve(expectedPr);
				},
			} as unknown as Awaited<ApiClients['bitbucket']>),
		};
		Object.defineProperty((server as unknown as { authenticationService: object }).authenticationService, 'apis', {
			configurable: true,
			value: apis,
		});

		const pr = await server.getPullRequest({ key: 'KEY/app', owner: 'KEY', name: 'app' }, '7');

		assert.equal(pr?.id, expectedPr.id);
		assert.equal(pr?.state, expectedPr.state);
		assert.deepEqual(capturedArgs?.slice(2, 5), ['KEY', 'app', '7']);

		service.dispose();
	});
});
