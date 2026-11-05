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
import { AuthenticationError, AuthenticationErrorReason, RequestNotFoundError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderRepository } from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies `resolveRepository` (#5438): remote-URL → provider identity for every git host with a
 * `getRepo` client, config-driven custom-domain matching, and status mapping (resolved / not-found /
 * undetermined / unauthorized / unsupported-provider) driven by the real per-provider `getRepoInfo` override.
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

/** Like {@link stubGetRepo}, plus the profile read a provider's `validateCredential` probes the credential with. */
function stubGetRepoAndProbe(
	integration: GitHostIntegration,
	getRepo: () => Promise<ProviderRepository | undefined>,
	probe: () => Promise<unknown>,
): { probes: () => number } {
	let probes = 0;
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve({
			getRepo: getRepo,
			getCurrentUser: () => {
				probes++;
				return probe();
			},
		});
	return { probes: () => probes };
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

async function stubRealGetRepoOfProjectFn(
	manager: ReturnType<typeof createIntegrationManager>,
	id: GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	impl: (
		input: { namespace: string; name: string; project: string },
		options: { token?: string; isPAT?: boolean; baseUrl?: string },
	) => Promise<{ data: ProviderRepository }>,
): Promise<void> {
	const api = await (manager as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();
	const providers = (api as unknown as { providers: Record<string, { getRepoOfProjectFn?: unknown } | undefined> })
		.providers;
	const provider = providers[id];
	assert.ok(provider != null, `provider ${id} should be registered on ProvidersApi`);
	provider.getRepoOfProjectFn = impl;
}

/**
 * Replaces the integration's GitHub API client (`authenticationService.apis.github`) with the two reads the miss
 * confirmation uses: the REST repository read and the profile read that proves the credential.
 */
async function stubGitHubClient(
	gh: GitHostIntegration,
	impl: {
		access: () => Promise<boolean>;
		account?: () => Promise<{ id: string; username: string }>;
	},
): Promise<{ accessReads: string[]; accountReads: () => number }> {
	const accessReads: string[] = [];
	let accountReads = 0;
	const { apis } = (
		gh as unknown as {
			authenticationService: { apis: Record<string, Promise<Record<string, unknown> | undefined>> };
		}
	).authenticationService;
	const client = await apis.github;
	assert.ok(client != null);
	client.getRepositoryAccess = (_provider: unknown, _token: unknown, owner: string, repo: string) => {
		accessReads.push(`${owner}/${repo}`);
		return impl.access();
	};
	client.getCurrentAccount = () => {
		accountReads++;
		return impl.account?.() ?? Promise.resolve(undefined);
	};
	return { accessReads: accessReads, accountReads: () => accountReads };
}

function githubAuthError(reason: AuthenticationErrorReason, original?: Error): AuthenticationError {
	return new AuthenticationError(
		{
			providerId: GitCloudHostIntegrationId.GitHub,
			microHash: undefined,
			cloud: true,
			type: 'oauth',
			scopes: ['repo'],
		},
		reason,
		original,
	);
}

/** A refusal as the GitHub client's REST read raises it: Octokit's `RequestError`, with GitHub's response. */
function gitHubRefusal(status: number, message: string, clientId: string | undefined): AuthenticationError {
	const original = Object.assign(new Error(message), {
		status: status,
		response: {
			status: status,
			url: 'https://api.github.com/repos/x/y',
			headers: clientId != null ? { 'x-oauth-client-id': clientId } : {},
			data: { message: message, documentation_url: 'https://docs.github.com/rest' },
		},
	});
	return githubAuthError(
		status === 401 ? AuthenticationErrorReason.Unauthorized : AuthenticationErrorReason.Forbidden,
		original,
	);
}

/** GitHub's own answer for a repository its organization hides from an unapproved OAuth app. */
function oauthAppRestriction(org: string, clientId: string | undefined): AuthenticationError {
	return gitHubRefusal(
		403,
		`Although you appear to have the correct authorization credentials, the \`${org}\` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited. For more information on these restrictions, including how to enable this app, visit https://docs.github.com/articles/restricting-access-to-your-organization-s-data/`,
		clientId,
	);
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

			manager.dispose();
		}
	});

	test('an explicit cloud provider cannot reinterpret another cloud host', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const github = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		let repoReads = 0;
		stubGetRepo(github, () => {
			repoReads++;
			return Promise.resolve(repoResult);
		});

		const result = await manager.resolveRepository({
			providerId: GitCloudHostIntegrationId.GitHub,
			remoteUrl: 'https://gitlab.com/octocat/hello.git',
		});

		assert.equal(result.resolution.status, 'host-mismatch');
		assert.equal(repoReads, 0, 'the wrong provider never receives the homonymous repository lookup');
		manager.dispose();
	});

	test('an explicit host cannot override a different host already present in the remote URL', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			host: 'ghe-a.example.com',
			remoteUrl: 'https://ghe-b.example.com/octocat/hello.git',
		});

		assert.equal(result.resolution.status, 'host-mismatch');
		manager.dispose();
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

	test('does not flag renamed when the remote has a trailing slash', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const bb = await connect(manager, GitCloudHostIntegrationId.Bitbucket, 'bitbucket.org');
		// Bitbucket Cloud answers a path with a trailing slash, naming the repository without it.
		stubGetRepo(bb, () =>
			Promise.resolve({ id: 'r1', namespace: 'octocat', name: 'hello' } as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://bitbucket.org/octocat/hello/' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.renamed, false);

		manager.dispose();
	});

	test('carries the fork flag and parent the provider reports', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () =>
			Promise.resolve({
				id: 'r1',
				namespace: 'contributor',
				name: 'hello',
				isFork: true,
				parent: { namespace: 'octocat', name: 'hello' },
			} as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/contributor/hello.git' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.isFork, true);
		assert.deepEqual(result.resolution.identity?.parent, { owner: 'octocat', name: 'hello' });

		manager.dispose();
	});

	test('reports a repository the provider says is not a fork with no parent', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () =>
			Promise.resolve({
				id: 'r1',
				namespace: 'octocat',
				name: 'hello',
				isFork: false,
			} as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.isFork, false);
		assert.equal(result.resolution.identity?.parent, undefined);

		manager.dispose();
	});

	test('leaves fork and parent unset when the provider does not say', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () =>
			Promise.resolve({ id: 'r1', namespace: 'octocat', name: 'hello' } as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.isFork, undefined, 'unknown is not "not a fork"');
		assert.equal(result.resolution.identity?.parent, undefined);

		manager.dispose();
	});

	test('a renamed fork keeps its parent', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () =>
			Promise.resolve({
				id: 'r1',
				namespace: 'contributor',
				name: 'hello-renamed',
				isFork: true,
				parent: { namespace: 'octocat', name: 'hello' },
			} as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/contributor/hello.git' });
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.renamed, true);
		assert.equal(result.resolution.identity?.name, 'hello-renamed');
		assert.equal(result.resolution.identity?.isFork, true);
		assert.deepEqual(result.resolution.identity?.parent, { owner: 'octocat', name: 'hello' });

		manager.dispose();
	});

	test('maps the fork fields the SDK repository carries for each provider family', async () => {
		const cases: {
			label: string;
			connect: (manager: ReturnType<typeof createIntegrationManager>) => Promise<GitHostIntegration>;
			options: { providerId?: GitCloudHostIntegrationId | GitSelfManagedHostIntegrationId; domain?: string };
			remoteUrl: string;
			repo: Record<string, unknown>;
			parent: { owner: string; name: string; project?: string };
		}[] = [
			{
				label: 'GitHub',
				connect: m => connect(m, GitCloudHostIntegrationId.GitHub, 'github.com'),
				options: {},
				remoteUrl: 'https://github.com/contributor/hello.git',
				repo: { namespace: 'contributor', name: 'hello' },
				parent: { owner: 'octocat', name: 'hello' },
			},
			{
				label: 'Bitbucket Cloud',
				connect: m => connect(m, GitCloudHostIntegrationId.Bitbucket, 'bitbucket.org'),
				options: {},
				remoteUrl: 'https://bitbucket.org/contributor/hello.git',
				repo: { namespace: 'contributor', name: 'hello' },
				parent: { owner: 'octocat', name: 'hello' },
			},
			{
				label: 'Bitbucket Data Center',
				connect: m =>
					connectSelfManaged(m, GitSelfManagedHostIntegrationId.BitbucketServer, 'bitbucket.example.com'),
				options: {
					providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
					domain: 'bitbucket.example.com',
				},
				remoteUrl: 'https://bitbucket.example.com/scm/~contributor/hello.git',
				repo: { namespace: '~contributor', name: 'hello' },
				parent: { owner: 'TEAM', name: 'hello' },
			},
			{
				label: 'Azure DevOps',
				connect: m => connect(m, GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com'),
				options: {},
				remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
				repo: { namespace: 'myorg', name: 'myrepo', project: 'myproject' },
				parent: { owner: 'myorg', name: 'upstream', project: 'coreproject' },
			},
		];

		for (const { label, connect: connectProvider, options, remoteUrl, repo, parent } of cases) {
			const manager = createIntegrationManager(createFakeRuntime());
			const integration = await connectProvider(manager);
			const resolve = async (response: Record<string, unknown>) => {
				stubGetRepo(integration, () =>
					Promise.resolve({ id: 'r1', ...response } as unknown as ProviderRepository),
				);
				return (await manager.resolveRepository({ ...options, remoteUrl: remoteUrl })).resolution;
			};

			let resolution = await resolve({
				...repo,
				isFork: true,
				parent: { namespace: parent.owner, name: parent.name, project: parent.project },
			});
			assert.equal(resolution.status, 'resolved', label);
			assert.equal(resolution.identity?.isFork, true, label);
			assert.deepEqual(resolution.identity?.parent, parent, label);

			resolution = await resolve({ ...repo, isFork: false });
			assert.equal(resolution.identity?.isFork, false, label);
			assert.equal(resolution.identity?.parent, undefined, label);

			// A provider that doesn't report the fields says nothing, which is not "not a fork".
			resolution = await resolve({ ...repo });
			assert.equal(resolution.identity?.isFork, undefined, label);
			assert.equal(resolution.identity?.parent, undefined, label);

			manager.dispose();
		}
	});

	test('drops a malformed fork parent instead of half-trusting it', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		for (const parent of [null, 'octocat/hello', { namespace: 'octocat' }, { namespace: '', name: 'hello' }]) {
			stubGetRepo(gh, () =>
				Promise.resolve({
					id: 'r1',
					namespace: 'contributor',
					name: 'hello',
					isFork: true,
					parent: parent,
				} as unknown as ProviderRepository),
			);

			const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/contributor/hello.git' });
			assert.equal(result.resolution.identity?.isFork, true);
			assert.equal(result.resolution.identity?.parent, undefined, JSON.stringify(parent));
		}

		manager.dispose();
	});

	test('a named parent reports a fork, and one the provider contradicts with isFork false is dropped', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		const resolve = async (isFork: Record<string, unknown>) => {
			stubGetRepo(gh, () =>
				Promise.resolve({
					id: 'r1',
					namespace: 'contributor',
					name: 'hello',
					...isFork,
					parent: { namespace: 'octocat', name: 'hello' },
				} as unknown as ProviderRepository),
			);
			return (await manager.resolveRepository({ remoteUrl: 'https://github.com/contributor/hello.git' }))
				.resolution.identity;
		};

		let identity = await resolve({});
		assert.equal(identity?.isFork, true, 'a parent is a report of a fork');
		assert.deepEqual(identity?.parent, { owner: 'octocat', name: 'hello' });

		identity = await resolve({ isFork: false });
		assert.equal(identity?.isFork, false);
		assert.equal(identity?.parent, undefined, 'a parent beside isFork false is never half-trusted');

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

	test('does not flag an Azure DevOps repo renamed when the provider names it as the remote does', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const az = await connect(manager, GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com');
		// The SDK's shape: the organization it was asked for, the bare repository name, and the project apart.
		stubGetRepo(az, () =>
			Promise.resolve({
				id: 'r1',
				namespace: 'myorg',
				name: 'myrepo',
				project: 'MyProject',
			} as unknown as ProviderRepository),
		);

		const result = await manager.resolveRepository({
			remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
		});
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.identity?.name, 'myrepo');
		assert.equal(result.resolution.identity?.project, 'MyProject');
		assert.equal(result.resolution.identity?.renamed, false, 'the bare name matches the remote path');

		manager.dispose();
	});

	test('flags an Azure DevOps repo renamed when its repository or project name differs', async () => {
		for (const { remoteUrl, label } of [
			{ remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/old-name', label: 'repository' },
			{ remoteUrl: 'https://dev.azure.com/myorg/old-project/_git/myrepo', label: 'project' },
		]) {
			const manager = createIntegrationManager(createFakeRuntime());
			const az = await connect(manager, GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com');
			stubGetRepo(az, () =>
				Promise.resolve({
					id: 'r1',
					namespace: 'myorg',
					name: 'myrepo',
					project: 'myproject',
				} as unknown as ProviderRepository),
			);

			const result = await manager.resolveRepository({ remoteUrl: remoteUrl });
			assert.equal(result.resolution.status, 'resolved', label);
			assert.equal(result.resolution.identity?.name, 'myrepo', label);
			assert.equal(result.resolution.identity?.project, 'myproject', label);
			assert.equal(result.resolution.identity?.renamed, true, `a differing ${label} name flags renamed`);

			manager.dispose();
		}
	});

	test('resolves legacy visualstudio.com remotes that still name DefaultCollection (#5999)', async () => {
		for (const { remoteUrl, project, name } of [
			{
				remoteUrl: 'https://myorg.visualstudio.com/DefaultCollection/myproject/_git/myrepo',
				project: 'myproject',
				name: 'myrepo',
			},
			{
				remoteUrl: 'https://myorg.visualstudio.com/defaultcollection/myproject/_git/myrepo',
				project: 'myproject',
				name: 'myrepo',
			},
			{
				remoteUrl: 'https://myorg.visualstudio.com/DefaultCollection/_git/myrepo',
				project: 'myrepo',
				name: 'myrepo',
			},
			{ remoteUrl: 'https://myorg.visualstudio.com/_git/myrepo', project: 'myrepo', name: 'myrepo' },
			{ remoteUrl: 'https://dev.azure.com/myorg/_git/myrepo', project: 'myrepo', name: 'myrepo' },
		]) {
			const manager = createIntegrationManager(createFakeRuntime());
			const az = await connect(manager, GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com');
			let captured: { owner: string; name: string; project: string | undefined } | undefined;
			stubGetRepo(az, (owner, repoName, repoProject) => {
				captured = { owner: owner, name: repoName, project: repoProject };
				return Promise.resolve(repoResult);
			});

			const result = await manager.resolveRepository({ remoteUrl: remoteUrl });
			assert.equal(result.resolution.status, 'resolved', remoteUrl);
			assert.deepEqual(captured, { owner: 'myorg', name: name, project: project }, remoteUrl);

			manager.dispose();
		}
	});

	test('matches a custom GitHub Enterprise domain via getRemoteConfigs (id inferred, not unsupported)', async () => {
		const runtime = createFakeRuntime();
		runtime.config.getRemoteConfigs = () => [{ type: 'github', domain: 'ghe.example.com' }];
		const manager = createIntegrationManager(runtime);

		const result = await manager.resolveRepository({ remoteUrl: 'https://ghe.example.com/org/repo.git' });
		// The custom domain matched → GHE inferred; unconnected here, so it degrades to unauthorized
		// (NOT unsupported-provider, which would mean the matcher recognized but cannot serve the host).
		assert.notEqual(result.resolution.status, 'unsupported-provider');
		assert.equal(result.resolution.status, 'unauthorized');

		manager.dispose();
	});

	test('matches a regex-based custom remote via getRemoteConfigs (not unsupported)', async () => {
		const runtime = createFakeRuntime();
		// A custom remote configured with `regex` (no `domain`) must still reach the matcher; otherwise the
		// host resolves as `invalid-remote-url`.
		runtime.config.getRemoteConfigs = () => [{ type: 'github', regex: 'ghe\\.example\\.com' }];
		const manager = createIntegrationManager(runtime);

		const result = await manager.resolveRepository({ remoteUrl: 'https://ghe.example.com/org/repo.git' });
		assert.notEqual(result.resolution.status, 'invalid-remote-url');
		assert.equal(result.resolution.status, 'unauthorized');

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

	test('a self-managed connection for another host maps to host-mismatch', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'https://ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		const manager = createIntegrationManager(runtime);

		const result = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			connectionId: 'ghe-a',
			remoteUrl: 'https://ghe-b.example.com/org/repo.git',
		});
		assert.equal(result.resolution.status, 'host-mismatch');

		manager.dispose();
	});

	test('a pinned self-managed connection with a legacy full-url domain resolves via the normalized host api base', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'https://ghe-a.example.com/api/v3',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		await runtime.storage.storeSecret(
			`integration.auth.cloud:${GitSelfManagedHostIntegrationId.CloudGitHubEnterprise}|ghe-a`,
			JSON.stringify({
				id: 'ghe-a',
				accessToken: 't',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-a.example.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const gh = await connectSelfManaged(
			manager,
			GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			'ghe-a.example.com',
		);

		let baseUrl: string | undefined;
		(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
			Promise.resolve({
				getRepo: (
					_token: unknown,
					_owner: string,
					_name: string,
					_project: string | undefined,
					opts?: { baseUrl?: string },
				) => {
					baseUrl = opts?.baseUrl;
					return Promise.resolve(repoResult);
				},
			});

		const result = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			connectionId: 'ghe-a',
			remoteUrl: 'https://ghe-a.example.com/org/repo.git',
		});

		assert.equal(result.resolution.status, 'resolved');
		assert.equal(baseUrl, 'https://ghe-a.example.com/api/v3');

		manager.dispose();
	});

	test('an issue-tracker providerId is unsupported (no getRepo client)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const result = await manager.resolveRepository({
			providerId: IssuesCloudHostIntegrationId.Jira,
			remoteUrl: 'https://github.com/octocat/hello.git',
		});
		assert.equal(result.resolution.status, 'unsupported-provider');

		manager.dispose();
	});

	test('an unparseable / unmatched URL is invalid', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const result = await manager.resolveRepository({ remoteUrl: 'not a url' });
		assert.equal(result.resolution.status, 'invalid-remote-url');

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

	test('an auth failure maps to unauthorized with an auth warning', async () => {
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
		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.kind, 'auth');
		assert.equal(result.resolution.warning?.isAuth, true);

		manager.dispose();
	});

	test('a connected-but-no-session read degrades to unauthorized', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		// Do NOT set a session: getRepoInfo resolves no session and returns undefined.
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		stubGetRepo(gh, () => Promise.resolve(repoResult));

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'unauthorized');

		manager.dispose();
	});

	test('resolves Azure DevOps Server through the project-scoped provider route and configured base URL', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connectSelfManaged(manager, GitSelfManagedHostIntegrationId.AzureDevOpsServer, 'ado-server.example.com');
		let capturedInput: { namespace: string; name: string; project: string } | undefined;
		let capturedOptions: { token?: string; isPAT?: boolean; baseUrl?: string } | undefined;
		await stubRealGetRepoOfProjectFn(
			manager,
			GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			(input, options) => {
				capturedInput = input;
				capturedOptions = options;
				return Promise.resolve({
					data: {
						id: 'r1',
						namespace: input.namespace,
						name: input.name,
						project: input.project,
					} as unknown as ProviderRepository,
				});
			},
		);

		const result = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			domain: 'ado-server.example.com',
			remoteUrl: 'https://ado-server.example.com/myorg/myproject/_git/myrepo',
		});
		assert.equal(result.resolution.status, 'resolved');
		assert.deepEqual(capturedInput, { namespace: 'myorg', name: 'myrepo', project: 'myproject' });
		assert.equal(capturedOptions?.baseUrl, 'https://ado-server.example.com');
		assert.equal(result.resolution.identity?.renamed, false, 'the bare name matches the remote path');

		manager.dispose();
	});

	test('resolves Azure DevOps Server behind nested virtual directories', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connectSelfManaged(manager, GitSelfManagedHostIntegrationId.AzureDevOpsServer, 'ado-server.example.com');
		let capturedInput: { namespace: string; name: string; project: string } | undefined;
		let capturedOptions: { token?: string; isPAT?: boolean; baseUrl?: string } | undefined;
		await stubRealGetRepoOfProjectFn(
			manager,
			GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			(input, options) => {
				capturedInput = input;
				capturedOptions = options;
				return Promise.resolve({ data: repoResult });
			},
		);

		const result = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			domain: 'ado-server.example.com',
			remoteUrl: 'https://ado-server.example.com/tfs/team/DefaultCollection/myproject/_git/myrepo',
		});
		assert.equal(result.resolution.status, 'resolved');
		assert.deepEqual(capturedInput, { namespace: 'DefaultCollection', name: 'myrepo', project: 'myproject' });
		assert.equal(capturedOptions?.baseUrl, 'https://ado-server.example.com/tfs/team');

		manager.dispose();
	});
});

