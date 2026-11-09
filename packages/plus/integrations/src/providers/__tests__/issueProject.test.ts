import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import type { ProviderAuthenticationSession } from '../../authentication/models.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../../constants.js';
import { createIntegrationService } from '../../integrationService.js';
import type { Integration } from '../../models/integration.js';
import type { ProviderIssue } from '../models.js';
import { fromProviderIssue, toIssueShape } from '../models.js';
import {
	encodeIssueOrPullRequestForGitConfig,
	getIssueFromGitConfigEntityIdentifier,
	getIssueOwner,
} from '../utils.js';
import { azureIntegration, createProviderIssue, jiraIntegration, linearIntegration } from './fixtures.js';

function project(namespace: string | null): NonNullable<ProviderIssue['project']> {
	return { id: '10001', key: 'TST', name: 'Test project', resourceId: 'site-id', namespace: namespace };
}

const jiraServerIntegration = {
	...jiraIntegration,
	id: IssuesSelfManagedHostIntegrationId.JiraServer,
	domain: 'jira.example.com',
} as unknown as Integration;

suite('issue project preservation', () => {
	test('Jira resolves same-key associations against their actual sites without resource names', async () => {
		const manager = createIntegrationService(createFakeRuntime());
		try {
			const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
			assert.ok(jira);
			(jira as unknown as { _session: ProviderAuthenticationSession })._session = {
				id: 'primary',
				accessToken: 'token',
				account: { id: 'me', label: 'me' },
				scopes: [],
				cloud: true,
				type: 'oauth',
				domain: 'atlassian.net',
			};
			const reads: string[] = [];
			(jira as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
				Promise.resolve({
					getIssue: (_token: unknown, request: { resourceId: string; number: string }) => {
						reads.push(request.resourceId);
						return Promise.resolve(
							createProviderIssue({
								id: `issue-${request.resourceId}`,
								number: request.number,
								project: { ...project(null), resourceId: request.resourceId },
							}),
						);
					},
				});
			for (const site of ['site-a', 'site-b']) {
				const issue = await jira.getIssue({ key: site, id: site, name: '' }, 'TST-52');
				assert.ok(issue);
				assert.equal(issue.project?.resourceId, site);
				assert.equal(issue.project?.resourceName, '');
				const owner = getIssueOwner(issue);
				assert.ok(owner);
				const encoded = encodeIssueOrPullRequestForGitConfig(issue, owner);
				const resolved = await getIssueFromGitConfigEntityIdentifier(() => Promise.resolve(jira), encoded);
				assert.equal(resolved?.nodeId, `issue-${site}`);
			}
			assert.deepEqual(reads, ['site-a', 'site-a', 'site-b', 'site-b']);
		} finally {
			manager.dispose();
		}
	});

	for (const integration of [jiraIntegration, jiraServerIntegration]) {
		for (const namespace of ['', null, 'Actual site name']) {
			test(`${integration.id}: retains supplied project identity with namespace ${JSON.stringify(namespace)}`, async () => {
				const input = createProviderIssue({ number: 'TST-52', project: project(namespace) });
				const expected = {
					id: '10001',
					name: 'Test project',
					resourceId: 'site-id',
					resourceName: namespace ?? '',
				};
				const shape = toIssueShape(input, integration);
				const issue = fromProviderIssue(input, integration);
				assert.deepEqual(shape?.project, expected);
				assert.deepEqual(issue.project, expected);
				assert.ok(shape);
				const owner = getIssueOwner(shape);
				assert.ok(owner);
				assert.equal(owner.key, 'site-id');
				const encoded = encodeIssueOrPullRequestForGitConfig(issue, owner);
				assert.equal(
					'resourceId' in encoded ? encoded.resourceId : null,
					integration === jiraIntegration ? 'site-id' : null,
				);
				assert.equal(encoded.metadata.owner.id, 'site-id');
				let reads = 0;
				const resolved = await getIssueFromGitConfigEntityIdentifier((id, domain) => {
					assert.equal(id, integration.id);
					if (integration === jiraServerIntegration) {
						assert.equal(domain, integration.domain);
					}

					return Promise.resolve({
						getIssue: (resource: { key: string; id: string; name: string }, key: string) => {
							reads++;
							assert.equal(resource.key, 'site-id');
							assert.equal(resource.id, 'site-id');
							assert.equal(resource.name, namespace ?? '');
							assert.equal(key, 'TST-52');
							return Promise.resolve(issue);
						},
					} as unknown as Integration);
				}, encoded);
				assert.equal(reads, 1);
				assert.equal(resolved, issue);
			});
		}

		for (const identity of ['id', 'resourceId'] as const) {
			for (const missing of ['', null]) {
				test(`${integration.id}: does not invent missing ${identity} ${JSON.stringify(missing)}`, () => {
					const input = createProviderIssue({ project: { ...project(''), [identity]: missing } });
					assert.equal(toIssueShape(input, integration)?.project, undefined);
					assert.equal(fromProviderIssue(input, integration).project, undefined);
				});
			}
		}
	}

	for (const integration of [azureIntegration, linearIntegration]) {
		for (const namespace of ['', null, 'Actual namespace']) {
			test(`${integration.id}: preserves its namespace requirement for ${JSON.stringify(namespace)}`, () => {
				const input = createProviderIssue({ project: project(namespace) });
				const shape = toIssueShape(input, integration);
				const issue = fromProviderIssue(input, integration);
				assert.equal(shape?.project?.resourceName, namespace || undefined);
				assert.deepEqual(issue.project, shape?.project);
			});
		}
	}

	test('does not invent a project when none was returned', () => {
		const input = createProviderIssue({ project: undefined });
		assert.equal(toIssueShape(input, jiraIntegration)?.project, undefined);
		assert.equal(fromProviderIssue(input, jiraIntegration).project, undefined);
	});

	test('preserves an empty project display name without substituting its key or id', () => {
		const input = createProviderIssue({ project: { ...project(null), name: '' } });
		assert.equal(toIssueShape(input, jiraIntegration)?.project?.name, '');
		assert.equal(fromProviderIssue(input, jiraIntegration).project?.name, '');
	});

	test('keeps an explicitly supplied project in preference to provider metadata', () => {
		const input = createProviderIssue({ project: project(null) });
		const explicit = { id: 'override-project', name: 'Override', resourceId: 'override-site', resourceName: '' };
		assert.deepEqual(fromProviderIssue(input, jiraIntegration, { project: explicit }).project, explicit);
	});
});
