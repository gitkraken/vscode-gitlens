import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ConfiguredIntegrationDescriptor } from '../authentication/models.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { GitSelfManagedHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

const providers = [
	{ id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, path: '/github', repo: 'owner/repo' },
	{ id: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, path: '/gitlab', repo: 'owner/repo' },
	{ id: GitSelfManagedHostIntegrationId.BitbucketServer, path: '/base', repo: 'scm/owner/repo' },
	{ id: GitSelfManagedHostIntegrationId.AzureDevOpsServer, path: '/tfs', repo: 'owner/project/_git/repo' },
];

function json(data: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', ...headers } });
}

function providerResponse(id: IntegrationIds, url: URL): Response {
	const links = { self: [{ href: `${url.origin}/users/me` }], clone: [] };
	if (id === GitSelfManagedHostIntegrationId.BitbucketServer) {
		if (url.pathname.endsWith('/users')) {
			return json(
				{ values: [{ id: 1, name: 'me', slug: 'me', displayName: 'Me', links: links }] },
				{
					'x-auserid': '1',
					'x-ausername': 'me',
				},
			);
		}
		if (url.pathname.endsWith('/repos/repo')) {
			return json({ id: 1, slug: 'repo', project: { key: 'owner' }, links: links });
		}
		return json({ values: [], isLastPage: true, start: 0, size: 0, limit: 100 });
	}
	if (id === GitSelfManagedHostIntegrationId.AzureDevOpsServer) {
		if (url.pathname.endsWith('/wiql')) return json({ workItems: [] });
		if (url.pathname.endsWith('/connectionData')) {
			return json({ authenticatedUser: { id: 'me', properties: { Account: { $value: 'me' } } } });
		}
		if (url.pathname.endsWith('/repositories/repo') || url.pathname.endsWith('/repositories/%252e')) {
			const name = url.pathname.endsWith('/repositories/%252e') ? '%2e' : 'repo';
			return json({
				id: '1',
				name: name,
				project: { id: 'project', name: 'project' },
				remoteUrl: `${url.origin}/repo`,
				_links: { web: { href: `${url.origin}/repo` } },
			});
		}
		return json({ count: 0, value: [] });
	}
	if (id === IssuesSelfManagedHostIntegrationId.JiraServer) {
		if (url.pathname.endsWith('/myself')) return json({ key: 'me', name: 'me', displayName: 'Me' });

		if (url.pathname.endsWith('/project')) return json([{ id: '1', name: 'Project' }]);
		return json({ issues: [], total: 0, startAt: 0, maxResults: 100 });
	}

	const page = { nodes: [], edges: [], pageInfo: { hasNextPage: false, endCursor: null } };
	if (!url.pathname.endsWith('/graphql')) {
		if (/\/projects\/[^/]+$/.test(url.pathname)) return json({ id: 1, path_with_namespace: 'owner/repo' });
		return json([]);
	}
	if (id === GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted) {
		return json({
			data: {
				projects: page,
				currentUser: { id: 'gid://gitlab/User/1', username: 'me', name: 'Me', projects: page, groups: page },
				project: {
					id: 'gid://gitlab/Project/1',
					fullPath: 'owner/repo',
					userPermissions: {},
					mergeRequests: page,
					issues: page,
				},
				group: { projects: page },
			},
		});
	}
	return json({
		data: {
			search: { ...page, issueCount: 0 },
			viewer: { databaseId: 1, login: 'me', name: 'Me', repositories: page, organizations: page },
			repository: {
				databaseId: 1,
				id: '1',
				name: 'repo',
				owner: { login: 'owner' },
				url: `${url.origin}/owner/repo`,
				pullRequests: page,
				issues: page,
			},
			organization: { repositories: page },
		},
	});
}

function createServer(id: IntegrationIds, baseUrl: string) {
	const runtime = createFakeRuntime();
	const requests: { url: URL; authorization: string | null; body: string | undefined }[] = [];
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async path =>
		json({
			data:
				path === 'v1/provider-tokens'
					? [{ tokenId: 'connection', provider: toCloudIntegrationType[id], type: 'pat', domain: baseUrl }]
					: {
							tokenId: 'connection',
							accessToken: 'synthetic-token',
							expiresIn: 3600,
							scopes: '',
							type: 'pat',
							domain: baseUrl,
						},
		});
	runtime.http.fetch = async (input, init) => {
		const url = new URL(input);
		requests.push({
			url: url,
			authorization: new Headers(init?.headers).get('authorization'),
			body: typeof init?.body === 'string' ? init.body : undefined,
		});
		return providerResponse(id, url);
	};
	const createManager = () => createIntegrationManager({ ...runtime, cache: undefined });
	return {
		runtime: runtime,
		requests: requests,
		createManager: createManager,
	};
}

