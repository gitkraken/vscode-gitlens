import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { advanceClock, restoreClock } from '../../../__tests__/clock.js';
import { createFakeRuntime } from '../../../__tests__/fakeRuntime.js';
import { connectedBitbucket, connectedBitbucketServer, primarySession } from '../../../__tests__/sweepHelpers.js';
import { GitSelfManagedHostIntegrationId } from '../../../constants.js';
import { createIntegrationService } from '../../../integrationService.js';
import { failureBackoffMaxMs } from '../../../utils/failureBackoff.js';
import type { ApiClients } from '../../apiClients.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { AzureWorkItemDescriptionsCache } from '../../azure/workItemDescriptions.js';
import { AzureWorkItemStatesCache } from '../../azure/workItemStateCategories.js';
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

	test('getPullRequestForCommit encodes the workspace and repository as path segments', async () => {
		const { config, requests } = configFor({ values: [] });
		const api = new BitbucketApi(config);

		await api.getPullRequestForCommit(bitbucketProvider, bitbucketToken, 'ws', 'r#x?y/z', 'head-sha', baseUrl);

		assert.ok(
			requests[0].startsWith(`${baseUrl}/repositories/ws/r%23x%3Fy%2Fz/commit/head-sha/pullrequests?`),
			requests[0],
		);
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
			azureWorkItemStates: new AzureWorkItemStatesCache(),
			azureWorkItemDescriptions: new AzureWorkItemDescriptionsCache(),
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

/**
 * Bitbucket Cloud's single-commit lookup, through the integration: its `undefined` is kept per commit as one without a
 * pull request, so only a commit or repository Bitbucket says is missing may answer it.
 */
suite('BitbucketIntegration.getPullRequestForCommit', () => {
	const sha = 'a'.repeat(40);
	const repo = { key: 'ws/r', owner: 'ws', name: 'r' };

	function json(status: number, body: unknown): Response {
		return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
	}

	async function lookUp(response: () => Response): Promise<{
		pr: unknown;
		invalidated: number;
		links: string[];
		strikes: number;
	}> {
		const runtime = createFakeRuntime();
		runtime.http.fetch = () => Promise.resolve(response());
		let invalidated = 0;
		runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
			loader({ invalidate: () => void invalidated++ } as never).value;
		const links: string[] = [];
		runtime.hooks!.ui = { onBitbucketCommitLinksAppMissing: link => void links.push(link) };
		const { manager, integration } = await connectedBitbucket(runtime);
		try {
			const pr = await integration.getPullRequestForCommit(repo, sha);
			const strikes = (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
			return { pr: pr, invalidated: invalidated, links: links, strikes: strikes };
		} finally {
			manager.dispose();
		}
	}

	test('a failed request is never kept as a commit without a pull request', async () => {
		for (const status of [401, 403, 410, 422, 429, 500]) {
			const { pr, invalidated } = await lookUp(() => json(status, { type: 'error', error: { message: 'nope' } }));

			assert.equal(pr, undefined, String(status));
			assert.equal(invalidated, 1, `${status}: the failure is dropped from the cache`);
		}
	});

	test('a commit without one answers none', async () => {
		const { pr, invalidated } = await lookUp(() => json(200, { values: [] }));

		assert.equal(pr, undefined);
		assert.equal(invalidated, 0);
	});

	test('a 404 or an answer without a list is a failure that is not kept and costs the connection nothing', async () => {
		for (const [label, response] of [
			['404', () => json(404, { type: 'error', error: { message: 'Commit not found' } })],
			['no list', () => json(200, {})],
		] as const) {
			const { pr, invalidated, strikes } = await lookUp(response);

			assert.equal(pr, undefined, label);
			assert.equal(invalidated, 1, `${label}: the failure is dropped from the cache`);
			assert.equal(strikes, 0, label);
		}
	});

	test("a repository's refusal costs the connection nothing, while a refused credential reaches its recovery", async () => {
		const runtime = createFakeRuntime();
		let status = 403;
		runtime.http.fetch = () =>
			Promise.resolve(json(status, { type: 'error', error: { message: 'Access denied' } }));
		let invalidated = 0;
		runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
			loader({ invalidate: () => void invalidated++ } as never).value;
		const { manager, integration } = await connectedBitbucket(runtime);
		const strikes = () => (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
		try {
			for (let i = 0; i < 6; i++) {
				assert.equal(await integration.getPullRequestForCommit(repo, sha), undefined);
			}
			status = 400;
			assert.equal(await integration.getPullRequestForCommit(repo, sha), undefined);

			assert.equal(invalidated, 7, 'no refusal is kept as a commit without a pull request');
			assert.equal(strikes(), 0);
			assert.equal(integration.maybeConnected, true);
			assert.notEqual(integration.connectionExpired, true, 'the session is not expired');

			status = 401;
			await integration.getPullRequestForCommit(repo, 'b'.repeat(40));
			assert.equal(integration.connectionExpired, true, 'a refused credential expires the session');
		} finally {
			manager.dispose();
		}
	});

	test('a 404 is a failure until the repository answers, then a commit without one', async () => {
		const runtime = createFakeRuntime();
		const indexedSha = 'b'.repeat(40);
		const unknownSha = 'c'.repeat(40);
		const requested: string[] = [];
		runtime.http.fetch = input => {
			const url = input.toString();
			requested.push(url);
			return Promise.resolve(
				url.includes(indexedSha)
					? json(200, { repo_indexed: true, type: 'paginated_pullrequests', values: [] })
					: json(404, { type: 'error', error: { message: 'Resource not found' } }),
			);
		};
		const cached = new Map<string, unknown>();
		let invalidated = 0;
		runtime.cache.getPullRequestForSha = (rev, _repo, _integration, loader) => {
			if (cached.has(rev)) return cached.get(rev) as never;

			const value = loader({ invalidate: () => void (invalidated++, cached.delete(rev)) } as never).value;
			cached.set(rev, value);
			return value;
		};
		const { manager, integration } = await connectedBitbucket(runtime);
		try {
			assert.equal(await integration.getPullRequestForCommit(repo, sha), undefined);
			assert.equal(invalidated, 1, 'before the repository answered, a 404 is a failure');

			assert.equal(await integration.getPullRequestForCommit(repo, indexedSha), undefined);
			assert.equal(await integration.getPullRequestForCommit(repo, unknownSha), undefined);
			assert.equal(invalidated, 1, 'after it answered, a 404 is a commit without one');

			assert.equal(await integration.getPullRequestForCommit(repo, unknownSha), undefined);
			assert.equal(requested.length, 3, 'the cache holds the answer');
		} finally {
			manager.dispose();
		}
	});

	test("a repository's answer to one token does not make a 404 none for another token of the connection", async () => {
		const indexedSha = 'b'.repeat(40);
		const api = new BitbucketApi({
			fetch: input =>
				Promise.resolve(
					input.toString().includes(indexedSha)
						? json(200, { repo_indexed: true, type: 'paginated_pullrequests', values: [] })
						: json(404, { type: 'error', error: { message: 'Resource not found' } }),
				),
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		});
		const baseUrl = 'https://api.bitbucket.org/2.0';
		const answered = { ...bitbucketToken, connectionId: 'connection', accessToken: 'answered' };
		const replaced = { ...answered, accessToken: 'replaced' };

		await api.getPullRequestForCommit(bitbucketProvider, answered, 'ws', 'r', indexedSha, baseUrl);
		assert.equal(
			await api.getPullRequestForCommit(bitbucketProvider, answered, 'ws', 'r', sha, baseUrl),
			undefined,
		);

		await assert.rejects(api.getPullRequestForCommit(bitbucketProvider, replaced, 'ws', 'r', sha, baseUrl));
	});

	test('a repository whose links are not indexed yet is a failure that backs off the repository', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(json(200, { repo_indexed: false, type: 'paginated_pullrequests', values: [] }));
		};
		let invalidated = 0;
		runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
			loader({ invalidate: () => void invalidated++ } as never).value;
		const { manager, integration } = await connectedBitbucket(runtime);
		try {
			assert.equal(await integration.getPullRequestForCommit(repo, sha), undefined);
			assert.equal(invalidated, 1);
			assert.equal(await integration.getPullRequestForCommit(repo, 'b'.repeat(40)), undefined);
			assert.equal(requests, 1, 'another commit of the repository is not asked inside the backoff');
		} finally {
			manager.dispose();
		}
	});

	test('a commit refused because the commit links app is missing shows the notice, and is not kept', async () => {
		for (const status of [400, 404]) {
			const { pr, invalidated, links, strikes } = await lookUp(() =>
				json(status, { type: 'error', error: { message: 'Invalid or unknown installation' } }),
			);

			assert.equal(pr, undefined, String(status));
			assert.deepEqual(links, [`https://bitbucket.org/ws/r/commits/${sha}`], String(status));
			assert.equal(invalidated, 1, `${status}: answered again once the app is installed`);
			assert.equal(strikes, 0, `${status}: a missing app isn't a connection failure`);
		}
	});

	test('the commit links notice shows once per workspace, however many commits are refused', async () => {
		const runtime = createFakeRuntime();
		runtime.http.fetch = () =>
			Promise.resolve(json(400, { type: 'error', error: { message: 'Invalid or unknown installation' } }));
		runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
			loader({ invalidate: () => {} } as never).value;
		const links: string[] = [];
		runtime.hooks!.ui = { onBitbucketCommitLinksAppMissing: link => void links.push(link) };
		const { manager, integration } = await connectedBitbucket(runtime);
		try {
			await integration.getPullRequestForCommit(repo, sha);
			await integration.getPullRequestForCommit(repo, sha);
			await integration.getPullRequestForCommit(repo, 'b'.repeat(40));
			await integration.getPullRequestForCommit({ ...repo, owner: 'other' }, sha);

			assert.deepEqual(links, [
				`https://bitbucket.org/ws/r/commits/${sha}`,
				`https://bitbucket.org/other/r/commits/${sha}`,
			]);
		} finally {
			manager.dispose();
		}
	});
});

suite('BitbucketServerIntegration.getPullRequestForCommit', () => {
	const sha = 'a'.repeat(40);
	const repo = { key: 'PROJ/r', owner: 'PROJ', name: 'r' };

	function json(status: number, body: unknown): Response {
		return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
	}

	async function lookUps(responses: readonly (() => Response)[]): Promise<{
		invalidated: number[];
		strikes: number;
		expired: boolean | undefined;
	}> {
		const runtime = createFakeRuntime();
		let respond = responses[0];
		runtime.http.fetch = () => Promise.resolve(respond());
		let invalidated = 0;
		runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
			loader({ invalidate: () => void invalidated++ } as never).value;
		const { manager, integration } = await connectedBitbucketServer(runtime);
		try {
			const after: number[] = [];
			for (const response of responses) {
				advanceClock(failureBackoffMaxMs);
				respond = response;
				assert.equal(await integration.getPullRequestForCommit(repo, sha), undefined);
				after.push(invalidated);
			}
			const strikes = (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
			return { invalidated: after, strikes: strikes, expired: integration.connectionExpired };
		} finally {
			restoreClock();
			manager.dispose();
		}
	}

	test('a 503 or an answer without a list is not kept as a commit without one, while a 404 still answers none', async () => {
		const { invalidated } = await lookUps([
			() => json(503, { errors: [{ message: 'restarting' }] }),
			() => json(200, {}),
			() => json(200, { values: [] }),
			() => json(404, { errors: [{ message: 'Commit not found' }] }),
		]);

		assert.deepEqual(invalidated, [1, 2, 2, 2], 'the failures are dropped from the cache; the answers are kept');
	});

	test("a repository's refusal costs the connection nothing and is not kept", async () => {
		const forbidden = () => json(403, { errors: [{ message: 'You are not permitted to access this resource' }] });
		const { invalidated, strikes, expired } = await lookUps([forbidden, forbidden, forbidden]);

		assert.deepEqual(invalidated, [1, 2, 3]);
		assert.equal(strikes, 0);
		assert.notEqual(expired, true, 'the session is not expired');
	});
});