// #5559: GitHub/GitLab `getRepo` are GraphQL and never throw `RequestNotFoundError` for a missing repo —
// they throw a `GraphQLErrors`. These tests stub the REAL `getRepoFn` with that SDK error shape and go
// through the real `ProvidersApi.getRepo`, so they exercise its classification.
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
		assert.equal(result.resolution.status, 'undetermined');
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
		assert.equal(result.resolution.status, 'undetermined');
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
		assert.equal(result.resolution.status, 'undetermined');
		assert.notEqual(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('GitHub: a NOT_FOUND entry on the repository parent says nothing about the repository', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitHub, () => {
			throw new GraphQLErrors('Repository octocat/hello not found', [
				{
					type: 'NOT_FOUND',
					message: 'Could not resolve node',
					path: ['repository', 'parent'],
					locations: [],
				},
			]);
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });
		assert.equal(result.resolution.status, 'undetermined');
		assert.notEqual(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('GitHub: a miss the REST read also calls a miss stays not-found', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		const { accessReads } = await stubGitHubClient(gh, { access: () => Promise.resolve(false) });

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/gone.git' });
		assert.equal(result.resolution.status, 'not-found');
		assert.equal(result.resolution.warning, undefined);
		assert.deepEqual(accessReads, ['octocat/gone']);

		manager.dispose();
	});

	test('GitHub: a miss whose REST read cannot confirm either way keeps the GraphQL answer', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		await stubGitHubClient(gh, { access: () => Promise.reject(new Error('socket hang up')) });

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/gone.git' });
		assert.equal(result.resolution.status, 'not-found');
		assert.equal(result.resolution.warning, undefined);

		manager.dispose();
	});

	test('GitHub: a repository hidden by OAuth App access restrictions is a scoped refusal naming its cause', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		const { accountReads } = await stubGitHubClient(gh, {
			access: () => Promise.reject(oauthAppRestriction('gitkraken', '55a4dd30e5f97b55e750')),
			account: () => Promise.resolve({ id: '1', username: 'me' }),
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/gitkraken/codesee.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		const warning = result.resolution.warning;
		assert.equal(warning?.kind, 'auth');
		assert.deepEqual(warning?.scope, { repositoryId: 'gitkraken/codesee' });
		assert.deepEqual(warning?.cause, {
			reason: 'oauth-app-not-allowed',
			remedyUrl: 'https://github.com/settings/connections/applications/55a4dd30e5f97b55e750',
		});
		assert.match(warning?.message ?? '', /does not allow third-party OAuth apps/);
		assert.equal(accountReads(), 1, 'the credential is confirmed once before the refusal is named');

		manager.dispose();
	});

	test('GitHub: a restricted repository with no client id on the refusal still names its cause', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		await stubGitHubClient(gh, {
			access: () => Promise.reject(oauthAppRestriction('gitkraken', undefined)),
			account: () => Promise.resolve({ id: '1', username: 'me' }),
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/gitkraken/codesee.git' });
		assert.deepEqual(result.resolution.warning?.cause, { reason: 'oauth-app-not-allowed' });

		manager.dispose();
	});

	test("GitHub: another repository refusal stays scoped but unnamed, keeping GitHub's own words", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		await stubGitHubClient(gh, {
			access: () =>
				Promise.reject(gitHubRefusal(403, 'Resource not accessible by integration', '55a4dd30e5f97b55e750')),
			account: () => Promise.resolve({ id: '1', username: 'me' }),
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/gitkraken/other.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.deepEqual(result.resolution.warning?.scope, { repositoryId: 'gitkraken/other' });
		assert.equal(result.resolution.warning?.cause, undefined);
		assert.match(result.resolution.warning?.message ?? '', /Resource not accessible by integration/);

		manager.dispose();
	});

	test("GitHub: a restricted repository whose credential no longer checks out is the connection's failure", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		await stubGitHubClient(gh, {
			access: () => Promise.reject(oauthAppRestriction('gitkraken', '55a4dd30e5f97b55e750')),
			account: () => Promise.reject(githubAuthError(AuthenticationErrorReason.Unauthorized)),
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/gitkraken/codesee.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.kind, 'auth');
		assert.equal(result.resolution.warning?.scope, undefined);
		assert.equal(result.resolution.warning?.cause, undefined);

		manager.dispose();
	});

	test("GitHub: a 401 on the REST read, which the credential check refuses too, is the connection's failure", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		const { accountReads } = await stubGitHubClient(gh, {
			access: () => Promise.reject(gitHubRefusal(401, 'Bad credentials', undefined)),
			account: () => Promise.reject(gitHubRefusal(401, 'Bad credentials', undefined)),
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/gitkraken/codesee.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.kind, 'auth');
		assert.equal(result.resolution.warning?.scope, undefined);
		assert.equal(accountReads(), 1);

		manager.dispose();
	});

	test('GitHub: a confirmed credential is remembered, so a second restricted repository probes nothing', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		const { accountReads } = await stubGitHubClient(gh, {
			access: () => Promise.reject(oauthAppRestriction('gitkraken', '55a4dd30e5f97b55e750')),
			account: () => Promise.resolve({ id: '1', username: 'me' }),
		});

		for (const name of ['codesee', 'vscode-symbol-maps']) {
			const result = await manager.resolveRepository({ remoteUrl: `https://github.com/gitkraken/${name}.git` });
			assert.equal(result.resolution.warning?.cause?.reason, 'oauth-app-not-allowed');
		}
		assert.equal(accountReads(), 1);

		manager.dispose();
	});

	test('GitHub: a probe that proves nothing leaves the refusal scoped but unnamed', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		await stubGitHubClient(gh, {
			access: () => Promise.reject(oauthAppRestriction('gitkraken', '55a4dd30e5f97b55e750')),
			account: () => Promise.reject(new Error('socket hang up')),
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/gitkraken/codesee.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.deepEqual(result.resolution.warning?.scope, { repositoryId: 'gitkraken/codesee' });
		assert.equal(result.resolution.warning?.cause, undefined);

		manager.dispose();
	});

	test('GitHub: confirming a miss never prompts for reauthentication, even when the credential check is refused', async () => {
		const runtime = createFakeRuntime();
		let prompts = 0;
		runtime.hooks!.onReauthenticationRequired = () => {
			prompts++;
			return Promise.resolve(false);
		};
		runtime.http.fetch = (url, init) => {
			const json = (status: number, body: unknown, headers?: Record<string, string>) =>
				Promise.resolve(
					new Response(JSON.stringify(body), {
						status: status,
						headers: { 'content-type': 'application/json', ...headers },
					}),
				);
			if ((typeof init?.body === 'string' ? init.body : '').includes('getCurrentAccount')) {
				return json(401, { message: 'Bad credentials' });
			}

			assert.match(String(url), /\/repos\/gitkraken\/codesee$/);
			return json(
				403,
				{ message: 'the `gitkraken` organization has enabled OAuth App access restrictions' },
				{ 'x-oauth-client-id': '55a4dd30e5f97b55e750' },
			);
		};
		const manager = createIntegrationManager(runtime);
		const gh = await connect(manager, GitCloudHostIntegrationId.GitHub, 'github.com');
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/gitkraken/codesee.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.scope, undefined, 'a refused credential check is the connection');
		assert.equal(prompts, 0);

		manager.dispose();
	});

	test('GitHub Enterprise: the remedy page is on the instance, not github.com', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'https://ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		await runtime.storage.storeSecret(
			`integration.auth.cloud:${GitSelfManagedHostIntegrationId.CloudGitHubEnterprise}|ghe-a`,
			JSON.stringify({
				id: 'ghe-a',
				accessToken: 't',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-a.example.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const gh = await connectSelfManaged(
			manager,
			GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			'ghe-a.example.com',
		);
		stubGetRepo(gh, () => Promise.reject(new RequestNotFoundError(new Error('404'))));
		await stubGitHubClient(gh, {
			access: () => Promise.reject(oauthAppRestriction('corp', 'abc123')),
			account: () => Promise.resolve({ id: '1', username: 'me' }),
		});

		const result = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			connectionId: 'ghe-a',
			remoteUrl: 'https://ghe-a.example.com/corp/repo.git',
		});
		assert.equal(result.resolution.status, 'unauthorized');
		assert.deepEqual(result.resolution.warning?.cause, {
			reason: 'oauth-app-not-allowed',
			remedyUrl: 'https://ghe-a.example.com/settings/connections/applications/abc123',
		});

		manager.dispose();
	});

	test('GitLab: an unrelated Error stays an error', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		await connect(manager, GitCloudHostIntegrationId.GitLab, 'gitlab.com');
		await stubRealGetRepoFn(manager, GitCloudHostIntegrationId.GitLab, () => {
			throw new Error('Something else failed');
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://gitlab.com/group/proj.git' });
		assert.equal(result.resolution.status, 'undetermined');
		assert.notEqual(result.resolution.warning, undefined);

		manager.dispose();
	});
});

