import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { CloudIntegrationService } from '../authentication/cloudIntegrationService.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { IntegrationAuthenticationSessionDescriptor } from '../authentication/integrationAuthenticationProvider.js';
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

type TokenFetch = { path: string; answer: (token: string, overrides?: Record<string, unknown>) => void };

/** Every provider-token fetch waits for the test to answer it, so the test chooses the order fetches finish in. */
function setup() {
	const runtime = createFakeRuntime();
	runtime.account.getAccount = async () => ({ id: 'me' });
	const fetches: TokenFetch[] = [];
	runtime.account.fetchGkApi = path =>
		new Promise(resolve =>
			fetches.push({
				path: path,
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
	return {
		fetches: fetches,
		configured: configured,
		getSession: async (options: { refreshRejectedToken?: boolean; sync?: boolean }) =>
			(await auth.get(id)).getSession(descriptor, options),
		reconcile: () => service['reconcileCloudConnections'](id, [connection], true),
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

/** Answers the oldest unanswered token fetch, waiting for one to start. */
async function answer(fixture: Fixture, token: string, overrides?: Record<string, unknown>): Promise<void> {
	while (fixture.fetches.length === 0) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
	fixture.fetches.shift()!.answer(token, overrides);
}

/** A rejected-token refresh reads the token, then refreshes it: two fetches. */
async function answerRefresh(fixture: Fixture, token: string): Promise<void> {
	await answer(fixture, 'rejected-token');
	await answer(fixture, token);
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
