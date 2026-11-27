import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { CloudIntegrationService } from '../authentication/cloudIntegrationService.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type {
	GetSessionOptions,
	IntegrationAuthenticationSessionDescriptor,
} from '../authentication/integrationAuthenticationProvider.js';
import { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { CloudIntegrationConnection } from '../authentication/models.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import { IntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
const domain = 'https://server.test/tfs';
const connectionId = 'connection';
const descriptor: IntegrationAuthenticationSessionDescriptor = {
	domain: 'server.test',
	scopes: [],
	connectionId: connectionId,
	cloud: true,
};
const connection: CloudIntegrationConnection & { id: string } = {
	id: connectionId,
	provider: toCloudIntegrationType[id]!,
	type: 'pat',
	domain: domain,
	primary: true,
	accountName: 'me',
};

const hostB: IntegrationAuthenticationSessionDescriptor = {
	domain: 'other.test',
	scopes: [],
	connectionId: 'connection-b',
	cloud: true,
};
const hostBToken = { tokenId: 'connection-b', domain: 'https://other.test/tfs' };
const implicitA: IntegrationAuthenticationSessionDescriptor = { domain: 'server.test', scopes: [], cloud: true };
const unconfigured: IntegrationAuthenticationSessionDescriptor = { domain: 'third.test', scopes: [], cloud: true };

type TokenFetch = {
	path: string;
	answer: (token: string, overrides?: Record<string, unknown>) => void;
	answerNone: () => void;
};

function setup() {
	const runtime = createFakeRuntime();
	runtime.account.getAccount = async () => ({ id: 'me' });
	const fetches: TokenFetch[] = [];
	runtime.account.fetchGkApi = path =>
		new Promise(resolve =>
			fetches.push({
				path: path,
				answerNone: () => resolve(Response.json({ data: null })),
				answer: (token, overrides) =>
					resolve(
						Response.json({
							data: {
								tokenId: connectionId,
								provider: connection.provider,
								type: 'pat',
								domain: domain,
								accessToken: token,
								expiresIn: 3600,
								scopes: '',
								...overrides,
							},
						}),
					),
			}),
		);

	const configured = new ConfiguredIntegrationService(runtime);
	let service: IntegrationService;
	const auth = new IntegrationAuthenticationService(
		configured,
		runtime,
		() => service,
		new CloudIntegrationService(runtime),
	);
	service = new IntegrationService(auth, configured, runtime);
	let connects = 0;
	auth.connectCloudIntegrations = () => {
		connects++;
		return Promise.resolve(false);
	};
	return {
		fetches: fetches,
		connects: () => connects,
		configured: configured,
		getSession: async (
			options: GetSessionOptions,
			target: IntegrationAuthenticationSessionDescriptor = descriptor,
		) => (await auth.get(id)).getSession(target, options),
		reconcile: (listed = connection) => service['reconcileCloudConnections'](id, [listed], true),
		stored: async () => (await configured.peekStoredSession(id, connectionId, true, 'server.test'))?.accessToken,
		dispose: () => service.dispose(),
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

type Fixture = ReturnType<typeof setup>;

async function answer(
	fixture: Fixture,
	token: string,
	overrides?: Record<string, unknown>,
	none?: boolean,
): Promise<void> {
	while (fixture.fetches.length === 0) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
	const fetch = fixture.fetches.shift()!;
	if (none) {
		fetch.answerNone();
	} else {
		fetch.answer(token, overrides);
	}
}

async function answerRefresh(fixture: Fixture, token: string): Promise<void> {
	await answer(fixture, 'rejected-token');
	await answer(fixture, token);
}

async function answerFor(
	fixture: Fixture,
	connection: string | undefined,
	token: string,
	overrides?: Record<string, unknown>,
): Promise<void> {
	const matches = (fetch: TokenFetch) =>
		connection != null ? fetch.path.includes(`/tokens/${connection}`) : !fetch.path.includes('/tokens/');
	while (!fixture.fetches.some(matches)) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
	fixture.fetches.splice(fixture.fetches.findIndex(matches), 1)[0].answer(token, overrides);
}

async function seed(fixture: Fixture, token: string): Promise<void> {
	const seeded = fixture.getSession({ sync: true });
	await answer(fixture, token);
	assert.equal((await seeded)?.accessToken, token);
}

suite('Azure DevOps Server credential acquisition ordering', () => {
	for (const existing of [undefined, 'stored-token']) {
		test(`a resolution waits for one already fetching, and the later one publishes last (${existing ?? 'cold'})`, async () => {
			const fixture = setup();
			try {
				if (existing != null) {
					await seed(fixture, existing);
				}

				const older = fixture.getSession(existing != null ? { refreshRejectedToken: true } : { sync: true });
				await settle();
				assert.equal(fixture.fetches.length, 1);
				const newer = fixture.getSession({ refreshRejectedToken: true });
				await settle();
				assert.equal(fixture.fetches.length, 1, 'the newer resolution does not fetch while one is open');

				await (existing != null ? answerRefresh(fixture, 'old-token') : answer(fixture, 'old-token'));
				assert.equal((await older)?.accessToken, 'old-token');
				await answerRefresh(fixture, 'new-token');
				assert.equal((await newer)?.accessToken, 'new-token');
				assert.equal(await fixture.stored(), 'new-token');
			} finally {
				fixture.dispose();
			}
		});
	}

	test('a reconciliation and a refresh publish in the order they acquire, whichever starts first', async () => {
		for (const first of ['reconcile', 'refresh'] as const) {
			const fixture = setup();
			try {
				await seed(fixture, 'stored-token');

				const runs = {
					reconcile: { start: fixture.reconcile, finish: (token: string) => answer(fixture, token) },
					refresh: {
						start: () => fixture.getSession({ refreshRejectedToken: true }),
						finish: (token: string) => answerRefresh(fixture, token),
					},
				};
				const second = first === 'reconcile' ? 'refresh' : 'reconcile';
				const firstRun = runs[first].start();
				await settle();
				assert.equal(fixture.fetches.length, 1);
				const secondRun = runs[second].start();
				await settle();
				assert.equal(fixture.fetches.length, 1, `${second} does not fetch while ${first} is open`);

				await runs[first].finish(`${first}-token`);
				await firstRun;
				assert.equal(await fixture.stored(), `${first}-token`);
				await runs[second].finish(`${second}-token`);
				await secondRun;
				assert.equal(await fixture.stored(), `${second}-token`);
			} finally {
				fixture.dispose();
			}
		}
	});

	test('a reconciliation refuses a token issued for another connection or address', async () => {
		for (const overrides of [{ tokenId: 'other-connection' }, { domain: 'https://server.test/other' }]) {
			const fixture = setup();
			try {
				await seed(fixture, 'stored-token');

				const reconcile = fixture.reconcile();
				await answer(fixture, 'foreign-token', overrides);
				await reconcile;
				assert.equal(await fixture.stored(), 'stored-token', JSON.stringify(overrides));
			} finally {
				fixture.dispose();
			}
		}
	});

	test('a resolution on another Server host progresses while one host holds its acquisition', async () => {
		const fixture = setup();
		try {
			await seed(fixture, 'stored-token');
			const seededB = fixture.getSession({ sync: true }, hostB);
			await answerFor(fixture, hostB.connectionId, 'b-stored', hostBToken);
			assert.equal((await seededB)?.accessToken, 'b-stored');

			const heldA = fixture.reconcile();
			await settle();
			assert.equal(fixture.fetches.length, 1);
			const refreshB = fixture.getSession({ refreshRejectedToken: true }, hostB);
			await answerFor(fixture, hostB.connectionId, 'b-rejected', hostBToken);
			await answerFor(fixture, hostB.connectionId, 'b-new', hostBToken);
			assert.equal((await refreshB)?.accessToken, 'b-new');

			await answerFor(fixture, connectionId, 'a-new');
			await heldA;
			assert.equal(await fixture.stored(), 'a-new');
		} finally {
			fixture.dispose();
		}
	});

	test('a resolution of the implicit primary orders with one naming its connection id, and only with it', async () => {
		const fixture = setup();
		try {
			await seed(fixture, 'stored-token');
			const seededB = fixture.getSession({ sync: true }, hostB);
			await answerFor(fixture, hostB.connectionId, 'b-stored', hostBToken);
			await seededB;

			const explicit = fixture.getSession({ refreshRejectedToken: true });
			await settle();
			assert.equal(fixture.fetches.length, 1);
			const implicit = fixture.getSession({ refreshRejectedToken: true }, implicitA);
			await settle();
			assert.equal(fixture.fetches.length, 1, 'the implicit primary waits for its explicit alias');

			const refreshB = fixture.getSession({ refreshRejectedToken: true }, hostB);
			await answerFor(fixture, hostB.connectionId, 'b-rejected', hostBToken);
			await answerFor(fixture, hostB.connectionId, 'b-new', hostBToken);
			assert.equal((await refreshB)?.accessToken, 'b-new', 'another host does not wait for the alias');

			await answerRefresh(fixture, 'explicit-token');
			assert.equal((await explicit)?.accessToken, 'explicit-token');
			assert.ok(fixture.fetches.every(f => f.path.includes(`/tokens/${connectionId}`)));
			await answerRefresh(fixture, 'implicit-token');
			assert.equal((await implicit)?.accessToken, 'implicit-token');
			assert.equal(await fixture.stored(), 'implicit-token');
		} finally {
			fixture.dispose();
		}
	});

	test('an unresolved connection waits for earlier acquisitions and holds back later ones', async () => {
		const fixture = setup();
		try {
			await seed(fixture, 'stored-token');

			const heldA = fixture.getSession({ refreshRejectedToken: true });
			await settle();
			const unresolved = fixture.getSession({ sync: true }, unconfigured);
			await settle();
			const laterB = fixture.getSession({ sync: true }, hostB);
			await settle();
			assert.equal(fixture.fetches.length, 1, 'only the held acquisition fetches');

			await answerRefresh(fixture, 'a-new');
			await heldA;
			await settle();
			assert.equal(fixture.fetches.length, 1);
			assert.equal(fixture.fetches[0].path.includes('/tokens/'), false, 'the unresolved one runs before B');
			await answerFor(fixture, undefined, 'unresolved-token', {
				tokenId: 'connection-c',
				domain: 'https://third.test/tfs',
			});
			await unresolved;

			await answerFor(fixture, hostB.connectionId, 'b-token', hostBToken);
			assert.equal((await laterB)?.accessToken, 'b-token');
		} finally {
			fixture.dispose();
		}
	});

	test('a sign-out during a connecting resolution does not start an interactive connect', async () => {
		const fixture = setup();
		try {
			const connecting = fixture.getSession({ createIfNeeded: true });
			await settle();
			assert.equal(fixture.fetches.length, 1);
			await fixture.configured.deleteStoredSessions(id, descriptor, true, {
				signOut: true,
				preserveConfigured: true,
			});

			await answer(fixture, 'fetched-before-sign-out');
			assert.equal(await connecting, undefined);
			assert.equal(fixture.connects(), 0);
			assert.equal(await fixture.stored(), undefined);

			const missing = fixture.getSession({ createIfNeeded: true });
			await answer(fixture, '', undefined, true);
			assert.equal(await missing, undefined);
			assert.equal(fixture.connects(), 1, 'a credential the backend does not have still connects');
		} finally {
			fixture.dispose();
		}
	});

	test('a reconciliation keeps a stored address that a domainless token does not confirm', async () => {
		const fixture = setup();
		try {
			await seed(fixture, 'stored-token');

			const moved = fixture.reconcile({ ...connection, domain: 'https://server.test/moved' });
			await answer(fixture, 'moved-token', { domain: '' });
			await moved;
			assert.equal(await fixture.stored(), 'stored-token');
			assert.equal(fixture.configured.getConfiguredBaseUrl(id, connectionId), domain);

			const same = fixture.reconcile();
			await answer(fixture, 'same-address-token', { domain: '' });
			await same;
			assert.equal(await fixture.stored(), 'same-address-token');
			assert.equal(fixture.configured.getConfiguredBaseUrl(id, connectionId), domain);
		} finally {
			fixture.dispose();
		}
	});

	test('a sign-out refuses what was fetching or queued before it, and a resolution after it still publishes', async () => {
		const fixture = setup();
		try {
			await seed(fixture, 'stored-token');

			const fetching = fixture.getSession({ refreshRejectedToken: true });
			await settle();
			const queued = fixture.getSession({ sync: true });
			await settle();
			await fixture.configured.deleteStoredSessions(id, descriptor, true, {
				signOut: true,
				preserveConfigured: true,
			});

			await answerRefresh(fixture, 'fetched-before-sign-out');
			assert.equal(await fetching, undefined);
			await answer(fixture, 'queued-before-sign-out');
			assert.equal(await queued, undefined);
			assert.equal(await fixture.stored(), undefined);

			const after = fixture.getSession({ sync: true });
			await answer(fixture, 'after-sign-out');
			assert.equal((await after)?.accessToken, 'after-sign-out');
			assert.equal(await fixture.stored(), 'after-sign-out');
		} finally {
			fixture.dispose();
		}
	});
});