/**
 * `getRepo` through the real SDK, answered at `fetch`: what GitLab's query asks for and how its reply comes out decide
 * the fork fields and the not-found classification, so stubbing either side of the SDK would prove neither.
 */
suite('resolveRepository — GitLab through provider-apis', () => {
	const project = {
		id: 'gid://gitlab/Project/1',
		fullPath: 'contributor/hello',
		webUrl: 'https://gitlab.com/contributor/hello',
		httpUrlToRepo: 'https://gitlab.com/contributor/hello.git',
		sshUrlToRepo: 'git@gitlab.com:contributor/hello.git',
		repository: { rootRef: 'main' },
		userPermissions: { adminOperations: false, pushCode: true },
	};

	function answerGitLab(reply: { project: unknown; errors?: { message: string }[] }) {
		const runtime = createFakeRuntime();
		const requests: { url: string; query: string; fullPath: string }[] = [];
		runtime.http.fetch = (input, init) => {
			const { query, variables } = JSON.parse(init?.body as string) as {
				query: string;
				variables: { fullPath: string };
			};
			requests.push({ url: String(input), query: query, fullPath: variables.fullPath });
			return Promise.resolve(
				new Response(JSON.stringify({ data: { project: reply.project }, errors: reply.errors }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			);
		};
		return { manager: createIntegrationManager(runtime), requests: requests };
	}

	const resolveGitLabDotCom = async (manager: ReturnType<typeof createIntegrationManager>) => {
		await connect(manager, GitCloudHostIntegrationId.GitLab, 'gitlab.com');
		return (await manager.resolveRepository({ remoteUrl: 'https://gitlab.com/contributor/hello.git' })).resolution;
	};

	test('gitlab.com: a fork carries its parent, with a nested group as the owner', async () => {
		const { manager, requests } = answerGitLab({
			project: { ...project, isForked: true, forkedFrom: { fullPath: 'group/subgroup/hello' } },
		});

		const resolution = await resolveGitLabDotCom(manager);
		assert.equal(resolution.status, 'resolved');
		assert.equal(resolution.identity?.owner, 'contributor');
		assert.equal(resolution.identity?.isFork, true);
		assert.deepEqual(resolution.identity?.parent, { owner: 'group/subgroup', name: 'hello' });
		assert.ok(requests[0].query.includes('forkedFrom'), 'gitlab.com is asked for the fork fields');

		manager.dispose();
	});

	test('gitlab.com: a fork whose parent the token cannot see is still a fork', async () => {
		const { manager } = answerGitLab({ project: { ...project, isForked: true, forkedFrom: null } });

		const resolution = await resolveGitLabDotCom(manager);
		assert.equal(resolution.identity?.isFork, true);
		assert.equal(resolution.identity?.parent, undefined);

		manager.dispose();
	});

	test('gitlab.com: a repository that is not a fork has no parent', async () => {
		const { manager } = answerGitLab({ project: { ...project, isForked: false, forkedFrom: null } });

		const resolution = await resolveGitLabDotCom(manager);
		assert.equal(resolution.status, 'resolved');
		assert.equal(resolution.identity?.isFork, false);
		assert.equal(resolution.identity?.parent, undefined);

		manager.dispose();
	});

	test('self-managed: the fork fields are not asked for, so neither is reported', async () => {
		const { manager, requests } = answerGitLab({
			project: {
				...project,
				webUrl: 'https://gitlab.example.com/contributor/hello',
				httpUrlToRepo: 'https://gitlab.example.com/contributor/hello.git',
				sshUrlToRepo: 'git@gitlab.example.com:contributor/hello.git',
			},
		});
		await connectSelfManaged(manager, GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'gitlab.example.com');

		const { resolution } = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
			domain: 'gitlab.example.com',
			remoteUrl: 'https://gitlab.example.com/contributor/hello.git',
		});
		assert.equal(resolution.status, 'resolved');
		assert.equal(resolution.identity?.isFork, undefined);
		assert.equal(resolution.identity?.parent, undefined);
		assert.ok(requests[0].url.startsWith('https://gitlab.example.com/'), requests[0].url);
		assert.ok(!requests[0].query.includes('isForked'), 'an older server would reject the whole query');
		assert.ok(!requests[0].query.includes('forkedFrom'), 'an older server would reject the whole query');

		manager.dispose();
	});

	for (const host of [
		{
			label: 'gitlab.com',
			domain: 'gitlab.com',
			connect: (manager: ReturnType<typeof createIntegrationManager>) =>
				connect(manager, GitCloudHostIntegrationId.GitLab, 'gitlab.com'),
			options: {},
		},
		{
			label: 'self-managed',
			domain: 'gitlab.example.com',
			connect: (manager: ReturnType<typeof createIntegrationManager>) =>
				connectSelfManaged(
					manager,
					GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
					'gitlab.example.com',
				),
			options: {
				providerId: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
				domain: 'gitlab.example.com',
			},
		},
	]) {
		const resolveNested = async (
			remotePath: string,
			fullPath: string,
			remoteUrl = `https://${host.domain}/${remotePath}.git`,
		) => {
			const { manager, requests } = answerGitLab({ project: { ...project, fullPath: fullPath } });
			await host.connect(manager);

			const { resolution } = await manager.resolveRepository({ ...host.options, remoteUrl: remoteUrl });
			manager.dispose();

			assert.equal(resolution.status, 'resolved');
			assert.equal(requests[0].fullPath, remotePath, 'the read addresses the whole path');
			return resolution.identity;
		};

		test(`${host.label}: a repository in a nested group is not renamed`, async () => {
			const identity = await resolveNested('acme/platform/kepler', 'acme/platform/kepler');
			assert.equal(identity?.owner, 'acme/platform');
			assert.equal(identity?.name, 'kepler');
			assert.equal(identity?.renamed, false);
		});

		test(`${host.label}: a nested group answered in other casing is not renamed`, async () => {
			const identity = await resolveNested('ACME/Platform/kepler', 'acme/platform/Kepler');
			assert.equal(identity?.renamed, false);
		});

		test(`${host.label}: an SSH remote in a nested group is not renamed`, async () => {
			const identity = await resolveNested(
				'acme/platform/kepler',
				'acme/platform/kepler',
				`git@${host.domain}:acme/platform/kepler.git`,
			);
			assert.equal(identity?.renamed, false);
		});

		test(`${host.label}: a remote with a trailing slash reads the path without it`, async () => {
			const identity = await resolveNested(
				'acme/platform/kepler',
				'acme/platform/kepler',
				`https://${host.domain}/acme/platform/kepler/`,
			);
			assert.equal(identity?.renamed, false);
		});

		// GitLab answers a renamed or moved path with no project, so no server sends these three: they pin the compare.
		test(`${host.label}: a repository renamed within a nested group is renamed`, async () => {
			const identity = await resolveNested('acme/platform/old-name', 'acme/platform/kepler');
			assert.equal(identity?.owner, 'acme/platform');
			assert.equal(identity?.name, 'kepler');
			assert.equal(identity?.renamed, true);
		});

		test(`${host.label}: a repository moved to another nested group is renamed`, async () => {
			const identity = await resolveNested('acme/platform/kepler', 'acme/tools/kepler');
			assert.equal(identity?.owner, 'acme/tools');
			assert.equal(identity?.renamed, true);
		});

		test(`${host.label}: a repository moved out of a nested group is renamed`, async () => {
			const identity = await resolveNested('acme/platform/kepler', 'acme/kepler');
			assert.equal(identity?.owner, 'acme');
			assert.equal(identity?.renamed, true);
		});

		test(`${host.label}: a repository in a flat path is not renamed`, async () => {
			const identity = await resolveNested('acme/kepler', 'acme/kepler');
			assert.equal(identity?.renamed, false);
		});
	}

	test('self-managed: a nested group under a context path reads the path below it', async () => {
		const { manager, requests } = answerGitLab({ project: { ...project, fullPath: 'acme/platform/kepler' } });
		await connectSelfManaged(manager, GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'gitlab.example.com');

		const { resolution } = await manager.resolveRepository({
			providerId: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
			domain: 'https://gitlab.example.com/gitlab',
			remoteUrl: 'https://gitlab.example.com/gitlab/acme/platform/kepler.git',
		});
		manager.dispose();

		assert.equal(resolution.status, 'resolved');
		assert.equal(requests[0].fullPath, 'acme/platform/kepler');
		assert.equal(resolution.identity?.renamed, false);
	});

	test('a null project with no errors is not-found', async () => {
		const { manager } = answerGitLab({ project: null });

		const resolution = await resolveGitLabDotCom(manager);
		assert.equal(resolution.status, 'not-found');
		assert.equal(resolution.warning, undefined);

		manager.dispose();
	});

	test('a null project in a reply carrying errors is not a false not-found', async () => {
		const { manager } = answerGitLab({ project: null, errors: [{ message: 'Internal server error' }] });

		const resolution = await resolveGitLabDotCom(manager);
		assert.equal(resolution.status, 'undetermined');
		assert.notEqual(resolution.warning, undefined);

		manager.dispose();
	});
});

