import * as assert from 'node:assert/strict';
import { suite, teardown, test } from 'mocha';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import { FailureBackoff, failureBackoffInitialMs, failureBackoffMaxMs } from '../utils/failureBackoff.js';
import { advanceClock, restoreClock } from './clock.js';
import { createFakeRuntime } from './fakeRuntime.js';
import {
	connectedBitbucket,
	connectedBitbucketServer,
	connectedGitHub,
	connectedGitLab,
	watchRequestFailures,
} from './sweepHelpers.js';

const sha = (n: number): string => `a${n.toString(16).padStart(39, '0')}`;

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

function strikes(integration: GitHostIntegration): number {
	return (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

function bypassCache(runtime: ReturnType<typeof createFakeRuntime>): void {
	runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
		loader({ invalidate: () => {} } as never).value;
}

suite('FailureBackoff', () => {
	test('doubles the wait of consecutive failures up to the cap, and a success starts it over', () => {
		const backoff = new FailureBackoff();
		let now = 0;
		const waits: number[] = [];
		for (let i = 0; i < 7; i++) {
			const until = backoff.fail('k', now);
			waits.push(until - now);
			assert.ok(backoff.isBackedOff('k', until - 1));
			assert.ok(!backoff.isBackedOff('k', until));
			now = until;
		}

		assert.deepEqual(
			waits,
			[1, 2, 4, 8, 16, 20, 20].map(n => n * failureBackoffInitialMs),
		);
		assert.equal(waits.at(-1), failureBackoffMaxMs);

		backoff.clear('k');
		assert.equal(backoff.fail('k', now) - now, failureBackoffInitialMs);
		assert.equal(backoff.fail('reset', now, now + 5), now + 5, "a rate limit's reset time wins");
	});

	test('failures inside a window count once, and only a later reset time extends it', () => {
		const backoff = new FailureBackoff();
		for (let i = 0; i < 6; i++) {
			assert.equal(backoff.fail('k', 0), failureBackoffInitialMs);
		}
		assert.equal(backoff.fail('k', 1, 5), failureBackoffInitialMs);
		assert.equal(backoff.fail('k', 1, 2 * failureBackoffInitialMs), 2 * failureBackoffInitialMs);

		const next = 2 * failureBackoffInitialMs;
		assert.equal(backoff.fail('k', next) - next, 2 * failureBackoffInitialMs, 'counted as the second failure');
	});
});

suite('GitHostIntegration.getPullRequestForCommit backoff', () => {
	teardown(() => restoreClock());

	const repo = { key: 'ws/r', owner: 'ws', name: 'r' };

	test('Bitbucket Cloud: a commit it answers 404 for is not asked again until its backoff passes', async () => {
		const runtime = createFakeRuntime();
		const requested: string[] = [];
		runtime.http.fetch = input => {
			requested.push(input.toString());
			return Promise.resolve(json(404, { type: 'error', error: { message: 'Commit not found' } }));
		};
		bypassCache(runtime);
		const { manager, integration } = await connectedBitbucket(runtime);
		try {
			await integration.getPullRequestForCommit(repo, sha(1));
			await integration.getPullRequestForCommit(repo, sha(1));
			assert.equal(requested.length, 1, 'the same commit inside its backoff sends nothing');

			await integration.getPullRequestForCommit(repo, sha(2));
			assert.equal(requested.length, 2, 'another commit of the repository is still asked');

			advanceClock(failureBackoffInitialMs);
			await integration.getPullRequestForCommit(repo, sha(1));
			assert.equal(requested.length, 3, 'asked again once its backoff passed');
		} finally {
			manager.dispose();
		}
	});

	test('Bitbucket Data Center: a server error backs off its repository, for one strike and one notice', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(json(500, { errors: [{ message: 'boom' }] }));
		};
		bypassCache(runtime);
		const { manager, integration } = await connectedBitbucketServer(runtime);
		const watched = watchRequestFailures(runtime);
		try {
			for (let i = 1; i <= 4; i++) {
				assert.equal(await integration.getPullRequestForCommit({ ...repo, owner: 'PROJ' }, sha(i)), undefined);
			}

			assert.equal(requests, 1);
			assert.equal(strikes(integration), 1);
			assert.equal(watched.notices.length, 1);
		} finally {
			manager.dispose();
		}
	});

	test('GitLab: an outage of the project lookup is asked once per backoff by every read of the project', async () => {
		const runtime = createFakeRuntime();
		let lookups = 0;
		let reads = 0;
		runtime.http.fetch = input => {
			if (input.toString().endsWith('/graphql')) {
				lookups++;
				return Promise.resolve(json(500, { message: 'boom' }));
			}

			reads++;
			return Promise.resolve(json(200, []));
		};
		bypassCache(runtime);
		const { manager, gl } = await connectedGitLab(runtime);
		const watched = watchRequestFailures(runtime);
		const project = { key: 'group/r', owner: 'group', name: 'r' };
		try {
			await gl.getPullRequestForCommit(project, sha(1));
			await gl.getPullRequestForCommit(project, sha(2));
			assert.equal(strikes(gl), 1);
			assert.equal(await gl.getAccountForCommit(project, sha(3)), undefined);

			assert.equal(lookups, 1);
			assert.equal(reads, 0);
			assert.equal(watched.notices.length, 1);

			advanceClock(failureBackoffInitialMs);
			await gl.getPullRequestForCommit(project, sha(4));
			assert.equal(lookups, 2, 'the lookup is tried again once its backoff passed');
		} finally {
			manager.dispose();
		}
	});

	test("GitLab: a refused project lookup holds the reads that swallow it, but not the commit lookup's recovery", async () => {
		const runtime = createFakeRuntime();
		let lookups = 0;
		runtime.http.fetch = input => {
			if (input.toString().endsWith('/graphql')) {
				lookups++;
			}
			return Promise.resolve(json(401, { message: '401 Unauthorized' }));
		};
		bypassCache(runtime);
		const { manager, gl } = await connectedGitLab(runtime);
		const project = { key: 'group/r', owner: 'group', name: 'r' };
		try {
			for (let i = 1; i <= 3; i++) {
				assert.equal(await gl.getAccountForCommit(project, sha(i)), undefined);
			}
			assert.equal(lookups, 1);

			await gl.getPullRequestForCommit(project, sha(4));
			assert.equal(lookups, 2, 'the commit lookup still asks');
			assert.equal(gl.connectionExpired, true, 'and its refusal reaches the session recovery');
		} finally {
			manager.dispose();
		}
	});

	test('a client that failed to construct backs off the repository, not each commit', async () => {
		const runtime = createFakeRuntime();
		bypassCache(runtime);
		const { manager, gh } = await connectedGitHub(runtime);
		let reached = 0;
		const { apis } = (gh as unknown as { authenticationService: { apis: object } }).authenticationService;
		Object.defineProperty(apis, 'github', {
			get: () => {
				reached++;
				return Promise.resolve(undefined);
			},
		});
		try {
			for (let i = 1; i <= 3; i++) {
				assert.equal(await gh.getPullRequestForCommit({ ...repo, owner: 'o' }, sha(i)), undefined);
			}

			assert.equal(reached, 1);
		} finally {
			manager.dispose();
		}
	});

	test('a refused credential and a cancellation are not backed off, while a timeout backs off the repository', async () => {
		const runtime = createFakeRuntime();
		let respond: () => Promise<Response> = () => Promise.resolve(json(401, { error: { message: 'Unauthorized' } }));
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return respond();
		};
		bypassCache(runtime);
		const { manager, integration } = await connectedBitbucket(runtime);
		const session = (integration as unknown as { _session: ProviderAuthenticationSession })._session;
		(integration as unknown as { _session: ProviderAuthenticationSession })._session = { ...session, cloud: false };
		try {
			await integration.getPullRequestForCommit(repo, sha(1));
			respond = () => Promise.resolve(json(200, { values: [] }));
			await integration.getPullRequestForCommit(repo, sha(1));
			assert.equal(requests, 2, 'a 401 is left to the credential recovery');

			respond = () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
			await integration.getPullRequestForCommit(repo, sha(2));
			await integration.getPullRequestForCommit(repo, sha(2));
			assert.equal(requests, 4);

			respond = () => Promise.reject(new CancellationError());
			await integration.getPullRequestForCommit(repo, sha(3));
			await integration.getPullRequestForCommit(repo, sha(3));
			assert.equal(requests, 6);

			const struck = strikes(integration);
			respond = () => Promise.reject(new CancellationError(new Error('Timed out'), 'timeout'));
			await integration.getPullRequestForCommit(repo, sha(4));
			await integration.getPullRequestForCommit(repo, sha(5));
			assert.equal(requests, 7, 'a timeout holds every commit of the repository');
			assert.equal(strikes(integration), struck);
		} finally {
			manager.dispose();
		}
	});

	test('a fresh read, another credential and a reset of the connection are not held by a backoff', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(json(404, { type: 'error', error: { message: 'Commit not found' } }));
		};
		bypassCache(runtime);
		const { manager, integration } = await connectedBitbucket(runtime);
		const session = (integration as unknown as { _session: ProviderAuthenticationSession })._session;
		try {
			await integration.getPullRequestForCommit(repo, sha(1));
			await integration.getPullRequestForCommit(repo, sha(1), { expiryOverride: true });
			assert.equal(requests, 2, 'a fresh read bypasses the backoff');

			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...session,
				accessToken: 'another',
			};
			await integration.getPullRequestForCommit(repo, sha(1));
			assert.equal(requests, 3, 'another credential inherits no backoff');

			integration.resetRequestExceptionCount('all');
			await integration.getPullRequestForCommit(repo, sha(1));
			assert.equal(requests, 4, 'a reset of the connection drops every backoff');
		} finally {
			manager.dispose();
		}
	});
});
