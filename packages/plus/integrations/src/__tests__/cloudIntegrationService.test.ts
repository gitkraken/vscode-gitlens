import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { CloudIntegrationService } from '../authentication/cloudIntegrationService.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createFakeRuntime } from './fakeRuntime.js';

interface FetchCall {
	path: string;
	method: string | undefined;
	body: string | undefined;
}

/** Wires a fake `fetchGkApi` that records calls and returns canned `{ data }` responses per path. */
function createCloudService(responder: (path: string, init?: RequestInit) => unknown) {
	const runtime = createFakeRuntime();
	const calls: FetchCall[] = [];
	runtime.account.fetchGkApi = (path: string, init?: RequestInit) => {
		calls.push({ path: path, method: init?.method, body: init?.body as string | undefined });
		const payload = responder(path, init);
		return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
	};
	return { service: new CloudIntegrationService(runtime), calls: calls };
}

/** Wires a fake `fetchGkApi` that returns a fixed non-ok status for every call (failure-path tests). */
function createFailingCloudService(status: number) {
	const runtime = createFakeRuntime();
	runtime.account.fetchGkApi = () =>
		Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: status }));
	return new CloudIntegrationService(runtime);
}

/**
 * Wires a fake `fetchGkApi` that fails with a different non-ok status per call, in call order, and records
 * the paths. Drives the refresh fallback: call 1 is the `/refresh` POST, call 2 the plain GET retry.
 */
function createSequentiallyFailingCloudService(...statuses: number[]) {
	const runtime = createFakeRuntime();
	const paths: string[] = [];
	runtime.account.fetchGkApi = (path: string) => {
		paths.push(path);
		const status = statuses[paths.length - 1] ?? statuses.at(-1);
		return Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: status }));
	};
	return { service: new CloudIntegrationService(runtime), paths: paths, runtime: runtime };
}

/** The reported fetch failures, in emission order, so tests can pin what diagnostics actually saw. */
function reportedFetchFailures(runtime: ReturnType<typeof createFakeRuntime>) {
	return runtime.emittedEvents
		.filter(e => e.event === 'integration.connection.fetch.failed')
		.map(e => ({ code: e.props?.code, refreshing: e.props?.refreshing }));
}

