import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { getDeferredRequestFailure } from '@gitlens/git/errors.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { advanceClock, restoreClock } from '../../../__tests__/clock.js';
import { createFakeRuntime } from '../../../__tests__/fakeRuntime.js';
import { connectedGitLab } from '../../../__tests__/sweepHelpers.js';
import { failureBackoffMaxMs } from '../../../utils/failureBackoff.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { GitLabApi } from '../gitlab.js';
import { gitLabProvider, gitLabToken } from './fixtures.js';

/**
 * The project lookup every repository-scoped GitLab read starts with. A failure is not an answer: it must not be kept
 * as a missing project, and the single-commit merge request read, whose `undefined` its caller keeps per commit as one
 * without a merge request, must report it as a failure. A dead token still asks to re-authenticate only once.
 */

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

const project = { data: { project: { id: 'gid://gitlab/Project/42' } } };
const mergeRequests = [
	{
		id: 100,
		iid: 7,
		author: null,
		title: 'MR 7',
		description: '',
		state: 'merged',
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-02T00:00:00Z',
		closed_at: null,
		merged_at: '2026-01-02T00:00:00Z',
		source_branch: 'feature',
		target_branch: 'main',
		web_url: 'https://gitlab.com/group/r/-/merge_requests/7',
	},
];

/** A client whose project lookups answer `lookup()` and whose REST reads answer the merge requests above. */
function apiAnswering(lookup: () => Response): { api: GitLabApi; lookups: () => number; prompts: () => number } {
	let lookups = 0;
	let prompts = 0;
	const config: ProviderApiConfig = {
		fetch: input => {
			if (new URL(input.toString()).pathname.endsWith('/graphql')) {
				lookups++;
				return Promise.resolve(lookup());
			}
			return Promise.resolve(json(200, mergeRequests));
		},
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		onReauthenticationRequired: () => {
			prompts++;
			return Promise.resolve(false);
		},
	};
	return { api: new GitLabApi(config), lookups: () => lookups, prompts: () => prompts };
}

function apiWaitingForAnswer() {
	let answer!: () => void;
	const answered = new Promise<void>(resolve => (answer = resolve));
	const requests: (AbortSignal | null | undefined)[] = [];
	const counts = { prompts: 0, notices: 0, strikes: 0 };
	const provider = { ...gitLabProvider, trackRequestException: () => void counts.strikes++ };
	const api = new GitLabApi({
		fetch: (_input, init) => {
			requests.push(init?.signal);
			return new Promise<Response>((resolve, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(new DOMException('The operation was aborted.', 'AbortError')),
				);
				void answered.then(() => resolve(json(200, project)));
			});
		},
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		onReauthenticationRequired: () => {
			counts.prompts++;
			return Promise.resolve(false);
		},
		onRequestFailed: () => void counts.notices++,
	});
	return { api: api, provider: provider, requests: requests, answer: answer, counts: counts };
}

const sha = 'a'.repeat(40);

