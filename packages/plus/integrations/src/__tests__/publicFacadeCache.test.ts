import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Account } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { RepositoryDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import { defer } from '@gitlens/utils/promise.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { GitHostIntegration, IntegrationCacheDescriptor, IntegrationManagerCacheProvider } from '../index.js';
import { createIntegrationManager } from '../index.js';
import type { IntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

const session: ProviderAuthenticationSession = {
	id: 'primary',
	accessToken: 'token',
	account: { id: 'me', label: 'me' },
	scopes: ['repo'],
	cloud: true,
	type: 'oauth',
	domain: 'github.com',
};

const account = {
	id: 'me',
	username: 'me',
	name: 'Me',
	email: 'me@example.com',
	avatarUrl: undefined,
	provider: { id: GitCloudHostIntegrationId.GitHub, name: 'GitHub', domain: 'github.com', icon: 'github' },
} satisfies Account;

async function getGitHub(manager: IntegrationService) {
	const integration = await manager.get(GitCloudHostIntegrationId.GitHub);
	assert.ok(integration);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = session;
	return integration;
}

suite('public integration manager cache', () => {
	test('adapts account caching to a neutral integration descriptor', async () => {
		const runtime = createFakeRuntime();
		const { cache: _internalCache, ...context } = runtime;
		let observed:
			| {
					integration: { id: string; domain?: string };
					options:
						| {
								connectionId?: string;
								etag?: string;
						  }
						| undefined;
			  }
			| undefined;

		const manager = createIntegrationManager({
			...context,
			cache: {
				getCurrentAccount: (integration, loader, options) => {
					observed = { integration: integration, options: options };
					return loader(new CacheController()).value;
				},
			},
		}) as IntegrationService;
		const integration = await getGitHub(manager);
		(
			integration as unknown as {
				getProviderCurrentAccount: () => Promise<Account>;
			}
		).getProviderCurrentAccount = async () => account;

		assert.equal(await integration.getCurrentAccount(), account);
		assert.ok(integration.sessionFingerprint, 'a connected integration has a session fingerprint');
		assert.deepEqual(
			{ ...observed?.integration },
			{
				id: GitCloudHostIntegrationId.GitHub,
				domain: 'github.com',
				maybeConnected: true,
				sessionFingerprint: integration.sessionFingerprint,
			},
		);
		assert.equal(observed?.options?.connectionId, undefined);
		assert.match(observed?.options?.etag ?? '', /^github:true:/);
		assert.equal('getIssue' in (observed?.integration ?? {}), false);

		manager.dispose();
	});

	test('executes account loaders uncached when the public cache is omitted', async () => {
		const runtime = createFakeRuntime();
		const { cache: _internalCache, ...context } = runtime;
		const manager = createIntegrationManager(context) as IntegrationService;
		const integration = await getGitHub(manager);
		let calls = 0;
		(
			integration as unknown as {
				getProviderCurrentAccount: () => Promise<Account>;
			}
		).getProviderCurrentAccount = async () => {
			calls++;
			return account;
		};

		await integration.getCurrentAccount();
		await integration.getCurrentAccount();

		assert.equal(calls, 2);
		manager.dispose();
	});

	test('forwards every lookup a class-instance cache supplies, calling it on the instance with a descriptor', async () => {
		const runtime = createFakeRuntime();
		const { cache: _internalCache, ...context } = runtime;

		const metadata = { marker: 'metadata' } as unknown as RepositoryMetadata;
		const defaultBranch = { marker: 'defaultBranch' } as unknown as DefaultBranch;
		const prForSha = { marker: 'prForSha' } as unknown as PullRequest;
		const prForBranch = { marker: 'prForBranch' } as unknown as PullRequest;
		const pr = { marker: 'pr' } as unknown as PullRequest;
		const issueOrPr = { marker: 'issueOrPr' } as unknown as IssueOrPullRequest;
		const issue = { marker: 'issue' } as unknown as Issue;

		// Methods on the prototype that read `this`: a spread or a detached call would lose both and fail here.
		class RecordingCache implements IntegrationManagerCacheProvider {
			readonly calls: { method: string; integration: IntegrationCacheDescriptor | undefined }[] = [];

			private record<T>(method: string, integration: IntegrationCacheDescriptor | undefined, value: T): T {
				assert.equal(integration != null && 'getIssue' in integration, false, `${method} got the class`);
				this.calls.push({ method: method, integration: integration && { ...integration } });
				return value;
			}

			getCurrentAccount(integration: IntegrationCacheDescriptor): Account {
				return this.record('getCurrentAccount', integration, account);
			}
			getRepositoryMetadata(_repo: unknown, integration: IntegrationCacheDescriptor | undefined) {
				return this.record('getRepositoryMetadata', integration, metadata);
			}
			getRepositoryDefaultBranch(_repo: unknown, integration: IntegrationCacheDescriptor | undefined) {
				return this.record('getRepositoryDefaultBranch', integration, defaultBranch);
			}
			getPullRequestForSha(_sha: string, _repo: unknown, integration: IntegrationCacheDescriptor | undefined) {
				return this.record('getPullRequestForSha', integration, prForSha);
			}
			getPullRequestForBranch(
				_branch: string,
				_repo: unknown,
				integration: IntegrationCacheDescriptor | undefined,
			) {
				return this.record('getPullRequestForBranch', integration, prForBranch);
			}
			getPullRequest(_id: string, _resource: unknown, integration: IntegrationCacheDescriptor | undefined) {
				return this.record('getPullRequest', integration, pr);
			}
			getIssueOrPullRequest(
				_id: string,
				_type: unknown,
				_resource: unknown,
				integration: IntegrationCacheDescriptor | undefined,
			) {
				return this.record('getIssueOrPullRequest', integration, issueOrPr);
			}
			getIssue(_id: string, _resource: unknown, integration: IntegrationCacheDescriptor | undefined) {
				return this.record('getIssue', integration, issue);
			}
			deletePullRequests(): void {
				this.record('deletePullRequests', undefined, undefined);
			}
		}

		const cache = new RecordingCache();
		const manager = createIntegrationManager({ ...context, cache: cache }) as IntegrationService;
		const integration = await getGitHub(manager);
		(integration as unknown as { mergeProviderPullRequest: () => Promise<boolean> }).mergeProviderPullRequest =
			async () => true;

		const repo: RepositoryDescriptor = { key: 'octo/repo', owner: 'octo', name: 'repo' };
		assert.equal(await integration.getCurrentAccount(), account);
		assert.equal(await integration.getRepositoryMetadata(repo), metadata);
		assert.equal(await integration.getDefaultBranch(repo), defaultBranch);
		assert.equal(await integration.getPullRequestForCommit(repo, 'abc123'), prForSha);
		assert.equal(await integration.getPullRequestForBranch(repo, 'main'), prForBranch);
		assert.equal(await integration.getPullRequest(repo, '1'), pr);
		assert.equal(await integration.getLinkedIssueOrPullRequest(repo, { id: '1', key: '1' }), issueOrPr);
		assert.equal(await integration.getIssue(repo, '1'), issue);
		assert.equal(await integration.mergePullRequest({} as PullRequest), true);

		const descriptor: IntegrationCacheDescriptor = {
			id: GitCloudHostIntegrationId.GitHub,
			domain: 'github.com',
			maybeConnected: true,
			sessionFingerprint: integration.sessionFingerprint,
		};
		assert.deepEqual(cache.calls, [
			{ method: 'getCurrentAccount', integration: descriptor },
			{ method: 'getRepositoryMetadata', integration: descriptor },
			{ method: 'getRepositoryDefaultBranch', integration: descriptor },
			{ method: 'getPullRequestForSha', integration: descriptor },
			{ method: 'getPullRequestForBranch', integration: descriptor },
			{ method: 'getPullRequest', integration: descriptor },
			{ method: 'getIssueOrPullRequest', integration: descriptor },
			{ method: 'getIssue', integration: descriptor },
			{ method: 'deletePullRequests', integration: undefined },
		]);

		manager.dispose();
	});

	test('the descriptor reads connection state when the cache reads it, not when the lookup starts', async () => {
		const runtime = createFakeRuntime();
		const { cache: _internalCache, ...context } = runtime;
		let captured: IntegrationCacheDescriptor | undefined;
		const manager = createIntegrationManager({
			...context,
			cache: {
				getCurrentAccount: (_integration, loader) => loader(new CacheController()).value,
				getPullRequest: (_id, _resource, integration, loader) => {
					captured = integration;
					return loader(new CacheController()).value;
				},
			},
		}) as IntegrationService;
		const integration = await getGitHub(manager);
		(
			integration as unknown as { getProviderPullRequest: () => Promise<PullRequest | undefined> }
		).getProviderPullRequest = async () => undefined;

		await integration.getPullRequest({ key: 'octo/repo', owner: 'octo', name: 'repo' }, '1');
		assert.equal(captured?.maybeConnected, true);

		// A host cache that reads the descriptor again later (an etag check) sees the integration as it is then, as it
		// did when it was handed the integration itself.
		(integration as unknown as { _session: ProviderAuthenticationSession | null })._session = null;
		assert.equal(captured?.maybeConnected, false);
		assert.equal(captured?.sessionFingerprint, undefined);

		manager.dispose();
	});

	test('passes the same Enterprise session to the cache descriptor and deferred pull request loader', async () => {
		const { cache: _internalCache, ...context } = createFakeRuntime();
		const domain = 'ghe.example.test:8443';
		const providerId = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
		const selected = { ...session, domain: domain, baseUrl: `http://${domain}` };
		const replacement = { ...selected, baseUrl: `https://${domain}`, accessToken: 'replacement' };
		let captured: IntegrationCacheDescriptor | undefined;
		let beforeLoad: () => void = () => {};
		const manager = createIntegrationManager({
			...context,
			cache: {
				getCurrentAccount: (_integration, loader) => loader(new CacheController()).value,
				getPullRequest: async (_id, _resource, integration, loader) => {
					captured = integration;
					await Promise.resolve();
					beforeLoad();
					return loader(new CacheController()).value;
				},
			},
		}) as IntegrationService;
		try {
			const integration = await manager.get(providerId, selected.baseUrl);
			const stubbed = integration as unknown as {
				_session: ProviderAuthenticationSession;
				getProviderPullRequest: (session: ProviderAuthenticationSession) => Promise<PullRequest | undefined>;
			};
			stubbed._session = selected;
			beforeLoad = () => {
				stubbed._session = replacement;
			};
			let dispatched: ProviderAuthenticationSession | undefined;
			stubbed.getProviderPullRequest = async session => {
				dispatched = session;
				return undefined;
			};
			const repo = { key: 'octo/repo', owner: 'octo', name: 'repo' };

			await integration.getPullRequest(repo, '1');
			assert.equal(dispatched, selected);
			assert.deepEqual(
				{ ...captured },
				{
					id: providerId,
					domain: domain,
					maybeConnected: true,
					installationOrigin: selected.baseUrl,
					sessionFingerprint: fnv1aHash64(selected.accessToken),
				},
			);

			await integration.getPullRequest(repo, '1');
			assert.equal(dispatched, replacement);
			assert.equal(captured?.installationOrigin, replacement.baseUrl);
			assert.equal(captured?.sessionFingerprint, fnv1aHash64(replacement.accessToken));
		} finally {
			manager.dispose();
		}
	});

	test('scopes an Enterprise linked pull request when the caller hints that it is an issue', async () => {
		const { cache: _internalCache, ...context } = createFakeRuntime();
		const domain = 'ghe.example.test:8443';
		const providerId = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
		const selected = { ...session, domain: domain, baseUrl: `http://${domain}` };
		const linked = { id: '1', type: 'pullrequest' } satisfies Partial<PullRequest> as PullRequest;
		let captured: IntegrationCacheDescriptor | undefined;
		const manager = createIntegrationManager({
			...context,
			cache: {
				getCurrentAccount: (_integration, loader) => loader(new CacheController()).value,
				getIssueOrPullRequest: (_id, type, _resource, descriptor, loader) => {
					assert.equal(type, 'issue');
					captured = descriptor;
					return loader(new CacheController()).value;
				},
			},
		}) as IntegrationService;
		try {
			const integration = await manager.get(providerId, selected.baseUrl);
			const stubbed = integration as unknown as {
				_session: ProviderAuthenticationSession;
				getProviderLinkedIssueOrPullRequest: (session: ProviderAuthenticationSession) => Promise<PullRequest>;
			};
			stubbed._session = selected;
			stubbed.getProviderLinkedIssueOrPullRequest = async value => {
				assert.equal(value, selected);
				return linked;
			};

			const result = await integration.getLinkedIssueOrPullRequest(
				{ key: 'octo/repo', owner: 'octo', name: 'repo' },
				{ id: '1', key: '1' },
				{ type: 'issue' },
			);
			assert.equal(result, linked);
			assert.equal(captured?.installationOrigin, selected.baseUrl);
			assert.equal(captured?.sessionFingerprint, fnv1aHash64(selected.accessToken));
		} finally {
			manager.dispose();
		}
	});

	test('exposes a cached-only Enterprise scope for the selected, non-retired local session', async () => {
		const runtime = createFakeRuntime();
		runtime.http.fetch = () => assert.fail('getting the scope must not make a request');
		const domain = 'ghe.example.test:8443';
		const providerId = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
		const selected = { ...session, domain: domain, baseUrl: `http://${domain}` };
		const sibling = { ...selected, id: 'sibling', baseUrl: `https://${domain}` };
		const webRemote = `${selected.baseUrl}/octo/repo.git`;
		const sshRemote = 'ssh://git@ghe.example.test:2222/octo/repo.git';
		const scpRemote = 'git@ghe.example.test:octo/repo.git';
		const configured = new ConfiguredIntegrationService(runtime);
		await configured.storeSession(providerId, sibling);
		await configured.storeSession(providerId, selected);
		await configured.setPrimaryConnection(providerId, selected.id);
		const { cache: _internalCache, ...context } = runtime;
		const manager = createIntegrationManager(context) as IntegrationService;
		try {
			const integration = await manager.get(providerId, selected.baseUrl);
			const view: GitHostIntegration = integration;
			const stubbed = integration as unknown as { _session?: ProviderAuthenticationSession };
			assert.equal(view.getCachedPullRequestScope?.(webRemote), undefined);

			stubbed._session = selected;
			for (const remote of [webRemote, sshRemote, scpRemote]) {
				const scope = view.getCachedPullRequestScope?.(remote);
				assert.equal(scope?.installationOrigin, selected.baseUrl, remote);
				assert.equal(scope?.sessionFingerprint, fnv1aHash64(selected.accessToken), remote);
			}

			for (const remote of [
				`${sibling.baseUrl}/octo/repo.git`,
				'http://ghe.example.test:8080/octo/repo.git',
				'ssh://git@other.example.test:2222/octo/repo.git',
				'git@other.example.test:octo/repo.git',
				'ssh://git@ghe.example.test:invalid/octo/repo.git',
				'git://ghe.example.test/octo/repo.git',
				'file:///octo/repo.git',
				'git@:octo/repo.git',
				'git@ghe.example.test:',
			]) {
				assert.equal(view.getCachedPullRequestScope?.(remote), undefined, remote);
			}

			stubbed._session = { ...selected, expiresAt: new Date(0) };
			assert.equal(view.getCachedPullRequestScope?.(webRemote), undefined);
			stubbed._session = sibling;
			assert.equal(view.getCachedPullRequestScope?.(sshRemote), undefined);

			stubbed._session = selected;
			const { configuredIntegrationService: localStore } = manager as unknown as {
				configuredIntegrationService: ConfiguredIntegrationService;
			};
			const insideWrite = defer<void>();
			const finishWrite = defer<void>();
			const storeSecret = runtime.storage.storeSecret;
			runtime.storage.storeSecret = async (key, value) => {
				insideWrite.fulfill();
				await finishWrite.promise;
				await storeSecret(key, value);
			};

			const replacement = { ...selected, accessToken: 'replacement' };
			const rotating = localStore.storeSession(providerId, replacement);
			try {
				await Promise.race([
					insideWrite.promise,
					rotating.then(() =>
						assert.equal(insideWrite.pending, false, 'the replacement must reach the secret store'),
					),
				]);
				assert.equal(stubbed._session, undefined);
				assert.equal(view.getCachedPullRequestScope?.(sshRemote), undefined);
			} finally {
				finishWrite.fulfill();
				await rotating;
				runtime.storage.storeSecret = storeSecret;
			}

			stubbed._session = replacement;
			integration.onSessionsRemoving('secondary', true);
			assert.equal(
				view.getCachedPullRequestScope?.(webRemote)?.sessionFingerprint,
				fnv1aHash64(replacement.accessToken),
			);
			integration.onSessionsRemoving(replacement.id, replacement.cloud);
			assert.equal(view.getCachedPullRequestScope?.(scpRemote), undefined);
		} finally {
			manager.dispose();
			configured.dispose();
		}
	});

	test('runs every lookup the cache omits uncached, and tolerates a missing eviction', async () => {
		const runtime = createFakeRuntime();
		const { cache: _internalCache, ...context } = runtime;
		const manager = createIntegrationManager({
			...context,
			cache: { getCurrentAccount: (_integration, loader) => loader(new CacheController()).value },
		}) as IntegrationService;
		const integration = await getGitHub(manager);

		const pr = { marker: 'pr' } as unknown as PullRequest;
		let loads = 0;
		const stubbed = integration as unknown as {
			getProviderPullRequest: () => Promise<PullRequest>;
			mergeProviderPullRequest: () => Promise<boolean>;
		};
		stubbed.getProviderPullRequest = async () => {
			loads++;
			return pr;
		};
		stubbed.mergeProviderPullRequest = async () => true;

		const repo: RepositoryDescriptor = { key: 'octo/repo', owner: 'octo', name: 'repo' };
		assert.equal(await integration.getPullRequest(repo, '1'), pr);
		assert.equal(await integration.getPullRequest(repo, '1'), pr);
		assert.equal(loads, 2, 'an omitted lookup is not cached across calls');
		assert.equal(await integration.mergePullRequest({} as PullRequest), true, 'no deletePullRequests is fine');

		manager.dispose();
	});
});