suite('CloudIntegrationService — multi-account wire mapping (#5430)', () => {
	test('getConnections flattens primary + secondaries and maps tokenId/positional primary', async () => {
		const { service } = createCloudService(() => ({
			data: [
				{
					tokenId: 'primary-tok',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					accountName: 'octo-primary',
					secondaries: [
						{
							tokenId: 'secondary-tok',
							provider: 'github',
							type: 'oauth',
							domain: 'github.com',
							accountName: 'octo-secondary',
						},
					],
				},
			],
		}));

		const connections = await service.getConnections();

		assert.deepEqual(connections, [
			{
				id: 'primary-tok',
				type: 'oauth',
				provider: 'github',
				domain: 'github.com',
				primary: true,
				accountName: 'octo-primary',
			},
			{
				id: 'secondary-tok',
				type: 'oauth',
				provider: 'github',
				domain: 'github.com',
				primary: false,
				accountName: 'octo-secondary',
			},
		]);
	});

	test('getConnections falls back to the primary domain when a secondary domain is empty', async () => {
		const { service } = createCloudService(() => ({
			data: [
				{
					tokenId: 'primary-tok',
					provider: 'githubEnterprise',
					type: 'oauth',
					domain: 'ghe.example.com',
					secondaries: [
						{
							tokenId: 'secondary-tok',
							provider: 'githubEnterprise',
							type: 'oauth',
							domain: '',
						},
					],
				},
			],
		}));

		const connections = await service.getConnections();

		assert.equal(connections?.find(c => c.id === 'secondary-tok')?.domain, 'ghe.example.com');
	});

	test('getConnections tolerates a non-array secondaries payload without throwing', async () => {
		const { service } = createCloudService(() => ({
			data: [
				{
					tokenId: 'primary-tok',
					provider: 'github',
					type: 'oauth',
					domain: 'github.com',
					// Malformed backend payload: secondaries should be an array. It must not abort the sync.
					secondaries: {},
				},
			],
		}));

		const connections = await service.getConnections();

		assert.deepEqual(
			connections,
			[
				{
					id: 'primary-tok',
					type: 'oauth',
					provider: 'github',
					domain: 'github.com',
					primary: true,
					accountName: undefined,
				},
			],
			'primary is still mapped and the malformed secondaries is ignored',
		);
	});

	test('getConnectionSession targets /tokens/{tokenId} for a specific connection and maps tokenId to id', async () => {
		const { service, calls } = createCloudService(() => ({
			data: {
				tokenId: 'secondary-tok',
				isPrimary: false,
				accessToken: 'secret',
				expiresIn: 3600,
				scopes: 'repo',
				type: 'oauth',
				domain: 'github.com',
			},
		}));

		const session = await service.getConnectionSession(
			GitCloudHostIntegrationId.GitHub,
			undefined,
			'secondary-tok',
		);

		assert.equal(calls[0].path, 'v1/provider-tokens/tokens/secondary-tok');
		assert.equal(calls[0].method, 'GET');
		assert.equal(session?.id, 'secondary-tok');
		assert.equal(session?.accessToken, 'secret');
	});

	test('getConnectionSession refreshes a specific connection via /tokens/{tokenId}/refresh, not the provider endpoint', async () => {
		// The provider-scoped /refresh only ever refreshes the PRIMARY, so a secondary must refresh by id.
		const { service, calls } = createCloudService(() => ({
			data: { tokenId: 'secondary-tok', accessToken: 'fresh', expiresIn: 3600, scopes: 'repo', type: 'oauth' },
		}));

		await service.getConnectionSession(GitCloudHostIntegrationId.GitHub, 'stale-access-token', 'secondary-tok');

		assert.equal(calls[0].path, 'v1/provider-tokens/tokens/secondary-tok/refresh');
		assert.equal(calls[0].method, 'POST');
		assert.equal(calls[0].body, JSON.stringify({ access_token: 'stale-access-token' }));
	});

	test('getConnectionSession without a connectionId targets the provider (primary)', async () => {
		const { service, calls } = createCloudService(() => ({
			data: { tokenId: 'primary-tok', accessToken: 's', expiresIn: 3600, scopes: 'repo', type: 'oauth' },
		}));

		await service.getConnectionSession(GitCloudHostIntegrationId.GitHub);

		assert.equal(calls[0].path, 'v1/provider-tokens/github');
	});

	test('setPrimaryConnection POSTs to /tokens/{tokenId}/primary', async () => {
		const { service, calls } = createCloudService(() => ({ data: {} }));

		const ok = await service.setPrimaryConnection(GitCloudHostIntegrationId.GitHub, 'secondary-tok');

		assert.equal(ok, true);
		assert.equal(calls[0].path, 'v1/provider-tokens/tokens/secondary-tok/primary');
		assert.equal(calls[0].method, 'POST');
	});

	test('disconnectConnection DELETEs /tokens/{tokenId}', async () => {
		const { service, calls } = createCloudService(() => ({ data: {} }));

		const ok = await service.disconnectConnection(GitCloudHostIntegrationId.GitHub, 'secondary-tok');

		assert.equal(ok, true);
		assert.equal(calls[0].path, 'v1/provider-tokens/tokens/secondary-tok');
		assert.equal(calls[0].method, 'DELETE');
	});
});

