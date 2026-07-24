import * as assert from 'node:assert/strict';
import { GraphQLErrors } from '@gitkraken/provider-apis';
import type { GraphQLError } from '@gitkraken/provider-apis';
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
import type { ProvidersApi } from '../providers/providersApi.js';
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

/**
 * Overrides the real `getRepoFn` on the manager's `ProvidersApi` so the resolution goes through the
 * actual `ProvidersApi.getRepo` (and its GraphQL not-found classification), NOT the pre-classified stub
 * that `stubGetRepo` installs. This is what lets these tests feed the real SDK error shapes and verify
 * they map to `not-found` (#5559).
 */
async function stubRealGetRepoFn(
	manager: ReturnType<typeof createIntegrationManager>,
	id: GitCloudHostIntegrationId,
	impl: () => never,
): Promise<void> {
	const api = await (manager as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();
	const providers = (api as unknown as { providers: Record<string, { getRepoFn?: unknown } | undefined> }).providers;
	const provider = providers[id];
	assert.ok(provider != null, `provider ${id} should be registered on ProvidersApi`);
	provider.getRepoFn = impl;
}

/** A GraphQL error entry as the SDK receives it from the provider's `body.errors`. */
function graphQLError(type: string | undefined, message: string): GraphQLError {
	return { type: type, message: message, path: ['repository'], locations: [] };
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

	test('builds the identity from the canonical provider response, marking a rename', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		// The remote points at the stale `octocat/old-name`; the provider follows the 301 redirect and
		// returns the canonical `octocat/hello`.
		stubGetRepo(gh, () =>
			Promise.resolve({ id: 'r1', namespace: 'octocat', name: 'hello' } as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/old-name.git' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.owner, 'octocat', 'owner comes from the canonical response');
		assert.equal(result.resolution.identity?.name, 'hello', 'name comes from the canonical response');
		assert.equal(result.resolution.identity?.renamed, true, 'a differing canonical name flags renamed');
		assert.equal(
			result.resolution.identity?.remoteUrl,
			'https://github.com/octocat/old-name.git',
			'remoteUrl keeps the original input',
		);

		manager.dispose();
	});

	test('flags renamed when only the owner changed (repo transferred between accounts)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		// The repo kept its name but moved to a new owner; the name-only rename test above keeps the owner
		// constant, so this exercises the owner side of the OR compare.
		stubGetRepo(gh, () =>
			Promise.resolve({ id: 'r1', namespace: 'new-org', name: 'hello' } as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.owner, 'new-org', 'owner comes from the canonical response');
		assert.equal(result.resolution.identity?.renamed, true, 'a differing canonical owner flags renamed');

		manager.dispose();
	});

	test('does not flag renamed when the canonical identity differs only in casing', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		// Some hosts echo the input casing rather than a canonical one; a case-insensitive compare (matching
		// gkcli's EqualFold) must not treat that as a rename.
		stubGetRepo(gh, () =>
			Promise.resolve({ id: 'r1', namespace: 'OctoCat', name: 'Hello' } as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.renamed, false, 'a case-only difference is not a rename');

		manager.dispose();
	});

	test('falls back to the parsed remote when the response omits owner/name (not renamed)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		// A response without namespace/name must not spuriously flag a rename against empty canonical values.
		stubGetRepo(gh, () => Promise.resolve({ id: 'r1' } as unknown as ProviderRepository));

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.owner, 'octocat', 'owner falls back to the parsed remote');
		assert.equal(result.resolution.identity?.name, 'hello', 'name falls back to the parsed remote');
		assert.equal(result.resolution.identity?.renamed, false);

		manager.dispose();
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

// #5559: GitHub/GitLab `getRepo` are GraphQL and never throw `RequestNotFoundError` for a missing repo —
// they throw a `GraphQLErrors` (GitHub) or a bare `Error` (GitLab). These tests stub the REAL `getRepoFn`
// with those SDK error shapes and go through the real `ProvidersApi.getRepo`, so they exercise the
// classification the previous `RequestNotFoundError`-shaped stub could never reach.
suite('resolveRepository — GraphQL not-found classification (#5559)', () => {
	test('GitHub: a GraphQLErrors with a NOT_FOUND-typed entry maps to not-found', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitHub, () => {
			throw new GraphQLErrors('Repository octocat/gone not found', [
				graphQLError('NOT_FOUND', "Could not resolve to a Repository with the name 'octocat/gone'."),
			]);
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/gone.git' });
		assert.equal(result.resolution.status, 'not-found');
		assert.equal(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('GitHub: a GraphQLErrors with no entries falls back to the not-found message', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		// The SDK throws with `body.errors` undefined when the node is simply null with no error array.
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitHub, () => {
			throw new GraphQLErrors('Repository octocat/gone not found', undefined);
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/gone.git' });
		assert.equal(result.resolution.status, 'not-found');

		manager.dispose();
	});

	test('GitHub: a GraphQLErrors with no entries but a non-repo message stays an error (narrow fallback)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		// An empty/undefined errors array for a reason other than a missing repo must not be swept into
		// not-found: the message fallback is anchored to the repo-specific `Repository … not found` shape.
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitHub, () => {
			throw new GraphQLErrors('Something else went wrong', undefined);
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/gone.git' });
		assert.equal(result.resolution.status, 'error');
		assert.notEqual(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('GitHub: a GraphQLErrors with a non-NOT_FOUND entry stays an error (never misclassified as not-found)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		// FORBIDDEN surfaces the null repository node too, so the SDK message is still "... not found"; the
		// structured type must win so a permission error is not reported as a confident negative.
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitHub, () => {
			throw new GraphQLErrors('Repository octocat/secret not found', [
				graphQLError('FORBIDDEN', 'Resource not accessible by integration'),
			]);
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/secret.git' });
		assert.equal(result.resolution.status, 'error');
		assert.notEqual(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('GitHub: a NOT_FOUND entry on a non-repository path stays an error (path-scoped)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		// A NOT_FOUND scoped to some other selection (were the query to grow one) must not be read as the
		// repository being missing; only a `repository`-pathed NOT_FOUND is a real repo not-found.
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitHub, () => {
			throw new GraphQLErrors('Something under a different field not found', [
				{
					type: 'NOT_FOUND',
					message: 'Could not resolve node',
					path: ['viewer', 'somethingElse'],
					locations: [],
				},
			]);
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/gone.git' });
		assert.equal(result.resolution.status, 'error');
		assert.notEqual(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('GitLab: a bare Error("Repository <path> not found") maps to not-found', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitLab, 'gitlab.com');
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitLab, () => {
			throw new Error('Repository group/proj not found');
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://gitlab.com/group/proj.git' });
		assert.equal(result.resolution.status, 'not-found');
		assert.equal(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('GitLab: an unrelated bare Error stays an error (message guard is specific)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitLab, 'gitlab.com');
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitLab, () => {
			throw new Error('Something else failed');
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://gitlab.com/group/proj.git' });
		assert.equal(result.resolution.status, 'error');
		assert.notEqual(result.resolution.warning, undefined);

		manager.dispose();
	});
});
