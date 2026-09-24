import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Issue } from '@gitlens/git/models/issue.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import { createIntegrationService } from '../integrationService.js';
import type { GitConfigEntityIdentifier } from '../providers/models.js';
import {
	decodeEntityIdentifiersFromGitConfig,
	encodeIssueOrPullRequestForGitConfig,
	getEntityIdentifierInput,
	getIssueFromGitConfigEntityIdentifier,
} from '../providers/utils.js';
import { createFakeRuntime } from './fakeRuntime.js';

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
					{ getConfiguredIntegrations: () => [{ domain: hostB }] },
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

suite('legacy branch associations without a self-managed git host', () => {
	const owner = { key: 'org/repo', owner: 'org', name: 'repo' };
	const hostA = 'host-a.example.com';
	const hostB = 'host-b.example.com';

	function issue(provider: string, domain: string): Issue {
		return {
			type: 'issue',
			id: '7',
			nodeId: 'I_7',
			provider: { id: provider, name: provider, domain: domain, icon: '' },
			project: { id: 'project', name: 'Project', resourceId: 'resource', resourceName: 'Resource' },
		} satisfies Partial<Issue> as Issue;
	}

	async function configuredHosts(
		provider: GitSelfManagedHostIntegrationId,
		domains: string[],
	): Promise<ReturnType<typeof createIntegrationService>> {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			[provider]: domains.map((domain, index) => ({
				id: `connection-${index}`,
				integrationId: provider,
				domain: domain,
				cloud: index === 0,
				scopes: 'repo',
				primary: index === 0,
			})),
		});
		return createIntegrationService(runtime);
	}

	for (const provider of Object.values(GitSelfManagedHostIntegrationId)) {
		test(`${provider} resolves a legacy association only with one configured host`, async () => {
			const expected = issue(provider, hostA);
			const identifier = encodeIssueOrPullRequestForGitConfig(expected, owner);
			for (const domains of [[], [hostA], [hostA, hostB]]) {
				const manager = await configuredHosts(provider, domains);
				try {
					const integration = await manager.get(provider, hostA);
					assert.ok(integration);
					const reads: string[] = [];
					integration.getIssue = (_resource, id) => {
						reads.push(id);
						return Promise.resolve(expected);
					};
					for (const domain of [undefined, null, '', ' \t']) {
						const resolutions: (string | undefined)[] = [];
						const result = await getIssueFromGitConfigEntityIdentifier(
							(id, resolvedDomain) => {
								resolutions.push(resolvedDomain);
								return manager.get(id, resolvedDomain);
							},
							{ ...identifier, domain: domain } as GitConfigEntityIdentifier,
							{ getConfiguredIntegrations: id => manager.getConfigured(id) },
						);
						assert.equal(result, domains.length === 1 ? expected : undefined);
						assert.deepEqual(resolutions, domains.length === 1 ? [hostA] : []);
					}
					assert.deepEqual(reads, domains.length === 1 ? ['7', '7', '7', '7'] : []);
				} finally {
					manager.dispose();
				}
			}
		});

		test(`${provider} keeps cache-only legacy reads scoped to the unique configured host`, async () => {
			const expected = issue(provider, hostA);
			const identifier = {
				...encodeIssueOrPullRequestForGitConfig(expected, owner),
				domain: null,
			} as unknown as GitConfigEntityIdentifier;
			for (const domains of [[], [hostA], [hostA, hostB]]) {
				const manager = await configuredHosts(provider, domains);
				try {
					const integration = await manager.get(provider, hostA);
					assert.ok(integration);
					integration.getIssue = () => assert.fail('A cache-only read must not fetch an issue');
					let peeks = 0;
					const result = await getIssueFromGitConfigEntityIdentifier(
						(id, domain) => manager.get(id, domain),
						identifier,
						{
							cached: true,
							getConfiguredIntegrations: id => manager.getConfigured(id),
							peekCachedIssue: resolved => {
								assert.equal(resolved, integration);
								peeks++;
								return expected;
							},
						},
					);
					assert.equal(result, domains.length === 1 ? expected : undefined);
					assert.equal(peeks, domains.length === 1 ? 1 : 0);
				} finally {
					manager.dispose();
				}
			}
		});

		test(`${provider} round-trips an explicit host independently of the primary host`, async () => {
			const manager = await configuredHosts(provider, [hostA, hostB]);
			try {
				const expected = issue(provider, hostB);
				const encoded = encodeIssueOrPullRequestForGitConfig(expected, owner);
				const [identifier] = decodeEntityIdentifiersFromGitConfig(JSON.stringify([encoded]));
				assert.equal('domain' in identifier ? identifier.domain : undefined, hostB);
				const primary = await manager.get(provider, hostA);
				const secondary = await manager.get(provider, hostB);
				assert.ok(primary && secondary);
				primary.getIssue = () => assert.fail('An explicit host must not resolve through the primary');
				secondary.getIssue = () => Promise.resolve(expected);
				assert.equal(
					await getIssueFromGitConfigEntityIdentifier((id, domain) => manager.get(id, domain), identifier, {
						getConfiguredIntegrations: () => assert.fail('An explicit host needs no configuration lookup'),
					}),
					expected,
				);
			} finally {
				manager.dispose();
			}
		});
	}

	test('counts normalized hosts rather than connections and refuses unknown hosts or distinct ports', async () => {
		const expected = issue(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, hostA);
		const identifier = {
			...encodeIssueOrPullRequestForGitConfig(expected, owner),
			domain: null,
		} as unknown as GitConfigEntityIdentifier;
		for (const domains of [
			[hostA, 'https://HOST-A.EXAMPLE.COM:443/path'],
			[hostA, `${hostA}:8443`],
			[hostA, undefined],
			[hostA, ''],
			[hostA, 'https://'],
		]) {
			const resolutions: (string | undefined)[] = [];
			await getIssueFromGitConfigEntityIdentifier(
				(_id, domain) => {
					resolutions.push(domain);
					return Promise.resolve(undefined);
				},
				identifier,
				{ getConfiguredIntegrations: () => domains.map(domain => ({ domain: domain })) },
			);
			assert.deepEqual(resolutions, domains[1] === 'https://HOST-A.EXAMPLE.COM:443/path' ? [hostA] : []);
		}
	});

	test('refuses a legacy self-managed association when the caller supplies no host configuration', async () => {
		const identifier = {
			...encodeIssueOrPullRequestForGitConfig(
				issue(GitSelfManagedHostIntegrationId.BitbucketServer, hostA),
				owner,
			),
			domain: null,
		} as unknown as GitConfigEntityIdentifier;
		assert.equal(
			await getIssueFromGitConfigEntityIdentifier(
				() => assert.fail('Missing configuration must not fall back to the primary host'),
				identifier,
			),
			undefined,
		);
	});

	for (const provider of Object.values(GitCloudHostIntegrationId)) {
		test(`${provider} keeps resolving cloud associations without a configuration lookup`, async () => {
			const identifier = {
				...encodeIssueOrPullRequestForGitConfig(issue(provider, `${provider}.com`), owner),
				domain: null,
			} as unknown as GitConfigEntityIdentifier;
			const resolutions: (string | undefined)[] = [];
			await getIssueFromGitConfigEntityIdentifier(
				(_id, domain) => {
					resolutions.push(domain);
					return Promise.resolve(undefined);
				},
				identifier,
				{ getConfiguredIntegrations: () => assert.fail('A cloud association needs no host selection') },
			);
			assert.deepEqual(resolutions, [undefined]);
		});
	}

	test('keeps Bitbucket Server pull request identifiers compatible with stored pins and snoozes', () => {
		const input = getEntityIdentifierInput({
			type: 'pullrequest',
			uuid: 'stored-pin',
			graphQLId: 'PR_7',
			provider: { id: GitSelfManagedHostIntegrationId.BitbucketServer, domain: hostA },
		});
		assert.equal('domain' in input ? input.domain : undefined, null);
	});
});
