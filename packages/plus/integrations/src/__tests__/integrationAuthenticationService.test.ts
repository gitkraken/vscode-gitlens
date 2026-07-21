import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { CloudIntegrationService } from '../authentication/cloudIntegrationService.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import { createManualTokenAuthProvider } from '../authentication/manualTokenProvider.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import type { IntegrationService } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies IntegrationAuthenticationService.supports (#5438): it gates whether a disconnect offers to sign
 * out of the cloud token, so every provider that registers a cloud auth provider must report true — Trello
 * and Linear included (previously omitted, leaving their backend token + connection intact on disable).
 */

function createAuthService(): IntegrationAuthenticationService {
	const ctx = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(ctx);
	const cloud = new CloudIntegrationService(ctx);
	// supports() reads none of these collaborators, so a throwaway service getter is fine.
	return new IntegrationAuthenticationService(
		configured,
		ctx,
		() => undefined as unknown as IntegrationService,
		cloud,
	);
}

suite('IntegrationAuthenticationService.supports (#5438)', () => {
	test('reports true for the cloud-backed issue trackers, including Trello and Linear', () => {
		const auth = createAuthService();

		assert.equal(auth.supports(IssuesCloudHostIntegrationId.Jira), true);
		assert.equal(auth.supports(IssuesCloudHostIntegrationId.Linear), true, 'Linear offers cloud sign-out');
		assert.equal(auth.supports(IssuesCloudHostIntegrationId.Trello), true, 'Trello offers cloud sign-out');
	});

	test('still reports true for the git hosts', () => {
		const auth = createAuthService();

		assert.equal(auth.supports(GitCloudHostIntegrationId.GitHub), true);
		assert.equal(auth.supports(GitCloudHostIntegrationId.GitLab), true);
		assert.equal(auth.supports(GitCloudHostIntegrationId.Bitbucket), true);
		assert.equal(auth.supports(GitCloudHostIntegrationId.AzureDevOps), true);
		assert.equal(auth.supports(GitSelfManagedHostIntegrationId.AzureDevOpsServer), true);
	});

	test('reports false for an unknown provider id', () => {
		const auth = createAuthService();

		assert.equal(auth.supports('not-a-provider'), false);
	});

	test('manual token auth preserves the optional appKey on the session', async () => {
		const provider = createManualTokenAuthProvider({
			id: IssuesCloudHostIntegrationId.Trello,
			token: 'tok',
			account: { id: 'me', label: 'CLI Token' },
			domain: 'trello.com',
			appKey: 'trello-app-key',
		});

		const session = await provider.getSession({ domain: 'trello.com', scopes: [] });

		assert.equal(session?.appKey, 'trello-app-key');
		provider.dispose();
	});
});