function tokenFromAuthorization(authorization: string | null): string {
	const value = authorization ?? '';
	return value.toLowerCase().startsWith('basic ') ? Buffer.from(value.slice(6), 'base64').toString() : value;
}

function target(connection: ConfiguredIntegrationDescriptor) {
	return { providerId: connection.integrationId, connectionId: connection.id, domain: connection.domain };
}

suite('self-managed installation addresses through the public manager', () => {
	for (const provider of providers) {
		for (const path of ['', provider.path]) {
			for (const authority of ['server.test', 'server.test:8443']) {
				test(`${provider.id} keeps ${authority}${path || '/'} through sync, restart and HTTPS resolution`, async () => {
					const baseUrl = `https://${authority}${path}`;
					const server = createServer(provider.id, baseUrl);
					let manager = server.createManager();
					try {
						await manager.refreshConnections();
						const [connection] = manager.getConfigured(provider.id);
						assert.equal(connection.domain, authority);
						assert.equal(connection.baseUrl, baseUrl);
						assert.ok(server.requests.length > 0, 'initialization must exercise the provider');
						manager.dispose();
						manager = server.createManager();
						const [restored] = manager.getConfigured(provider.id);
						assert.equal(restored.baseUrl, baseUrl);
						const result = await manager.resolveRepository({
							...target(restored),
							remoteUrl: `${baseUrl}/${provider.repo}.git`,
						});
						assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
						assert.equal(result.resolution.identity?.owner, 'owner');
						assert.equal(result.resolution.identity?.name, 'repo');
						const request = server.requests.at(-1)!;
						if (provider.id === GitSelfManagedHostIntegrationId.CloudGitHubEnterprise) {
							assert.deepEqual(JSON.parse(request.body!).variables, { owner: 'owner', name: 'repo' });
						} else if (provider.id === GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted) {
							assert.deepEqual(JSON.parse(request.body!).variables, { fullPath: 'owner/repo' });
						} else {
							const suffix =
								provider.id === GitSelfManagedHostIntegrationId.BitbucketServer
									? '/rest/api/1.0/projects/owner/repos/repo'
									: '/owner/project/_apis/git/repositories/repo';
							assert.equal(request.url.pathname, `${path}${suffix}`);
						}
						for (const request of server.requests) {
							assert.equal(request.url.origin, `https://${authority}`);
							assert.ok(request.url.pathname.startsWith(`${path}/`), request.url.href);
							assert.ok(request.authorization, 'provider requests must use the synthetic credential');
							assert.ok(!path || !request.url.pathname.startsWith(`${path}${path}/`), request.url.href);
						}
					} finally {
						manager.dispose();
					}
				});
			}
		}

		test(`${provider.id} resolves an SSH remote using the configured web port and installation`, async () => {
			const baseUrl = `https://server.test:8443${provider.path}`;
			const server = createServer(provider.id, baseUrl);
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				const [connection] = manager.getConfigured(provider.id);
				const repo = provider.repo.replace(/^scm\//, '');
				for (const remoteUrl of [`ssh://git@server.test:7999/${repo}.git`, `git@server.test:${repo}.git`]) {
					const result = await manager.resolveRepository({ ...target(connection), remoteUrl: remoteUrl });
					assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
				}
				for (const request of server.requests) {
					assert.ok(request.url.href.startsWith(`${baseUrl}/`), request.url.href);
				}
			} finally {
				manager.dispose();
			}
		});

		test(`${provider.id} refuses another installation before sending credentials`, async () => {
			const server = createServer(provider.id, `https://server.test${provider.path}`);
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				const [connection] = manager.getConfigured(provider.id);
				const count = server.requests.length;
				for (const prefix of ['', '/other', `${provider.path}-other`]) {
					const result = await manager.resolveRepository({
						...target(connection),
						remoteUrl: `https://server.test${prefix}/${provider.repo}.git`,
					});
					assert.equal(result.resolution.status, 'host-mismatch');
				}
				assert.equal(server.requests.length, count);
			} finally {
				manager.dispose();
			}
		});
		test(`${provider.id} keeps the installation for discovery, pull requests and issues`, async () => {
			const baseUrl = `https://server.test${provider.path}`;
			const server = createServer(provider.id, baseUrl);
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				const [connection] = manager.getConfigured(provider.id);
				const options = target(connection);
				const repos = [{ namespace: 'owner', name: 'repo', project: 'project' }];
				if (provider.id !== GitSelfManagedHostIntegrationId.BitbucketServer) {
					const repositories = await manager.listRepos({ ...options, org: 'owner', project: 'project' });
					assert.ok(!repositories.fetchFailed, JSON.stringify(repositories));
				}

				const beforePulls = server.requests.length;
				const pulls = await manager.listPullRequestsPage({ ...options, repos: repos });
				assert.ok(!pulls.fetchFailed, JSON.stringify(pulls));
				assert.ok(server.requests.length > beforePulls);
				if (provider.id !== GitSelfManagedHostIntegrationId.BitbucketServer) {
					const beforeIssues = server.requests.length;
					const issues = await manager.listIssuesPage({
						...options,
						repos: repos,
						includeAllAssignees: true,
					});
					assert.ok(!issues.fetchFailed, JSON.stringify(issues));
					assert.ok(server.requests.length > beforeIssues);
				}
				for (const request of server.requests) {
					assert.ok(request.url.href.startsWith(`${baseUrl}/`), request.url.href);
				}
			} finally {
				manager.dispose();
			}
		});

		test(`${provider.id} restores a legacy connection with a path-bearing domain without reconnecting`, async () => {
			const baseUrl = `https://server.test${provider.path}`;
			const server = createServer(provider.id, baseUrl);
			await server.runtime.storage.store('integrations:configured', {
				[provider.id]: [
					{
						id: 'connection',
						integrationId: provider.id,
						domain: baseUrl,
						cloud: true,
						scopes: '',
						primary: true,
					},
				],
			});
			await server.runtime.storage.storeSecret(
				`integration.auth.cloud:${provider.id}|connection`,
				JSON.stringify({
					id: 'connection',
					accessToken: 'legacy-token',
					domain: baseUrl,
					cloud: true,
					type: 'pat',
					scopes: [],
				}),
			);
			server.runtime.account.fetchGkApi = async () => {
				throw new Error('Legacy credentials must not require reconnecting');
			};
			const manager = server.createManager();
			try {
				const [connection] = manager.getConfigured(provider.id);
				assert.equal(connection.domain, 'server.test');
				assert.equal(connection.baseUrl, baseUrl);
				const result = await manager.resolveRepository({
					...target(connection),
					remoteUrl: `${baseUrl}/${provider.repo}.git`,
				});
				assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
				for (const request of server.requests) {
					assert.ok(request.url.href.startsWith(`${baseUrl}/`), request.url.href);
				}
			} finally {
				manager.dispose();
			}
		});

		test(`${provider.id} rejects path traversal and a different HTTPS port without provider requests`, async () => {
			const baseUrl = `https://server.test:8443${provider.path}`;
			const server = createServer(provider.id, baseUrl);
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				const [connection] = manager.getConfigured(provider.id);
				const count = server.requests.length;
				for (const remoteUrl of [
					`https://server.test${provider.path}/${provider.repo}`,
					`${baseUrl}/../other/${provider.repo}`,
					`${baseUrl}/%2e%2e/other/${provider.repo}`,
					`git@server.test:owner/../../other/repo`,
				]) {
					const result = await manager.resolveRepository({ ...target(connection), remoteUrl: remoteUrl });
					assert.ok(
						['host-mismatch', 'invalid-remote-url'].includes(result.resolution.status),
						JSON.stringify(result),
					);
				}
				assert.equal(server.requests.length, count);
			} finally {
				manager.dispose();
			}
		});

		test(`${provider.id} keeps primary and secondary installation credentials separate on one host`, async () => {
			const firstUrl = `http://server.test:8080${provider.path}`;
			const secondUrl = `http://server.test:8080/secondary${provider.path}`;
			const server = createServer(provider.id, firstUrl);
			const connection = (secondary: boolean) => ({
				tokenId: secondary ? 'secondary' : 'connection',
				provider: toCloudIntegrationType[provider.id],
				type: 'pat',
				domain: secondary ? secondUrl : firstUrl,
			});
			server.runtime.account.fetchGkApi = async path =>
				json({
					data:
						path === 'v1/provider-tokens'
							? [{ ...connection(false), secondaries: [connection(true)] }]
							: {
									...connection(path.endsWith('/secondary')),
									accessToken: path.endsWith('/secondary') ? 'secondary-token' : 'primary-token',
									expiresIn: 3600,
									scopes: '',
								},
				});
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				const configured = manager.getConfigured(provider.id);
				assert.equal(configured.length, 2);
				assert.equal(configured.filter(c => c.primary).length, 1);
				for (const descriptor of configured) {
					assert.equal(descriptor.domain, 'server.test:8080');
					const remoteUrl = `${descriptor.baseUrl}/${provider.repo}.git`;
					const result = await manager.resolveRepository({ ...target(descriptor), remoteUrl: remoteUrl });
					assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
					// Unpinned, the remote's installation path selects the connection (and so its credentials).
					const unpinned = await manager.resolveRepository({
						providerId: provider.id,
						remoteUrl: remoteUrl,
					});
					assert.equal(unpinned.resolution.status, 'resolved', JSON.stringify(unpinned));
				}
				assert.ok(server.requests.some(r => r.url.href.startsWith(`${secondUrl}/`)));
				for (const request of server.requests) {
					const token = tokenFromAuthorization(request.authorization);
					const expected = token.endsWith('secondary-token') ? secondUrl : firstUrl;
					assert.ok(request.url.href.startsWith(`${expected}/`), request.url.href);
				}
			} finally {
				manager.dispose();
			}
		});

		test(`${provider.id} resolves an unpinned remote with the primary when installations tie`, async () => {
			const baseUrl = `http://server.test:8080${provider.path}`;
			const server = createServer(provider.id, baseUrl);
			const connection = (secondary: boolean) => ({
				tokenId: secondary ? 'secondary' : 'connection',
				provider: toCloudIntegrationType[provider.id],
				type: 'pat',
				domain: baseUrl,
			});
			server.runtime.account.fetchGkApi = async path =>
				json({
					data:
						path === 'v1/provider-tokens'
							? [{ ...connection(false), secondaries: [connection(true)] }]
							: {
									...connection(path.includes('/secondary')),
									accessToken: path.includes('/secondary') ? 'secondary-token' : 'first-token',
									expiresIn: 3600,
									scopes: '',
								},
				});
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				await manager.setPrimaryConnection(provider.id, 'secondary');
				const configured = manager.getConfigured(provider.id);
				assert.equal(configured.find(c => c.primary)?.id, 'secondary');
				assert.notEqual(configured[0].id, 'secondary', 'the primary must not be the first configured');
				const count = server.requests.length;
				const result = await manager.resolveRepository({
					providerId: provider.id,
					remoteUrl: `${baseUrl}/${provider.repo}.git`,
				});
				assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
				const requests = server.requests.slice(count);
				assert.ok(requests.length > 0);
				for (const request of requests) {
					const token = tokenFromAuthorization(request.authorization);
					assert.ok(token.endsWith('secondary-token'), `${request.url.href} used ${token}`);
				}
			} finally {
				manager.dispose();
			}
		});

		test(`${provider.id} refuses an unpinned remote under an installation only a local connection reaches`, async () => {
			const rootUrl = 'http://server.test:8080';
			const localUrl = `${rootUrl}/secondary${provider.path}`;
			const server = createServer(provider.id, rootUrl);
			await server.runtime.storage.store('integrations:configured', {
				[provider.id]: [
					{
						id: 'local',
						integrationId: provider.id,
						domain: 'server.test:8080',
						baseUrl: localUrl,
						cloud: false,
						scopes: '',
					},
				],
			});
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				const configured = manager.getConfigured(provider.id);
				assert.ok(
					configured.some(c => c.id === 'local' && !c.cloud),
					JSON.stringify(configured),
				);
				assert.equal(configured.find(c => c.primary)?.id, 'connection');
				const count = server.requests.length;
				const result = await manager.resolveRepository({
					providerId: provider.id,
					remoteUrl: `${localUrl}/${provider.repo}.git`,
				});
				assert.equal(result.resolution.status, 'host-mismatch', JSON.stringify(result));
				assert.equal(server.requests.length, count);
			} finally {
				manager.dispose();
			}
		});

		test(`${provider.id} fails closed when a sync serves a cloud installation other than the local primary`, async () => {
			const localUrl = `http://server.test:8080/a${provider.path}`;
			const cloudUrl = `http://server.test:8080/b${provider.path}`;
			const server = createServer(provider.id, cloudUrl);
			await server.runtime.storage.store('integrations:configured', {
				[provider.id]: [
					{
						id: 'local',
						integrationId: provider.id,
						domain: 'server.test:8080',
						baseUrl: localUrl,
						cloud: false,
						scopes: '',
						primary: true,
					},
				],
			});
			await server.runtime.storage.storeSecret(
				`integration.auth:${provider.id}|local`,
				JSON.stringify({
					id: 'local',
					accessToken: 'local-token',
					domain: 'server.test:8080',
					baseUrl: localUrl,
					cloud: false,
					scopes: [],
				}),
			);
			// The cloud connection is a secondary of a primary on another host, so this host keeps its local primary.
			const token = (tokenId: string, domain: string) => ({
				tokenId: tokenId,
				provider: toCloudIntegrationType[provider.id],
				type: 'pat',
				domain: domain,
			});
			server.runtime.account.fetchGkApi = async path =>
				json({
					data:
						path === 'v1/provider-tokens'
							? [{ ...token('other', 'https://other.test'), secondaries: [token('cloud', cloudUrl)] }]
							: path.includes('/cloud')
								? {
										...token('cloud', cloudUrl),
										accessToken: 'cloud-token',
										expiresIn: 3600,
										scopes: '',
									}
								: {
										...token('other', 'https://other.test'),
										accessToken: 'other-token',
										expiresIn: 3600,
										scopes: '',
									},
				});
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				const configured = manager.getConfigured(provider.id, { domain: 'server.test:8080' });
				assert.equal(configured.find(c => c.primary)?.id, 'local', JSON.stringify(configured));
				assert.ok(
					configured.some(c => c.id === 'cloud'),
					JSON.stringify(configured),
				);
				// A forced sync leaves the cloud connection's session serving unpinned reads on this host.
				await manager.listPullRequestsPage({
					providerId: provider.id,
					domain: 'server.test:8080',
					repos: [{ namespace: 'owner', name: 'repo', project: 'project' }],
					forceSync: true,
				});
				const count = server.requests.length;
				const local = await manager.resolveRepository({
					providerId: provider.id,
					remoteUrl: `${localUrl}/${provider.repo}.git`,
				});
				assert.equal(local.resolution.status, 'host-mismatch', JSON.stringify(local));
				assert.equal(server.requests.length, count);

				const cloud = await manager.resolveRepository({
					providerId: provider.id,
					remoteUrl: `${cloudUrl}/${provider.repo}.git`,
				});
				assert.equal(cloud.resolution.status, 'resolved', JSON.stringify(cloud));
				const requests = server.requests.slice(count);
				assert.ok(requests.length > 0);
				for (const request of requests) {
					assert.ok(request.url.href.startsWith(`${cloudUrl}/`), request.url.href);
					assert.ok(tokenFromAuthorization(request.authorization).endsWith('cloud-token'), request.url.href);
				}
			} finally {
				manager.dispose();
			}
		});
	}

	test('Azure rejects encoded dot segments in HTTPS and SSH remote paths', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		const server = createServer(id, 'https://server.test/tfs');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(id);
			const count = server.requests.length;
			for (const segment of ['%2e', '%2e%2e', '.%2E', '%2e.', '%5c', '%2f']) {
				for (const path of [
					`${segment}/evil/_git/repo`,
					`owner/${segment}/_git/repo`,
					`owner/project/_git/${segment}`,
				]) {
					for (const prefix of ['https://server.test/tfs/', 'ssh://git@server.test/tfs/']) {
						const remoteUrl = `${prefix}${path}`;
						const result = await manager.resolveRepository({ ...target(connection), remoteUrl: remoteUrl });
						assert.equal(result.resolution.status, 'invalid-remote-url', remoteUrl);
						assert.equal(server.requests.length, count, remoteUrl);
					}
				}
			}
		} finally {
			manager.dispose();
		}
	});

	test('Azure resolves a repository literally named %2e from HTTPS and SSH remotes', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		const server = createServer(id, 'https://server.test/tfs');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(id);
			for (const prefix of ['https://server.test/tfs/', 'ssh://git@server.test/tfs/']) {
				const remoteUrl = `${prefix}owner/project/_git/%252e`;
				const count = server.requests.length;
				const result = await manager.resolveRepository({ ...target(connection), remoteUrl: remoteUrl });
				assert.equal(result.resolution.status, 'resolved', remoteUrl);
				assert.equal(result.resolution.identity?.name, '%2e');
				assert.ok(
					server.requests
						.slice(count)
						.some(r => r.url.pathname === '/tfs/owner/project/_apis/git/repositories/%252e'),
					remoteUrl,
				);
			}
		} finally {
			manager.dispose();
		}
	});

	test('Azure keeps a collection named in the connection address out of the installation path', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		for (const path of ['/tfs', '']) {
			const server = createServer(id, `https://server.test${path}/DefaultCollection`);
			const manager = server.createManager();
			try {
				await manager.refreshConnections();
				const [connection] = manager.getConfigured(id);
				const remotes = [
					`https://server.test${path}/DefaultCollection/project/_git/repo`,
					`ssh://git@server.test${path}/DefaultCollection/project/_git/repo`,
				];
				if (path) {
					remotes.push('ssh://git@server.test/DefaultCollection/project/_git/repo');
				}
				for (const remoteUrl of remotes) {
					const count = server.requests.length;
					const result = await manager.resolveRepository({ ...target(connection), remoteUrl: remoteUrl });
					assert.equal(result.resolution.status, 'resolved', `${remoteUrl}: ${JSON.stringify(result)}`);
					assert.equal(result.resolution.identity?.owner, 'DefaultCollection');
					assert.ok(
						server.requests
							.slice(count)
							.some(
								r => r.url.pathname === `${path}/DefaultCollection/project/_apis/git/repositories/repo`,
							),
						`${remoteUrl}: ${server.requests
							.slice(count)
							.map(r => r.url.pathname)
							.join(', ')}`,
					);
				}
			} finally {
				manager.dispose();
			}
		}
	});

	test('Azure matches installation paths decoded and case-insensitively', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		const server = createServer(id, 'https://server.test/tfs/DefaultCollection');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(id);
			for (const remoteUrl of [
				'https://server.test/TFS/defaultcollection/project/_git/repo',
				'https://server.test/%74fs/Default%43ollection/project/_git/repo',
			]) {
				const count = server.requests.length;
				const result = await manager.resolveRepository({ ...target(connection), remoteUrl: remoteUrl });
				assert.equal(result.resolution.status, 'resolved', `${remoteUrl}: ${JSON.stringify(result)}`);
				const paths = server.requests.slice(count).map(r => r.url.pathname);
				assert.ok(
					paths.some(p => p.toLowerCase() === '/tfs/defaultcollection/project/_apis/git/repositories/repo'),
					`${remoteUrl}: ${paths.join(', ')}`,
				);
			}
		} finally {
			manager.dispose();
		}
	});

	test('Azure repository-list reads keep a collection named in the address once', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		const server = createServer(id, 'https://server.test/tfs/DefaultCollection');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(id);
			const repos = [{ namespace: 'DefaultCollection', name: 'repo', project: 'project' }];
			const count = server.requests.length;
			const pulls = await manager.listPullRequestsPage({ ...target(connection), repos: repos });
			assert.ok(!pulls.fetchFailed, JSON.stringify(pulls));
			const issues = await manager.listIssuesPage({
				...target(connection),
				repos: repos,
				includeAllAssignees: true,
			});
			assert.ok(!issues.fetchFailed, JSON.stringify(issues));
			// An unfiltered pull request read may span collections; each repository keeps its own base.
			await manager.listPullRequestsPage({
				...target(connection),
				repos: [...repos, { namespace: 'OtherCollection', name: 'repo', project: 'project' }],
			});
			const paths = server.requests.slice(count).map(r => r.url.pathname);
			assert.ok(
				paths.some(p => p.startsWith('/tfs/DefaultCollection/project/')),
				paths.join(', '),
			);
			assert.ok(!paths.some(p => p.includes('/DefaultCollection/DefaultCollection/')), paths.join(', '));
		} finally {
			manager.dispose();
		}
	});

	test('Azure never widens an address naming the collection to another directory', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		const server = createServer(id, 'https://server.test/DefaultCollection');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(id);
			for (const remoteUrl of [
				'ssh://git@server.test/other/DefaultCollection/project/_git/repo',
				'https://server.test/DefaultCollection/other/DefaultCollection/project/_git/repo',
			]) {
				const count = server.requests.length;
				const result = await manager.resolveRepository({ ...target(connection), remoteUrl: remoteUrl });
				assert.notEqual(result.resolution.status, 'resolved', `${remoteUrl}: ${JSON.stringify(result)}`);
				for (const request of server.requests.slice(count)) {
					assert.ok(!request.url.pathname.includes('/other/'), request.url.href);
				}
			}
		} finally {
			manager.dispose();
		}
	});

	test('Azure tells a virtual directory apart from a collection of the same name', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		const server = createServer(id, 'https://server.test/tfs');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(id);
			const count = server.requests.length;
			const result = await manager.resolveRepository({
				...target(connection),
				remoteUrl: 'https://server.test/tfs/tfs/project/_git/repo',
			});
			assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
			assert.ok(
				server.requests
					.slice(count)
					.some(r => r.url.pathname === '/tfs/tfs/project/_apis/git/repositories/repo'),
				server.requests
					.slice(count)
					.map(r => r.url.pathname)
					.join(', '),
			);
		} finally {
			manager.dispose();
		}
	});

	test('Azure applies an SSH virtual directory once and refuses another directory', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		const server = createServer(id, 'https://server.test/tfs/team');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(id);
			const result = await manager.resolveRepository({
				...target(connection),
				remoteUrl: 'ssh://git@server.test/tfs/team/owner/project/_git/repo',
			});
			assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
			assert.ok(
				server.requests.some(r => r.url.pathname === '/tfs/team/owner/project/_apis/git/repositories/repo'),
			);
			const count = server.requests.length;
			const rejected = await manager.resolveRepository({
				...target(connection),
				remoteUrl: 'ssh://git@server.test/other/owner/project/_git/repo',
			});
			assert.notEqual(rejected.resolution.status, 'resolved');
			assert.equal(server.requests.length, count);
		} finally {
			manager.dispose();
		}
	});

	test('Azure appends the virtual directory when the connection is addressed at the host root', async () => {
		const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		const server = createServer(id, 'https://server.test');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(id);
			assert.equal(connection.baseUrl, 'https://server.test');
			for (const remoteUrl of [
				'https://server.test/tfs/team/owner/project/_git/repo',
				'ssh://git@server.test/tfs/team/owner/project/_git/repo',
			]) {
				const count = server.requests.length;
				const result = await manager.resolveRepository({ ...target(connection), remoteUrl: remoteUrl });
				assert.equal(result.resolution.status, 'resolved', JSON.stringify(result));
				assert.ok(
					server.requests
						.slice(count)
						.some(r => r.url.pathname === '/tfs/team/owner/project/_apis/git/repositories/repo'),
					remoteUrl,
				);
			}
		} finally {
			manager.dispose();
		}
	});

	test('Jira Data Center keeps its context path during initialization and project discovery', async () => {
		const server = createServer(IssuesSelfManagedHostIntegrationId.JiraServer, 'https://server.test:8443/jira');
		const manager = server.createManager();
		try {
			await manager.refreshConnections();
			const [connection] = manager.getConfigured(IssuesSelfManagedHostIntegrationId.JiraServer);
			await manager.listProjects(target(connection));
			await manager.listIssueTrackerIssuesPage(target(connection));
			assert.ok(server.requests.some(r => r.url.pathname.endsWith('/myself')));
			assert.ok(server.requests.some(r => r.url.pathname.endsWith('/project')));
			for (const request of server.requests) {
				assert.ok(request.url.href.startsWith('https://server.test:8443/jira/'), request.url.href);
			}
		} finally {
			manager.dispose();
		}
	});
});
