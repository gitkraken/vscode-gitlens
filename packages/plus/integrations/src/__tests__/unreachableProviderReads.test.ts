import * as assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { suite, test } from 'mocha';
import { toCloudIntegrationType } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import { createIntegrationService } from '../integrationService.js';
import type { ProviderWarning } from '../results.js';
import { createFakeRuntime } from './fakeRuntime.js';

const domain = 'https://server.example.com';
const connectionId = 'connection';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

async function createConnectedProvider(
	providerId: IntegrationIds,
	fetch: ReturnType<typeof createFakeRuntime>['http']['fetch'],
) {
	const runtime = createFakeRuntime();
	const cloudRequests: string[] = [];
	const providerRequests: string[] = [];
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async path => {
		cloudRequests.push(path);
		return json({
			data: {
				tokenId: connectionId,
				provider: toCloudIntegrationType[providerId],
				accessToken: 'valid-token',
				domain: domain,
				type: 'pat',
				expiresIn: 3600,
				scopes: '',
			},
		});
	};
	runtime.http.fetch = (input, init) => {
		providerRequests.push(String(input));
		return fetch(input, init);
	};
	await runtime.storage.store('integrations:configured', {
		[providerId]: [
			{ id: connectionId, integrationId: providerId, cloud: true, primary: true, domain: domain, scopes: '' },
		],
	});
	await runtime.storage.storeSecret(
		`integration.auth.cloud:${providerId}|${connectionId}`,
		JSON.stringify({
			id: connectionId,
			accessToken: 'old-token',
			scopes: [],
			cloud: true,
			type: 'pat',
			domain: domain,
			expiresAt: new Date(Date.now() - 1000),
		}),
	);
	const manager = createIntegrationService(runtime);
	return { manager: manager, cloudRequests: cloudRequests, providerRequests: providerRequests };
}

function assertUnreachable(warnings: ProviderWarning[], expectedConnectionId: string | null = connectionId): void {
	assert.ok(warnings.length > 0);
	for (const warning of warnings) {
		assert.equal(warning.kind, 'other');
		assert.equal(warning.isAuth, false);
		assert.deepEqual(warning.cause, { reason: 'unreachable' });
		assert.equal(warning.connectionId, expectedConnectionId ?? undefined);
	}
}

