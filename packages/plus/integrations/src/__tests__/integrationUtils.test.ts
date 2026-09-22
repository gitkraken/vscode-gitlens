import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import { isNonExpiringZeroTokenIntegrationId } from '../utils/integration.utils.js';

/**
 * Verifies isNonExpiringZeroTokenIntegrationId (#5438): the two `expiresIn === 0` guards use it to map a
 * non-expiring token (returned as 0) to a far-future expiry. Trello is issued with `expiration: never`
 * (identity-service), so it must be included — otherwise its session is built with `expiresAt = now` and
 * rejected as expired on the next read.
 */
suite('isNonExpiringZeroTokenIntegrationId (#5438)', () => {
	test('includes GitHub, the cloud self-managed hosts, and Trello', () => {
		assert.equal(isNonExpiringZeroTokenIntegrationId(GitCloudHostIntegrationId.GitHub), true);
		assert.equal(isNonExpiringZeroTokenIntegrationId(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise), true);
		assert.equal(isNonExpiringZeroTokenIntegrationId(GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted), true);
		assert.equal(
			isNonExpiringZeroTokenIntegrationId(IssuesCloudHostIntegrationId.Trello),
			true,
			'Trello token never expires',
		);
	});

	test('includes the self-managed trackers, whose PAT the backend cannot refresh', () => {
		// Jira Data Center authenticates with a PAT the backend stores as-is, so a 0 here means "no meaningful
		// expiry". Reading it as already-expired would re-resolve the session on every single read (#5864).
		assert.equal(isNonExpiringZeroTokenIntegrationId(IssuesSelfManagedHostIntegrationId.JiraServer), true);
	});

	test('excludes providers whose 0 would mean actually-expired', () => {
		// GitLab cloud, Bitbucket cloud, Azure cloud, Jira, Linear return real TTLs; a 0 there is a real expiry.
		assert.equal(isNonExpiringZeroTokenIntegrationId(GitCloudHostIntegrationId.GitLab), false);
		assert.equal(isNonExpiringZeroTokenIntegrationId(GitCloudHostIntegrationId.Bitbucket), false);
		assert.equal(isNonExpiringZeroTokenIntegrationId(GitCloudHostIntegrationId.AzureDevOps), false);
		assert.equal(isNonExpiringZeroTokenIntegrationId(IssuesCloudHostIntegrationId.Jira), false);
		assert.equal(isNonExpiringZeroTokenIntegrationId(IssuesCloudHostIntegrationId.Linear), false);
	});
});
