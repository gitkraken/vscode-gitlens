import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { AuthenticationError, RequestNotFoundError } from '../errors.js';
import { createIntegrationManager } from '../index.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderRepository } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies `resolveRepository` (#5438): remote-URL → provider identity for every git host with a
 * `getRepo` client, config-driven custom-domain matching, and status mapping (resolved / not-found /
 * error / no-connection / unsupported) driven by the real per-provider `getRepoInfo` override.
 */

function primarySession(token: string, domain: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

const repoResult = { id: 'r1' } as unknown as ProviderRepository;

function stubGetRepo(
	gh: GitHostIntegration,
	impl: (owner: string, name: string, project?: string) => Promise<ProviderRepository | undefined>,
): void {
	(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve({
			getRepo: (_t: unknown, owner: string, name: string, project?: string) => impl(owner, name, project),
		});
}

async function connect(
	manager: ReturnType<typeof createIntegrationManager>,
	id: GitCloudHostIntegrationId,
	domain: string,
) {
	const gh = await manager.get(id);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t', domain);
	return gh;
}

async function connectSelfManaged(
	manager: ReturnType<typeof createIntegrationManager>,
	id: GitSelfManagedHostIntegrationId,
	domain: string,
) {
	const gh = await manager.get(id, domain);
	assert.ok(gh != null, `${id} integration should construct for ${domain}`);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t', domain);
	return gh;
}

suite('resolveRepository (#5438)', () => {
	test('resolves github.com / gitlab.com / bitbucket.org to their provider identity', async () => {
		const cases: Array<{ id: GitCloudHostIntegrationId; url: string; domain: string }> = [
			{ id: GitCloudHostIntegrationId.GitHub, url: 'https://github.com/octocat/hello.git', domain: 'github.com' },
			{ id: GitCloudHostIntegrationId.GitLab, url: 'https://gitlab.com/group/proj.git', domain: 'gitlab.com' },
			{
				id: GitCloudHostIntegrationId.Bitbucket,
				url: 'https://bitbucket.org/team/repo.git',
				domain: 'bitbucket.org',
			},
		];
		for (const c of cases) {
			const manager = createIntegrationManager(createFakeRuntime());
			const gh = await connect(manager, c.id, c.domain);
			stubGetRepo(gh, () => Promise.resolve(repoResult));

			const result = await manager.resolveRepository({ remoteUrl: c.url });
			assert.equal(result.resolution.status, 'resolved', `${c.id} resolves`);
			assert.equal(result.resolution.identity?.providerId, c.id);
			assert.equal(result.cliUnsupported, false);

			manager.dispose();
		}
	});

	test('resolves an Azure DevOps repo, passing the parsed project through', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const az = await connect(manager, GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com');
		let capturedProject: string | undefined;
		stubGetRepo(az, (_o, _n, project) => {
			capturedProject = project;
			return Promise.resolve(repoResult);
		});

		const result = await manager.resolveRepository({
			remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
		});
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(capturedProject, 'myproject', 'the Azure project is derived from the URL and forwarded');

		manager.dispose();
	});

	test('matches a custom GitHub Enterprise domain via getRemoteConfigs (id inferred, not unsupported)', async () => {
		const runtime = createFakeRuntime();
		runtime.config.getRemoteConfigs = () => [{ type: 'github', domain: 'ghe.example.com' }];
		const manager = createIntegrationManager(runtime);

		const result = await manager.resolveRepository({ remoteUrl: 'https://ghe.example.com/org/repo.git' });
		// The custom domain matched → GHE inferred; unconnected here, so it degrades to no-connection
		// (NOT unsupported, which would mean the matcher failed to recognize the host).
		assert.notEqual(result.resolution.status, 'unsupported');
		assert.equal(result.resolution.status, 'no-connection');

		manager.dispose();
	});

	test('matches a regex-based custom remote via getRemoteConfigs (not unsupported)', async () => {
		const runtime = createFakeRuntime();
		// A custom remote configured with `regex` (no `domain`) must still reach the matcher; otherwise the
		// host resolves as `unsupported`.
		runtime.config.getRemoteConfigs = () => [{ type: 'github', regex: 'ghe\\.example\\.com' }];
		const manager = createIntegrationManager(runtime);

		const result = await manager.resolveRepository({ remoteUrl: 'https://ghe.example.com/org/repo.git' });
		assert.notEqual(result.resolution.status, 'unsupported');
		assert.equal(result.resolution.status, 'no-connection');

		manager.dispose();
	});

	test('uses the explicit host override when the remote URL has no parsed domain', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.resolve(repoResult));

		const result = await manager.resolveRepository({
			providerId: GitCloudHostIntegrationId.GitHub,
			host: 'github.com',
			remoteUrl: 'octocat/hello.git',
		});
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.providerId, GitCloudHostIntegrationId.GitHub);

		manager.dispose();
	});

	test('an issue-tracker providerId is unsupported (no getRepo client)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const result = await manager.resolveRepository({
			providerId: IssuesCloudHostIntegrationId.Jira,
			remoteUrl: 'https://github.com/octocat/hello.git',
		});
		assert.equal(result.resolution.status, 'unsupported');
		assert.equal(result.cliUnsupported, true);

		manager.dispose();
	});

	test('an unparseable / unmatched URL is unsupported', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const result = await manager.resolveRepository({ remoteUrl: 'not a url' });
		assert.equal(result.resolution.status, 'unsupported');
		assert.equal(result.cliUnsupported, true);

		manager.dispose();
	});

	test('a 404 (RequestNotFoundError) maps to not-found, not error', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/gone.git' });
		assert.equal(result.resolution.status, 'not-found');
		assert.equal(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('an auth failure maps to error with an auth warning', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () =>
			Promise.reject(
				new AuthenticationError({
					providerId: GitCloudHostIntegrationId.GitHub,
					microHash: undefined,
					cloud: true,
					type: 'oauth',
					scopes: ['repo'],
				}),
			),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'error');
		assert.equal(result.resolution.warning?.kind, 'auth');
		assert.equal(result.resolution.warning?.isAuth, true);

		manager.dispose();
	});

	test('a connected-but-no-session read degrades to no-connection', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		// Do NOT set a session: getRepoInfo resolves no session and returns undefined.
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		stubGetRepo(gh, () => Promise.resolve(repoResult));

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'no-connection');

		manager.dispose();
	});

	test('Azure DevOps Server getRepoInfo degrades to undefined instead of calling the unsupported repo route', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const az = await connectSelfManaged(
			manager,
			GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			'ado-server.example.com',
		);
		let called = false;
		stubGetRepo(az, () => {
			called = true;
			return Promise.reject(new Error('unexpected getRepo call'));
		});

		const repo = await az.getRepoInfo?.({ owner: 'myorg', name: 'myrepo', project: 'myproject' });
		assert.equal(repo, undefined);
		assert.equal(called, false, 'Azure DevOps Server should not call ProvidersApi.getRepo');

		manager.dispose();
	});
});
