// Per-provider boundary tests — exercises every integration id through the
// public manager facade with a `FakeRuntime`. Verifies each provider can be
// constructed, resolves its auth provider in-package (no host hook), and
// respects the configured-domain requirement for self-managed variants.
import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

suite('@gitlens/integrations — per-provider construction', () => {
	const cloudIds = [
		GitCloudHostIntegrationId.GitHub,
		GitCloudHostIntegrationId.GitLab,
		GitCloudHostIntegrationId.Bitbucket,
		GitCloudHostIntegrationId.AzureDevOps,
		IssuesCloudHostIntegrationId.Jira,
		IssuesCloudHostIntegrationId.Linear,
	] as const;

	for (const id of cloudIds) {
		test(`${id}: constructs through manager.get and resolves auth in-package`, async () => {
			const runtime = createFakeRuntime();
			const manager = createIntegrationManager(runtime);
			try {
				const integration = await manager.get(id);
				assert.ok(integration != null, `${id} integration should construct`);
				assert.equal(integration.id, id);
				// The package owns cloud auth-provider construction (cloud-only). This lookup must not throw
				// "No authentication provider registered" — its absence proves the package built it itself.
				await assert.doesNotReject(() => integration.isConnected());
			} finally {
				manager.dispose();
			}
		});
	}

	// Self-managed providers (all cloud-backed now) return undefined when no domain is
	// supplied AND none is configured — they're allowed to be unconfigured; supplying a
	// domain constructs them.
	const undefinedOnMissingDomain = [
		GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
		GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
		GitSelfManagedHostIntegrationId.BitbucketServer,
		GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	] as const;

	for (const id of undefinedOnMissingDomain) {
		test(`${id}: returns undefined when no domain is supplied or configured`, async () => {
			const runtime = createFakeRuntime();
			const manager = createIntegrationManager(runtime);
			try {
				const integration = await manager.get(id);
				assert.equal(integration, undefined);
			} finally {
				manager.dispose();
			}
		});
	}

	for (const id of undefinedOnMissingDomain) {
		test(`${id}: constructs with a domain and exposes its id`, async () => {
			const runtime = createFakeRuntime();
			const manager = createIntegrationManager(runtime);
			try {
				const integration = await manager.get(id, 'enterprise.example.com');
				assert.ok(integration != null);
				assert.equal(integration.id, id);
			} finally {
				manager.dispose();
			}
		});
	}
});

// Resolving an integration from a `GitRemote` must work entirely in-package — the host's
// `getRemoteIntegration` hook was removed in favor of the internal `getByRemote`, so a consumer
// that wires no such hook (e.g. an external bundling consumer) must still resolve remotes.
suite('@gitlens/integrations — getByRemote (no host hook)', () => {
	const fakeRemote = (provider: { id: string; domain?: string } | undefined): GitRemote =>
		({ provider: provider, path: 'owner/repo' }) as unknown as GitRemote;

	test('resolves a git-host integration internally', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		try {
			const integration = await manager.getByRemote(fakeRemote({ id: 'bitbucket', domain: 'bitbucket.org' }));
			assert.ok(integration != null, 'getByRemote should resolve the bitbucket integration');
			assert.equal(integration.id, GitCloudHostIntegrationId.Bitbucket);
		} finally {
			manager.dispose();
		}
	});

	test('returns undefined when the remote has no provider', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		try {
			assert.equal(await manager.getByRemote(fakeRemote(undefined)), undefined);
		} finally {
			manager.dispose();
		}
	});
});
