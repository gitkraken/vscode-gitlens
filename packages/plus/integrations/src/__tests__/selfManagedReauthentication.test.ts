import * as assert from 'node:assert/strict';
import { suite, teardown, test } from 'mocha';
import { CloudIntegrationService } from '../authentication/cloudIntegrationService.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { IntegrationIds } from '../constants.js';
import { GitSelfManagedHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

suite('Self-managed forced session connection selection', () => {
	for (const id of [
		GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
		GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
		GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		GitSelfManagedHostIntegrationId.BitbucketServer,
		IssuesSelfManagedHostIntegrationId.JiraServer,
	]) {
		test(`${id} captures its host token before clearing local sessions`, async () => {
			const { runtime, calls, configured, provider, connectCalls } = await setup(id);
			await provider.getSession({ domain: 'second.example.test', scopes: [] }, { forceNewSession: true });

			assert.deepEqual(calls, ['DELETE v1/provider-tokens/tokens/second-token']);
			assert.ok(await runtime.storage.getSecret(`integration.auth.cloud:${id}|first-token`));
			assert.equal(await runtime.storage.getSecret(`integration.auth.cloud:${id}|second-token`), undefined);
			assert.deepEqual(
				configured.getConfigured(id).map(c => c.id),
				['first-token'],
			);
			assert.equal(connectCalls.length, 1);
		});

		for (const descriptor of [
			{ domain: 'missing.example.test', scopes: [] },
			{ domain: 'first.example.test', connectionId: 'second-token', scopes: [] },
		]) {
			test(`${id} refuses ${descriptor.connectionId ? 'a live foreign-host token' : 'a missing host'}`, async () => {
				const { runtime, calls, configured, provider, connectCalls } = await setup(id);
				const before = configured.getConfigured(id);
				const secrets = await Promise.all(
					['first', 'second'].map(host =>
						runtime.storage.getSecret(`integration.auth.cloud:${id}|${host}-token`),
					),
				);
				assert.ok(secrets.every(Boolean));

				assert.equal(await provider.getSession(descriptor, { forceNewSession: true }), undefined);

				assert.deepEqual(calls, []);
				assert.deepEqual(connectCalls, []);
				assert.deepEqual(configured.getConfigured(id), before);
				assert.deepEqual(
					await Promise.all(
						['first', 'second'].map(host =>
							runtime.storage.getSecret(`integration.auth.cloud:${id}|${host}-token`),
						),
					),
					secrets,
				);
			});
		}

		test(`${id} retries the same token after a failed DELETE without restoring its secret`, async () => {
			const { runtime, calls, configured, provider, connectCalls } = await setup(id, [503, 200]);
			await configured.storeSession(id, { ...session('third'), domain: 'second.example.test' });
			const before = configured.getConfigured(id);
			const mark = configured.getSignOutMark();
			const descriptor = { domain: 'second.example.test', scopes: [] };
			await provider.getSession(descriptor, { forceNewSession: true });

			assert.deepEqual(calls, ['DELETE v1/provider-tokens/tokens/second-token']);
			assert.deepEqual(connectCalls, []);
			assert.deepEqual(configured.getConfigured(id), before);
			assert.equal(await runtime.storage.getSecret(`integration.auth.cloud:${id}|second-token`), undefined);
			assert.equal(await configured.storeSession(id, session('second'), { signOutMark: mark }), false);
			assert.equal(await configured.storeSession(id, session('first'), { signOutMark: mark }), true);

			await provider.getSession(descriptor, { forceNewSession: true });

			assert.deepEqual(calls, Array(2).fill('DELETE v1/provider-tokens/tokens/second-token'));
			assert.equal(connectCalls.length, 1);
			assert.ok(await runtime.storage.getSecret(`integration.auth.cloud:${id}|third-token`));
			assert.deepEqual(
				configured.getConfigured(id).map(c => c.id),
				['first-token', 'third-token'],
			);
			assert.ok(await runtime.storage.getSecret(`integration.auth.cloud:${id}|first-token`));
			assert.equal(await runtime.storage.getSecret(`integration.auth.cloud:${id}|second-token`), undefined);
		});
	}

	const disposables: Array<{ dispose(): void }> = [];
	teardown(() => {
		for (const disposable of disposables.splice(0)) {
			disposable.dispose();
		}
	});

	function session(host: string) {
		return {
			id: `${host}-token`,
			accessToken: `${host}-pat`,
			domain: `${host}.example.test`,
			scopes: [],
			cloud: true,
			type: 'pat' as const,
			account: { id: '', label: '' },
		};
	}

	async function setup(id: IntegrationIds, statuses = [200]) {
		const runtime = createFakeRuntime();
		const calls: string[] = [];
		const connectCalls: boolean[] = [];
		runtime.account.getAccount = async () => ({ id: 'me' });
		runtime.account.fetchGkApi = async (path, init) => {
			calls.push(`${init?.method} ${path}`);
			return new Response(JSON.stringify({ data: null }), { status: statuses.shift() ?? 200 });
		};
		const configured = new ConfiguredIntegrationService(runtime);
		disposables.push(configured);
		for (const host of ['first', 'second']) {
			await configured.storeSession(id, session(host));
		}
		const auth = new IntegrationAuthenticationService(
			configured,
			runtime,
			() =>
				({
					connectCloudIntegrations: async () => {
						connectCalls.push(true);
						return false;
					},
				}) as unknown as IntegrationService,
			new CloudIntegrationService(runtime),
		);
		disposables.push(auth);
		return {
			runtime: runtime,
			calls: calls,
			configured: configured,
			provider: await auth.get(id),
			connectCalls: connectCalls,
		};
	}
});