suite('GitLab project lookup', () => {
	test('a failed lookup is not kept as a missing project: a read after its backoff asks again', async () => {
		let fails = true;
		const { api, lookups } = apiAnswering(() => (fails ? json(500, { message: 'boom' }) : json(200, project)));
		const lookup = () => api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, undefined);

		assert.equal(await lookup(), undefined);
		fails = false;
		advanceClock(failureBackoffMaxMs);
		try {
			assert.equal(await lookup(), '42');
		} finally {
			restoreClock();
		}
		assert.equal(lookups(), 2);
		assert.equal(await lookup(), '42');
		assert.equal(lookups(), 2, 'an answer is kept');
	});

	test('a 404 of the GraphQL endpoint is a failed lookup, while a project GitLab answers null for is missing', async () => {
		const { api: failing } = apiAnswering(() => json(404, { message: '404 Not Found' }));
		await assert.rejects(
			failing.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, undefined, { strict: true }),
		);

		const { api, lookups } = apiAnswering(() => json(200, { data: { project: null } }));
		const lookup = () =>
			api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, undefined, { strict: true });
		assert.equal(await lookup(), undefined);
		assert.equal(await lookup(), undefined);
		assert.equal(lookups(), 1, 'a missing project is kept');
	});

	test('the single-commit merge request read fails on a failed lookup rather than answering none', async () => {
		const { api } = apiAnswering(() => json(500, { message: 'boom' }));

		await assert.rejects(api.getPullRequestForCommit(gitLabProvider, gitLabToken, 'group', 'r', sha));
	});

	test("the integration's single-commit lookup doesn't keep a failed project lookup as a commit without one", async () => {
		const runtime = createFakeRuntime();
		let fails = true;
		runtime.http.fetch = input => {
			if (input.toString().endsWith('/graphql')) {
				return Promise.resolve(fails ? json(500, { message: 'boom' }) : json(200, project));
			}
			return Promise.resolve(json(200, mergeRequests));
		};
		let invalidated = 0;
		runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) =>
			loader({ invalidate: () => void invalidated++ } as never).value;
		const { manager, gl } = await connectedGitLab(runtime);
		const repo = { key: 'group/r', owner: 'group', name: 'r' };

		assert.equal(await gl.getPullRequestForCommit(repo, sha), undefined);
		assert.equal(invalidated, 1, 'the failure is dropped from the cache');

		fails = false;
		advanceClock(failureBackoffMaxMs);
		try {
			assert.equal((await gl.getPullRequestForCommit(repo, sha))?.id, '7');
		} finally {
			restoreClock();
		}

		manager.dispose();
	});

	test("the integration's repository metadata read doesn't keep a failed project lookup as a repository without metadata", async () => {
		const runtime = createFakeRuntime();
		let fails = true;
		let lookups = 0;
		runtime.http.fetch = input => {
			if (input.toString().endsWith('/graphql')) {
				lookups++;
				return Promise.resolve(fails ? json(404, { message: '404 Not Found' }) : json(200, project));
			}
			return Promise.resolve(json(200, { namespace: { path: 'group', full_path: 'group' }, path: 'r' }));
		};
		const kept = new Map<string, unknown>();
		runtime.cache.getRepositoryMetadata = (repo, _integration, cacheable, options) => {
			if (!kept.has(repo.key) || options?.expiryOverride === true) {
				kept.set(repo.key, cacheable({ invalidate: () => kept.delete(repo.key) } as never).value);
			}
			return kept.get(repo.key) as never;
		};
		const { manager, gl } = await connectedGitLab(runtime);
		const repo = { key: 'group/r', owner: 'group', name: 'r' };
		const other = { key: 'group/other', owner: 'group', name: 'other' };

		assert.equal(await gl.getRepositoryMetadata(repo), undefined);
		assert.equal(await gl.getRepositoryMetadata(other), undefined);
		fails = false;
		assert.equal(await gl.getRepositoryMetadata(repo), undefined);
		assert.equal(await gl.getRepositoryMetadata(other), undefined);
		assert.equal(lookups, 2, 'a read during the backoff sends no request');

		const forced = await gl.getRepositoryMetadata(other, { expiryOverride: true });
		assert.equal(forced?.owner, 'group', 'a forced read gets through the backoff');
		assert.equal(lookups, 3);

		advanceClock(failureBackoffMaxMs);
		try {
			const metadata = await gl.getRepositoryMetadata(repo);
			assert.equal(`${metadata?.owner}/${metadata?.name}`, 'group/r');
		} finally {
			restoreClock();
		}
		assert.equal(lookups, 4);

		manager.dispose();
	});

	test("a read joining a lookup another read cancelled still gets the project's answer", async () => {
		const { api, answer } = apiWaitingForAnswer();
		const controller = new AbortController();
		const lookup = (signal: AbortSignal) =>
			api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, signal, { strict: true });

		const cancelled = assert.rejects(lookup(controller.signal), (ex: unknown) => isCancellationError(ex));
		const joined = lookup(new AbortController().signal);
		controller.abort();
		await cancelled;
		answer();

		assert.equal(await joined, '42');
	});

	test('a kept answer is not asked again once the read that looked it up is cancelled', async () => {
		const { api, requests, answer } = apiWaitingForAnswer();
		const lookup = (signal: AbortSignal) =>
			api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, signal, { strict: true });

		const controller = new AbortController();
		const first = lookup(controller.signal);
		answer();
		assert.equal(await first, '42');
		controller.abort();

		assert.equal(await lookup(new AbortController().signal), '42');
		assert.equal(requests.length, 1);
	});

	test('a lookup every read sharing it cancelled is aborted, and the next read asks again', async () => {
		const { api, provider, requests, answer, counts } = apiWaitingForAnswer();
		const read = (signal: AbortSignal | undefined, strict = true) =>
			api.getProjectId(provider, gitLabToken, 'group', 'r', undefined, signal, { strict: strict });
		const cancelled = (promise: Promise<unknown>) =>
			assert.rejects(promise, (ex: unknown) => isCancellationError(ex));

		const batch = new AbortController();
		const other = new AbortController();
		const reads = [cancelled(read(batch.signal)), cancelled(read(batch.signal)), cancelled(read(other.signal))];
		other.abort();
		assert.equal(requests[0]?.aborted, false, 'a read sharing the lookup still waits');
		batch.abort();
		assert.equal(requests[0]?.aborted, true);

		const late = new AbortController();
		reads.push(cancelled(read(late.signal)));
		assert.equal(requests.length, 2, 'a read right after the abort does not join the aborted lookup');
		late.abort();
		assert.equal(requests[1]?.aborted, true);
		await Promise.all(reads);
		await new Promise(resolve => setImmediate(resolve));

		const leaving = new AbortController();
		const left = read(leaving.signal, false);
		assert.equal(requests.length, 3, 'no backoff holds the read after a cancelled lookup');
		const pinned = read(undefined, false);
		leaving.abort();
		assert.equal(requests[2]?.aborted, false, 'a read without a signal keeps the lookup');
		assert.equal(await left, undefined);
		answer();
		assert.equal(await pinned, '42');

		assert.equal(requests.length, 3);
		assert.deepEqual(counts, { prompts: 0, notices: 0, strikes: 0 });
	});

	test('a read whose signal is already aborted sends no request', async () => {
		const { api, lookups } = apiAnswering(() => json(200, project));
		const controller = new AbortController();
		controller.abort();
		const read = (strict: boolean) =>
			api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, controller.signal, {
				strict: strict,
			});

		await assert.rejects(read(true), (ex: unknown) => isCancellationError(ex));
		assert.equal(await read(false), undefined);
		assert.equal(lookups(), 0);
	});

	test('a lookup that rejects as timed out backs off like any failed lookup', async () => {
		let lookups = 0;
		const api = new GitLabApi({
			fetch: () => {
				lookups++;
				return Promise.reject(new CancellationError(new Error('Timed out'), 'timeout'));
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
		});
		const read = () => api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, undefined);

		assert.equal(await read(), undefined);
		assert.equal(await read(), undefined);
		assert.equal(lookups, 1);
	});

	test('a refused credential asks to re-authenticate once, however many lookups meet it', async () => {
		const { api, lookups, prompts } = apiAnswering(() => json(401, { message: '401 Unauthorized' }));

		for (let i = 0; i < 3; i++) {
			assert.equal(
				await api.getProjectId(gitLabProvider, gitLabToken, 'group', `r${i}`, undefined, undefined),
				undefined,
			);
		}
		await assert.rejects(api.getPullRequestForCommit(gitLabProvider, gitLabToken, 'group', 'r', sha));

		assert.equal(lookups(), 4, 'each lookup asks, since a failure is not kept');
		assert.equal(prompts(), 1);
	});

	test('a backed-off lookup asked with an aborted signal leaves no rejection unhandled', async () => {
		const { api } = apiAnswering(() => json(500, { message: 'boom' }));
		await api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, undefined);

		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => void unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);
		try {
			const controller = new AbortController();
			controller.abort();
			assert.equal(
				await api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, controller.signal),
				undefined,
			);
			await new Promise(resolve => setImmediate(resolve));
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}

		assert.deepEqual(unhandled, []);
	});

	test("a batch's per-commit reads on a cold client leave a failed lookup to the batch", async () => {
		for (const status of [401, 500]) {
			let notices = 0;
			let strikes = 0;
			let prompts = 0;
			const provider = { ...gitLabProvider, trackRequestException: () => void strikes++ };
			const api = new GitLabApi({
				fetch: () => Promise.resolve(json(status, { message: 'boom' })),
				wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
				onReauthenticationRequired: () => {
					prompts++;
					return Promise.resolve(false);
				},
				onRequestFailed: () => void notices++,
			});

			for (let i = 0; i < 3; i++) {
				await assert.rejects(
					api.getPullRequestForCommit(provider, gitLabToken, 'group', 'r', sha, { deferFailure: true }),
					(ex: unknown) => status !== 500 || getDeferredRequestFailure(ex) != null,
				);
			}

			assert.equal(prompts, 0, `${status}: no prompt`);
			assert.equal(notices, 0, `${status}: no notice`);
			assert.equal(strikes, 0, `${status}: no strike`);
		}
	});

	test("a read joining the batch's lookup reports its server error once, though the batch was cancelled", async () => {
		let answer!: () => void;
		const answered = new Promise<void>(resolve => (answer = resolve));
		let notices = 0;
		let strikes = 0;
		const provider = { ...gitLabProvider, trackRequestException: () => void strikes++ };
		const api = new GitLabApi({
			fetch: async () => {
				await answered;
				return json(500, { message: 'boom' });
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
			onRequestFailed: () => void notices++,
		});
		const controller = new AbortController();

		const batch = assert.rejects(
			api.getProjectId(provider, gitLabToken, 'group', 'r', undefined, controller.signal, {
				strict: true,
				backoff: false,
				deferFailure: true,
			}),
			(ex: unknown) => isCancellationError(ex),
		);
		const author = api.getAccountForCommit(provider, gitLabToken, 'group', 'r', sha);
		controller.abort();
		await batch;
		answer();

		assert.equal(await author, undefined);
		assert.equal(notices, 1);
		assert.equal(strikes, 1);
	});

	test('a failed lookup backs off when any read sharing it asked to, not only the one that started it', async () => {
		const { api, lookups } = apiAnswering(() => json(500, { message: 'boom' }));
		const lookup = (options?: { backoff?: boolean }) =>
			api.getProjectId(gitLabProvider, gitLabToken, 'group', 'r', undefined, undefined, options);

		await Promise.all([lookup({ backoff: false }), lookup()]);
		assert.equal(await lookup(), undefined);

		assert.equal(lookups(), 1, 'the read after the failure is held by its backoff');
	});
});
