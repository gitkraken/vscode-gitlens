import assert from 'node:assert';
import { suite, test } from 'mocha';
import { PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

/**
 * Adding a pull request to its merge queue and removing it. GitHub answers a refusal as a GraphQL error, which the
 * mutation turns into a `failed` result saying why; anything that isn't GitHub's answer about the action is thrown.
 */
suite('GitHubApi merge-queue actions', () => {
	const provider = {
		id: 'github',
		name: 'GitHub',
		domain: 'github.com',
		icon: 'github',
		getIgnoreSSLErrors: () => false,
		reauthenticate: () => Promise.resolve(),
		trackRequestException: () => {},
	} as unknown as Provider;

	const token: GitHubTokenInfo = {
		providerId: 'github',
		accessToken: 'token',
		microHash: 'hash',
		cloud: true,
		type: undefined,
	};

	interface Served {
		config: GitHubApiConfig;
		calls: { query: string; variables: Record<string, unknown> }[];
		authFailures: () => number;
	}

	function serve(response: { status?: number; data?: unknown; errors?: unknown[] }): Served {
		const calls: { query: string; variables: Record<string, unknown> }[] = [];
		let authFailures = 0;
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
			onAuthenticationFailure: () => {
				authFailures++;
				return Promise.resolve(false);
			},
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as {
					query?: string;
					variables?: Record<string, unknown>;
				};
				calls.push({
					query: body.query ?? '',
					variables: body.variables ?? {},
				});
				const status = response.status ?? 200;
				return new Response(
					JSON.stringify(
						status === 200
							? {
									data: response.data ?? null,
									...(response.errors != null ? { errors: response.errors } : {}),
								}
							: { message: 'failed' },
					),
					{ status: status, headers: { 'content-type': 'application/json' } },
				);
			},
		} as unknown as GitHubApiConfig;
		return { config: config, calls: calls, authFailures: () => authFailures };
	}

	function refusal(type: string, message: string): { errors: unknown[] } {
		return {
			errors: [
				{
					type: type,
					message: message,
					path: ['enqueuePullRequest'],
					locations: [],
				},
			],
		};
	}

	suite('enqueuePullRequest', () => {
		test('enqueues the pull request at the expected head and maps the new entry', async () => {
			const { config, calls } = serve({
				data: {
					enqueuePullRequest: {
						mergeQueueEntry: {
							state: 'QUEUED',
							enqueuedAt: '2026-11-06T10:00:00Z',
							estimatedTimeToMerge: null,
							mergeQueue: { url: 'https://github.com/o/r/queue/main' },
							position: 3,
						},
					},
				},
			});

			const result = await new GitHubApi(config).enqueuePullRequest(provider, token, 'PR_1', 'head-sha');

			assert.deepStrictEqual(result, {
				status: 'queued',
				entry: {
					state: PullRequestMergeQueueState.Queued,
					enqueuedAt: new Date('2026-11-06T10:00:00Z'),
					estimatedMergeAt: undefined,
					url: 'https://github.com/o/r/queue/main',
					position: 3,
				},
			});
			assert.equal(calls.length, 1);
			assert.match(calls[0].query, /^mutation enqueuePullRequest\(/);
			assert.match(
				calls[0].query,
				/enqueuePullRequest\(input: \{ pullRequestId: \$id, expectedHeadOid: \$expectedHeadOid \}\)/,
			);
			// The ruleset decides the merge method, and a plain enqueue never jumps the queue.
			assert.doesNotMatch(calls[0].query, /mergeMethod|jump/);
			assert.equal(calls[0].variables.id, 'PR_1');
			assert.equal(calls[0].variables.expectedHeadOid, 'head-sha');
		});

		test('reports a pull request already in the queue', async () => {
			const { config } = serve(refusal('UNPROCESSABLE', 'Pull request is already in the queue'));

			const result = await new GitHubApi(config).enqueuePullRequest(provider, token, 'PR_1', 'head-sha');

			assert.deepStrictEqual(result, {
				status: 'failed',
				reason: 'already-queued',
				message: 'Pull request is already in the queue',
			});
		});

		const cases: [string, string, string, string][] = [
			[
				'a stale head',
				'UNPROCESSABLE',
				'Failed to add PR #4: expected head oid does not match the current head oid',
				'head-changed',
			],
			['a closed or merged pull request', 'UNPROCESSABLE', 'Pull request is closed', 'not-allowed'],
			['a draft pull request', 'UNPROCESSABLE', 'Pull request is in draft', 'not-allowed'],
			['FORBIDDEN without a known message', 'FORBIDDEN', 'Resource not accessible by integration', 'permission'],
			['NOT_FOUND', 'NOT_FOUND', "Could not resolve to a node with the global id of 'PR_1'", 'unknown'],
			['an unrecognized refusal', 'UNPROCESSABLE', 'Something new went wrong', 'unknown'],
		];
		for (const [name, type, message, reason] of cases) {
			test(`maps ${name} to ${reason}, carrying GitHub's message`, async () => {
				const { config } = serve(refusal(type, message));

				const result = await new GitHubApi(config).enqueuePullRequest(provider, token, 'PR_1', 'head-sha');

				assert.deepStrictEqual(result, {
					status: 'failed',
					reason: reason,
					message: message,
				});
			});
		}

		test("a FORBIDDEN refusal is the account's permission, never a prompt to re-authenticate", async () => {
			const { config, authFailures } = serve(refusal('FORBIDDEN', 'Must have push access'));

			const result = await new GitHubApi(config).enqueuePullRequest(provider, token, 'PR_1', 'head-sha');

			assert.equal(result.status === 'failed' ? result.reason : undefined, 'permission');
			assert.equal(authFailures(), 0);
		});

		test('throws a refused credential, as any other request does', async () => {
			const { config, authFailures } = serve({ status: 401 });

			await assert.rejects(new GitHubApi(config).enqueuePullRequest(provider, token, 'PR_1', 'head-sha'));
			assert.equal(authFailures(), 1);
		});

		test('is never retried on a transient failure', async () => {
			const { config, calls } = serve({ status: 502 });

			await assert.rejects(new GitHubApi(config).enqueuePullRequest(provider, token, 'PR_1', 'head-sha'));
			assert.equal(calls.length, 1, 'a mutation is not idempotent');
		});

		test('throws a cancellation', async () => {
			const { config, calls } = serve({ data: {} });
			const controller = new AbortController();
			controller.abort();

			await assert.rejects(
				new GitHubApi(config).enqueuePullRequest(
					provider,
					token,
					'PR_1',
					'head-sha',
					undefined,
					controller.signal,
				),
				(ex: Error) => ex.name === 'CancellationError' || /cancel/i.test(ex.message),
			);
			assert.equal(calls.length, 0);
		});

		test('is unsupported on GitHub Enterprise Server, without a request', async () => {
			const { config, calls } = serve({ data: {} });

			const result = await new GitHubApi(config).enqueuePullRequest(provider, token, 'PR_1', 'head-sha', {
				baseUrl: 'https://ghe.example.com/api/v3',
			});

			assert.deepStrictEqual(result, {
				status: 'failed',
				reason: 'unsupported',
			});
			assert.equal(calls.length, 0);
		});
	});

	suite('dequeuePullRequest', () => {
		test("dequeues by the pull request's node id", async () => {
			const { config, calls } = serve({
				data: { dequeuePullRequest: { mergeQueueEntry: { id: 'MQE_1' } } },
			});

			const result = await new GitHubApi(config).dequeuePullRequest(provider, token, 'PR_1');

			assert.deepStrictEqual(result, { status: 'dequeued' });
			assert.equal(calls.length, 1);
			assert.match(calls[0].query, /^mutation dequeuePullRequest\(/);
			assert.match(calls[0].query, /dequeuePullRequest\(input: \{ id: \$id \}\)/);
			assert.equal(calls[0].variables.id, 'PR_1');
		});

		test("maps the generic refusal for a pull request that isn't queued to unknown", async () => {
			const message = 'Failed to remove PR #4 "Add merge queue support"';
			const { config } = serve(refusal('UNPROCESSABLE', message));

			const result = await new GitHubApi(config).dequeuePullRequest(provider, token, 'PR_1');

			assert.deepStrictEqual(result, { status: 'failed', reason: 'unknown', message: message });
		});

		for (const title of ['Fix merge conflict', 'Add permission checks', 'Handle checks failed state']) {
			test(`a pull request titled "${title}" in the dequeue refusal is still unknown`, async () => {
				const message = `Failed to remove PR #4 "${title}"`;
				const { config } = serve(refusal('UNPROCESSABLE', message));

				const result = await new GitHubApi(config).dequeuePullRequest(provider, token, 'PR_1');

				assert.deepStrictEqual(result, { status: 'failed', reason: 'unknown', message: message });
			});
		}

		test('is never retried on a transient failure', async () => {
			const { config, calls } = serve({ status: 502 });

			await assert.rejects(new GitHubApi(config).dequeuePullRequest(provider, token, 'PR_1'));
			assert.equal(calls.length, 1);
		});

		test('is unsupported on GitHub Enterprise Server, without a request', async () => {
			const { config, calls } = serve({ data: {} });

			const result = await new GitHubApi(config).dequeuePullRequest(provider, token, 'PR_1', {
				baseUrl: 'https://ghe.example.com/api/v3',
			});

			assert.deepStrictEqual(result, {
				status: 'failed',
				reason: 'unsupported',
			});
			assert.equal(calls.length, 0);
		});
	});
});
