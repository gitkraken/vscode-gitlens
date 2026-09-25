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

		/**
		 * `/users`' refusal as `throwProviderError` wraps it (see `providersApi.ts`, which puts the body's message in
		 * the error's). Defaults to the answer captured from Bitbucket Data Center 8.8 for a dead token, which is the
		 * same body an authenticated credential gets, except that `X-AUSERNAME` then names its user.
		 */
		function usersRefusal(
			options: { username?: string; message?: string; exceptionName?: string } = {},
		): AuthenticationError {
			const {
				username,
				message = 'You are not permitted to access this resource',
				exceptionName = 'com.atlassian.bitbucket.AuthorisationException',
			} = options;
			const original = Object.assign(new Error(`(401) Unauthorized. ${message}`), {
				response: {
					status: 401,
					statusText: 'Unauthorized',
					headers: username != null ? { 'x-ausername': username } : {},
					body: { errors: [{ context: null, message: message, exceptionName: exceptionName }] },
				},
			});
			return new AuthenticationError(
				{
					providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
					microHash: undefined,
					cloud: false,
					type: 'pat',
					scopes: [],
				},
				AuthenticationErrorReason.Unauthorized,
				original,
			);
		}

		/** Reads the refused repositories' pull requests twice, returning the first read and the checks made. */
		async function readTwice(probe: () => Promise<unknown>) {
			let probes = 0;
			const manager = await bitbucketServerRefusingEveryRepository(() => {
				probes++;
				return probe();
			});
			try {
				const read = () =>
					manager.listPullRequestsPage({
						providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
						repos: repos,
						domain: 'bb.example.com',
					});
				const result = await read();
				await read();
				return { result: result, probes: probes };
			} finally {
				manager.dispose();
			}
		}

		test('a dead token is a connection failure, not one refusal per repository', async () => {
			const { result } = await readTwice(() => Promise.reject(usersRefusal()));

			const auth = result.warnings.filter(w => w.kind === 'auth');
			assert.equal(auth.length, 1);
			assert.equal('scope' in auth[0], false, 'the refused credential is reported for the connection');
			assert.equal(result.fetchFailed, true);
		});

		for (const [label, probe] of [
			['a refusal naming the user it authenticated', () => Promise.reject(usersRefusal({ username: 'jdoe' }))],
			[
				'a refusal of an unlicensed user',
				() =>
					Promise.reject(
						usersRefusal({ message: 'The currently authenticated user is not a licensed user.' }),
					),
			],
			[
				// What the SDK throws when `/users` answers but does not list the user the token authenticated as.
				'a project access token, whose bot user `/users` does not list,',
				() => Promise.reject(new Error('Could not find current Bitbucket Server user')),
			],
		] as const) {
			test(`${label} proves nothing, and is checked again on the next read`, async () => {
				const { result, probes } = await readTwice(probe);

				assert.deepEqual(
					result.warnings.filter(w => w.kind === 'auth').map(w => w.scope),
					[{ repositoryId: 'PROJ/one' }, { repositoryId: 'PROJ/two' }],
					'the read is left as it was',
				);
				assert.equal(probes, 2, 'a check that proved nothing is not remembered');
			});
		}

		test('a sound token keeps each repository its own refusal', async () => {
			const { result, probes } = await readTwice(() => Promise.resolve({ id: 'u1' }));

			assert.deepEqual(
				result.warnings.filter(w => w.kind === 'auth').map(w => w.scope),
				[{ repositoryId: 'PROJ/one' }, { repositoryId: 'PROJ/two' }],
			);
			assert.equal(probes, 1, 'a pass is remembered');
		});
	});
});
