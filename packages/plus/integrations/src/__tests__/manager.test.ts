import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

suite('createIntegrationManager — vertical-slice smoke', () => {
	test('constructs and disposes cleanly with a fake runtime', () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);

		// Manager exposes the expected surface
		assert.ok(typeof manager.get === 'function', 'manager.get exists');
		assert.ok(typeof manager.dispose === 'function', 'manager.dispose exists');
		assert.ok(typeof manager.connectCloudIntegrations === 'function');

		// Disposing should not throw
		manager.dispose();
	});

	test('emits integration.connection.started telemetry on connectCloudIntegrations', async () => {
		const runtime = createFakeRuntime();
		// Short-circuit the host connect flow so the orchestration returns immediately (onStarted still fires).
		runtime.account.connect = async () => false;
		const manager = createIntegrationManager(runtime);

		await manager.connectCloudIntegrations(
			{ integrationIds: [GitCloudHostIntegrationId.GitHub] },
			{ source: 'test' },
		);

		const startEvents = runtime.emittedEvents.filter(e => e.event === 'integration.connection.started');
		assert.ok(startEvents.length >= 1, 'started event should fire at least once');
		assert.deepEqual(startEvents[0].source, { source: 'test' });
	});

	test('connection state changes route through typed telemetry hooks', () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);

		// Triggering subscription/auth events shouldn't crash the manager and
		// shouldn't emit any package events (those fire on actual state changes).
		runtime.fireSubscriptionChange();
		runtime.fireSubscriptionCheckIn();
		runtime.fireAuthenticationSessionChange('github');

		assert.equal(
			runtime.emittedEvents.filter(e => e.event === 'integration.connection.hosting.changed').length,
			0,
			'no spurious hosting.changed events from idle transitions',
		);

		manager.dispose();
	});

	test('manager disposes cleanly and idempotently', () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);

		manager.dispose();
		// dispose should be idempotent
		manager.dispose();
	});

	test('package constructs cloud auth providers directly (no host hook)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		// The package owns cloud auth-provider construction (cloud-only). Resolving any cloud integration's
		// connection state exercises that in-package lookup; a missing provider would throw "No authentication
		// provider registered", so the absence of that rejection proves the package built it itself.
		const integration = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		assert.ok(integration != null, 'cloud integration resolves');
		await assert.doesNotReject(() => integration.isConnected());
		manager.dispose();
	});
});

suite('ConfiguredIntegrationService.purgeStoredConfiguration — retired-id cleanup', () => {
	test('deletes config, secrets, and connected flags for retired ids while leaving live ids intact', async () => {
		const runtime = createFakeRuntime();
		// Seed pre-cloud-only local self-managed state (the retired `github-enterprise` id) plus a live id.
		await runtime.storage.store('integrations:configured', {
			'github-enterprise': [
				{ cloud: false, integrationId: 'github-enterprise', domain: 'gh.example.com', scopes: 'repo' },
			],
			github: [{ cloud: true, integrationId: 'github', domain: 'github.com', scopes: 'repo' }],
		});
		await runtime.storage.storeSecret('integration.auth:github-enterprise|gh.example.com', '{}');
		await runtime.storage.storeSecret('integration.auth.cloud:github-enterprise|gh.example.com', '{}');
		await runtime.storage.storeWorkspace('connected:github-enterprise:gh.example.com', true);

		await new ConfiguredIntegrationService(runtime).purgeStoredConfiguration([
			'github-enterprise',
			'gitlab-self-hosted',
		]);

		const configured = runtime.storage.get<Record<string, unknown>>('integrations:configured') ?? {};
		assert.ok(!('github-enterprise' in configured), 'retired github-enterprise config removed');
		assert.ok('github' in configured, 'live github config retained');
		assert.equal(
			await runtime.storage.getSecret('integration.auth:github-enterprise|gh.example.com'),
			undefined,
			'retired local secret deleted',
		);
		assert.equal(
			await runtime.storage.getSecret('integration.auth.cloud:github-enterprise|gh.example.com'),
			undefined,
			'retired cloud secret deleted',
		);
		assert.equal(
			runtime.storage.getWorkspace('connected:github-enterprise:gh.example.com'),
			undefined,
			'retired connected flag deleted',
		);
	});
});
