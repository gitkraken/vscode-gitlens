import * as assert from 'node:assert';
import { getKeplerProviderId, isKeplerSupportedProvider } from '../keplerProviders.js';

suite('getKeplerProviderId', () => {
	test('maps every GitLens integration id Kepler supports to its Kepler ProviderId', () => {
		assert.strictEqual(getKeplerProviderId('github'), 'github');
		assert.strictEqual(getKeplerProviderId('cloud-github-enterprise'), 'githubEnterprise');
		assert.strictEqual(getKeplerProviderId('gitlab'), 'gitlab');
		assert.strictEqual(getKeplerProviderId('cloud-gitlab-self-hosted'), 'gitlabSelfHosted');
		assert.strictEqual(getKeplerProviderId('bitbucket'), 'bitbucket');
		assert.strictEqual(getKeplerProviderId('azureDevOps'), 'azure');
		assert.strictEqual(getKeplerProviderId('jira'), 'jira');
		assert.strictEqual(getKeplerProviderId('linear'), 'linear');
		assert.strictEqual(getKeplerProviderId('trello'), 'trello');
	});

	test('returns undefined for the two GitLens ids Kepler has no product support for at all', () => {
		assert.strictEqual(getKeplerProviderId('bitbucket-server'), undefined);
		assert.strictEqual(getKeplerProviderId('azure-devops-server'), undefined);
	});

	test('returns undefined for an arbitrary unrecognised string', () => {
		assert.strictEqual(getKeplerProviderId('not-a-real-provider'), undefined);
		assert.strictEqual(getKeplerProviderId(''), undefined);
	});
});

suite('isKeplerSupportedProvider', () => {
	test('bitbucket is PR-capable but not issue-capable — Kepler does not support Bitbucket issues', () => {
		assert.strictEqual(isKeplerSupportedProvider('pr', 'bitbucket'), true);
		assert.strictEqual(isKeplerSupportedProvider('issue', 'bitbucket'), false);
	});

	test('providers common to both kinds pass for both', () => {
		for (const provider of ['github', 'githubEnterprise', 'gitlab', 'gitlabSelfHosted', 'azure']) {
			assert.strictEqual(isKeplerSupportedProvider('pr', provider), true);
			assert.strictEqual(isKeplerSupportedProvider('issue', provider), true);
		}
	});

	test('issue-only providers fail for pr', () => {
		for (const provider of ['jira', 'linear', 'trello']) {
			assert.strictEqual(isKeplerSupportedProvider('pr', provider), false);
			assert.strictEqual(isKeplerSupportedProvider('issue', provider), true);
		}
	});

	test('an unmapped or undefined provider fails for both kinds', () => {
		assert.strictEqual(isKeplerSupportedProvider('pr', undefined), false);
		assert.strictEqual(isKeplerSupportedProvider('issue', undefined), false);
		assert.strictEqual(isKeplerSupportedProvider('pr', 'not-a-real-provider'), false);
		assert.strictEqual(isKeplerSupportedProvider('issue', 'not-a-real-provider'), false);
	});
});
