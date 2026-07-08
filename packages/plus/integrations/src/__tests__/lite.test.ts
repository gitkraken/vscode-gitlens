import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createTokenScopedGitHostIntegration } from '../lite.js';

type FakeFetch = ((input: string | URL, init?: RequestInit) => Promise<Response>) & { calls: string[] };

/** A `fetch` that returns `body` as JSON for any request, recording the URLs it was called with. */
function fakeFetch(body: unknown, status = 200): FakeFetch {
	const calls: string[] = [];
	const fn = (input: string | URL) => {
		calls.push(input.toString());
		return Promise.resolve(
			new Response(JSON.stringify(body), {
				status: status,
				headers: { 'content-type': 'application/json; charset=utf-8' },
			}),
		);
	};
	return Object.assign(fn, { calls: calls });
}

suite('createTokenScopedGitHostIntegration — token-scoped reads', () => {
	test('GitHub: maps repository metadata (fork with parent) without an IntegrationServiceContext', async () => {
		const fetch = fakeFetch({
			data: {
				repository: {
					owner: { login: 'octocat' },
					name: 'hello-world',
					parent: { owner: { login: 'upstream' }, name: 'hello-world' },
				},
			},
		});

		const gh = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.GitHub,
			{ accessToken: 'tok' },
			{ fetch: fetch },
		);
		const metadata = await gh.getRepositoryMetadata('octocat', 'hello-world');

		assert.ok(metadata != null);
		assert.equal(metadata.owner, 'octocat');
		assert.equal(metadata.name, 'hello-world');
		assert.equal(metadata.isFork, true);
		assert.deepEqual(metadata.parent, { owner: 'upstream', name: 'hello-world' });
		assert.equal(metadata.provider.id, 'github');
		assert.ok(
			fetch.calls[0].startsWith('https://api.github.com'),
			`GitHub cloud should hit api.github.com, got ${fetch.calls[0]}`,
		);
	});

	test('GitLab: maps repository metadata (non-fork)', async () => {
		// GitLab resolves the numeric project id via GraphQL first, then fetches the project over REST.
		const fetch = (input: string | URL) => {
			const url = input.toString();
			const body = url.includes('/graphql')
				? { data: { project: { id: 'gid://gitlab/Project/42' } } }
				: { id: '42', path: 'my-repo', namespace: { full_path: 'my-group' }, forked_from_project: null };
			return Promise.resolve(
				new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
			);
		};

		const gl = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.GitLab,
			{ accessToken: 'tok' },
			{ fetch: fetch },
		);
		const metadata = await gl.getRepositoryMetadata('my-group', 'my-repo');

		assert.ok(metadata != null);
		assert.equal(metadata.owner, 'my-group');
		assert.equal(metadata.name, 'my-repo');
		assert.equal(metadata.isFork, false);
		assert.equal(metadata.parent, undefined);
	});

	test('Bitbucket: maps repository metadata and default branch', async () => {
		const repo = {
			slug: 'my-repo',
			workspace: { slug: 'my-workspace' },
			parent: null,
			mainbranch: { name: 'develop' },
		};

		const bb = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.Bitbucket,
			{ accessToken: 'tok' },
			{ fetch: fakeFetch(repo) },
		);

		const metadata = await bb.getRepositoryMetadata('my-workspace', 'my-repo');
		assert.ok(metadata != null);
		assert.equal(metadata.owner, 'my-workspace');
		assert.equal(metadata.name, 'my-repo');
		assert.equal(metadata.isFork, false);

		const branch = await bb.getDefaultBranch('my-workspace', 'my-repo');
		assert.deepEqual(branch, { provider: metadata.provider, name: 'develop' });
	});

	test('Bitbucket: default branch is undefined when mainbranch is absent', async () => {
		const bb = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.Bitbucket,
			{ accessToken: 'tok' },
			{ fetch: fakeFetch({ slug: 'r', workspace: { slug: 'w' }, parent: null }) },
		);

		assert.equal(await bb.getDefaultBranch('w', 'r'), undefined);
	});

	test('Azure: derives org/project/repo and normalizes the default branch', async () => {
		const fetch = fakeFetch({
			id: 'guid',
			name: 'my-repo',
			project: { id: 'p', name: 'my-project' },
			defaultBranch: 'refs/heads/main',
			isFork: false,
		});

		const az = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.AzureDevOps,
			{ accessToken: 'tok' },
			{ fetch: fetch },
		);

		const metadata = await az.getRepositoryMetadata('my-org', 'my-project/_git/my-repo');
		assert.ok(metadata != null);
		assert.equal(metadata.owner, 'my-org');
		assert.equal(metadata.name, 'my-repo');
		assert.equal(metadata.isFork, false);

		const branch = await az.getDefaultBranch('my-org', 'my-project/_git/my-repo');
		assert.deepEqual(branch, { provider: metadata.provider, name: 'main' });
		assert.ok(
			fetch.calls[0].includes('my-org/my-project/_apis/git/repositories/my-repo'),
			`Azure URL should encode org/project/repo, got ${fetch.calls[0]}`,
		);
	});

	test('Azure: a fork maps its parent name, but never falls back to naming itself its own parent', async () => {
		const forkOfNamed = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.AzureDevOps,
			{ accessToken: 'tok' },
			{ fetch: fakeFetch({ name: 'my-repo', isFork: true, parentRepository: { id: 'up', name: 'upstream' } }) },
		);
		const withParent = await forkOfNamed.getRepositoryMetadata('my-org', 'my-project/_git/my-repo');
		assert.equal(withParent?.isFork, true);
		assert.deepEqual(withParent?.parent, { owner: 'my-org', name: 'upstream' });

		// A fork whose payload omits parentRepository.name must report `isFork` but no bogus self-parent.
		const forkMissingParent = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.AzureDevOps,
			{ accessToken: 'tok' },
			{ fetch: fakeFetch({ name: 'my-repo', isFork: true }) },
		);
		const noParent = await forkMissingParent.getRepositoryMetadata('my-org', 'my-project/_git/my-repo');
		assert.equal(noParent?.isFork, true);
		assert.equal(noParent?.parent, undefined);
	});

	test('throws for a self-managed id when no domain is supplied', () => {
		assert.throws(
			() =>
				createTokenScopedGitHostIntegration(
					GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					{ accessToken: 'tok' },
					{ fetch: fakeFetch({}) },
				),
			/requires 'token.domain'/,
		);
	});

	test('Azure: a malformed repo descriptor returns undefined without issuing a bogus request', async () => {
		const fetch = fakeFetch({});
		const az = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.AzureDevOps,
			{ accessToken: 'tok' },
			{ fetch: fetch },
		);

		assert.equal(await az.getRepositoryMetadata('my-org', 'not-a-descriptor'), undefined);
		assert.equal(
			fetch.calls.length,
			0,
			`no request should be issued for a malformed descriptor, got ${JSON.stringify(fetch.calls)}`,
		);
	});

	test('Azure DevOps Server: honors an explicit scheme in the domain and keeps it out of the DTO', async () => {
		const fetch = fakeFetch({ name: 'my-repo', defaultBranch: 'refs/heads/main', isFork: false });
		const az = createTokenScopedGitHostIntegration(
			GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			{ accessToken: 'tok', domain: 'http://tfs.example.com' },
			{ fetch: fetch },
		);

		const metadata = await az.getRepositoryMetadata('my-org', 'my-project/_git/my-repo');
		assert.ok(metadata != null);
		// The DTO's provider domain must be the bare host, never carry the scheme.
		assert.equal(metadata.provider.domain, 'tfs.example.com');
		assert.ok(
			fetch.calls[0].startsWith('http://tfs.example.com/my-org/my-project/_apis/'),
			`Azure Server should honor the http scheme, got ${fetch.calls[0]}`,
		);
	});

	test('GitHub Enterprise: an accidental scheme in the domain does not produce a malformed base URL', async () => {
		const fetch = fakeFetch({ data: { repository: { owner: { login: 'o' }, name: 'r', parent: null } } });
		const ghe = createTokenScopedGitHostIntegration(
			GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			{ accessToken: 'tok', domain: 'https://ghe.example.com' },
			{ fetch: fetch },
		);

		await ghe.getRepositoryMetadata('o', 'r');
		assert.ok(
			fetch.calls[0].startsWith('https://ghe.example.com/'),
			`GHE should hit the bare host, got ${fetch.calls[0]}`,
		);
		// The scheme must not be doubled up (e.g. `https://https://...`) when the domain already carries one.
		assert.ok(!/https:\/\/[^/]*:\/\//.test(fetch.calls[0]), `base URL is malformed: ${fetch.calls[0]}`);
	});

	test('returns undefined on a 404 rather than throwing', async () => {
		const gh = createTokenScopedGitHostIntegration(
			GitCloudHostIntegrationId.GitHub,
			{ accessToken: 'tok' },
			{ fetch: fakeFetch({ message: 'Not Found' }, 404) },
		);

		assert.equal(await gh.getRepositoryMetadata('nope', 'nope'), undefined);
	});
});