suite('CloudIntegrationService — transient vs terminal failure classification (#5569)', () => {
	test('getConnectionSession throws on a transient 5xx failure so callers can retry', async () => {
		const service = createFailingCloudService(503);

		// Match the error, not just "something threw": a 5xx must be reported as retryable, and an unrelated
		// failure (e.g. a JSON parse error on the body) must not be mistaken for that.
		await assert.rejects(
			service.getConnectionSession(GitCloudHostIntegrationId.GitHub),
			/Retryable failure \(503\)/,
		);
	});

	test('getConnectionSession throws on a 429 rate-limit failure', async () => {
		const service = createFailingCloudService(429);

		await assert.rejects(
			service.getConnectionSession(GitCloudHostIntegrationId.GitHub),
			/Retryable failure \(429\)/,
		);
	});

	test('getConnectionSession throws on a 401 — a rejected account token is not evidence the connection is gone', async () => {
		// A 401 means OUR GK account token was rejected, which says nothing about whether the integration
		// connection still exists. Treating it as terminal would disconnect a healthy integration (#5569).
		const service = createFailingCloudService(401);

		await assert.rejects(
			service.getConnectionSession(GitCloudHostIntegrationId.GitHub),
			/Retryable failure \(401\)/,
		);
	});

	test('getConnectionSession throws on a 403 — the GK API returns it for rate limits, so it must stay retryable', async () => {
		const service = createFailingCloudService(403);

		await assert.rejects(
			service.getConnectionSession(GitCloudHostIntegrationId.GitHub),
			/Retryable failure \(403\)/,
		);
	});

	test('getConnectionSession returns undefined on a terminal 404 so the connection can be dropped', async () => {
		const service = createFailingCloudService(404);

		assert.equal(await service.getConnectionSession(GitCloudHostIntegrationId.GitHub), undefined);
	});

	test('getConnectionSession returns undefined on a terminal 400 (a malformed request can never succeed on retry)', async () => {
		const service = createFailingCloudService(400);

		assert.equal(await service.getConnectionSession(GitCloudHostIntegrationId.GitHub), undefined);
	});

	test('getConnectionSession returns undefined on an ok-but-empty response (the connection has no token)', async () => {
		const { service } = createCloudService(() => ({ data: null }));

		assert.equal(await service.getConnectionSession(GitCloudHostIntegrationId.GitHub), undefined);
	});

	test('a failed refresh whose fallback GET fails transiently throws (classified by the fallback)', async () => {
		// The refresh POST fails terminally, but the fallback GET — the request that actually decides whether
		// the token is still fetchable — fails transiently, so the failure must surface as retryable.
		const { service, paths, runtime } = createSequentiallyFailingCloudService(400, 503);

		await assert.rejects(
			service.getConnectionSession(GitCloudHostIntegrationId.GitHub, 'stale-access-token'),
			/Retryable failure \(503\)/,
		);
		assert.deepEqual(
			paths,
			['v1/provider-tokens/github/refresh', 'v1/provider-tokens/github'],
			'a failed refresh falls back to a plain GET before the failure is classified',
		);
		assert.deepEqual(
			reportedFetchFailures(runtime),
			[
				{ code: 400, refreshing: true },
				{ code: 503, refreshing: false },
			],
			'both failures are reported, so diagnostics see the fallback status that drove the classification',
		);
	});

	test('a failed refresh whose fallback GET fails terminally returns undefined, even if the refresh was transient', async () => {
		// The reverse pairing: the refresh POST fails transiently, but the fallback GET answers definitively
		// that the token is gone. The fallback is authoritative, so this is terminal (droppable), not retryable.
		const { service, paths, runtime } = createSequentiallyFailingCloudService(503, 404);

		assert.equal(
			await service.getConnectionSession(GitCloudHostIntegrationId.GitHub, 'stale-access-token'),
			undefined,
		);
		assert.deepEqual(paths, ['v1/provider-tokens/github/refresh', 'v1/provider-tokens/github']);
		assert.deepEqual(
			reportedFetchFailures(runtime),
			[
				{ code: 503, refreshing: true },
				{ code: 404, refreshing: false },
			],
			'the terminal fallback status is reported, not just the transient refresh status',
		);
	});
});
