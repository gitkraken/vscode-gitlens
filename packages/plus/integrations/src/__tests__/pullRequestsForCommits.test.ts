import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import { azureRestDiscoveryResponse, createAzurePullRequest } from '../providers/azure/__tests__/fixtures.js';
import { providerFanOutConcurrency } from '../providers/utils/providerPaging.js';
import { createFakeRuntime } from './fakeRuntime.js';
import {
	connectedAzure,
	connectedBitbucket,
	connectedBitbucketServer,
	connectedGitHub,
	connectedGitLab,
	watchRequestFailures,
} from './sweepHelpers.js';

/**
 * The pull-requests-by-commit read: for each of several commits of one repository, the pull request it belongs to.
 *
 * What these pin is the distinction the read exists for — a SHA the host ANSWERED has no pull request comes back as a
 * row without one (a resolved none a caller can cache), while a SHA whose read failed is not returned at all —
 * and the request cost: 25 SHAs per GitHub request, a window per Azure DevOps query, bounded concurrency everywhere
 * else, and no request past one the host answered with a rate limit, a refused credential or a missing app.
 */

/** The working tree's SHA: a resolved none, never sent. */
const uncommitted = '0'.repeat(40);

const sha = (n: number): string => `a${n.toString(16).padStart(39, '0')}`;
const shas = (count: number): string[] => Array.from({ length: count }, (_, i) => sha(i + 1));
/** The number of the pull request a test gives a SHA: its position in `shas()`. */
const numberOf = (s: string): number => parseInt(s.slice(1), 16);

function pullRequest(provider: ProviderReference, number: number): PullRequest {
	return Object.assign(
		new PullRequest(
			provider,
			{ id: 'octocat', name: 'octocat', username: 'octocat' },
			String(number),
			`PR_node${number}`,
			`PR ${number}`,
			`https://example.com/o/r/pull/${number}`,
			{ owner: 'o', repo: 'r' },
			'merged',
			new Date(0),
			new Date(0),
		),
		{ number: number },
	);
}

