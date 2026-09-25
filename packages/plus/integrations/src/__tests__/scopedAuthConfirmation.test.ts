import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { primarySession, providerPr, stubApi } from './sweepHelpers.js';

/**
 * A scoped `auth` warning promises the credential itself was accepted (#5890). These cover the Bitbucket reads that
 * could break that promise: a token missing the OAuth scopes a read needs, which a probe of the account alone would
 * pass, and a Bitbucket Data Center repository fan-out that reaches every repository with no request to the
 * connection first.
 */

/** A refusal as `throwProviderError` wraps a Bitbucket error response (see `providersApi.ts`). */
function bitbucketRefusal(status: 401 | 403, message: string): AuthenticationError {
	const original = Object.assign(new Error(`(${status}) ${status === 401 ? 'Unauthorized' : 'Forbidden'}.`), {
		response: {
			status: status,
			statusText: status === 401 ? 'Unauthorized' : 'Forbidden',
			headers: {},
			body: { type: 'error', error: { message: message } },
		},
	});
	return new AuthenticationError(
		{
			providerId: GitCloudHostIntegrationId.Bitbucket,
			microHash: undefined,
			cloud: true,
			type: 'oauth',
			scopes: [],
		},
		status === 401 ? AuthenticationErrorReason.Unauthorized : AuthenticationErrorReason.Forbidden,
		original,
	);
}

/**
 * A Bitbucket connection with two workspaces, `ws` and `ok`, whose authored pull requests are read with `authored`.
 */
async function bitbucketWithWorkspaces(
	authored: (workspace: string) => Promise<unknown>,
	probe: () => Promise<unknown>,
) {
	const manager = createIntegrationManager(createFakeRuntime());
	const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
	(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'bitbucket.org',
	};
	stubApi(bb, {
		getBitbucketPullRequestsAuthoredByUserForWorkspace: (_t: unknown, _u: string, workspace: string) =>
			authored(workspace),
		getCurrentUser: probe,
	});
	(
		bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
	).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
	(
		bb as unknown as {
			getProviderResourcesForCurrentUser: () => Promise<{ values: { id: string; slug: string }[] }>;
		}
	).getProviderResourcesForCurrentUser = () =>
		Promise.resolve({
			values: [
				{ id: 'w1', slug: 'ws' },
				{ id: 'w2', slug: 'ok' },
			],
		});
	return manager;
}

/** The healthy workspace's one pull request. */
function okWorkspacePullRequests() {
	return Promise.resolve({
		data: [
			providerPr('pr-ok', {
				url: 'https://bitbucket.org/ok/repo/pull-requests/1',
				repository: { id: 'ok/repo', name: 'repo', owner: { login: 'ok' }, remoteInfo: null },
			}),
		],
		hasMore: false,
		nextPage: null,
	});
}