const failures = [
	{
		name: 'connection refused',
		error: () => new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ECONNREFUSED' }) }),
	},
	{ name: 'DNS failure', error: () => Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' }) },
	{ name: 'timeout', error: () => new DOMException('The operation timed out', 'TimeoutError') },
	{ name: 'transport abort', error: () => new DOMException('The request was aborted', 'AbortError') },
	{ name: 'TLS failure', error: () => Object.assign(new Error('certificate expired'), { code: 'CERT_HAS_EXPIRED' }) },
	{ name: '502', status: 502 },
	{ name: '503', status: 503 },
	{ name: '504', status: 504 },
] as const;

suite('self-managed provider failures with a healthy cloud connection', () => {
	for (const failure of ['refused', 'timeout', 502, 401] as const) {
		test(`Azure DevOps Server: real HTTP ${failure} reaches the facade`, async () => {
			const server = createServer((_request, response) => {
				if (failure === 'timeout') return;

				response.writeHead(typeof failure === 'number' ? failure : 200);
				response.end();
			});
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			const address = server.address();
			assert.ok(address != null && typeof address !== 'string');
			const close = () =>
				new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
			if (failure === 'refused') {
				await close();
			}

			const providerId = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
			const { manager } = await createConnectedProvider(providerId, (input, init) =>
				fetch(`http://127.0.0.1:${address.port}${new URL(input).pathname}`, {
					...init,
					signal: AbortSignal.timeout(failure === 'timeout' ? 50 : 5000),
				}),
			);
			try {
				const result = await manager.getCurrentAccount({ providerId: providerId, connectionId: connectionId });
				assert.equal(result.fetchFailed, true);
				if (failure === 401) {
					assert.deepEqual(
						result.warnings.map(w => w.kind),
						['auth'],
					);
				} else {
					assertUnreachable(result.warnings);
				}
			} finally {
				manager.dispose();
				if (failure !== 'refused') {
					server.closeAllConnections();
					await close();
				}
			}
		});
	}

	for (const providerId of Object.values(GitSelfManagedHostIntegrationId)) {
		for (const failure of failures) {
			test(`${providerId}: current-account ${failure.name} is unreachable`, async () => {
				const { manager, cloudRequests, providerRequests } = await createConnectedProvider(
					providerId,
					async () => {
						if ('error' in failure) throw failure.error();
						return json({ message: 'Server unavailable' }, failure.status);
					},
				);
				try {
					const result = await manager.getCurrentAccount({
						providerId: providerId,
						connectionId: connectionId,
					});
					assert.equal(result.account, undefined);
					assert.equal(result.fetchFailed, true);
					assertUnreachable(result.warnings);
					assert.ok(cloudRequests.some(path => path.includes('v1/provider-tokens/')));
					assert.ok(providerRequests.length > 0);
				} finally {
					manager.dispose();
				}
			});
		}

		for (const status of [401, 403]) {
			test(`${providerId}: current-account ${status} remains auth`, async () => {
				const { manager } = await createConnectedProvider(providerId, async () =>
					json({ message: 'Denied' }, status),
				);
				try {
					const result = await manager.getCurrentAccount({
						providerId: providerId,
						connectionId: connectionId,
					});
					assert.equal(result.fetchFailed, true);
					assert.deepEqual(
						result.warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth, cause: w.cause })),
						[{ kind: 'auth', isAuth: true, cause: undefined }],
					);
				} finally {
					manager.dispose();
				}
			});
		}
	}

	for (const failure of failures) {
		test(`Azure DevOps Server: PR and issue reads preserve current-user ${failure.name}`, async () => {
			const providerId = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
			const { manager, providerRequests } = await createConnectedProvider(providerId, async () => {
				if ('error' in failure) throw failure.error();
				return json({ message: 'Server unavailable' }, failure.status);
			});
			try {
				const target = { providerId: providerId, connectionId: connectionId };
				const page = await manager.listPullRequestsPage(target);
				const sweep = await manager.sweepPullRequests({ targets: [target] });
				const issues = await manager.listIssuesPage(target);
				for (const result of [page, sweep, issues]) {
					assert.equal(result.fetchFailed, true);
					assertUnreachable(result.warnings);
				}
				assert.ok(providerRequests.every(url => url.includes('_apis/connectionData')));
			} finally {
				manager.dispose();
			}
		});

		test(`Jira Data Center: issue ${failure.name} is unreachable`, async () => {
			const providerId = IssuesSelfManagedHostIntegrationId.JiraServer;
			const { manager, providerRequests } = await createConnectedProvider(providerId, async input => {
				if (String(input).endsWith('/rest/api/2/project')) return json([{ id: 'project', name: 'PROJ' }]);

				if ('error' in failure) throw failure.error();
				return json({ message: 'Server unavailable' }, failure.status);
			});
			try {
				const result = await manager.listIssueTrackerIssuesPage({
					providerId: providerId,
					connectionId: connectionId,
				});
				assert.equal(result.fetchFailed, true);
				assertUnreachable(result.warnings);
				assert.ok(providerRequests.some(url => url.includes('/myself')));
			} finally {
				manager.dispose();
			}
		});
	}

	test('Azure DevOps Server recovers without reconnecting after repeated failures', async () => {
		const providerId = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		let down = true;
		const { manager, cloudRequests } = await createConnectedProvider(providerId, async () =>
			down
				? json({ message: 'Server unavailable' }, 503)
				: json({ authenticatedUser: { id: 'me', properties: { Account: { $value: 'me@example.com' } } } }),
		);
		try {
			const target = { providerId: providerId, connectionId: connectionId };
			for (let i = 0; i < 6; i++) {
				assertUnreachable((await manager.getCurrentAccount(target)).warnings);
			}
			down = false;
			const recovered = await manager.getCurrentAccount(target);
			assert.equal(recovered.account?.id, 'me');
			assert.deepEqual(recovered.warnings, []);
			assert.equal(recovered.fetchFailed, undefined);
			assert.equal(cloudRequests.length, 1, 'the valid cloud token is reused');
		} finally {
			manager.dispose();
		}
	});

	test('Azure DevOps Server keeps its primary session through repeated 500s and recovers', async () => {
		const providerId = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		let down = true;
		const { manager, cloudRequests } = await createConnectedProvider(providerId, async () =>
			down
				? json({ message: 'Server unavailable' }, 500)
				: json({ authenticatedUser: { id: 'me', properties: { Account: { $value: 'me@example.com' } } } }),
		);
		try {
			const integration = await manager.get(providerId, domain);
			assert.ok(integration);
			assert.equal(await integration.isConnected(), true);
			const target = { providerId: providerId, domain: domain };
			for (let i = 0; i < 6; i++) {
				const result = await manager.getCurrentAccount(target);
				assert.equal(result.fetchFailed, true);
				assertUnreachable(result.warnings, null);
				assert.equal(integration.maybeConnected, true);
			}
			down = false;
			const recovered = await manager.getCurrentAccount(target);
			assert.equal(recovered.account?.id, 'me');
			assert.deepEqual(recovered.warnings, []);
			assert.equal(cloudRequests.length, 1, 'the valid cloud token is reused');
		} finally {
			manager.dispose();
		}
	});

	test('a fully failed GitLab repository issue collection retains its unreachable cause', async () => {
		const providerId = GitCloudHostIntegrationId.GitLab;
		const { manager, providerRequests } = await createConnectedProvider(providerId, async input => {
			if (String(input).endsWith('/projects/123')) {
				return json({
					id: 123,
					name: 'repo',
					path: 'repo',
					path_with_namespace: 'owner/repo',
					web_url: 'https://gitlab.com/owner/repo',
					namespace: { id: 1, name: 'owner', full_path: 'owner' },
				});
			}
			return json({ message: 'Server unavailable' }, 503);
		});
		try {
			const result = await manager.listIssuesPage({
				providerId: providerId,
				connectionId: connectionId,
				repos: ['123'],
				includeAllAssignees: true,
			});
			assert.equal(result.fetchFailed, true);
			assertUnreachable(result.warnings);
			assert.ok(
				providerRequests.some(url => url.endsWith('/api/graphql')),
				JSON.stringify(providerRequests),
			);
		} finally {
			manager.dispose();
		}
	});

	test('an absent connection still reports no-connection', async () => {
		const manager = createIntegrationService(createFakeRuntime());
		try {
			const result = await manager.getCurrentAccount({
				providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
				connectionId: 'missing',
			});
			assert.deepEqual(
				result.warnings.map(w => w.kind),
				['no-connection'],
			);
		} finally {
			manager.dispose();
		}
	});
});
