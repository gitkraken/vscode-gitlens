// This fixture proves that `@gitlens/integrations` works as a real external
// consumer would use it: imports only the public facade (`./index.js`),
// constructs a runtime out of vanilla Node primitives (no vscode, no
// Container, no GitLens), instantiates the manager, and exercises a few
// surfaces.
//
// If the package ever grows a hidden coupling to VS Code or to GitLens, this
// fixture will fail to type-check or fail at runtime.

import * as assert from 'node:assert/strict';
import {
	createIntegrationManager,
	type ConfigChangeEvent,
	type IntegrationServiceContext,
	type IntegrationStorageProvider,
} from '@gitlens/integrations/index.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { Uri } from '@gitlens/utils/uri.js';

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
		const providerModelsStayPrivate: 'get' extends keyof typeof manager ? false : true = true;
		const providerClientsStayPrivate: 'apis' extends keyof typeof manager ? false : true = true;
		assert.ok(manager);
		assert.equal(providerModelsStayPrivate, true);
		assert.equal(providerClientsStayPrivate, true);
		assert.equal(typeof manager.getConfigured, 'function');
		assert.equal(typeof manager.listPullRequestsPage, 'function');
		assert.equal(typeof manager.resolveRepository, 'function');
		assert.equal(typeof manager.dispose, 'function');
		manager.dispose();
	});

	await check('manager exposes only neutral connection descriptors', () => {
		const manager = createIntegrationManager(buildRuntime());
		assert.deepEqual(manager.getConfigured(), []);
		manager.dispose();
	});

	await check('repository resolution classifies malformed input without exposing provider clients', async () => {
		const manager = createIntegrationManager(buildRuntime());
		const result = await manager.resolveRepository({ remoteUrl: 'not a remote' });
		assert.equal(result.resolution.status, 'invalid-remote-url');
		assert.equal(result.cliUnsupported, false);
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
