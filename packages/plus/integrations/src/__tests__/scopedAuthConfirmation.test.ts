import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { primarySession, stubApi } from './sweepHelpers.js';

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

/** A Bitbucket connection with one workspace, whose authored pull requests are read with `authored`. */
async function bitbucketWithWorkspace(authored: () => Promise<unknown>, probe: () => Promise<unknown>) {
	const manager = createIntegrationManager(createFakeRuntime());
	const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
	(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'bitbucket.org',
	};
	stubApi(bb, { getBitbucketPullRequestsAuthoredByUserForWorkspace: authored, getCurrentUser: probe });
	(
		bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
	).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
	(
		bb as unknown as {
			getProviderResourcesForCurrentUser: () => Promise<{ values: { id: string; slug: string }[] }>;
		}
	).getProviderResourcesForCurrentUser = () => Promise.resolve({ values: [{ id: 'w1', slug: 'ws' }] });
	return manager;
}

suite('scoped auth confirmation (#5890)', () => {
	test('Bitbucket: a token missing the OAuth scopes a read needs is a connection failure, not a scoped one', async () => {
		let probes = 0;
		const manager = await bitbucketWithWorkspace(
			() => Promise.reject(bitbucketRefusal(403, 'Your credentials lack one or more required privilege scopes.')),
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
			assert.equal(auth[0].message, 'Your credentials lack one or more required privilege scopes.');
			assert.equal(result.fetchFailed, true);
			assert.equal(probes, 0, 'the refusal says what it is, so nothing is probed');
		} finally {
			manager.dispose();
		}
	});

	test("Bitbucket: a workspace's own refusal of a sound credential stays scoped", async () => {
		let probes = 0;
		const manager = await bitbucketWithWorkspace(
			() => Promise.reject(bitbucketRefusal(403, 'Access denied. You must have write or admin access.')),
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