suite('scoped auth confirmation (#5890)', () => {
	test('Bitbucket: a token missing the OAuth scopes a read needs is reported for the connection', async () => {
		let probes = 0;
		const manager = await bitbucketWithWorkspaces(
			workspace =>
				workspace === 'ok'
					? okWorkspacePullRequests()
					: Promise.reject(
							bitbucketRefusal(403, 'Your credentials lack one or more required privilege scopes.'),
						),
			() => {
				probes++;
				return Promise.resolve({ id: 'u1' });
			},
		);

		try {
			const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.Bitbucket });

			const auth = result.warnings.filter(w => w.kind === 'auth');
			assert.equal(auth.length, 1);
			// The account probe would pass (it needs only the account scope), yet a reconnect, consenting to the
			// scopes again, is exactly the fix; a scope would tell a consumer the opposite.
			assert.equal('scope' in auth[0], false);
			assert.match(auth[0].message, /lack one or more required privilege scopes\.$/);
			assert.equal(probes, 0, 'the refusal says what it is, so nothing is probed');
			// Never a throw: the workspace that answered keeps its results.
			assert.deepEqual(
				result.items.map(pr => pr.url),
				['https://bitbucket.org/ok/repo/pull-requests/1'],
			);
			assert.equal(result.fetchFailed, true);
		} finally {
			manager.dispose();
		}
	});

	test('Bitbucket: every scope refusing a token that lacks OAuth scopes is still one warning, for the connection', async () => {
		const manager = await bitbucketWithWorkspaces(
			() => Promise.reject(bitbucketRefusal(403, 'Your credentials lack one or more required privilege scopes.')),
			() => Promise.resolve({ id: 'u1' }),
		);

		try {
			const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.Bitbucket });

			const auth = result.warnings.filter(w => w.kind === 'auth');
			assert.equal(auth.length, 1, 'one credential, one warning, not one per workspace');
			assert.equal('scope' in auth[0], false);
			assert.doesNotMatch(auth[0].message, /\(resource /);
		} finally {
			manager.dispose();
		}
	});

	test("Bitbucket: a workspace's own refusal of a sound credential stays scoped", async () => {
		let probes = 0;
		const manager = await bitbucketWithWorkspaces(
			workspace =>
				workspace === 'ok'
					? okWorkspacePullRequests()
					: Promise.reject(bitbucketRefusal(403, 'Access denied. You must have write or admin access.')),
			() => {
				probes++;
				return Promise.resolve({ id: 'u1' });
			},
		);

		try {
			const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.Bitbucket });

			const auth = result.warnings.find(w => w.kind === 'auth');
			assert.deepEqual(auth?.scope, { resourceId: 'ws' });
			assert.match(auth?.message ?? '', /Access denied\. You must have write or admin access\.$/);
			assert.equal(probes, 1, 'the credential was confirmed before the scope was trusted');
			assert.equal(result.items.length, 1);
		} finally {
			manager.dispose();
		}
	});

	suite('Bitbucket Data Center repository fan-out', () => {
		const repos = [
			{ namespace: 'PROJ', name: 'one' },
			{ namespace: 'PROJ', name: 'two' },
		];

		/** A connection whose repo-scoped pull request read (the SDK fan-out) refuses every repository. */
		async function bitbucketServerRefusingEveryRepository(probe: () => Promise<unknown>) {
			const manager = createIntegrationManager(createFakeRuntime());
			const bbs = await manager.get(GitSelfManagedHostIntegrationId.BitbucketServer, 'https://bb.example.com');
			assert.ok(bbs);
			(bbs as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: 'bb.example.com',
				type: 'pat',
			};
			stubApi(bbs, {
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => undefined,
				// The SDK's `collectAcrossScopes`: every refused repository becomes a scoped failure, none a throw.
				getPullRequestsForRepos: () =>
					Promise.resolve({
						values: [],
						paging: { more: false },
						metadata: {
							completeness: 'partial',
							failures: repos.map(r => ({
								scope: {
									providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
									repositoryId: `${r.namespace}/${r.name}`,
								},
								kind: 'authentication',
								message: 'Unauthorized',
							})),
						},
					}),
				getCurrentUser: probe,
			});
			return manager;
		}

		test('a dead token is a connection failure, not one refusal per repository', async () => {
			const manager = await bitbucketServerRefusingEveryRepository(() =>
				Promise.reject(
					new AuthenticationError(
						{
							providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
							microHash: undefined,
							cloud: false,
							type: 'pat',
							scopes: [],
						},
						AuthenticationErrorReason.Unauthorized,
					),
				),
			);

			try {
				const result = await manager.listPullRequestsPage({
					providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
					repos: repos,
					domain: 'bb.example.com',
				});

				const auth = result.warnings.filter(w => w.kind === 'auth');
				assert.equal(auth.length, 1);
				assert.equal('scope' in auth[0], false, 'the refused credential is reported for the connection');
				assert.equal(result.fetchFailed, true);
			} finally {
				manager.dispose();
			}
		});

		test('an unlicensed credential (e.g. a project access token) is not a dead one', async () => {
			// `/users` needs a licensed user; a bot user authenticates but holds no license.
			const unlicensed = Object.assign(
				new Error('(401) Unauthorized. The currently authenticated user is not a licensed user.'),
				{
					response: { status: 401, statusText: 'Unauthorized', headers: {}, body: undefined },
				},
			);
			const manager = await bitbucketServerRefusingEveryRepository(() =>
				Promise.reject(
					new AuthenticationError(
						{
							providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
							microHash: undefined,
							cloud: false,
							type: 'pat',
							scopes: [],
						},
						AuthenticationErrorReason.Unauthorized,
						unlicensed,
					),
				),
			);

			try {
				const result = await manager.listPullRequestsPage({
					providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
					repos: repos,
					domain: 'bb.example.com',
				});

				assert.deepEqual(
					result.warnings.filter(w => w.kind === 'auth').map(w => w.scope),
					[{ repositoryId: 'PROJ/one' }, { repositoryId: 'PROJ/two' }],
					'the check proves nothing, so the read is left as it was',
				);
			} finally {
				manager.dispose();
			}
		});

		test('a sound token keeps each repository its own refusal', async () => {
			let probes = 0;
			const manager = await bitbucketServerRefusingEveryRepository(() => {
				probes++;
				return Promise.resolve({ id: 'u1' });
			});

			try {
				const result = await manager.listPullRequestsPage({
					providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
					repos: repos,
					domain: 'bb.example.com',
				});

				assert.deepEqual(
					result.warnings.filter(w => w.kind === 'auth').map(w => w.scope),
					[{ repositoryId: 'PROJ/one' }, { repositoryId: 'PROJ/two' }],
				);
				assert.equal(probes, 1);
			} finally {
				manager.dispose();
			}
		});
	});
});
