import * as assert from 'node:assert/strict';
import { suite, teardown, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import { createIntegrationService } from '../integrationService.js';
import type { IntegrationManager } from '../manager.js';
import { createFakeRuntime } from './fakeRuntime.js';

const providerId = GitSelfManagedHostIntegrationId.BitbucketServer;
const connections = [
	{ id: 'account-a', baseUrl: 'https://one.test:8443/bitbucket', token: 'synthetic-a' },
	{ id: 'account-b', baseUrl: 'https://one.test:8443/bitbucket', token: 'synthetic-b' },
	{ id: 'host-b', baseUrl: 'https://two.test/other', token: 'synthetic-c' },
	{ id: 'path-b', baseUrl: 'https://one.test:8443/other', token: 'synthetic-d' },
];

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status: status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

function page(values: unknown[], start = 0, next?: number): Response {
	return json({ values: values, start: start, isLastPage: next == null, nextPageStart: next });
}

function repository(id: number, project = 'PRJ', baseUrl = connections[0].baseUrl) {
	return {
		id: id,
		slug: `repo-${id}`,
		name: `Repository ${id}`,
		project: { key: project },
		links: {
			self: [{ href: `${baseUrl}/projects/${project}/repos/repo-${id}/browse` }],
			clone: [
				{ name: 'http', href: `${baseUrl}/scm/${project}/repo-${id}.git` },
				{ name: 'ssh', href: `ssh://git@${new URL(baseUrl).hostname}/${project}/repo-${id}.git` },
			],
		},
	};
}

suite('Bitbucket Data Center discovery through the public manager', () => {
	const managers: IntegrationManager[] = [];
	teardown(() => {
		for (const manager of managers.splice(0)) {
			manager.dispose();
		}
	});

	async function createServer(respond: (url: URL, connection: (typeof connections)[number]) => Response) {
		const runtime = createFakeRuntime();
		const requests: { url: URL; connectionId: string }[] = [];
		const tokenRequests: string[] = [];
		runtime.account.getAccount = async () => ({ id: 'me' });
		runtime.account.fetchGkApi = async path => {
			tokenRequests.push(path);
			if (path === 'v1/provider-tokens') {
				return json({
					data: connections.map(connection => ({
						tokenId: connection.id,
						provider: toCloudIntegrationType[providerId],
						type: 'pat',
						domain: connection.baseUrl,
					})),
				});
			}

			const connection = connections.find(c => path.includes(`/tokens/${c.id}`)) ?? connections[0];
			return json({
				data: {
					tokenId: connection.id,
					accessToken: connection.token,
					expiresIn: 3600,
					scopes: '',
					type: 'pat',
					domain: connection.baseUrl,
				},
			});
		};
		runtime.http.fetch = async (input, init) => {
			const url = new URL(input);
			const authorization = new Headers(init?.headers).get('authorization');
			const connection = connections.find(c => authorization === `Bearer ${c.token}`);
			assert.ok(connection, 'each request uses a configured credential');
			assert.equal(url.origin, new URL(connection.baseUrl).origin);
			assert.ok(url.pathname.startsWith(`${new URL(connection.baseUrl).pathname}/rest/api/1.0/`));
			if (url.pathname.endsWith('/users')) {
				return json(
					{
						values: [
							{
								id: 1,
								name: 'me',
								slug: 'me',
								displayName: 'Me',
								links: { self: [{ href: `${connection.baseUrl}/users/me` }] },
							},
						],
					},
					200,
					{ 'x-auserid': '1', 'x-ausername': 'me' },
				);
			}

			requests.push({ url: url, connectionId: connection.id });
			return respond(url, connection);
		};
		const manager = createIntegrationManager({ ...runtime, cache: undefined });
		managers.push(manager);
		await manager.refreshConnections();
		assert.equal(manager.getConfigured(providerId).length, connections.length);
		return { manager: manager, requests: requests, tokenRequests: tokenRequests };
	}

	test('drains project pages, keeps empty projects, and uses project keys as org selectors', async () => {
		const { manager, requests } = await createServer(url => {
			if (url.pathname.endsWith('/projects')) {
				return url.searchParams.get('start') === '0'
					? page([{ key: 'PRJ', name: 'Project' }], 0, 7)
					: page(
							[
								{ key: 'PRJ', name: 'Project' },
								{ key: 'EMPTY', name: 'Empty project' },
							],
							7,
						);
			}

			assert.ok(url.pathname.endsWith('/projects/EMPTY/repos'));
			return page([]);
		});
		const target = { providerId: providerId, connectionId: 'account-b' };
		const orgs = await manager.listOrgs(target);
		assert.deepEqual(orgs.items, [
			{ id: 'PRJ', name: 'PRJ', providerId: providerId, url: `${connections[0].baseUrl}/projects/PRJ` },
			{ id: 'EMPTY', name: 'EMPTY', providerId: providerId, url: `${connections[0].baseUrl}/projects/EMPTY` },
		]);
		assert.equal(orgs.fetchFailed, undefined);
		assert.deepEqual(orgs.warnings, []);
		assert.deepEqual(
			requests.map(r => r.url.searchParams.get('start')),
			['0', '7'],
		);
		const repos = await manager.listRepos({ ...target, org: orgs.items[1].name });
		assert.deepEqual(repos.items, []);
		assert.equal(repos.hasMore, false);
		assert.equal(repos.fetchFailed, undefined);
		assert.equal(repos.page.truncated, undefined);
		assert.ok(requests.every(r => r.connectionId === 'account-b'));
	});

	for (const org of [undefined, 'PRJ', '~me']) {
		test(`paginates ${org ?? 'account-wide'} repositories by exact offsets and deduplicates across pages`, async () => {
			const { manager, requests } = await createServer(url => {
				assert.ok(url.pathname.endsWith(org == null ? '/1.0/repos' : `/projects/${org}/repos`));
				const start = Number(url.searchParams.get('start'));
				return start === 0
					? page([repository(1, org), repository(1, org)], 0, 37)
					: page([repository(1, org), repository(2, org)], 37);
			});
			const target = { providerId: providerId, connectionId: 'account-a', org: org };
			const first = await manager.listRepos(target);
			assert.deepEqual(
				first.items.map(r => r.id),
				['1'],
			);
			assert.equal(first.items[0].name, 'repo-1');
			assert.equal(first.items[0].namespace, org ?? 'PRJ');
			assert.equal(first.items[0].cloneUrlHttps, repository(1, org).links.clone[0].href);
			assert.equal(first.items[0].cloneUrlSsh, repository(1, org).links.clone[1].href);
			assert.equal(first.hasMore, true);
			assert.ok(first.cursor);
			assert.ok(!first.cursor.includes(connections[0].token));
			const second = await manager.listRepos({ ...target, cursor: first.cursor, page: 2 });
			assert.deepEqual(
				second.items.map(r => r.id),
				['2'],
			);
			assert.equal(second.hasMore, false);
			assert.equal(second.cursor, undefined);
			assert.equal(second.page.currentPage, 2);
			assert.equal(second.page.truncated, undefined);
			assert.equal(second.fetchFailed, undefined);
			assert.deepEqual(second.warnings, []);
			assert.deepEqual(
				requests.map(r => r.url.searchParams.get('start')),
				['0', '37'],
			);
		});
	}

	test('walks direct page-number requests instead of interpreting a page as an offset', async () => {
		const { manager, requests } = await createServer(url => {
			const start = Number(url.searchParams.get('start'));
			return start === 0 ? page([repository(1)], 0, 37) : page([repository(2)], 37);
		});
		const result = await manager.listRepos({ providerId: providerId, connectionId: 'account-a', page: 2 });
		assert.deepEqual(
			result.items.map(r => r.id),
			['2'],
		);
		assert.equal(result.page.currentPage, 2);
		assert.deepEqual(
			requests.map(r => r.url.searchParams.get('start')),
			['0', '37'],
		);
	});

	test('rejects a page cursor supplied as a repository continuation', async () => {
		const { manager, requests } = await createServer(() => page([repository(1)]));
		const result = await manager.listRepos({
			providerId: providerId,
			connectionId: 'account-a',
			cursor: JSON.stringify({ type: 'page', value: 3 }),
			page: 3,
		});
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.length > 0);
		assert.equal(requests.length, 0);
	});

	test('removes credentials from project and repository links before returning them', async () => {
		const { manager } = await createServer(url => {
			if (url.pathname.endsWith('/projects')) {
				return page([
					{
						key: 'PRJ',
						links: {
							self: [
								{ href: 'https://user:secret@one.test:8443/bitbucket/projects/PRJ?token=secret#part' },
							],
						},
					},
				]);
			}

			const repo = repository(1);
			repo.links.self[0].href =
				'https://user:secret@one.test:8443/bitbucket/projects/PRJ/repos/repo-1/browse?token=secret#part';
			repo.links.clone[0].href =
				'https://user:secret@one.test:8443/bitbucket/scm/PRJ/repo-1.git?token=secret#part';
			repo.links.clone[1].href = 'ssh://git:secret@one.test/PRJ/repo-1.git?token=secret#part';
			return page([repo]);
		});
		const target = { providerId: providerId, connectionId: 'account-a' };
		const orgs = await manager.listOrgs(target);
		const repos = await manager.listRepos(target);
		assert.equal(orgs.items[0].url, 'https://one.test:8443/bitbucket/projects/PRJ');
		assert.equal(repos.items[0].url, 'https://one.test:8443/bitbucket/projects/PRJ/repos/repo-1/browse');
		assert.equal(repos.items[0].cloneUrlHttps, 'https://one.test:8443/bitbucket/scm/PRJ/repo-1.git');
		assert.equal(repos.items[0].cloneUrlSsh, 'ssh://git@one.test/PRJ/repo-1.git');
	});

	test('keeps only links that name the entry on its own installation', async () => {
		const base = connections[0].baseUrl;
		const { manager } = await createServer(url => {
			if (url.pathname.endsWith('/projects')) {
				return page([
					{ key: 'PRJ', links: { self: [{ href: `https://two.test/bitbucket/projects/PRJ` }] } },
					{ key: 'OTHER', links: { self: [{ href: `${base}/projects/PRJ` }] } },
				]);
			}

			const accepted = repository(1);
			accepted.links.clone[0].href = `${base}/scm/prj/repo-1.git`;
			accepted.links.clone[1].href = 'ssh://git@one.test:7999/prj/repo-1.git';
			const personal = repository(2, '~me');
			personal.links.self[0].href = `${base}/users/me/repos/repo-2/browse`;
			const foreign = repository(3);
			foreign.links.self[0].href = 'https://two.test/bitbucket/projects/PRJ/repos/repo-3/browse';
			foreign.links.clone[0].href = 'https://one.test:8443/other/scm/PRJ/repo-3.git';
			foreign.links.clone[1].href = 'ssh://git@two.test/PRJ/repo-3.git';
			const substituted = repository(4);
			substituted.links.self[0].href = `${base}/projects/PRJ/repos/repo-1/browse`;
			substituted.links.clone[0].href = `${base}/scm/OTHER/repo-4.git`;
			substituted.links.clone[1].href = 'ssh://git@one.test/PRJ/repo-1.git';
			return page([accepted, personal, foreign, substituted]);
		});
		const target = { providerId: providerId, connectionId: 'account-a' };
		const orgs = await manager.listOrgs(target);
		assert.deepEqual(
			orgs.items.map(o => o.url),
			[`${base}/projects/PRJ`, `${base}/projects/OTHER`],
		);
		const repos = await manager.listRepos(target);
		assert.deepEqual(
			repos.items.map(r => [r.url, r.cloneUrlHttps, r.cloneUrlSsh]),
			[
				[
					`${base}/projects/PRJ/repos/repo-1/browse`,
					`${base}/scm/prj/repo-1.git`,
					'ssh://git@one.test:7999/prj/repo-1.git',
				],
				[
					`${base}/users/me/repos/repo-2/browse`,
					`${base}/scm/~me/repo-2.git`,
					'ssh://git@one.test/~me/repo-2.git',
				],
				[`${base}/projects/PRJ/repos/repo-3/browse`, `${base}/scm/PRJ/repo-3.git`, undefined],
				[`${base}/projects/PRJ/repos/repo-4/browse`, `${base}/scm/PRJ/repo-4.git`, undefined],
			],
		);
	});

	test('preserves each selected account, host and installation across all discovery pages', async () => {
		const { manager, requests } = await createServer((url, connection) => {
			const start = Number(url.searchParams.get('start'));
			const values = url.pathname.endsWith('/projects')
				? [{ key: `${connection.id}-${start}` }]
				: [repository(start + 1, connection.id, connection.baseUrl)];
			return page(values, start, start === 0 ? 17 : undefined);
		});
		await Promise.all(
			connections.map(async connection => {
				const target = { providerId: providerId, connectionId: connection.id };
				const orgs = await manager.listOrgs(target);
				assert.deepEqual(
					orgs.items.map(o => o.id),
					[`${connection.id}-0`, `${connection.id}-17`],
				);
				const first = await manager.listRepos(target);
				const second = await manager.listRepos({ ...target, cursor: first.cursor, page: 2 });
				assert.equal(first.items[0].namespace, connection.id);
				assert.equal(second.items[0].namespace, connection.id);
				assert.equal(second.fetchFailed, undefined);
			}),
		);
		for (const connection of connections) {
			assert.equal(requests.filter(r => r.connectionId === connection.id).length, 4);
		}
	});

	test('refuses cursors from another account, host, installation or project before fetching', async () => {
		const { manager, requests } = await createServer(() => page([repository(1)], 0, 37));
		const first = await manager.listRepos({ providerId: providerId, connectionId: 'account-a', org: 'PRJ' });
		for (const target of [
			...connections.slice(1).map(c => ({ connectionId: c.id, org: 'PRJ' })),
			{ connectionId: 'account-a', org: 'OTHER' },
			{ connectionId: 'account-a' },
		]) {
			const result = await manager.listRepos({ providerId: providerId, ...target, cursor: first.cursor });
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(result.items, []);
			assert.ok(result.warnings.length > 0);
		}
		assert.equal(requests.length, 1);
	});

	test('refuses empty and dot-segment project keys without widening the request scope', async () => {
		const { manager, requests } = await createServer(() => page([repository(1)]));
		for (const org of ['', '.', '..']) {
			const result = await manager.listRepos({ providerId: providerId, connectionId: 'account-a', org: org });
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
		}
		assert.equal(requests.length, 0);
	});

	for (const status of [401, 403, 429, 503]) {
		test(`preserves projects from earlier pages and classifies a ${status} continuation failure`, async () => {
			const { manager } = await createServer(url =>
				url.searchParams.get('start') === '0' ? page([{ key: 'PRJ' }], 0, 37) : json({}, status),
			);
			const result = await manager.listOrgs({ providerId: providerId, connectionId: 'account-b' });
			assert.deepEqual(
				result.items.map(o => o.id),
				['PRJ'],
			);
			assert.equal(result.fetchFailed, true);
			const warning = result.warnings[0];
			assert.equal(warning.connectionId, 'account-b');
			assert.equal(warning.domain, 'one.test:8443');
			assert.equal(warning.isAuth, status === 401 || status === 403);
			if (status === 429) {
				assert.equal(warning.kind, 'rate-limit');
			}
		});
	}

	test('refreshes a rejected connection after a partial project authentication failure', async () => {
		let continuationFailed = false;
		const { manager, tokenRequests } = await createServer(url => {
			if (url.searchParams.get('start') === '0') return page([{ key: 'PRJ' }], 0, 37);
			if (!continuationFailed) {
				continuationFailed = true;
				return json({}, 401);
			}
			return page([{ key: 'NEXT' }], 37);
		});
		const target = { providerId: providerId, connectionId: 'account-b' };
		const first = await manager.listOrgs(target);
		assert.deepEqual(
			first.items.map(org => org.id),
			['PRJ'],
		);
		assert.equal(first.fetchFailed, true);
		assert.equal(first.warnings[0].kind, 'auth');
		const second = await manager.listOrgs(target);
		assert.deepEqual(
			second.items.map(org => org.id),
			['PRJ', 'NEXT'],
		);
		assert.deepEqual(second.warnings, []);
		assert.deepEqual(
			tokenRequests.filter(path => path.endsWith('/refresh')),
			['v1/provider-tokens/tokens/account-b/refresh'],
		);
	});

	test('reports a failed repository continuation instead of an authoritative empty page', async () => {
		const { manager } = await createServer(url =>
			url.searchParams.get('start') === '0' ? page([repository(1)], 0, 37) : json({}, 401),
		);
		const target = { providerId: providerId, connectionId: 'account-b', org: 'PRJ' };
		const first = await manager.listRepos(target);
		const second = await manager.listRepos({ ...target, cursor: first.cursor, page: 2 });
		assert.equal(second.fetchFailed, true);
		assert.equal(second.warnings[0].kind, 'auth');
		assert.equal(second.warnings[0].connectionId, 'account-b');
		assert.equal(second.hasMore, false);
	});

	test('resumes a repository continuation after recovery rotates the rejected credential', async () => {
		const connection = connections[1];
		const original = connection.token;
		const rotated = `${original}-rotated`;
		try {
			const { manager, tokenRequests } = await createServer((url, current) => {
				if (url.searchParams.get('start') === '0') return page([repository(1)], 0, 37);
				return current.token === rotated ? page([repository(2)], 37) : json({}, 401);
			});
			const target = { providerId: providerId, connectionId: connection.id, org: 'PRJ' };
			const first = await manager.listRepos(target);
			const rejected = await manager.listRepos({ ...target, cursor: first.cursor, page: 2 });
			assert.equal(rejected.fetchFailed, true);
			connection.token = rotated;
			const resumed = await manager.listRepos({ ...target, cursor: first.cursor, page: 2 });
			assert.deepEqual(
				resumed.items.map(r => r.id),
				['2'],
			);
			assert.equal(resumed.fetchFailed, undefined);
			assert.deepEqual(resumed.warnings, []);
			assert.deepEqual(
				tokenRequests.filter(path => path.endsWith('/refresh')),
				[`v1/provider-tokens/tokens/${connection.id}/refresh`],
			);
		} finally {
			connection.token = original;
		}
	});

	for (const next of [undefined, 0, -1, 0.5]) {
		test(`marks an unusable continuation (${next}) as incomplete`, async () => {
			const { manager } = await createServer(url =>
				json({
					values: url.pathname.endsWith('/projects') ? [{ key: 'PRJ' }] : [repository(1)],
					start: 0,
					isLastPage: false,
					nextPageStart: next,
				}),
			);
			const target = { providerId: providerId, connectionId: 'account-a' };
			const projects = await manager.listOrgs(target);
			assert.equal(projects.items.length, 1);
			assert.equal(projects.fetchFailed, true);
			const repos = await manager.listRepos(target);
			assert.equal(repos.items.length, 1);
			assert.equal(repos.page.truncated, true);
			assert.equal(repos.hasMore, false);
			assert.equal(repos.cursor, undefined);
			assert.ok(repos.warnings.length > 0);
		});
	}

	for (const body of [null, {}, { values: [], start: 0 }, { values: [], isLastPage: true, start: 3 }]) {
		test(`rejects a malformed page (${JSON.stringify(body)})`, async () => {
			const { manager } = await createServer(() => json(body));
			const target = { providerId: providerId, connectionId: 'account-a' };
			assert.equal((await manager.listOrgs(target)).fetchFailed, true);
			assert.equal((await manager.listRepos(target)).fetchFailed, true);
		});
	}

	test('signals incomplete project discovery when the drain reaches its page budget', async () => {
		const { manager, requests } = await createServer(url => {
			const start = Number(url.searchParams.get('start'));
			return page([{ key: `PRJ${start}` }], start, start + 13);
		});
		const result = await manager.listOrgs({ providerId: providerId, connectionId: 'account-a' });
		assert.equal(result.items.length, 20);
		assert.equal(requests.length, 20);
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.length > 0);
	});

	test('empty accounts succeed and unsupported issue operations and extra project tiers stay absent', async () => {
		const { manager, requests } = await createServer(() => page([]));
		const target = { providerId: providerId, connectionId: 'account-a' };
		const orgs = await manager.listOrgs(target);
		assert.deepEqual(orgs.items, []);
		assert.deepEqual(orgs.warnings, []);
		assert.equal(orgs.fetchFailed, undefined);
		const projects = await manager.listProjects(target);
		assert.deepEqual(projects.items, []);
		assert.deepEqual(projects.warnings, []);
		assert.equal(projects.fetchFailed, undefined);
		const repos = await manager.listRepos(target);
		assert.deepEqual(repos.items, []);
		assert.equal(repos.fetchFailed, undefined);
		const issues = await manager.listIssuesPage(target);
		assert.equal(issues.fetchFailed, true);
		assert.deepEqual(manager.getSupportedFilters(providerId).issues, []);
		assert.equal(requests.length, 2);
	});

	test('Bitbucket Cloud still discovers workspaces and pages workspace repositories through its own API', async () => {
		const runtime = createFakeRuntime();
		const requests: URL[] = [];
		runtime.http.fetch = async input => {
			const url = new URL(input);
			requests.push(url);
			assert.equal(url.origin, 'https://api.bitbucket.org');
			if (url.pathname === '/2.0/user/workspaces') {
				return json({ values: [{ workspace: { uuid: 'workspace-id', slug: 'team' } }], page: 1 });
			}

			assert.equal(url.pathname, '/2.0/repositories/team');
			const currentPage = Number(url.searchParams.get('page'));
			return json({
				values: [],
				page: currentPage,
				next: currentPage === 1 ? `${url.origin}${url.pathname}?page=2` : undefined,
			});
		};
		const manager = createIntegrationService(runtime);
		managers.push(manager);
		const integration = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
			id: 'cloud',
			accessToken: 'synthetic-cloud',
			account: { id: 'me', label: 'Me' },
			scopes: [],
			cloud: true,
			type: 'oauth',
			domain: 'bitbucket.org',
			expiresAt: new Date(Date.now() + 60_000),
		};
		const target = { providerId: GitCloudHostIntegrationId.Bitbucket };
		const orgs = await manager.listOrgs(target);
		assert.deepEqual(orgs.items, [
			{ id: 'workspace-id', name: 'team', providerId: 'bitbucket', url: 'https://bitbucket.org/team' },
		]);
		const first = await manager.listRepos({ ...target, org: 'team' });
		assert.equal(first.hasMore, true);
		const second = await manager.listRepos({ ...target, org: 'team', cursor: first.cursor, page: 2 });
		assert.equal(second.hasMore, false);
		assert.equal(second.fetchFailed, undefined);
		assert.equal((await manager.listRepos(target)).fetchFailed, true);
		assert.deepEqual(
			requests.map(url => url.searchParams.get('page')),
			['1', '1', '2'],
		);
	});
});
