import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Issue } from '@gitlens/git/models/issue.js';
import {
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import type { GitConfigEntityIdentifier } from '../providers/models.js';
import {
	decodeEntityIdentifiersFromGitConfig,
	encodeIssueOrPullRequestForGitConfig,
	getEntityIdentifierInput,
	getIssueFromGitConfigEntityIdentifier,
} from '../providers/utils.js';

/**
 * A branch association has to be read back from the host it was written for. Start Work associates issues from
 * every configured host of a self-managed provider (#5873), and two hosts routinely share `owner/repo#number`, so
 * an identifier that names no host would be answered by whichever host is primary.
 */

const hostB = 'ghe-b.example.com';

suite('branch-associated issues across self-managed hosts (#5873)', () => {
	test('round-trips Jira Server associations through the named host and refuses a missing host', async () => {
		const issue = {
			type: 'issue',
			id: 'PROJ-7',
			nodeId: '10007',
			provider: { id: IssuesSelfManagedHostIntegrationId.JiraServer, name: 'Jira', domain: hostB, icon: '' },
			project: { id: '10000', resourceId: hostB, resourceName: 'Jira B', name: 'Project' },
		} satisfies Partial<Issue> as Issue;
		const encoded = encodeIssueOrPullRequestForGitConfig(issue, { key: hostB, id: hostB, name: 'Jira B' });
		const [identifier] = decodeEntityIdentifiersFromGitConfig(JSON.stringify([encoded]));
		const reads: string[] = [];
		const result = await getIssueFromGitConfigEntityIdentifier((id, domain) => {
			assert.equal(id, IssuesSelfManagedHostIntegrationId.JiraServer);
			assert.equal(domain, hostB);
			return Promise.resolve({
				getIssue: (_resource: unknown, issueId: string) => {
					reads.push(issueId);
					return Promise.resolve(issue);
				},
			});
		}, identifier);
		assert.equal(result, issue);
		assert.deepEqual(reads, ['PROJ-7']);

		for (const domain of [undefined, '', ' ']) {
			assert.equal(
				await getIssueFromGitConfigEntityIdentifier(
					() => {
						assert.fail('An association without a Jira Server host must not select the primary host');
					},
					{ ...identifier, domain: domain } as GitConfigEntityIdentifier,
				),
				undefined,
			);
		}

		assert.equal(
			await getIssueFromGitConfigEntityIdentifier(() => Promise.resolve(undefined), identifier, {
				cached: true,
				peekCachedIssue: () => {
					assert.fail("An unresolved host must not read another integration's cache");
				},
			}),
			undefined,
		);
	});

	test('a branch-associated self-managed issue is read back from the host it was written for', async () => {
		// Start Work associates issues from any configured host, so the identifier must name that host and the
		// read must go there — two hosts routinely share `owner/repo#number`.
		const owner = { key: 'octo/repo', owner: 'octo', name: 'repo' };
		const hostBIssue = {
			type: 'issue',
			id: '7',
			nodeId: 'I_7',
			provider: {
				id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				name: 'GHE',
				domain: hostB,
				icon: '',
			},
		} as unknown as Parameters<typeof getEntityIdentifierInput>[0];

		const input = getEntityIdentifierInput(hostBIssue);
		assert.equal(
			'domain' in input ? input.domain : undefined,
			hostB,
			'the identifier carries the host of an issue read through the enterprise id',
		);

		const identifier = {
			...input,
			metadata: { id: '7', owner: { ...owner, id: undefined }, createdDate: new Date(0).toISOString() },
		} as unknown as GitConfigEntityIdentifier;
		const resolved: { id: string; domain: string | undefined }[] = [];
		await getIssueFromGitConfigEntityIdentifier((id, domain) => {
			resolved.push({ id: id, domain: domain });
			return Promise.resolve(undefined);
		}, identifier);

		assert.deepEqual(resolved, [{ id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, domain: hostB }]);
	});

	test('a pull request identifier keeps its host-less form, so stored Launchpad pins and snoozes still match', () => {
		const pr = {
			type: 'pullrequest',
			id: '1',
			nodeId: 'PR_1',
			provider: {
				id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				name: 'GHE',
				domain: hostB,
				icon: '',
			},
		} as unknown as Parameters<typeof getEntityIdentifierInput>[0];

		const input = getEntityIdentifierInput(pr);
		assert.equal('domain' in input ? input.domain : undefined, null);
	});

	test('a cloud tracker identifier resolves with no host', async () => {
		const identifier = {
			provider: 'linear',
			entityType: 'issue',
			version: '1',
			domain: null,
			entityId: 'uuid-1',
			accountOrOrgId: null,
			organizationName: null,
			projectId: null,
			repoId: null,
			resourceId: null,
			metadata: { id: 'LIN-1', owner: { key: 'o', name: 'o', id: 'o', owner: undefined }, createdDate: '' },
		} as unknown as GitConfigEntityIdentifier;
		const resolved: { id: string; domain: string | undefined }[] = [];
		await getIssueFromGitConfigEntityIdentifier((id, domain) => {
			resolved.push({ id: id, domain: domain });
			return Promise.resolve(undefined);
		}, identifier);

		assert.deepEqual(resolved, [{ id: IssuesCloudHostIntegrationId.Linear, domain: undefined }]);
	});
});
