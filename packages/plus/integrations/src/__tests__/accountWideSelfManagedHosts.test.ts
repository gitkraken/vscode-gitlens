import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { primarySession } from './sweepHelpers.js';

/**
 * Account-wide reads must cover EVERY configured host of a self-managed provider, git host or issue tracker alike.
 * `get(id)` with no domain resolves a single instance (the first cached, else the primary), so a user connected to
 * two GitHub Enterprise servers or two Jira Data Center instances silently got issues from one of them and no
 * indication the other was skipped (#5873).
 */

const hostA = 'ghe-a.example.com';
const hostB = 'ghe-b.example.com';

type MyIssuesSeam = {
	searchProviderMyIssues: (
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
	) => Promise<IssueShape[] | undefined>;
};

type MyPullRequestsSeam = {
	searchProviderMyPullRequests: (session: ProviderAuthenticationSession) => Promise<PullRequest[] | undefined>;
};

function issue(host: string, id: string): IssueShape {
	return {
		id: id,
		title: `Issue ${id} on ${host}`,
		provider: { id: 'github', name: 'GitHub Enterprise', domain: host },
	} as unknown as IssueShape;
}

function gitHubEnterpriseRemote(host: string, repo: string, scheme = 'https://'): GitRemote {
	return {
		name: 'origin',
		scheme: scheme,
		provider: { id: 'github', domain: host, owner: 'octo', repoName: repo, custom: false },
	} as unknown as GitRemote;
}

/**
 * Two GitHub Enterprise hosts, each with its own primary session. Host B is configured with a URL-shaped domain
 * on purpose: the fan-out must collapse it onto the same bare-host cache key `get(id, host)` uses, or the read
 * would build (and read through) a second, sessionless instance for the same server.
 */
async function connectedHosts(
	runtime: ReturnType<typeof createFakeRuntime>,
): Promise<{ manager: ReturnType<typeof createIntegrationManager>; byHost: Map<string, GitHostIntegration> }> {
	await runtime.storage.store('integrations:configured', {
		[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
			{
				id: 'ghe-a1',
				cloud: true,
				integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				domain: hostA,
				scopes: 'repo',
				primary: true,
			},
			{
				id: 'ghe-b1',
				cloud: true,
				integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				domain: `https://${hostB}`,
				scopes: 'repo',
			},
		],
	});

	const manager = createIntegrationManager(runtime);
	const byHost = new Map<string, GitHostIntegration>();
	for (const host of [hostA, hostB]) {
		const integration = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, host);
		assert.ok(integration != null, `integration for ${host} resolves`);
		(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession(`token-${host}`),
			domain: host,
		};
		byHost.set(host, integration);
	}
	return { manager: manager, byHost: byHost };
}

function stubIssues(byHost: Map<string, GitHostIntegration>, reads: string[]): void {
	for (const [host, integration] of byHost) {
		(integration as unknown as MyIssuesSeam).searchProviderMyIssues = session => {
			reads.push(session.accessToken);
			return Promise.resolve([issue(host, '1')]);
		};
	}
}

