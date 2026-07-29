import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { GitCloudHostIntegrationId } from '../constants.js';
import { toProviderWarning } from '../results.js';

suite('provider warning messages', () => {
	test('replaces an HTML gateway response with its status', () => {
		const ex = Object.assign(new Error('<html><body><h1>502 Bad Gateway</h1></body></html>'), {
			status: 502,
		});

		const warning = toProviderWarning(GitCloudHostIntegrationId.GitHub, undefined, 'connection-1', ex);

		assert.equal(warning.message, 'Provider request failed with status 502.');
		assert.doesNotMatch(warning.message, /html|body/i);
	});

	test('caps an oversized provider message', () => {
		const warning = toProviderWarning(
			GitCloudHostIntegrationId.GitLab,
			undefined,
			undefined,
			new Error('x'.repeat(1000)),
		);

		assert.equal(warning.message.length, 500);
		assert.match(warning.message, /\.\.\.$/);
	});
});
