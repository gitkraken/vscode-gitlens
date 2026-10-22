import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { suite, test } from 'mocha';
import { isCancellationError, raceWithTimeout } from '@gitlens/utils/cancellation.js';
import { defer } from '@gitlens/utils/promise.js';
import { AuthenticationError } from '../../../errors.js';
import { AzureDevOpsApi } from '../azure.js';
import { azureProject, azureProvider, azureRestDiscoveryResponse, azureToken } from './fixtures.js';

const baseUrl = 'https://azure.example.test';
const collection = 'collection';
const repository = `${azureProject.name}/_git/repo`;
const options = {
	baseUrl: baseUrl,
	criteria: { state: 'all' as const },
	projectNames: [azureProject.name],
	resolveProject: () => azureProject,
};

function harness(firstDiscoveryStatus = 200, onDiscoveryStart?: () => void) {
	const started = defer<void>();
	const gate = defer<void>();
	const requests: { method: string; path: string; signal: AbortSignal | null | undefined }[] = [];
	let discoveries = 0;
	let activeWraps = 0;
	const api = new AzureDevOpsApi({
		wrapForForcedInsecureSSL: async (_ignore, fn) => {
			activeWraps++;
			try {
				return await fn();
			} finally {
				activeWraps--;
			}
		},
		fetch: async (input, init) => {
			const path = new URL(input.toString()).pathname;
			const method = init?.method ?? 'GET';
			requests.push({ method: method, path: path, signal: init?.signal });
			if (method === 'OPTIONS') {
				const status = ++discoveries === 1 ? firstDiscoveryStatus : 200;
				started.fulfill(undefined);
				onDiscoveryStart?.();
				await gate.promise;
				if (status !== 200) return Response.json({ message: 'Discovery unavailable' }, { status: status });

				const response = azureRestDiscoveryResponse(input);
				assert.ok(response);
				return response;
			}

			if (path.toLowerCase().endsWith('/wiql')) return Response.json({ workItems: [] });
			if (path.toLowerCase().endsWith('/pullrequestquery')) return Response.json({ results: [] });
			if (path.endsWith('/workItemTypes')) return Response.json({ value: [{ name: 'Task' }] });
			if (path.endsWith('/workItemTypes/Task/states')) {
				return Response.json({ value: [{ name: 'New', category: 'Proposed' }] });
			}

			assert.ok(path.includes('/_apis/git/repositories/'), path);
			return Response.json({ name: 'repo', defaultBranch: 'refs/heads/main' });
		},
	});
	return {
		api: api,
		started: started.promise,
		requests: requests,
		activeWraps: () => activeWraps,
		release: () => gate.fulfill(undefined),
	};
}

function assertCancelled(operation: Promise<unknown>): Promise<void> {
	return assert.rejects(
		raceWithTimeout(operation, 250),
		(error: unknown) => isCancellationError(error) && error.reason !== 'timeout',
	);
}

async function checkSynchronousCancellation(): Promise<void> {
	const controller = new AbortController();
	const h = harness(401, () => controller.abort());
	let unhandled = 0;
	const onUnhandled = () => unhandled++;
	process.on('unhandledRejection', onUnhandled);
	const operation = h.api.getDefaultBranch(
		azureProvider,
		azureToken,
		collection,
		repository,
		options,
		controller.signal,
	);
	const peer = h.api.getRepositoryMetadata(azureProvider, azureToken, collection, repository, options);
	const denied = assert.rejects(peer, AuthenticationError);
	try {
		await assertCancelled(operation);
		h.release();
		await denied;
		await new Promise<void>(resolve => setImmediate(resolve));
		process.stdout.write(JSON.stringify({ unhandled: unhandled }));
		assert.equal(unhandled, 0);
		assert.equal(h.requests.length, 1);
	} finally {
		h.release();
		await Promise.allSettled([operation, peer, denied]);
		process.removeListener('unhandledRejection', onUnhandled);
		h.api.dispose();
	}
}

const reads: { name: string; run: (api: AzureDevOpsApi, signal: AbortSignal) => Promise<unknown> }[] = [
	{
		name: 'count',
		run: (api, signal) => api.countWorkItems(azureProvider, azureToken, collection, options, signal),
	},
	{
		name: 'search',
		run: (api, signal) => api.searchWorkItemsPage(azureProvider, azureToken, collection, options, signal),
	},
	{
		name: 'repository metadata',
		run: (api, signal) =>
			api.getRepositoryMetadata(azureProvider, azureToken, collection, repository, options, signal),
	},
	{
		name: 'default branch',
		run: (api, signal) => api.getDefaultBranch(azureProvider, azureToken, collection, repository, options, signal),
	},
	{
		name: 'pull request for commit',
		run: (api, signal) =>
			api.getPullRequestForCommit(
				azureProvider,
				azureToken,
				collection,
				repository,
				'a'.repeat(40),
				baseUrl,
				undefined,
				signal,
			),
	},
];

