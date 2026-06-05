// This fixture proves that `@gitlens/integrations` works as a real external
// consumer would use it: imports only the public facade (`./index.js`),
// constructs a runtime out of vanilla Node primitives (no vscode, no
// Container, no GitLens), instantiates the manager, and exercises a few
// surfaces.
//
// If the package ever grows a hidden coupling to VS Code or to GitLens, this
// fixture will fail to type-check or fail at runtime.

import * as assert from 'node:assert/strict';
import { Emitter } from '@gitlens/utils/event.js';
import type { Uri } from '@gitlens/utils/uri.js';
import {
	createIntegrationManager,
	createManualTokenAuthProvider,
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	type ConfigChangeEvent,
	type IntegrationServiceContext,
	type IntegrationStorageProvider,
} from '@gitlens/integrations/index.js';

const failures: string[] = [];
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
	return Promise.resolve()
		.then(fn)
		.then(() => console.log(`  ✔ ${name}`))
		.catch(err => {
			failures.push(`${name}: ${err.message ?? err}`);
			console.log(`  ✘ ${name} — ${err.message ?? err}`);
		});
}

function buildRuntime(): IntegrationServiceContext {
	const memory = new Map<string, unknown>();
	const workspace = new Map<string, unknown>();
	const secrets = new Map<string, string>();

	const storage: IntegrationStorageProvider = {
		get: <T>(key: string) => memory.get(key) as T | undefined,
		store: async <T>(key: string, value: T) => void memory.set(key, value),
		delete: async (key: string) => void memory.delete(key),
		deleteWithPrefix: async (prefix: string) => {
			for (const k of memory.keys()) if (k.startsWith(prefix)) memory.delete(k);
		},
		getWorkspace: <T>(key: string) => workspace.get(key) as T | undefined,
		storeWorkspace: async <T>(key: string, value: T) => void workspace.set(key, value),
		deleteWorkspace: async (key: string) => void workspace.delete(key),
		getSecret: async (key: string) => secrets.get(key),
		storeSecret: async (key: string, value: string) => void secrets.set(key, value),
		deleteSecret: async (key: string) => void secrets.delete(key),
	};

	return {
		storage: storage,
		account: {
			getAccount: async () => undefined,
			onDidChange: new Emitter<void>().event,
			onDidCheckIn: new Emitter<{ force?: boolean }>().event,
			onDidChangeSessions: new Emitter<{ provider: { id: string } }>().event,
			isTrialOrPaid: async () => false,
			fetchGkApi: () => {
				throw new Error('not implemented in fixture');
			},
			connect: async () => false,
			openManagement: async () => false,
		},
		config: {
			isIntegrationsEnabled: () => true,
			getLaunchpadOptions: () => ({}),
			getRemoteConfigs: () => [],
			onDidChange: new Emitter<ConfigChangeEvent>().event,
		},
		http: {
			isWeb: false,
			userAgent: 'IntegrationsConsumerFixture/0.0.0 (IntegrationsFixture/fixture-1.0.0; node-fixture)',
			fetch: () => {
				throw new Error('not implemented in fixture');
			},
			wrapForForcedInsecureSSL: (_, fn) => Promise.resolve(fn()),
		},
		cache: {
			getRepositoryMetadata: undefined as never,
			getRepositoryDefaultBranch: undefined as never,
			getPullRequestForSha: undefined as never,
			getPullRequestForBranch: undefined as never,
			getPullRequest: () => {
				throw new Error('not implemented in fixture');
			},
			getIssueOrPullRequest: undefined as never,
			getIssue: () => {
				throw new Error('not implemented in fixture');
			},
			getCurrentAccount: () => {
				throw new Error('not implemented in fixture');
			},
		},
		repositories: { getOpenRemotes: async () => [] },
		hooks: {},
	};
}

async function main(): Promise<void> {
	console.log('@gitlens/integrations consumer fixture');
	console.log('--------------------------------------');

	await check('manager constructs from a vanilla-Node runtime', () => {
		const manager = createIntegrationManager(buildRuntime());
		assert.ok(manager);
		assert.equal(typeof manager.get, 'function');
		assert.equal(typeof manager.dispose, 'function');
		manager.dispose();
	});

	await check('manager.get works for every cloud provider id', async () => {
		const manager = createIntegrationManager(buildRuntime());
		const cloudIds = [
			GitCloudHostIntegrationId.GitHub,
			GitCloudHostIntegrationId.GitLab,
			GitCloudHostIntegrationId.Bitbucket,
			GitCloudHostIntegrationId.AzureDevOps,
			IssuesCloudHostIntegrationId.Jira,
			IssuesCloudHostIntegrationId.Linear,
		];
		for (const id of cloudIds) {
			const integration = await manager.get(id);
			assert.ok(integration, `expected ${id} integration to construct`);
			assert.equal(integration.id, id);
		}
		manager.dispose();
	});

	await check('self-managed providers accept an explicit domain', async () => {
		const manager = createIntegrationManager(buildRuntime());
		const integration = await manager.get(
			GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			'enterprise.example.com',
		);
		assert.ok(integration);
		manager.dispose();
	});

	await check('createManualTokenAuthProvider plugs in via the hook', async () => {
		const ctx = buildRuntime();
		ctx.hooks!.createAuthenticationProvider = async ({ id }) =>
			id === GitCloudHostIntegrationId.GitHub
				? createManualTokenAuthProvider({
						id: id,
						token: 'fixture-pat-abc',
						account: { id: 'me', label: 'Fixture Token' },
						scopes: ['repo'],
					})
				: undefined;
		const manager = createIntegrationManager(ctx);
		const integration = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.ok(integration);
		// Manual-token providers always report a session as available.
		assert.equal(await integration.isConnected(), true);
		manager.dispose();
	});

	await check('connectCloudIntegrations invokes typed telemetry hooks', async () => {
		const started: Array<{ integrationIds: readonly string[] | undefined }> = [];
		const ctx: IntegrationServiceContext = {
			...buildRuntime(),
			hooks: { connection: { onStarted: e => started.push({ integrationIds: e.integrationIds }) } },
		};
		const manager = createIntegrationManager(ctx);
		await manager.connectCloudIntegrations(
			{ integrationIds: [GitCloudHostIntegrationId.GitHub] },
			{ source: 'fixture' },
		);
		assert.ok(started.length >= 1, 'connection.onStarted should fire');
		manager.dispose();
	});

	console.log('--------------------------------------');
	if (failures.length > 0) {
		console.error(`FAIL — ${failures.length} check(s) failed:`);
		for (const f of failures) console.error(`  • ${f}`);
		process.exit(1);
	}
	console.log('PASS — public boundary holds for an external consumer.');
}

await main();