/** The integration's memoized API client, whose methods a test can replace. */
async function apiClient(
	integration: GitHostIntegration,
	key: 'github' | 'gitlab' | 'azure',
): Promise<Record<string, unknown>> {
	const { apis } = (
		integration as unknown as {
			authenticationService: { apis: Record<string, Promise<Record<string, unknown> | undefined>> };
		}
	).authenticationService;
	const client = await apis[key];
	assert.ok(client != null);
	return client;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

/** The strikes an integration has spent toward disconnecting itself. */
function strikes(integration: GitHostIntegration): number {
	return (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

type GitHubSlot = PromiseSettledResult<PullRequest | undefined>;

suite('IntegrationManager.getPullRequestsForCommits', () => {
	test('GitHub resolves up to 25 SHAs per request, and a SHA the host answered has none is a row without one', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const github = await apiClient(gh, 'github');
		const sizes: number[] = [];
		github.getPullRequestsForCommits = (
			provider: ProviderReference,
			_token: unknown,
			_owner: string,
			_repo: string,
			chunk: string[],
		): Promise<GitHubSlot[]> => {
			sizes.push(chunk.length);
			return Promise.resolve(
				chunk.map((s): GitHubSlot => ({
					status: 'fulfilled',
					value: s === sha(26) ? undefined : pullRequest(provider, numberOf(s)),
				})),
			);
		};

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: 'o',
			repo: 'r',
			shas: shas(26),
		});

		assert.deepEqual(sizes.toSorted(), [1, 25]);
		assert.deepEqual(
			result.items.map(i => i.sha),
			shas(26),
			'one row per SHA, in input order',
		);
		assert.equal(result.items[0].pullRequest?.number, 1);
		assert.equal(result.items[25].pullRequest, undefined);
		assert.ok(!('pullRequest' in result.items[25]), 'a resolved none carries no pullRequest key');
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);

		manager.dispose();
	});

	test('GitHub: a chunk that throws drops only its own SHAs, never reporting them as none', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const github = await apiClient(gh, 'github');
		github.getPullRequestsForCommits = (
			provider: ProviderReference,
			_token: unknown,
			_owner: string,
			_repo: string,
			chunk: string[],
		): Promise<GitHubSlot[]> => {
			// The second chunk (the 26th SHA, alone) fails; the first chunk of 25 must still answer.
			if (chunk.length === 1) return Promise.reject(new Error('second chunk exploded'));

			return Promise.resolve(
				chunk.map((s): GitHubSlot => ({ status: 'fulfilled', value: pullRequest(provider, numberOf(s)) })),
			);
		};

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: 'o',
			repo: 'r',
			shas: shas(26),
		});

		assert.deepEqual(
			result.items.map(i => i.sha),
			shas(25),
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.deepEqual(result.warnings[0].targetKeys, [sha(26)], "only the failed chunk's SHA is named");

		manager.dispose();
	});

	test('a non-GitHub host asks the single-commit read once per SHA, with bounded concurrency, and isolates a failing SHA', async () => {
		const { manager, gl } = await connectedGitLab(createFakeRuntime());
		const gitlab = await apiClient(gl, 'gitlab');
		// The batch settles the project once up front; the per-SHA reads are what this test counts.
		gitlab.getProjectId = (): Promise<string> => Promise.resolve('42');
		const asked: string[] = [];
		let inFlight = 0;
		let peak = 0;
		gitlab.getPullRequestForCommit = async (
			provider: ProviderReference,
			_token: unknown,
			owner: string,
			repo: string,
			rev: string,
		): Promise<PullRequest | undefined> => {
			assert.equal(`${owner}/${repo}`, 'group/sub/r', 'the namespace and repository reach the read as given');
			asked.push(rev);
			inFlight++;
			peak = Math.max(peak, inFlight);
			await Promise.resolve();
			await Promise.resolve();
			inFlight--;

			if (rev === sha(2)) throw new Error('boom');
			if (rev === sha(3)) return undefined;
			return pullRequest(provider, numberOf(rev));
		};

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitLab,
			owner: 'group/sub',
			repo: 'r',
			// The working tree's SHA is skipped, so it's neither asked nor failed.
			shas: [...shas(20), uncommitted],
		});

		assert.deepEqual(asked.toSorted(), shas(20).toSorted());
		assert.ok(
			peak > 1 && peak <= providerFanOutConcurrency,
			`peak concurrency ${peak} must be bounded by ${providerFanOutConcurrency}`,
		);
		const byShaRow = new Map(result.items.map(i => [i.sha, i]));
		assert.equal(byShaRow.get(sha(1))?.pullRequest?.number, 1);
		assert.ok(byShaRow.has(sha(3)) && byShaRow.get(sha(3))?.pullRequest == null, 'answered none is a row');
		assert.ok(
			byShaRow.has(uncommitted) && byShaRow.get(uncommitted)?.pullRequest == null,
			'the working tree is none',
		);
		assert.ok(!byShaRow.has(sha(2)), 'the failed SHA is dropped, not reported as none');
		assert.equal(result.items.length, 20);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.warnings[0].targetKeys, [sha(2)]);

		manager.dispose();
	});

	test('Azure DevOps reads the project-qualified repository, and refuses a call that names no project', async () => {
		const { manager, azure } = await connectedAzure(createFakeRuntime());
		const client = await apiClient(azure, 'azure');
		const reads: string[] = [];
		client.getPullRequestsForCommits = (
			provider: ProviderReference,
			_token: unknown,
			owner: string,
			repoName: string,
			revs: string[],
		): Promise<GitHubSlot[]> => {
			reads.push(`${owner}|${repoName}|${revs.join(',')}`);
			return Promise.resolve(
				revs.map((): GitHubSlot => ({ status: 'fulfilled', value: pullRequest(provider, 7) })),
			);
		};

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			owner: 'org',
			repo: 'r',
			project: 'proj',
			shas: [sha(1)],
		});
		assert.deepEqual(reads, [`org|proj/_git/r|${sha(1)}`]);
		assert.equal(result.items[0].pullRequest?.number, 7);

		for (const project of [undefined, ' ']) {
			const refused = await manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				owner: 'org',
				repo: 'r',
				project: project,
				shas: [sha(1)],
			});
			assert.deepEqual(refused.items, []);
			assert.equal(refused.fetchFailed, true);
			assert.match(refused.warnings[0].message, /requires a project/);
		}
		assert.equal(reads.length, 1, 'a refused call reads nothing');

		manager.dispose();
	});

	test('resolves a repeated SHA once, and refuses an issue tracker or an empty repository', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const github = await apiClient(gh, 'github');
		const seen: string[][] = [];
		github.getPullRequestsForCommits = (
			_provider: ProviderReference,
			_token: unknown,
			_owner: string,
			_repo: string,
			chunk: string[],
		): Promise<GitHubSlot[]> => {
			seen.push([...chunk]);
			return Promise.resolve(chunk.map((): GitHubSlot => ({ status: 'fulfilled', value: undefined })));
		};

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: ' o ',
			repo: 'r',
			shas: [sha(1), ` ${sha(1).toUpperCase()}`, sha(2)],
		});
		assert.deepEqual(seen, [[sha(1), sha(2)]]);
		assert.deepEqual(
			result.items.map(i => i.sha),
			[sha(1), sha(2)],
		);

		const tracker = await manager.getPullRequestsForCommits({
			providerId: IssuesCloudHostIntegrationId.Jira,
			owner: 'o',
			repo: 'r',
			shas: [sha(1)],
		});
		assert.equal(tracker.fetchFailed, true);
		assert.deepEqual(tracker.items, []);

		const empty = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: '',
			repo: 'r',
			shas: [sha(1)],
		});
		assert.equal(empty.fetchFailed, true);
		assert.equal(seen.length, 1, 'refused calls read nothing');

		manager.dispose();
	});

	test('an uppercase SHA is asked in lowercase and answered under the spelling it was passed in', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const github = await apiClient(gh, 'github');
		const seen: string[] = [];
		github.getPullRequestsForCommits = (
			provider: ProviderReference,
			_token: unknown,
			_owner: string,
			_repo: string,
			chunk: string[],
		): Promise<GitHubSlot[]> => {
			seen.push(...chunk);
			return Promise.resolve(
				chunk.map((s): GitHubSlot => ({ status: 'fulfilled', value: pullRequest(provider, numberOf(s)) })),
			);
		};

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: 'o',
			repo: 'r',
			shas: [sha(3).toUpperCase()],
		});

		assert.deepEqual(seen, [sha(3)]);
		assert.deepEqual(
			result.items.map(i => [i.sha, i.pullRequest?.number]),
			[[sha(3).toUpperCase(), 3]],
		);

		manager.dispose();
	});

	test('GitLab: SHAs whose requests fail with 500 are dropped, with one notice and no strike per SHA', async () => {
		const runtime = createFakeRuntime();
		runtime.http.fetch = input => {
			const url = input.toString();
			if (url.endsWith('/graphql')) {
				return Promise.resolve(json(200, { data: { project: { id: 'gid://gitlab/Project/42' } } }));
			}
			return Promise.resolve(url.includes(sha(1)) ? json(200, []) : json(500, { message: 'boom' }));
		};
		const { manager, gl } = await connectedGitLab(runtime);
		const watched = watchRequestFailures(runtime);

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitLab,
			owner: 'group',
			repo: 'r',
			shas: shas(7),
		});

		assert.deepEqual(
			result.items.map(i => i.sha),
			[sha(1)],
		);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.warnings[0]?.targetKeys?.toSorted(), shas(7).slice(1).toSorted());
		assert.equal(strikes(gl), 0, 'a call that answered some SHAs spends no strike');
		assert.equal(watched.notices.length, 1, 'one notice for the whole call');
		assert.equal(watched.disconnected, undefined);

		manager.dispose();
	});

	test('GitLab: a failed project lookup fails the call rather than answering every SHA none, and is asked again', async () => {
		const runtime = createFakeRuntime();
		let lookups = 0;
		let projectAnswers = false;
		runtime.http.fetch = input => {
			const url = input.toString();
			if (url.endsWith('/graphql')) {
				lookups++;
				return Promise.resolve(
					projectAnswers
						? json(200, { data: { project: { id: 'gid://gitlab/Project/42' } } })
						: json(500, { message: 'boom' }),
				);
			}
			return Promise.resolve(json(200, []));
		};
		const { manager } = await connectedGitLab(runtime);
		const read = () =>
			manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.GitLab,
				owner: 'group',
				repo: 'r',
				shas: shas(8),
			});

		const failed = await read();
		assert.deepEqual(failed.items, [], 'no SHA reads as a resolved none');
		assert.equal(failed.fetchFailed, true);
		assert.equal(lookups, 1, 'the project is looked up once for the whole call');

		projectAnswers = true;
		const answered = await read();
		assert.equal(lookups, 2, 'the failed lookup was not kept');
		assert.deepEqual(
			answered.items.map(i => i.sha),
			shas(8),
		);
		assert.equal(answered.fetchFailed, undefined);

		manager.dispose();
	});

	test('GitLab: concurrent calls sharing a failed project lookup send it once, for one notice and one strike', async () => {
		const runtime = createFakeRuntime();
		let lookups = 0;
		let answer!: () => void;
		const answered = new Promise<void>(resolve => (answer = resolve));
		runtime.http.fetch = async input => {
			if (!input.toString().endsWith('/graphql')) return json(200, []);

			lookups++;
			await answered;
			return json(500, { message: 'boom' });
		};
		const { manager, gl } = await connectedGitLab(runtime);
		const watched = watchRequestFailures(runtime);

		const reads = Array.from({ length: 4 }, () =>
			manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.GitLab,
				owner: 'group',
				repo: 'r',
				shas: shas(3),
			}),
		);
		await new Promise(resolve => setImmediate(resolve));
		answer();
		const results = await Promise.all(reads);

		assert.equal(lookups, 1, 'the calls share one lookup');
		assert.ok(results.every(r => r.items.length === 0 && r.fetchFailed === true));
		assert.equal(watched.notices.length, 1);
		assert.equal(strikes(gl), 1);

		manager.dispose();
	});

	test('Azure DevOps queries a window of commits at once and reads each pull request it finds once', async () => {
		const runtime = createFakeRuntime();
		const queried: string[][] = [];
		const read: string[] = [];
		runtime.http.fetch = (input, init) => {
			const discovery = azureRestDiscoveryResponse(input);
			if (discovery != null) return Promise.resolve(discovery);

			const url = new URL(input.toString());
			if (!url.pathname.toLowerCase().endsWith('/pullrequestquery')) {
				read.push(url.pathname);
				return Promise.resolve(json(200, createAzurePullRequest(url.href, 'proj', 'r')));
			}

			const body = typeof init?.body === 'string' ? init.body : '{}';
			const items = (JSON.parse(body) as { queries: { items: string[] }[] }).queries[0].items;
			queried.push(items);
			// The second window fails as a whole; in the first, odd commits share pull request 5 and the rest have none.
			if (items.includes(sha(101))) return Promise.resolve(json(500, { message: 'boom' }));

			return Promise.resolve(
				json(200, {
					results: [
						Object.fromEntries(
							items.map(rev => [
								rev,
								numberOf(rev) % 2 === 1
									? [{ pullRequestId: 5, repository: { id: 'repo-id', project: { id: 'proj-id' } } }]
									: [],
							]),
						),
					],
				}),
			);
		};
		const { manager, azure } = await connectedAzure(runtime);
		const watched = watchRequestFailures(runtime);
		const many = Array.from({ length: 102 }, (_, i) => sha(i + 1));

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			owner: 'org',
			repo: 'r',
			project: 'proj',
			shas: many,
		});

		assert.deepEqual(
			queried.map(items => items.length).toSorted((a, b) => a - b),
			[2, 100],
			'one query per window of up to 100 commits',
		);
		assert.equal(read.length, 1, 'the pull request five commits share is read once');
		assert.deepEqual(
			result.items.map(i => i.sha),
			many.slice(0, 100),
			"the failed window's SHAs are dropped, never reported as none",
		);
		assert.equal(result.items[0].pullRequest?.id, '5');
		assert.equal(result.items[1].pullRequest, undefined, 'a commit the query answered without one is none');
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.warnings[0]?.targetKeys, many.slice(100));
		assert.equal(strikes(azure), 0);
		assert.equal(watched.notices.length, 1, 'one notice for the whole call');

		manager.dispose();
	});

	test('Bitbucket Cloud without the commit links app: the call stops at the first answer and fails naming the app', async () => {
		for (const status of [400, 404]) {
			const runtime = createFakeRuntime();
			let requests = 0;
			runtime.http.fetch = () => {
				requests++;
				return Promise.resolve(
					json(status, { type: 'error', error: { message: 'Invalid or unknown installation' } }),
				);
			};
			const watched = watchRequestFailures(runtime);
			const links: string[] = [];
			runtime.hooks!.ui = {
				...runtime.hooks!.ui,
				onBitbucketCommitLinksAppMissing: link => void links.push(link),
			};
			const { manager, integration } = await connectedBitbucket(runtime);

			const result = await manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				owner: 'ws',
				repo: 'r',
				shas: shas(20),
			});

			assert.deepEqual(result.items, [], `${status}: unread until the app is installed, never a resolved none`);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1, `${status}: one warning`);
			assert.match(result.warnings[0].message, /pull request commit links app/);
			assert.ok(
				requests <= providerFanOutConcurrency,
				`${status}: ${requests} requests; none is sent after the first answer`,
			);
			assert.equal(links.length, 1, `${status}: the notice shows once`);
			assert.match(links[0], /^https:\/\/bitbucket\.org\/ws\/r\/commits\/a[0-9a-f]{39}$/);
			assert.equal(strikes(integration), 0, `${status}: a missing app isn't a connection failure`);
			assert.equal(watched.disconnected, undefined);

			await manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				owner: 'ws',
				repo: 'r',
				shas: shas(20),
			});
			assert.equal(links.length, 1, `${status}: a second call doesn't show the notice again`);

			manager.dispose();
		}
	});

	test('a rate limit stops the fan-out: the SHAs not yet sent fail with it, under one warning', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = input => {
			requests++;
			// The first request answers; every one after it is throttled.
			return Promise.resolve(
				input.toString().includes(sha(1))
					? json(200, { values: [] })
					: json(429, {
							type: 'error',
							error: { message: 'Rate limit for this resource has been exceeded' },
						}),
			);
		};
		const { manager, integration } = await connectedBitbucket(runtime);

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			owner: 'ws',
			repo: 'r',
			shas: shas(30),
		});

		assert.ok(requests <= providerFanOutConcurrency + 1, `${requests} requests for 30 SHAs`);
		assert.deepEqual(
			result.items.map(i => i.sha),
			[sha(1)],
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'rate-limit');
		assert.deepEqual(result.warnings[0].targetKeys?.toSorted(), shas(30).slice(1).toSorted());
		assert.equal(strikes(integration), 0);

		manager.dispose();
	});

	test("a repository refusing the call's first answer stops the fan-out; one refusing after an answer doesn't", async () => {
		const runtime = createFakeRuntime();
		let answering = new Set<string>();
		let requests = 0;
		runtime.http.fetch = input => {
			const url = input.toString();
			if (!url.includes('/commit/')) {
				return Promise.resolve(json(200, { uuid: '{me}', account_id: 'me', display_name: 'Me' }));
			}

			requests++;
			return Promise.resolve(
				[...answering].some(s => url.includes(s))
					? json(200, { values: [] })
					: json(403, { type: 'error', error: { message: 'Access denied' } }),
			);
		};
		const { manager, integration } = await connectedBitbucket(runtime);
		const read = () =>
			manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				owner: 'ws',
				repo: 'r',
				shas: shas(30),
			});

		const refused = await read();

		assert.ok(requests <= providerFanOutConcurrency, `${requests} requests for 30 SHAs`);
		assert.deepEqual(refused.items, []);
		assert.equal(refused.fetchFailed, true);
		assert.equal(refused.warnings.length, 1);
		assert.equal(refused.warnings[0].kind, 'auth');
		assert.ok(refused.warnings[0].scope != null, "the repository's refusal, not the credential's");
		assert.deepEqual(refused.warnings[0].targetKeys?.toSorted(), shas(30).toSorted());
		assert.equal(strikes(integration), 0);

		answering = new Set(shas(providerFanOutConcurrency));
		requests = 0;
		const partly = await read();

		assert.equal(requests, 30, "a refusal after an answer is that commit's own");
		assert.deepEqual(
			partly.items.map(i => i.sha),
			[...answering],
		);
		assert.equal(partly.warnings.length, 1);
		assert.ok(partly.warnings[0].scope != null);
		assert.equal(partly.warnings[0].targetKeys?.length, 30 - providerFanOutConcurrency);

		manager.dispose();
	});

	test('a credential refused after some SHAs answered fails the rest as the credential, through its recovery once', async () => {
		const runtime = createFakeRuntime();
		const answering = new Set(shas(providerFanOutConcurrency));
		runtime.http.fetch = input => {
			const url = input.toString();
			return Promise.resolve(
				[...answering].some(s => url.includes(s))
					? json(200, { values: [] })
					: json(401, { type: 'error', error: { message: 'Unauthorized' } }),
			);
		};
		const { manager, integration } = await connectedBitbucket(runtime);
		(integration as unknown as { requestExceptionCount: number }).requestExceptionCount = 2;

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			owner: 'ws',
			repo: 'r',
			shas: shas(30),
		});

		assert.deepEqual(
			result.items.map(i => i.sha),
			[...answering],
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'auth');
		assert.equal(result.warnings[0].scope, undefined, "the credential's failure, not the repository's");
		assert.deepEqual(
			result.warnings[0].targetKeys?.toSorted(),
			shas(30).slice(providerFanOutConcurrency).toSorted(),
		);
		assert.equal(integration.connectionExpired, true, 'the refused credential expires the session');
		assert.equal(strikes(integration), 2, 'the budget is not reset, and a second handling would spend a strike');

		manager.dispose();
	});

	test('Bitbucket Cloud: every SHA answering 404 is asked, and each fails rather than reading as none', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(json(404, { type: 'error', error: { message: 'Resource not found' } }));
		};
		const { manager, integration } = await connectedBitbucket(runtime);

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			owner: 'ws',
			repo: 'r',
			shas: shas(30),
		});

		assert.equal(requests, 30, 'a 404 stops nothing: the repository may hold the other commits');
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(strikes(integration), 0);

		manager.dispose();
	});

	test('Bitbucket Cloud: once a commit answered, the commits it answers 404 for are none, whatever settled first', async () => {
		const runtime = createFakeRuntime();
		const unknown = new Set(shas(providerFanOutConcurrency));
		let requests = 0;
		runtime.http.fetch = input => {
			const url = input.toString();
			requests++;
			return Promise.resolve(
				[...unknown].some(s => url.includes(s))
					? json(404, { type: 'error', error: { message: 'Resource not found' } })
					: json(200, { repo_indexed: true, type: 'paginated_pullrequests', values: [] }),
			);
		};
		const { manager } = await connectedBitbucket(runtime);

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			owner: 'ws',
			repo: 'r',
			shas: shas(30),
		});

		assert.equal(requests, 30);
		assert.deepEqual(
			result.items.map(i => i.sha),
			shas(30),
		);
		assert.ok(
			result.items.every(i => !('pullRequest' in i)),
			'the unknown commits are resolved nones',
		);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('Bitbucket Cloud: a repository whose links are not indexed yet stops the call, and is never none', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(json(200, { repo_indexed: false, type: 'paginated_pullrequests', values: [] }));
		};
		const { manager } = await connectedBitbucket(runtime);

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			owner: 'ws',
			repo: 'r',
			shas: shas(30),
		});

		assert.ok(requests <= providerFanOutConcurrency, `${requests} requests for 30 SHAs`);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);

		manager.dispose();
	});

	test('a host whose client failed to construct fails the call rather than reading as unsupported', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const { apis } = (gh as unknown as { authenticationService: { apis: object } }).authenticationService;
		Object.defineProperty(apis, 'github', { get: () => Promise.resolve(undefined) });

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: 'o',
			repo: 'r',
			shas: shas(2),
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.notEqual(result.warnings[0].kind, 'unsupported');

		manager.dispose();
	});

	test('GitHub: a rate-limited chunk stops the chunks not yet sent', async () => {
		const runtime = createFakeRuntime();
		let sent = 0;
		// GitHub answers an exhausted GraphQL limit with 200 and a `RATE_LIMITED` error.
		runtime.http.fetch = () => {
			sent++;
			return Promise.resolve(
				json(200, {
					data: null,
					errors: [{ type: 'RATE_LIMITED', message: 'API rate limit already exceeded for user ID 1.' }],
				}),
			);
		};
		const { manager, gh } = await connectedGitHub(runtime);
		const many = Array.from({ length: 25 * 8 }, (_, i) => sha(i + 1));

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: 'o',
			repo: 'r',
			shas: many,
		});

		assert.ok(sent <= providerFanOutConcurrency, `${sent} of 8 chunks sent`);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'rate-limit');
		assert.equal(strikes(gh), 0);

		manager.dispose();
	});

	test('GitHub: a repository refusing the token stops the chunks not yet sent, under its own auth warning', async () => {
		const runtime = createFakeRuntime();
		let prompts = 0;
		runtime.hooks!.onReauthenticationRequired = () => {
			prompts++;
			return Promise.resolve(false);
		};
		let sent = 0;
		runtime.http.fetch = (_input, init) => {
			const body = typeof init?.body === 'string' ? init.body : '';
			if (!body.includes('getPullRequestsForCommits')) {
				return Promise.resolve(json(200, { data: { viewer: { login: 'me', id: 'U_me' } } }));
			}

			sent++;
			return Promise.resolve(
				json(200, {
					data: { repository: null },
					errors: [
						{
							type: 'FORBIDDEN',
							path: ['repository'],
							message: 'Resource protected by organization SAML enforcement.',
						},
					],
				}),
			);
		};
		const { manager, gh } = await connectedGitHub(runtime);
		const many = Array.from({ length: 25 * 8 }, (_, i) => sha(i + 1));

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: 'o',
			repo: 'r',
			shas: many,
		});

		assert.ok(sent <= providerFanOutConcurrency, `${sent} of 8 chunks sent`);
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => ({ kind: w.kind, scope: w.scope })),
			[{ kind: 'auth', scope: { repositoryId: 'o/r' } }],
		);
		assert.match(result.warnings[0].message, /Resource protected by organization SAML enforcement\./);
		assert.equal(strikes(gh), 0);
		assert.equal(prompts, 0, 'the warning asks for access, not a prompt per request');

		manager.dispose();
	});

	test('refuses the whole call when a SHA is not a full commit SHA, and never sends the working tree', async () => {
		const { manager, gh } = await connectedGitHub(createFakeRuntime());
		const github = await apiClient(gh, 'github');
		const seen: string[][] = [];
		github.getPullRequestsForCommits = (
			_provider: ProviderReference,
			_token: unknown,
			_owner: string,
			_repo: string,
			chunk: string[],
		): Promise<GitHubSlot[]> => {
			seen.push([...chunk]);
			return Promise.resolve(chunk.map((): GitHubSlot => ({ status: 'fulfilled', value: undefined })));
		};

		for (const bad of ['main', sha(1).slice(0, 7), `${sha(1)}0`, `${uncommitted}:`, `${sha(1).slice(0, 39)}g`]) {
			const refused = await manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.GitHub,
				owner: 'o',
				repo: 'r',
				shas: [sha(2), bad],
			});
			assert.deepEqual(refused.items, [], bad);
			assert.equal(refused.fetchFailed, true, bad);
			assert.equal(refused.warnings.length, 1, bad);
			assert.equal(refused.warnings[0].kind, 'other', bad);
			assert.ok(refused.warnings[0].message.includes(`'${bad}'`), refused.warnings[0].message);
		}
		assert.deepEqual(seen, [], 'a refused call reads nothing');

		const answered = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitHub,
			owner: 'o',
			repo: 'r',
			shas: [uncommitted, sha(2)],
		});
		assert.deepEqual(seen, [[sha(2)]], 'the working tree is never sent');
		assert.deepEqual(answered.items, [{ sha: uncommitted }, { sha: sha(2) }]);
		assert.equal(answered.fetchFailed, undefined);

		manager.dispose();
	});

	test('a cancelled call rejects with the cancellation and sends nothing more', async () => {
		const runtime = createFakeRuntime();
		const controller = new AbortController();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			controller.abort();
			return Promise.resolve(json(200, { values: [] }));
		};
		const { manager } = await connectedBitbucket(runtime);
		const read = (cancellation: AbortSignal) =>
			manager.getPullRequestsForCommits({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				owner: 'ws',
				repo: 'r',
				shas: shas(30),
				cancellation: cancellation,
			});

		await assert.rejects(read(controller.signal), (ex: unknown) => isCancellationError(ex));
		assert.ok(requests <= providerFanOutConcurrency, `${requests} requests for 30 SHAs`);

		requests = 0;
		await assert.rejects(read(AbortSignal.abort()), (ex: unknown) => isCancellationError(ex));
		assert.equal(requests, 0, 'an already cancelled call sends nothing');

		manager.dispose();
	});

	test('Bitbucket drops a SHA whose request failed, where the single-commit read would answer none', async () => {
		// The single-commit lookup swallows a failed request into `undefined`, which here would publish a 500 as a
		// commit with no pull request. An empty answer is a resolved none, and so is a missing commit (404) of a
		// repository that answered.
		const answer = (url: string): Response => {
			if (url.includes(sha(2))) return json(500, { error: 'boom' });
			if (url.includes(sha(3))) return json(404, { error: 'not found' });
			return json(200, { values: [] });
		};

		for (const host of ['cloud', 'server'] as const) {
			const runtime = createFakeRuntime();
			const requested: string[] = [];
			runtime.http.fetch = input => {
				const url = input.toString();
				requested.push(url);
				return Promise.resolve(answer(url));
			};
			const { manager } =
				host === 'cloud' ? await connectedBitbucket(runtime) : await connectedBitbucketServer(runtime);

			const result = await manager.getPullRequestsForCommits({
				providerId:
					host === 'cloud'
						? GitCloudHostIntegrationId.Bitbucket
						: GitSelfManagedHostIntegrationId.BitbucketServer,
				owner: 'ws',
				repo: 'r',
				shas: shas(3),
			});

			assert.equal(requested.length, 3, `${host}: one request per SHA`);
			assert.deepEqual(
				result.items.map(i => i.sha),
				[sha(1), sha(3)],
				`${host}: the failed SHA is dropped, the empty and the missing ones are resolved nones`,
			);
			assert.ok(result.items.every(i => i.pullRequest == null));
			assert.equal(result.fetchFailed, true, host);
			assert.deepEqual(result.warnings[0]?.targetKeys, [sha(2)], host);

			manager.dispose();
		}
	});

	test('a SHA that is never sent does not count as an answer: every sent SHA failing fails the call, with its strike', async () => {
		const runtime = createFakeRuntime();
		runtime.http.fetch = () => Promise.resolve(json(500, { error: 'boom' }));
		const { manager, integration } = await connectedBitbucket(runtime);
		const watched = watchRequestFailures(runtime);

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			owner: 'ws',
			repo: 'r',
			shas: [sha(1), sha(2), uncommitted],
		});

		assert.deepEqual(result.items, [], 'a failed call answers no SHA, not even the one it never asked about');
		assert.equal(result.fetchFailed, true);
		assert.equal(strikes(integration), 1, 'the wholly failed call spends its strike');
		assert.equal(watched.notices.length, 1);

		manager.dispose();
	});

	test('GitLab: a credential refused on the per-commit reads is not a re-authentication prompt per SHA', async () => {
		const runtime = createFakeRuntime();
		let prompts = 0;
		runtime.hooks!.onReauthenticationRequired = () => {
			prompts++;
			return Promise.resolve(false);
		};
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(json(401, { message: '401 Unauthorized' }));
		};
		const { manager, gl } = await connectedGitLab(runtime);
		// The project id was kept from before the credential was refused, so only the per-commit reads meet it.
		const gitlab = await apiClient(gl, 'gitlab');
		gitlab.getProjectId = (): Promise<string> => Promise.resolve('42');

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitLab,
			owner: 'group',
			repo: 'r',
			shas: shas(20),
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.ok(prompts <= 1, `${prompts} prompts for one call`);
		assert.ok(
			requests <= providerFanOutConcurrency,
			`${requests} requests for 20 SHAs; none is sent after the credential is refused`,
		);

		manager.dispose();
	});

	test("GitLab: a credential refused on the call's project lookup is not a re-authentication prompt", async () => {
		const runtime = createFakeRuntime();
		let prompts = 0;
		runtime.hooks!.onReauthenticationRequired = () => {
			prompts++;
			return Promise.resolve(false);
		};
		runtime.http.fetch = () => Promise.resolve(json(401, { message: '401 Unauthorized' }));
		const { manager } = await connectedGitLab(runtime);

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.GitLab,
			owner: 'group',
			repo: 'r',
			shas: shas(3),
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(prompts, 0);

		manager.dispose();
	});

	test('Azure DevOps drops a SHA whose found pull request could not be read, even on a 404', async () => {
		const runtime = createFakeRuntime();
		runtime.http.fetch = (input, init) => {
			const discovery = azureRestDiscoveryResponse(input);
			if (discovery != null) return Promise.resolve(discovery);

			const url = new URL(input.toString());
			if (!url.pathname.toLowerCase().endsWith('/pullrequestquery')) {
				return Promise.resolve(json(404, { message: 'TF401180: The requested pull request was not found.' }));
			}

			const body = typeof init?.body === 'string' ? init.body : '{}';
			const [rev] = (JSON.parse(body) as { queries: { items: string[] }[] }).queries[0].items;
			return Promise.resolve(
				json(200, {
					results: [
						{ [rev]: [{ pullRequestId: 5, repository: { id: 'repo-id', project: { id: 'proj-id' } } }] },
					],
				}),
			);
		};
		const { manager } = await connectedAzure(runtime);

		const result = await manager.getPullRequestsForCommits({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			owner: 'org',
			repo: 'r',
			project: 'proj',
			shas: [sha(1)],
		});

		assert.deepEqual(result.items, [], 'the query found a pull request, so this is unread, not a resolved none');
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});
});
