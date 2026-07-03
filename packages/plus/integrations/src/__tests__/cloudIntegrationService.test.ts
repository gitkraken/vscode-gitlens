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
