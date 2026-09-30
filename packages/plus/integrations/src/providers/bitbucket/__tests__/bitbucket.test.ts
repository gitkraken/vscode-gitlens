import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../../__tests__/fakeRuntime.js';
import { primarySession } from '../../../__tests__/sweepHelpers.js';
import { GitSelfManagedHostIntegrationId } from '../../../constants.js';
import { createIntegrationService } from '../../../integrationService.js';
import type { ApiClients } from '../../apiClients.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { BitbucketApi } from '../bitbucket.js';
import type { BitbucketIssue, BitbucketPullRequest } from '../models.js';
import { fromBitbucketIssue } from '../models.js';
import {
	appUser,
	bitbucketProvider,
	bitbucketToken,
	createBitbucketPullRequest,
	participant,
	user,
} from './fixtures.js';

// Answers every request with `body` as JSON, or with a 404 when `body` is undefined.
function configFor(body: unknown): { config: ProviderApiConfig; requests: string[] } {
	const requests: string[] = [];
	return {
		requests: requests,
		config: {
			fetch: input => {
				requests.push(input.toString());
				if (body == null) {
					return Promise.resolve(new Response('{}', { status: 404, statusText: 'Not Found' }));
				}

				return Promise.resolve(Response.json(body));
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		},
	};
}

suite('BitbucketApi.getPullRequest', () => {
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

// A review bot is an `app_user` whose `links` has no `html`: mapping it must not throw and fail the whole read.
suite('BitbucketApi app_user accounts', () => {
	const baseUrl = 'https://api.bitbucket.org/2.0';

	function apiFor(body: unknown): { api: BitbucketApi; requests: string[] } {
		const { config, requests } = configFor(body);
		return { api: new BitbucketApi(config), requests: requests };
	}

	function createPullRequestWithBot(id: number = 5): BitbucketPullRequest {
		return {
			...createBitbucketPullRequest('myworkspace', 'myrepo', id),
			state: 'OPEN',
			closed_by: null,
			participants: [
				participant(user('human')),
				participant(appUser(), { role: 'PARTICIPANT' }),
				participant(appUser('Review Bot'), { role: 'REVIEWER', participatedOn: null }),
			],
		};
	}

	test('getPullRequest maps an app_user participant without links.html', async () => {
		const { api } = apiFor(createPullRequestWithBot());

		const pr = await api.getPullRequest(bitbucketProvider, bitbucketToken, 'myworkspace', 'myrepo', '5', baseUrl);

		assert.ok(pr, 'the pull request maps');
		const bot = pr.latestReviews?.find(r => r.reviewer.name === 'CodeAnt AI')?.reviewer;
		assert.deepEqual(bot, {
			avatarUrl: 'https://bitbucket.org/bot/avatar',
			name: 'CodeAnt AI',
			username: undefined,
			url: undefined,
			id: '{bot}',
		});
		const human = pr.latestReviews?.find(r => r.reviewer.name === 'human')?.reviewer;
		assert.equal(human?.url, 'https://bitbucket.org/human', 'a regular user keeps its profile url');
		assert.deepEqual(
			pr.reviewRequests?.map(r => r.reviewer.name),
			['Review Bot'],
			'an app_user reviewer who has not reviewed yet is a pending review request',
		);
	});

	test('getPullRequest maps an app_user author and an account with no links at all', async () => {
		const noLinks: BitbucketPullRequest['author'] = { type: 'user', uuid: '{nolinks}', display_name: 'No Links' };
		const { api } = apiFor({
			...createPullRequestWithBot(),
			author: appUser(),
			participants: [participant(noLinks)],
		});

		const pr = await api.getPullRequest(bitbucketProvider, bitbucketToken, 'myworkspace', 'myrepo', '5', baseUrl);

		assert.equal(pr?.author.name, 'CodeAnt AI');
		assert.equal(pr?.author.url, undefined);
		assert.equal(pr?.author.avatarUrl, 'https://bitbucket.org/bot/avatar');
		const reviewer = pr?.latestReviews?.[0]?.reviewer;
		assert.equal(reviewer?.name, 'No Links');
		assert.equal(reviewer?.avatarUrl, undefined);
		assert.equal(reviewer?.url, undefined);
	});

	test('getIssueOrPullRequest returns a pull request with an app_user participant', async () => {
		const { api, requests } = apiFor(createPullRequestWithBot());

		const result = await api.getIssueOrPullRequest(
			bitbucketProvider,
			bitbucketToken,
			'myworkspace',
			'myrepo',
			'5',
			baseUrl,
		);

		assert.equal(result?.type, 'pullrequest');
		assert.equal(requests.length, 1, 'the issue endpoint is not requested once the pull request maps');
	});

	test('getPullRequestForBranch maps a pull request with an app_user participant', async () => {
		const { api } = apiFor({ values: [createPullRequestWithBot()], pagelen: 1, size: 1, page: 1 });

		const pr = await api.getPullRequestForBranch(
			bitbucketProvider,
			bitbucketToken,
			'myworkspace',
			'myrepo',
			'feature',
			baseUrl,
		);

		assert.equal(pr?.id, '5');
	});

	test('getPullRequestsForBranch keeps every pull request when one carries an app_user participant', async () => {
		const human = { ...createBitbucketPullRequest('myworkspace', 'myrepo', 4), state: 'OPEN' as const };
		const { api } = apiFor({ values: [createPullRequestWithBot(5), human] });

		const { pullRequests, truncated } = await api.getPullRequestsForBranch(
			bitbucketProvider,
			bitbucketToken,
			'myworkspace',
			'myrepo',
			'feature',
			baseUrl,
			{ limit: 10 },
		);

		assert.deepEqual(pullRequests.map(pr => pr.id).sort(), ['4', '5']);
		assert.equal(truncated, false);
	});

	test('getPullRequestForCommit maps a pull request with an app_user participant', async () => {
		const { api } = apiFor({ values: [createPullRequestWithBot()] });

		const pr = await api.getPullRequestForCommit(
			bitbucketProvider,
			bitbucketToken,
			'myworkspace',
			'myrepo',
			'head-sha',
			baseUrl,
		);

		assert.equal(pr?.id, '5');
	});

	test('fromBitbucketIssue maps an app_user reporter and assignee', () => {
		const issueUrl = 'https://bitbucket.org/myworkspace/myrepo/issues/7';
		const issue: BitbucketIssue = {
			type: 'issue',
			id: 7,
			title: 'An issue',
			reporter: appUser(),
			assignee: appUser('Triage Bot'),
			state: 'new',
			created_on: '2026-01-01T00:00:00Z',
			updated_on: '2026-01-01T00:00:00Z',
			repository: createBitbucketPullRequest().destination.repository,
			votes: 0,
			content: { raw: '', markup: 'markdown', html: '' },
			links: {
				self: { href: issueUrl },
				html: { href: issueUrl },
				comments: { href: `${issueUrl}/comments` },
				attachments: { href: `${issueUrl}/attachments` },
				watch: { href: `${issueUrl}/watch` },
				vote: { href: `${issueUrl}/vote` },
			},
		};

		const result = fromBitbucketIssue(issue, bitbucketProvider);

		assert.equal(result.author?.name, 'CodeAnt AI');
		assert.equal(result.author?.url, undefined);
		assert.deepEqual(
			result.assignees.map(a => [a.name, a.url]),
			[['Triage Bot', undefined]],
		);
	});
});

suite('BitbucketServerIntegration.getPullRequest', () => {
	test('returns the pull request the client resolves through getServerPullRequest', async () => {
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
				getServerPullRequest: (...args: unknown[]) => {
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