/** The other hosts' replies through the real SDK: the `stubGetRepo` cases above can't tell whether it returns a fork. */
suite('resolveRepository — fork fields through provider-apis', () => {
	const cases: {
		label: string;
		connect: (manager: ReturnType<typeof createIntegrationManager>) => Promise<unknown>;
		options: { providerId?: GitSelfManagedHostIntegrationId; domain?: string };
		remoteUrl: string;
		read: string;
		reply: unknown;
		parent: { owner: string; name: string; project?: string };
	}[] = [
		{
			label: 'GitHub',
			connect: m => connect(m, GitCloudHostIntegrationId.GitHub, 'github.com'),
			options: {},
			remoteUrl: 'https://github.com/contributor/hello.git',
			read: 'https://api.github.com/graphql',
			reply: {
				data: {
					repository: {
						id: 'R_1',
						databaseId: 1,
						name: 'hello',
						owner: { login: 'contributor' },
						url: 'https://github.com/contributor/hello',
						sshUrl: 'git@github.com:contributor/hello.git',
						isFork: true,
						parent: { name: 'hello', owner: { login: 'octocat' } },
					},
				},
			},
			parent: { owner: 'octocat', name: 'hello' },
		},
		{
			label: 'Bitbucket Cloud',
			connect: m => connect(m, GitCloudHostIntegrationId.Bitbucket, 'bitbucket.org'),
			options: {},
			remoteUrl: 'https://bitbucket.org/contributor/hello.git',
			read: '/repositories/contributor/hello',
			reply: {
				uuid: '{1}',
				slug: 'hello',
				workspace: { slug: 'contributor' },
				links: { html: { href: 'https://bitbucket.org/contributor/hello' }, clone: [] },
				mainbranch: { name: 'main' },
				parent: { full_name: 'octocat/hello' },
			},
			parent: { owner: 'octocat', name: 'hello' },
		},
		{
			label: 'Bitbucket Data Center',
			connect: m =>
				connectSelfManaged(m, GitSelfManagedHostIntegrationId.BitbucketServer, 'bitbucket.example.com'),
			options: { providerId: GitSelfManagedHostIntegrationId.BitbucketServer, domain: 'bitbucket.example.com' },
			remoteUrl: 'https://bitbucket.example.com/scm/~contributor/hello.git',
			read: '/projects/~contributor/repos/hello',
			reply: {
				id: 1,
				slug: 'hello',
				project: { key: '~contributor' },
				links: { self: [{ href: 'https://bitbucket.example.com/users/contributor/repos/hello' }], clone: [] },
				origin: { slug: 'hello', project: { key: 'TEAM' } },
			},
			parent: { owner: 'TEAM', name: 'hello' },
		},
		{
			label: 'Azure DevOps',
			connect: m => connect(m, GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com'),
			options: {},
			remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
			read: '/myorg/myproject/_apis/git/repositories/myrepo?includeParent=true',
			reply: {
				id: 'r1',
				name: 'myrepo',
				project: { id: 'p1', name: 'myproject' },
				webUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
				remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
				sshUrl: 'git@ssh.dev.azure.com:v3/myorg/myproject/myrepo',
				isFork: true,
				parentRepository: { name: 'upstream', project: { name: 'coreproject' } },
			},
			parent: { owner: 'myorg', name: 'upstream', project: 'coreproject' },
		},
	];

	for (const { label, connect: connectProvider, options, remoteUrl, read, reply, parent } of cases) {
		test(`${label}: a fork carries its parent`, async () => {
			const runtime = createFakeRuntime();
			const requests: string[] = [];
			runtime.http.fetch = input => {
				requests.push(String(input));
				return Promise.resolve(
					new Response(JSON.stringify(reply), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					}),
				);
			};
			const manager = createIntegrationManager(runtime);
			await connectProvider(manager);

			const { resolution } = await manager.resolveRepository({ ...options, remoteUrl: remoteUrl });
			assert.equal(resolution.status, 'resolved');
			assert.equal(resolution.identity?.isFork, true);
			assert.deepEqual(resolution.identity?.parent, parent);
			assert.ok(
				requests.some(url => url.includes(read)),
				requests.join(', '),
			);

			manager.dispose();
		});
	}
});

