import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { CloudIntegrationAuthenticationProvider } from '../authentication/cloudIntegrationAuthenticationProvider.js';
import { CloudIntegrationService } from '../authentication/cloudIntegrationService.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import type { IntegrationAuthenticationSessionDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import { createFakeRuntime } from './fakeRuntime.js';

const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
const domain = 'https://server.test/tfs';
const descriptor: IntegrationAuthenticationSessionDescriptor = {
	domain: domain,
	scopes: [],
	connectionId: 'connection',
	cloud: true,
};

function session(accessToken: string): ProviderAuthenticationSession {
	return {
		id: 'connection',
		accessToken: accessToken,
		account: { id: 'account', label: 'Account' },
		scopes: [],
		cloud: true,
		type: 'pat',
		domain: domain,
		baseUrl: domain,
	};
}

/** Each fetch answers with the token the test releases it with, in the order the test chooses. */
class ControlledProvider extends CloudIntegrationAuthenticationProvider<typeof id> {
	readonly fetches: ((token: string) => void)[] = [];

	protected override getNewSession(): Promise<ProviderAuthenticationSession | undefined> {
		return new Promise(resolve => this.fetches.push(token => resolve(session(token))));
	}
}

async function setup(stored?: string) {
	const runtime = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(runtime);
	const auth = new IntegrationAuthenticationService(
		configured,
		runtime,
		() => undefined as never,
		new CloudIntegrationService(runtime),
	);
	if (stored != null) {
		assert.ok(await configured.storeSession(id, session(stored)));
	}

	const provider = new ControlledProvider(auth, configured, id);
	const read = async () => (await configured.peekStoredSession(id, 'connection', true, domain))?.accessToken;
	return {
		auth: auth,
		configured: configured,
		provider: provider,
		read: read,
		dispose: () => {
			provider.dispose();
			auth.dispose();
			configured.dispose();
		},
	};
}

async function waitForFetches(provider: ControlledProvider, count: number): Promise<void> {
	while (provider.fetches.length < count) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

suite('Azure DevOps Server stored credential ordering', () => {
	for (const [name, stored, options] of [
		['cold', undefined, {}],
		['replacing a stored credential', 'previous-token', { refreshRejectedToken: true }],
	] as const) {
		test(`an older fetch that finishes last keeps the newer credential (${name})`, async () => {
			const fixture = await setup(stored);
			try {
				const older = fixture.provider.getSession(descriptor, options);
				await waitForFetches(fixture.provider, 1);
				const newer = fixture.provider.getSession(descriptor, options);
				await waitForFetches(fixture.provider, 2);

				fixture.provider.fetches[1]('new-token');
				const newerSession = await newer;
				assert.equal(newerSession?.accessToken, 'new-token');
				const tracked = fixture.configured.getStoredWriteMark();
				const isNewerCurrent = fixture.auth.trackStoredSession(id, newerSession);

				fixture.provider.fetches[0]('old-token');
				const olderSession = await older;
				assert.equal(olderSession?.accessToken, 'new-token');
				assert.equal(await fixture.read(), 'new-token');
				assert.equal(await isNewerCurrent(), true);
				assert.equal(fixture.configured.getStoredWriteMark(), tracked);
				assert.equal(await fixture.auth.trackStoredSession(id, olderSession)(), true);
			} finally {
				fixture.dispose();
			}
		});
	}

	test('a fetch that finishes first is still replaced by a newer one that finishes later', async () => {
		const fixture = await setup();
		try {
			const older = fixture.provider.getSession(descriptor, {});
			await waitForFetches(fixture.provider, 1);
			fixture.provider.fetches[0]('old-token');
			assert.equal((await older)?.accessToken, 'old-token');

			const newer = fixture.provider.getSession(descriptor, { refreshRejectedToken: true });
			await waitForFetches(fixture.provider, 2);
			fixture.provider.fetches[1]('new-token');
			assert.equal((await newer)?.accessToken, 'new-token');
			assert.equal(await fixture.read(), 'new-token');
		} finally {
			fixture.dispose();
		}
	});
});
