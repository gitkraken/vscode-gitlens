import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { RequestClientError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderPullRequest } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { providerPr, stubApi } from './sweepHelpers.js';

/**
 * The failure budget that disconnects an integration after too many failed requests is counted per connection. Two
 * accounts of one provider share an integration instance, so a single shared count let a secondary account's
 * failures disconnect the primary, and a success on either account wipe the other's strikes.
 */

const provider = GitCloudHostIntegrationId.GitHub;
const repos = [{ namespace: 'octocat', name: 'hello' }];

/** Configured GitHub connections, the first one primary, each with its own stored token `token-<id>`. */
async function seedConnections(runtime: ReturnType<typeof createFakeRuntime>, ids: readonly string[]): Promise<void> {
	await runtime.storage.store('integrations:configured', {
		[provider]: ids.map((id, i) => ({
			id: id,
			cloud: true,
			integrationId: provider,
			scopes: 'repo',
			primary: i === 0,
		})),
	});
	for (const id of ids) {
		await runtime.storage.storeSecret(
			`integration.auth.cloud:${provider}|${id}`,
			JSON.stringify({
				id: id,
				accessToken: `token-${id}`,
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'github.com',
			}),
		);
	}
}

/**
 * A connected GitHub whose provider-apis pull request read fails with a 4xx for every token in `failing`, and whose
 * own API client is answered a 500 for every token in `serverErrors` (counted in `serverErrorRequests`).
 */
async function connect(
	ids: readonly string[],
	options?: { resolvePrimary?: boolean },
): Promise<{
	manager: ReturnType<typeof createIntegrationManager>;
	gh: GitHostIntegration;
	failing: Set<string>;
	serverErrors: Set<string>;
	serverErrorRequests: Map<string, number>;
	watched: { disconnected?: string };
}> {
	const runtime = createFakeRuntime();
	await seedConnections(runtime, ids);
	const watched: { disconnected?: string } = {};
	runtime.hooks!.ui = { onDisconnectedAfterTooManyFailures: name => void (watched.disconnected = name) };

	const serverErrors = new Set<string>();
	const serverErrorRequests = new Map<string, number>();
	runtime.http.fetch = (_input, init) => {
		const token = new Headers(init?.headers).get('authorization')?.replace(/^token /, '') ?? '';
		if (!serverErrors.has(token)) {
			return Promise.reject(new Error(`unexpected GitHub request with ${token}`));
		}

		serverErrorRequests.set(token, (serverErrorRequests.get(token) ?? 0) + 1);
		return Promise.resolve(
			new Response(JSON.stringify({ message: 'Server Error' }), {
				status: 500,
				headers: { 'content-type': 'application/json' },
			}),
		);
	};

	const manager = createIntegrationManager(runtime);
	const gh = await manager.get(provider);
	if (options?.resolvePrimary !== false) {
		assert.equal(await gh.isConnected(), true);
	}

	const failing = new Set<string>();
	stubApi(gh, {
		isRepoIdsInput: () => false,
		getProviderPullRequestsPagingMode: () => PagingMode.Repos,
		getPullRequestsForRepos: (token: { accessToken: string }) =>
			failing.has(token.accessToken)
				? Promise.reject(new RequestClientError(new Error('bad request')))
				: Promise.resolve({
						values: [providerPr(token.accessToken)],
						paging: { more: false, cursor: '{}' },
					} satisfies PagedResult<ProviderPullRequest>),
	});
	return {
		manager: manager,
		gh: gh,
		failing: failing,
		serverErrors: serverErrors,
		serverErrorRequests: serverErrorRequests,
		watched: watched,
	};
}

function readPage(manager: ReturnType<typeof createIntegrationManager>, connectionId?: string) {
	return manager.listPullRequestsPage({ providerId: provider, connectionId: connectionId, repos: repos });
}

/** An account-wide sweep of `connectionId` (the primary when omitted), which reads through GitHub's own client. */
function sweepAccount(manager: ReturnType<typeof createIntegrationManager>, connectionId?: string) {
	return manager.sweepPullRequests({ targets: [{ providerId: provider, connectionId: connectionId }] });
}

function getSession(gh: GitHostIntegration): ProviderAuthenticationSession | null | undefined {
	return (gh as unknown as { _session: ProviderAuthenticationSession | null | undefined })._session;
}