/**
 * A 401/403 from one repository settles as a batch read's refused target does (see `settleBatchRefusals`), on every
 * host that resolves repositories, not only the one whose refusal this path was written for (#5900).
 */
suite('resolveRepository — a repository refusing its credential (#5900)', () => {
	function refusal(
		providerId: GitCloudHostIntegrationId,
		status: 401 | 403,
		body: unknown,
		reason = status === 401 ? AuthenticationErrorReason.Unauthorized : AuthenticationErrorReason.Forbidden,
	): AuthenticationError {
		const original = Object.assign(new Error(`(${status}) ${status === 401 ? 'Unauthorized' : 'Forbidden'}.`), {
			response: { status: status, headers: {}, body: body },
		});
		return new AuthenticationError(
			{ providerId: providerId, microHash: undefined, cloud: true, type: 'oauth', scopes: [] },
			reason,
			original,
		);
	}

	test("Bitbucket: a repository's 403 to a credential the probe confirms is that repository's", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const bb = await connect(manager, GitCloudHostIntegrationId.Bitbucket, 'bitbucket.org');
		const { probes } = stubGetRepoAndProbe(
			bb,
			() =>
				Promise.reject(
					refusal(GitCloudHostIntegrationId.Bitbucket, 403, {
						type: 'error',
						error: { message: 'Access denied. You must have write or admin access.' },
					}),
				),
			() => Promise.resolve({ id: 'u1' }),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://bitbucket.org/ws/repo.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.deepEqual(result.resolution.warning?.scope, { repositoryId: 'ws/repo' });
		assert.equal(result.resolution.warning?.cause, undefined);
		assert.match(result.resolution.warning?.message ?? '', /Access denied/);
		assert.equal(probes(), 1);

		manager.dispose();
	});

	test("Bitbucket: a token missing the OAuth scopes the read needs stays the connection's failure", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const bb = await connect(manager, GitCloudHostIntegrationId.Bitbucket, 'bitbucket.org');
		const { probes } = stubGetRepoAndProbe(
			bb,
			() =>
				Promise.reject(
					refusal(GitCloudHostIntegrationId.Bitbucket, 403, {
						type: 'error',
						error: { message: 'Your credentials lack one or more required privilege scopes.' },
					}),
				),
			() => Promise.resolve({ id: 'u1' }),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://bitbucket.org/ws/repo.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.kind, 'auth');
		assert.equal(result.resolution.warning?.scope, undefined);
		assert.equal(probes(), 0, 'the refusal says what it is, so nothing is probed');

		manager.dispose();
	});

	test("Bitbucket: a refusal whose probe refuses the credential too is the connection's failure", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const bb = await connect(manager, GitCloudHostIntegrationId.Bitbucket, 'bitbucket.org');
		const { probes } = stubGetRepoAndProbe(
			bb,
			() => Promise.reject(refusal(GitCloudHostIntegrationId.Bitbucket, 403, '')),
			() => Promise.reject(refusal(GitCloudHostIntegrationId.Bitbucket, 401, '')),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://bitbucket.org/ws/repo.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.kind, 'auth');
		assert.equal(result.resolution.warning?.scope, undefined);
		assert.match(result.resolution.warning?.message ?? '', /invalid or expired/);
		assert.equal(probes(), 1);

		manager.dispose();
	});

	test("GitLab: with no credential check, a refusal stays the connection's failure, as before", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gl = await connect(manager, GitCloudHostIntegrationId.GitLab, 'gitlab.com');
		stubGetRepo(gl, () =>
			Promise.reject(refusal(GitCloudHostIntegrationId.GitLab, 403, { message: '403 Forbidden' })),
		);

		const result = await manager.resolveRepository({ remoteUrl: 'https://gitlab.com/group/proj.git' });
		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.kind, 'auth');
		assert.equal(result.resolution.warning?.scope, undefined);

		manager.dispose();
	});

	test('Azure DevOps: an organization that disallows OAuth apps is scoped to it and named, once the credential checks out', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const az = await connect(manager, GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com');
		stubGetRepoAndProbe(
			az,
			() => Promise.reject(refusal(GitCloudHostIntegrationId.AzureDevOps, 401, '')),
			() => Promise.resolve({ id: 'guid-1' }),
		);

		const result = await manager.resolveRepository({
			remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
		});
		assert.equal(result.resolution.status, 'unauthorized');
		assert.deepEqual(result.resolution.warning?.scope, { resourceId: 'myorg', projectId: 'myproject' });
		assert.equal(result.resolution.warning?.cause?.reason, 'oauth-app-not-allowed');

		manager.dispose();
	});

	test("Azure DevOps: the same 401 with a probe that refuses the credential is the connection's failure", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const az = await connect(manager, GitCloudHostIntegrationId.AzureDevOps, 'dev.azure.com');
		stubGetRepoAndProbe(
			az,
			() => Promise.reject(refusal(GitCloudHostIntegrationId.AzureDevOps, 401, '')),
			() => Promise.reject(refusal(GitCloudHostIntegrationId.AzureDevOps, 401, '')),
		);

		const result = await manager.resolveRepository({
			remoteUrl: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
		});
		assert.equal(result.resolution.status, 'unauthorized');
		assert.equal(result.resolution.warning?.scope, undefined);
		assert.equal(result.resolution.warning?.cause, undefined);

		manager.dispose();
	});
});
