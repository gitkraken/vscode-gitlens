import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../../constants.js';
import { AnonymousResponseError, isProviderIssueNotFoundError, markRequestError } from '../providerErrors.js';

suite('Jira issue absence evidence', () => {
	for (const providerId of [IssuesCloudHostIntegrationId.Jira, IssuesSelfManagedHostIntegrationId.JiraServer]) {
		for (const body of [
			{ message: 'Not Found' },
			{ message: 'No message available' },
			'<html>Not Found</html>',
			null,
			{ errorMessages: [] },
			{ errorMessages: [null] },
		]) {
			test(`${providerId}: a non-answer ${JSON.stringify(body)} is not an absence`, () => {
				assert.equal(
					isProviderIssueNotFoundError(
						providerId,
						markRequestError(
							{ response: { status: 404, body: body } },
							{ url: 'https://jira.test/rest/api/2/issue/A-1' },
						),
					),
					false,
				);
			});
		}

		for (const [path, method, absent] of [
			['/rest/api/2/issue/A-1', 'GET', true],
			['/jira/rest/api/2/issue/A-1', 'GET', true],
			['/rest/api/2/field', 'GET', false],
			['/oauth/token/accessible-resources', 'GET', false],
			['/rest/api/2/issue/bulkfetch', 'POST', false],
		] as const) {
			test(`${providerId}: localized error from ${method} ${path} identifies only an issue absence`, () => {
				const ex = markRequestError(
					{ response: { status: 404, body: { errorMessages: ['DER VORGANG EXISTIERT NICHT.'] } } },
					{ url: `https://jira.test${path}`, method: method },
				);
				assert.equal(isProviderIssueNotFoundError(providerId, ex), absent);
			});
		}

		for (const status of [401, 403, 410, 422, 429, 500]) {
			test(`${providerId}: a ${status} refusal is not an absence even with a missing-issue message`, () => {
				assert.equal(
					isProviderIssueNotFoundError(providerId, {
						response: { status: status, body: { errorMessages: ['Issue does not exist'] } },
					}),
					false,
				);
			});
		}

		test(`${providerId}: an anonymous response never proves absence`, () => {
			assert.equal(isProviderIssueNotFoundError(providerId, new AnonymousResponseError(404, {})), false);
		});
	}
});