if (process.argv.includes('--check-synchronous-discovery-cancellation')) {
	void checkSynchronousCancellation().catch(() => {
		process.exitCode = 1;
	});
} else {
	suite('Azure REST discovery cancellation', () => {
		test('synchronous setup cancellation observes a late discovery failure', () => {
			const output = execFileSync(process.execPath, [__filename, '--check-synchronous-discovery-cancellation'], {
				encoding: 'utf8',
				timeout: 5000,
			});
			assert.deepEqual(JSON.parse(output), { unhandled: 0 });
		});

		for (const read of reads) {
			test(`${read.name} cancels before stalled discovery settles`, async () => {
				const h = harness();
				const controller = new AbortController();
				const operation = read.run(h.api, controller.signal);
				const cancelled = assertCancelled(operation);
				try {
					await h.started;
					controller.abort();
					await cancelled;
					assert.equal(h.requests.length, 1);
					assert.equal(h.requests[0].method, 'OPTIONS');
					assert.equal(h.requests[0].signal, undefined);
				} finally {
					h.release();
					await Promise.allSettled([operation]);
					h.api.dispose();
				}
			});

			test(`${read.name} starts no discovery for a pre-aborted caller`, async () => {
				const h = harness();
				const controller = new AbortController();
				controller.abort();
				const operation = read.run(h.api, controller.signal);
				try {
					await assertCancelled(operation);
					assert.deepEqual(h.requests, []);
				} finally {
					h.release();
					await Promise.allSettled([operation]);
					h.api.dispose();
				}
			});
		}

		test('one cancelled caller leaves shared discovery and a surviving caller intact', async () => {
			const h = harness();
			const controller = new AbortController();
			const cancelledRead = h.api.getRepositoryMetadata(
				azureProvider,
				azureToken,
				collection,
				repository,
				options,
				controller.signal,
			);
			const survivingRead = h.api.getDefaultBranch(azureProvider, azureToken, collection, repository, options);
			const cancelled = assertCancelled(cancelledRead);
			try {
				await h.started;
				controller.abort();
				await cancelled;
				h.release();
				assert.equal((await survivingRead)?.name, 'main');
				assert.equal(
					(await h.api.getRepositoryMetadata(azureProvider, azureToken, collection, repository, options))
						?.name,
					'repo',
				);
				assert.equal(h.requests.filter(request => request.method === 'OPTIONS').length, 1);
				assert.equal(h.requests.filter(request => request.method === 'GET').length, 2);
			} finally {
				h.release();
				await Promise.allSettled([cancelledRead, survivingRead]);
				h.api.dispose();
			}
		});

		test('a later caller reuses discovery after its only previous waiter cancelled', async () => {
			const h = harness();
			const controller = new AbortController();
			const first = h.api.getDefaultBranch(
				azureProvider,
				azureToken,
				collection,
				repository,
				options,
				controller.signal,
			);
			const cancelled = assertCancelled(first);
			try {
				await h.started;
				controller.abort();
				await cancelled;
				assert.equal(h.activeWraps(), 1);
				const next = h.api.getDefaultBranch(azureProvider, azureToken, collection, repository, options);
				h.release();
				assert.equal((await next)?.name, 'main');
				assert.equal(h.requests.filter(request => request.method === 'OPTIONS').length, 1);
				assert.equal(h.requests.filter(request => request.method === 'GET').length, 1);
			} finally {
				h.release();
				await Promise.allSettled([first]);
				h.api.dispose();
			}
		});

		test('a late discovery failure after cancellation permits fresh discovery', async () => {
			const h = harness(401);
			const controller = new AbortController();
			const first = h.api.getDefaultBranch(
				azureProvider,
				azureToken,
				collection,
				repository,
				options,
				controller.signal,
			);
			const cancelled = assertCancelled(first);
			try {
				await h.started;
				controller.abort();
				await cancelled;
				h.release();
				await new Promise<void>(resolve => setImmediate(resolve));
				assert.equal(
					(await h.api.getDefaultBranch(azureProvider, azureToken, collection, repository, options))?.name,
					'main',
				);
				assert.equal(h.requests.filter(request => request.method === 'OPTIONS').length, 2);
			} finally {
				h.release();
				await Promise.allSettled([first]);
				h.api.dispose();
			}
		});

		test('workflow discovery uses the aggregate signal for surviving count callers', async () => {
			const h = harness();
			const controller = new AbortController();
			const open = { ...options, criteria: { state: 'open' as const } };
			const first = h.api.countWorkItems(azureProvider, azureToken, collection, open, controller.signal);
			const second = h.api.countWorkItems(azureProvider, azureToken, collection, open);
			const cancelled = assertCancelled(first);
			try {
				await h.started;
				controller.abort();
				await cancelled;
				h.release();
				assert.equal(await second, 0);
				assert.equal(h.requests.filter(request => request.method === 'OPTIONS').length, 1);
			} finally {
				h.release();
				await Promise.allSettled([first, second]);
				h.api.dispose();
			}
		});
	});
}
