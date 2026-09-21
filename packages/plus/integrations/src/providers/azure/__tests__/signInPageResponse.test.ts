import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { AuthenticationError } from '../../../errors.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { AzureDevOpsApi } from '../azure.js';
import { azureProject, azureProvider, azureToken, createWorkItem } from './fixtures.js';

const signInPage = '<!DOCTYPE html><html><body>Sign in to Azure DevOps</body></html>';

function configReturning(status: number, contentType: string, body: string | null): ProviderApiConfig {
	return {
		fetch: () =>
			Promise.resolve(
				new Response(body, { status: status, headers: contentType ? { 'content-type': contentType } : {} }),
			),
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
	};
}

/** Answers the work-item read with real data and the follow-up state-list read with the sign-in page. */
function configFailingOnlyTheStateList(workItem: unknown): ProviderApiConfig {
	return {
		fetch: input =>
			Promise.resolve(
				input.toString().includes('/states')
					? new Response(signInPage, { status: 203, headers: { 'content-type': 'text/html' } })
					: Response.json(workItem),
			),
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
	};
}

// Azure answers a rejected credential by redirecting to its sign-in page, which returns `203 text/html`. On the
// direct REST path `rsp.ok` spans 200-299, so that page reached `rsp.json()` and died as a bare `SyntaxError` —
// which every caller's `catch` reports as "not found", making an invalid credential indistinguishable from a
// missing work item (GKDEV-3617).
suite('Azure direct reads reject a sign-in page (GKDEV-3617)', () => {
	test('a 203 sign-in page is an authentication failure, not a missing work item', async () => {
		const api = new AzureDevOpsApi(configReturning(203, 'text/html; charset=utf-8', signInPage));

		await assert.rejects(
			() =>
				api.getIssue(azureProvider, azureToken, azureProject, '42', {
					baseUrl: 'https://dev.azure.com/acme',
				}),
			AuthenticationError,
			'a rejected credential must not be reported as an absent issue',
		);
	});

	test('the linked issue-or-PR read reports it too, rather than an absent link', async () => {
		// This is a separate entry point from `getIssue`, and it is the one behind a linked-issue lookup. Its
		// catch also degraded every non-404 to `undefined`, so the sign-in page read as "no such issue".
		const api = new AzureDevOpsApi(configReturning(203, 'text/html; charset=utf-8', signInPage));

		await assert.rejects(
			() =>
				api.getIssueOrPullRequest(azureProvider, azureToken, 'acme', 'Payments/_git/Repo', '42', {
					baseUrl: 'https://dev.azure.com/acme',
				}),
			AuthenticationError,
		);
	});

	test('the PR-for-branch read reports it rather than reporting no pull request', async () => {
		const api = new AzureDevOpsApi(configReturning(203, 'text/html; charset=utf-8', signInPage));

		await assert.rejects(
			() =>
				api.getPullRequestForBranch(azureProvider, azureToken, 'acme', 'Payments/_git/Repo', 'feature', {
					baseUrl: 'https://dev.azure.com/acme',
				}),
			AuthenticationError,
		);
	});

	test('the default-branch probe reports it rather than degrading quietly', async () => {
		// This one is written to swallow failures on purpose — a probe that 404s is a normal outcome. A rejected
		// credential is not, and the caller routes it into the session recovery.
		const api = new AzureDevOpsApi(configReturning(203, 'text/html; charset=utf-8', signInPage));

		await assert.rejects(
			() =>
				api.getDefaultBranch(azureProvider, azureToken, 'acme', 'Payments/_git/Repo', {
					baseUrl: 'https://dev.azure.com/acme',
				}),
			AuthenticationError,
		);
	});

	test('a sign-in page on the follow-up state read is reported, not cached as an unknown state', async () => {
		// The work-item read succeeds and only the state-list read is rejected. That helper returned `[]` on any
		// failure, and the caller CACHES whatever it returns — so an empty list would pin every work item of this
		// type to an unknown state long after the session recovery this error should have triggered.
		const api = new AzureDevOpsApi(configFailingOnlyTheStateList(createWorkItem('Payments\\Sprint 3')));

		await assert.rejects(
			() =>
				api.getIssue(azureProvider, azureToken, azureProject, '42', {
					baseUrl: 'https://dev.azure.com/acme',
				}),
			AuthenticationError,
		);
	});

	test('the content-type is matched case-insensitively', async () => {
		const api = new AzureDevOpsApi(configReturning(200, 'TEXT/HTML', signInPage));

		await assert.rejects(
			() =>
				api.getIssue(azureProvider, azureToken, azureProject, '42', {
					baseUrl: 'https://dev.azure.com/acme',
				}),
			AuthenticationError,
		);
	});
});
