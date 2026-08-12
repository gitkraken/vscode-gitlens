import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Pins that no Jira LIST read asks the provider to expand issue transitions.
 *
 * Jira computes them per issue from the workflow and the reader's permissions, so a page of 100 pays for 100 of
 * them in server work and response payload, on what is a cold-start path. Nothing in this package reads
 * `statusTransitions` off a list, so the cost buys nothing — but the SDK's default is `true`, which means the
 * saving lives entirely in these call sites and silently disappears the moment one of them is rewritten. The
 * singular `getIssue` is deliberately not covered here: it always expands them, and a status change is offered
 * from there.
 */

function jiraSession(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'atlassian.net',
	};
}

type JiraListInput = { includeTransitions?: boolean };

async function captureJiraListInputs(): Promise<{
	api: ProvidersApi;
	inputs: JiraListInput[];
	dispose: () => void;
}> {
	const manager = createIntegrationManager(createFakeRuntime());
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	// The real `ProvidersApi`, not a stub of it: the call sites under test live inside it, so a stubbed facade
	// would assert nothing. Only the provider function table below is replaced, which is where the SDK begins.
	const api = await (jira as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();

	const inputs: JiraListInput[] = [];
	const provider = (api as unknown as { providers: Record<string, Record<string, unknown>> }).providers[
		IssuesCloudHostIntegrationId.Jira
	];
	const capture = (input: JiraListInput) => {
		inputs.push(input);
		return Promise.resolve({ data: [], pageInfo: undefined });
	};
	provider.getIssuesForProjectFn = capture;
	provider.getIssuesForResourceForCurrentUserFn = capture;

	return { api: api, inputs: inputs, dispose: () => manager.dispose() };
}

suite('Jira list reads and issue transitions', () => {
	test('the project read opts out of transitions', async () => {
		const { api, inputs, dispose } = await captureJiraListInputs();
		const token = toTokenWithInfo(IssuesCloudHostIntegrationId.Jira, jiraSession());

		await api.getIssuesForProject(token, 'p1', 'org-1');

		assert.equal(inputs[0]?.includeTransitions, false);
		dispose();
	});

	test('the paged project read opts out of transitions', async () => {
		const { api, inputs, dispose } = await captureJiraListInputs();
		const token = toTokenWithInfo(IssuesCloudHostIntegrationId.Jira, jiraSession());

		await api.getIssuesForProjectPaged(token, 'p1', 'org-1');

		assert.equal(inputs[0]?.includeTransitions, false);
		dispose();
	});

	test('the account-wide read opts out of transitions', async () => {
		const { api, inputs, dispose } = await captureJiraListInputs();
		const token = toTokenWithInfo(IssuesCloudHostIntegrationId.Jira, jiraSession());

		await api.getIssuesForResourceForCurrentUser(token, 'org-1');

		assert.equal(inputs[0]?.includeTransitions, false);
		dispose();
	});
});