suite('account-wide reads over every self-managed host (#5873)', () => {
	for (const firstHost of ['disconnected', 'unavailable', 'inaccessible'] as const) {
		test(`connection checks find a later host when the first is ${firstHost}`, async () => {
			const runtime = createFakeRuntime();
			const { manager, byHost } = await connectedHosts(runtime);
			const a = byHost.get(hostA)!;
			const b = byHost.get(hostB)!;
			Object.defineProperty(a, 'maybeConnected', {
				value: firstHost === 'unavailable' ? undefined : firstHost === 'inaccessible',
			});
			a.isConnected = () => Promise.reject(new Error('Host unavailable'));
			a.access = () => Promise.resolve(false);
			b.access = () => Promise.resolve(true);

			assert.equal(await manager.isConnectedForAccountWideRead(a.id), true);
			assert.equal(await manager.isConnectedForAccountWideRead(a.id, { access: true }), true);
			b.access = () => Promise.resolve(false);
			assert.equal(await manager.isConnectedForAccountWideRead(a.id, { access: true }), false);
			assert.equal(await manager.isConnectedForAccountWideRead(a.id), true);
			manager.dispose();
		});
	}

	test('getMyIssues reads every configured host of a self-managed provider, not just the primary', async () => {
		const runtime = createFakeRuntime();
		const { manager, byHost } = await connectedHosts(runtime);
		const reads: string[] = [];
		stubIssues(byHost, reads);

		const result = await manager.getMyIssues([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]);

		assert.deepEqual(reads.sort(), [`token-${hostA}`, `token-${hostB}`], 'each host is read with its own session');
		assert.equal(result?.error, undefined);
		assert.deepEqual(
			result?.value?.map(i => `${i.provider.domain}#${i.id}`).sort(),
			[`${hostA}#1`, `${hostB}#1`],
			'an issue key shared by two hosts is kept for both; identity stays per host',
		);

		manager.dispose();
	});

	test('getMyIssues with no ids fans the self-managed provider out over every host too', async () => {
		const runtime = createFakeRuntime();
		const { manager, byHost } = await connectedHosts(runtime);
		const reads: string[] = [];
		stubIssues(byHost, reads);

		const result = await manager.getMyIssues();

		assert.deepEqual(reads.sort(), [`token-${hostA}`, `token-${hostB}`]);
		assert.equal(result?.value?.length, 2);

		manager.dispose();
	});

	test('getMyIssues keeps the hosts that succeeded when one host fails', async () => {
		const runtime = createFakeRuntime();
		const { manager, byHost } = await connectedHosts(runtime);
		const failure = new Error('host A is down');
		(byHost.get(hostA) as unknown as MyIssuesSeam).searchProviderMyIssues = () => Promise.reject(failure);
		(byHost.get(hostB) as unknown as MyIssuesSeam).searchProviderMyIssues = () =>
			Promise.resolve([issue(hostB, '7')]);

		const result = await manager.getMyIssues([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]);

		assert.deepEqual(
			result?.value?.map(i => `${i.provider.domain}#${i.id}`),
			[`${hostB}#7`],
			'the surviving host still contributes its issues',
		);
		assert.equal(result?.error, failure, 'the failing host is reported alongside the surviving results');

		manager.dispose();
	});

	for (const method of ['getMyIssues', 'getMyPullRequests'] as const) {
		test(`${method} reports a session rejection alongside another host's results`, async () => {
			const runtime = createFakeRuntime();
			const { manager, byHost } = await connectedHosts(runtime);
			const a = byHost.get(hostA)!;
			const b = byHost.get(hostB)!;
			const failure = new Error('host A session unavailable');
			Object.defineProperty(a, 'maybeConnected', { value: undefined });
			a.isConnected = () => Promise.reject(failure);
			(b as unknown as MyIssuesSeam).searchProviderMyIssues = () => Promise.resolve([issue(hostB, '7')]);
			(b as unknown as MyPullRequestsSeam).searchProviderMyPullRequests = () =>
				Promise.resolve([{ id: '7' } satisfies Partial<PullRequest> as PullRequest]);

			const result = await manager[method]([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]);

			assert.deepEqual(
				result?.value?.map(item => item.id),
				['7'],
			);
			assert.equal(result?.error, failure);
			manager.dispose();
		});

		test(`${method} combines session rejections and provider errors`, async () => {
			const runtime = createFakeRuntime();
			const { manager, byHost } = await connectedHosts(runtime);
			const a = byHost.get(hostA)!;
			const b = byHost.get(hostB)!;
			const failure = new Error('host B request failed');
			Object.defineProperty(a, 'maybeConnected', { value: undefined });
			// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Session providers can reject with non-Error values.
			a.isConnected = () => Promise.reject('host A session unavailable');
			(b as unknown as MyIssuesSeam).searchProviderMyIssues = () => Promise.reject(failure);
			(b as unknown as MyPullRequestsSeam).searchProviderMyPullRequests = () => Promise.reject(failure);

			const result = await manager[method]([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]);

			assert.deepEqual(result?.value, []);
			assert.ok(result?.error instanceof AggregateError);
			assert.deepEqual(result.error.errors, [new Error('host A session unavailable'), failure]);
			manager.dispose();
		});
	}

	test('getMyIssues with openRepositoriesOnly scopes each host to the repositories open on that host', async () => {
		const runtime = createFakeRuntime();
		runtime.repositories.getOpenRemotes = () =>
			Promise.resolve([gitHubEnterpriseRemote(hostA, 'repo-a'), gitHubEnterpriseRemote(hostB, 'repo-b')]);
		const { manager, byHost } = await connectedHosts(runtime);

		const scopes = new Map<string, string[] | undefined>();
		for (const [host, integration] of byHost) {
			(integration as unknown as MyIssuesSeam).searchProviderMyIssues = (_session, resources) => {
				scopes.set(
					host,
					resources?.map(r => r.key),
				);
				return Promise.resolve([]);
			};
		}

		await manager.getMyIssues([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise], {
			openRepositoriesOnly: true,
		});

		assert.deepEqual(
			[...scopes].sort(),
			[
				[hostA, ['octo/repo-a']],
				[hostB, ['octo/repo-b']],
			],
			'a host is only asked about the repositories that live on it',
		);

		manager.dispose();
	});

	test('getMyIssues with openRepositoriesOnly skips a host with no open repository', async () => {
		const runtime = createFakeRuntime();
		runtime.repositories.getOpenRemotes = () => Promise.resolve([gitHubEnterpriseRemote(hostA, 'repo-a')]);
		const { manager, byHost } = await connectedHosts(runtime);
		const reads: string[] = [];
		stubIssues(byHost, reads);

		await manager.getMyIssues([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise], {
			openRepositoriesOnly: true,
		});

		assert.deepEqual(reads, [`token-${hostA}`], 'only the host with an open repository is read');

		manager.dispose();
	});

	test('getMyIssues reads every configured Jira Data Center instance, and never scopes a tracker to repositories', async () => {
		const runtime = createFakeRuntime();
		const jiraA = 'jira-a.example.com';
		const jiraB = 'jira-b.example.com';
		await runtime.storage.store('integrations:configured', {
			[IssuesSelfManagedHostIntegrationId.JiraServer]: [
				{
					id: 'jira-a1',
					cloud: true,
					integrationId: IssuesSelfManagedHostIntegrationId.JiraServer,
					domain: jiraA,
					scopes: '',
					primary: true,
				},
				{
					id: 'jira-b1',
					cloud: true,
					integrationId: IssuesSelfManagedHostIntegrationId.JiraServer,
					domain: jiraB,
					scopes: '',
				},
			],
		});
		runtime.repositories.getOpenRemotes = () => Promise.resolve([gitHubEnterpriseRemote(hostA, 'repo-a')]);
		const manager = createIntegrationManager(runtime);

		const scopes = new Map<string, string[] | undefined>();
		for (const host of [jiraA, jiraB]) {
			const integration = await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, host);
			assert.ok(integration != null, `integration for ${host} resolves`);
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession(`token-${host}`),
				type: 'pat',
				domain: host,
			};
			(integration as unknown as MyIssuesSeam).searchProviderMyIssues = (_session, resources) => {
				scopes.set(
					host,
					resources?.map(r => r.key),
				);
				return Promise.resolve([issue(host, 'PROJ-1')]);
			};
		}

		const result = await manager.getMyIssues([IssuesSelfManagedHostIntegrationId.JiraServer], {
			openRepositoriesOnly: true,
		});

		assert.deepEqual(
			[...scopes].sort(),
			[
				[jiraA, undefined],
				[jiraB, undefined],
			],
			'both instances are read, account-wide, even with openRepositoriesOnly',
		);
		assert.deepEqual(
			result?.value?.map(i => `${i.provider.domain}#${i.id}`).sort(),
			[`${jiraA}#PROJ-1`, `${jiraB}#PROJ-1`],
			'the same issue key on two instances is kept for both',
		);

		manager.dispose();
	});

	for (const selection of ['explicit', 'omitted', 'empty'] as const) {
		test(`getMyPullRequests reads every configured host with ${selection} ids`, async () => {
			const runtime = createFakeRuntime();
			const { manager, byHost } = await connectedHosts(runtime);
			const reads: string[] = [];
			for (const integration of byHost.values()) {
				(integration as unknown as MyPullRequestsSeam).searchProviderMyPullRequests = session => {
					reads.push(session.accessToken);
					return Promise.resolve([]);
				};
			}

			await manager.getMyPullRequests(
				selection === 'explicit'
					? [GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]
					: selection === 'empty'
						? []
						: undefined,
			);

			assert.deepEqual(
				reads.sort(),
				[`token-${hostA}`, `token-${hostB}`],
				'each host is read with its own session',
			);

			manager.dispose();
		});
	}

	test('getMyIssues credits an SSH remote to the host configured with a web port', async () => {
		// `parseGitRemoteUrl` drops an SSH port, so the remote names `host` while the connection is keyed
		// `host:8443`: they must still match by hostname, or the host is skipped as having no open repository.
		const runtime = createFakeRuntime();
		const webPortHost = 'ghe-a.example.com:8443';
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: `https://${webPortHost}`,
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'ghe-b1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: hostB,
					scopes: 'repo',
				},
			],
		});
		runtime.repositories.getOpenRemotes = () =>
			Promise.resolve([
				gitHubEnterpriseRemote('ghe-a.example.com', 'repo-a', ''),
				// A web remote must match exactly: same hostname as host A, but a port it isn't served on.
				gitHubEnterpriseRemote('ghe-a.example.com:9999', 'repo-other', 'https://'),
			]);
		const manager = createIntegrationManager(runtime);

		const scopes = new Map<string, string[] | undefined>();
		for (const host of [webPortHost, hostB]) {
			const integration = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, host);
			assert.ok(integration != null, `integration for ${host} resolves`);
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession(`token-${host}`),
				domain: host,
			};
			(integration as unknown as MyIssuesSeam).searchProviderMyIssues = (_session, resources) => {
				scopes.set(
					host,
					resources?.map(r => r.key),
				);
				return Promise.resolve([]);
			};
		}

		await manager.getMyIssues([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise], {
			openRepositoriesOnly: true,
		});

		assert.deepEqual(
			[...scopes],
			[[webPortHost, ['octo/repo-a']]],
			'the SSH remote is read on its host; the other host, with no remote of its own, is skipped',
		);

		manager.dispose();
	});

	test('getMyIssues reads each host through its own stored session, and covers locally configured hosts', async () => {
		// No injected `_session`: the sessions come from storage the way they do in production, so this pins
		// that each host's read resolves its own connection's token. Host B is configured locally (`cloud: false`),
		// which `get(id)` already considered when picking a primary and which the fan-out must not drop.
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: hostA,
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'ghe-b1',
					cloud: false,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: hostB,
					scopes: 'repo',
				},
			],
		});
		for (const [connectionId, host, cloud] of [
			['ghe-a1', hostA, true],
			['ghe-b1', hostB, false],
		] as const) {
			await runtime.storage.storeSecret(
				`integration.auth${cloud ? '.cloud' : ''}:${GitSelfManagedHostIntegrationId.CloudGitHubEnterprise}|${connectionId}`,
				JSON.stringify({
					id: connectionId,
					accessToken: `token-${host}`,
					scopes: ['repo'],
					cloud: cloud,
					type: cloud ? 'oauth' : 'pat',
					domain: host,
					...(cloud ? { expiresAt: new Date(Date.now() + 60 * 60 * 1000) } : {}),
				}),
			);
		}
		const manager = createIntegrationManager(runtime);

		const reads: string[] = [];
		for (const host of [hostA, hostB]) {
			const integration = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, host);
			assert.ok(integration != null, `integration for ${host} resolves`);
			(integration as unknown as MyIssuesSeam).searchProviderMyIssues = session => {
				reads.push(`${host}:${session.accessToken}`);
				return Promise.resolve([]);
			};
		}

		await manager.getMyIssues([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]);

		assert.deepEqual(reads.sort(), [`${hostA}:token-${hostA}`, `${hostB}:token-${hostB}`]);

		manager.dispose();
	});

	test('getMyIssues credits every remote to the only configured host, even one named through an alias', async () => {
		// With one host there is nowhere else a remote can live, so a remote addressed through an SSH alias or a
		// custom domain stays scoped to it, as it was before the read fanned out over hosts.
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: hostA,
					scopes: 'repo',
					primary: true,
				},
			],
		});
		runtime.repositories.getOpenRemotes = () =>
			Promise.resolve([gitHubEnterpriseRemote('ssh.ghe-a.example.com', 'repo-a', '')]);
		const manager = createIntegrationManager(runtime);

		const integration = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, hostA);
		assert.ok(integration != null);
		(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession(`token-${hostA}`),
			domain: hostA,
		};
		let scope: string[] | undefined;
		(integration as unknown as MyIssuesSeam).searchProviderMyIssues = (_session, resources) => {
			scope = resources?.map(r => r.key);
			return Promise.resolve([]);
		};

		await manager.getMyIssues([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise], {
			openRepositoriesOnly: true,
		});

		assert.deepEqual(scope, ['octo/repo-a']);

		manager.dispose();
	});

	test('getMyIssues credits an SSH remote to no host when its hostname names several configured hosts', async () => {
		// Two instances on one machine, told apart only by port: an SSH remote's port says nothing about either, so
		// it can't be attributed, the same refusal `resolveRepository` makes.
		const runtime = createFakeRuntime();
		const [portA, portB] = ['ghe.example.com:8443', 'ghe.example.com:9443'];
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [portA, portB].map((host, index) => ({
				id: `ghe-${index}`,
				cloud: true,
				integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				domain: `https://${host}`,
				scopes: 'repo',
				primary: true,
			})),
		});
		runtime.repositories.getOpenRemotes = () =>
			Promise.resolve([
				gitHubEnterpriseRemote('ghe.example.com', 'ambiguous', ''),
				gitHubEnterpriseRemote(portB, 'repo-b', 'https://'),
			]);
		const manager = createIntegrationManager(runtime);

		const scopes = new Map<string, string[] | undefined>();
		for (const host of [portA, portB]) {
			const integration = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, host);
			assert.ok(integration != null, `integration for ${host} resolves`);
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession(`token-${host}`),
				domain: host,
			};
			(integration as unknown as MyIssuesSeam).searchProviderMyIssues = (_session, resources) => {
				scopes.set(
					host,
					resources?.map(r => r.key),
				);
				return Promise.resolve([]);
			};
		}

		await manager.getMyIssues([GitSelfManagedHostIntegrationId.CloudGitHubEnterprise], {
			openRepositoriesOnly: true,
		});

		assert.deepEqual([...scopes], [[portB, ['octo/repo-b']]], 'only the exactly matching web remote is credited');

		manager.dispose();
	});
});