function getPrimaryStrikes(gh: GitHostIntegration): number {
	return (gh as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

function getConnectionStrikes(gh: GitHostIntegration, connectionId: string): number {
	return (
		(
			gh as unknown as { connectionRequestExceptionCounts: Map<string, number> }
		).connectionRequestExceptionCounts.get(connectionId) ?? 0
	);
}

/** Lets the disconnect a strike starts (fire-and-forget) settle. */
async function settle(): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, 0));
}

suite('per-connection failure budget', () => {
	test('a secondary connection failing past the limit in a sweep leaves the primary connected', async () => {
		const { manager, gh, failing, watched } = await connect(['gh-primary', 'gh-secondary']);
		failing.add('token-gh-secondary');

		for (let i = 0; i < 8; i++) {
			const result = await manager.sweepPullRequests({
				targets: [
					{ providerId: provider, connectionId: 'gh-primary' },
					{ providerId: provider, connectionId: 'gh-secondary' },
				],
				repos: repos,
			});
			assert.deepEqual(
				result.items.map(pr => pr.id),
				['token-gh-primary'],
			);
			assert.deepEqual(result.failedTargets, [
				{ providerId: provider, connectionId: 'gh-secondary', domain: undefined },
			]);
		}
		await settle();

		assert.equal(watched.disconnected, undefined, 'no disconnect is announced');
		assert.equal(await gh.isConnected(), true);
		assert.equal(getSession(gh)?.accessToken, 'token-gh-primary', 'the primary session is intact');
		assert.equal(getPrimaryStrikes(gh), 0);
		assert.ok(getConnectionStrikes(gh, 'gh-secondary') >= 5, 'the secondary spent its own strikes');

		manager.dispose();
	});

	test('a secondary connection failing on its own past the limit disconnects nothing', async () => {
		const { manager, gh, failing, watched } = await connect(['gh-primary', 'gh-secondary']);
		failing.add('token-gh-secondary');

		for (let i = 0; i < 8; i++) {
			const result = await readPage(manager, 'gh-secondary');
			assert.equal(result.fetchFailed, true, 'each failure still surfaces on the secondary read');
		}
		await settle();

		assert.equal(watched.disconnected, undefined);
		assert.equal(await gh.isConnected(), true);
		assert.equal(getSession(gh)?.accessToken, 'token-gh-primary');
		assert.equal(getConnectionStrikes(gh, 'gh-secondary'), 8);

		const primary = await readPage(manager);
		assert.deepEqual(
			primary.items.map(pr => pr.id),
			['token-gh-primary'],
			'a primary read still succeeds',
		);
		const named = await readPage(manager, 'gh-primary');
		assert.deepEqual(
			named.items.map(pr => pr.id),
			['token-gh-primary'],
			'a read naming the primary still succeeds',
		);

		manager.dispose();
	});

	test("a secondary connection's success does not clear the primary's strikes", async () => {
		const { manager, gh, failing, watched } = await connect(['gh-primary', 'gh-secondary']);

		failing.add('token-gh-primary');
		for (let i = 0; i < 4; i++) {
			await readPage(manager);
		}
		assert.equal(getPrimaryStrikes(gh), 4);

		const secondary = await readPage(manager, 'gh-secondary');
		assert.deepEqual(
			secondary.items.map(pr => pr.id),
			['token-gh-secondary'],
		);
		assert.equal(getPrimaryStrikes(gh), 4, 'the secondary success leaves the primary at four');

		await readPage(manager);
		await settle();

		assert.equal(watched.disconnected, gh.name, 'the fifth primary strike disconnects');
		assert.equal(await gh.isConnected(), false);

		manager.dispose();
	});

	test("the primary connection's success does not clear a secondary's strikes", async () => {
		const { manager, gh, failing } = await connect(['gh-primary', 'gh-secondary']);

		failing.add('token-gh-secondary');
		for (let i = 0; i < 4; i++) {
			await readPage(manager, 'gh-secondary');
		}

		const primary = await readPage(manager);
		assert.deepEqual(
			primary.items.map(pr => pr.id),
			['token-gh-primary'],
		);
		assert.equal(getConnectionStrikes(gh, 'gh-secondary'), 4, 'the primary success leaves the secondary at four');

		await readPage(manager, 'gh-secondary');
		assert.equal(getConnectionStrikes(gh, 'gh-secondary'), 5);

		failing.delete('token-gh-secondary');
		await readPage(manager, 'gh-secondary');
		assert.equal(getConnectionStrikes(gh, 'gh-secondary'), 0, "the secondary's own success clears its strikes");

		manager.dispose();
	});

	test('a single connection disconnects after five failures of reads naming no connection', async () => {
		const { manager, gh, failing, watched } = await connect(['gh-primary']);
		failing.add('token-gh-primary');

		for (let i = 0; i < 4; i++) {
			await readPage(manager);
		}
		await settle();
		assert.equal(watched.disconnected, undefined);

		await readPage(manager);
		await settle();

		assert.equal(watched.disconnected, gh.name);
		assert.equal(await gh.isConnected(), false);

		manager.dispose();
	});

	test('a single connection disconnects after five failures of reads naming it, its session resolved or not', async () => {
		for (const resolvePrimary of [true, false]) {
			const { manager, gh, failing, watched } = await connect(['gh-primary'], { resolvePrimary: resolvePrimary });
			failing.add('token-gh-primary');

			for (let i = 0; i < 4; i++) {
				await readPage(manager, 'gh-primary');
			}
			await settle();
			assert.equal(watched.disconnected, undefined);

			await readPage(manager, 'gh-primary');
			await settle();

			assert.equal(watched.disconnected, gh.name, `resolved primary: ${resolvePrimary}`);
			assert.equal(getSession(gh), null, `resolved primary: ${resolvePrimary}`);

			manager.dispose();
		}
	});

	test("a secondary connection's success leaves the primary's pending re-sync request in place", async () => {
		const { manager, gh } = await connect(['gh-primary', 'gh-secondary']);

		gh.requestSessionSyncForUsecase('getPullRequestsForRepos');
		await readPage(manager, 'gh-secondary');
		assert.equal(gh.hasSessionSyncRequests(), true);

		await readPage(manager);
		assert.equal(gh.hasSessionSyncRequests(), false);

		manager.dispose();
	});

	test("a secondary connection's server errors past the limit leave the primary connected", async () => {
		const { manager, gh, serverErrors, serverErrorRequests, watched } = await connect([
			'gh-primary',
			'gh-secondary',
		]);
		serverErrors.add('token-gh-secondary');

		for (let i = 0; i < 6; i++) {
			const result = await sweepAccount(manager, 'gh-secondary');
			assert.deepEqual(result.failedTargets, [
				{ providerId: provider, connectionId: 'gh-secondary', domain: undefined },
			]);
		}
		await settle();

		const requests = serverErrorRequests.get('token-gh-secondary') ?? 0;
		assert.ok(requests >= 6, `each sweep reached GitHub (${requests} requests)`);
		assert.equal(watched.disconnected, undefined, 'no disconnect is announced');
		assert.equal(await gh.isConnected(), true);
		assert.equal(getSession(gh)?.accessToken, 'token-gh-primary', 'the primary session is intact');
		assert.equal(getPrimaryStrikes(gh), 0);
		assert.equal(getConnectionStrikes(gh, 'gh-secondary'), requests, 'the secondary spent a strike per request');

		const primary = await readPage(manager);
		assert.deepEqual(
			primary.items.map(pr => pr.id),
			['token-gh-primary'],
			'a primary read still succeeds',
		);

		manager.dispose();
	});

	test('the primary connection disconnects after five server errors, named or not', async () => {
		for (const connectionId of [undefined, 'gh-primary']) {
			const { manager, gh, serverErrors, serverErrorRequests, watched } = await connect([
				'gh-primary',
				'gh-secondary',
			]);
			serverErrors.add('token-gh-primary');

			while ((serverErrorRequests.get('token-gh-primary') ?? 0) < 5) {
				await settle();
				assert.equal(watched.disconnected, undefined, `named: ${connectionId}`);
				assert.equal(getPrimaryStrikes(gh), serverErrorRequests.get('token-gh-primary') ?? 0);

				await sweepAccount(manager, connectionId);
			}
			await settle();

			assert.equal(watched.disconnected, gh.name, `named: ${connectionId}`);
			assert.equal(await gh.isConnected(), false, `named: ${connectionId}`);
			assert.equal(getConnectionStrikes(gh, 'gh-primary'), 0, `named: ${connectionId}`);

			manager.dispose();
		}
	});

	test('a switch of the primary connection starts every budget afresh', async () => {
		const { manager, gh } = await connect(['gh-primary', 'gh-secondary']);

		for (let i = 0; i < 4; i++) {
			gh.trackRequestException({ silent: true });
		}
		gh.trackRequestException({ silent: true, connectionId: 'gh-secondary' });
		await gh.switchConnection();

		assert.equal(getPrimaryStrikes(gh), 0);
		assert.equal(getConnectionStrikes(gh, 'gh-secondary'), 0);

		manager.dispose();
	});
});
