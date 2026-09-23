import * as assert from 'assert';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { GitConfigEntityIdentifier } from '@gitlens/integrations/providers/models.js';
import { encodeIssueOrPullRequestForGitConfig } from '@gitlens/integrations/providers/utils.js';
import type { Container } from '../../../../container.js';
import {
	addAssociatedIssueToBranch,
	getAssociatedIssueId,
	getAssociatedIssuesForBranch,
	removeAssociatedIssueFromBranch,
} from '../branch.issue.utils.js';

const branch = {
	repoPath: '/repo',
	name: 'feature',
	ref: 'feature',
	refType: 'branch',
	remote: false,
} satisfies GitBranchReference;
const owner = { key: 'octo/repo', owner: 'octo', name: 'repo' };

function createIssue(provider: string, domain: string): Issue {
	return {
		type: 'issue',
		id: '7',
		nodeId: 'I_7',
		provider: { id: provider, name: provider, domain: domain, icon: '' },
		project: { id: 'project', name: 'Project', resourceId: 'resource', resourceName: 'Resource' },
	} satisfies Partial<Issue> as Issue;
}

function createContainer(
	initial: GitConfigEntityIdentifier[] = [],
	primaryIssue?: Issue,
): { container: Container; read: () => GitConfigEntityIdentifier[]; writes: () => number } {
	let encoded: string | undefined = initial.length ? JSON.stringify(initial) : undefined;
	let writes = 0;
	const container = {
		git: {
			getRepositoryService: () => ({
				config: {
					getGkConfig: () => Promise.resolve(encoded),
					setGkConfig: (_key: string, value: string | undefined) => {
						encoded = value;
						writes++;
						return Promise.resolve();
					},
				},
			}),
		},
		integrations: {
			get: (_id: string, domain?: string) =>
				Promise.resolve(
					primaryIssue == null
						? undefined
						: {
								domain: domain ?? primaryIssue.provider.domain,
								getIssue: () =>
									Promise.resolve(
										domain == null ? primaryIssue : createIssue(primaryIssue.provider.id, domain),
									),
							},
				),
		},
		events: { fire: () => {} },
	} as unknown as Container;
	return {
		container: container,
		read: () => (encoded == null ? [] : (JSON.parse(encoded) as GitConfigEntityIdentifier[])),
		writes: () => writes,
	};
}

suite('branch issue associations', () => {
	for (const provider of ['cloud-github-enterprise', 'cloud-gitlab-self-hosted']) {
		test(`${provider} migrates a legacy association when its primary host is selected again`, async () => {
			const issue = createIssue(provider, 'host-a.example.com');
			const legacy = {
				...encodeIssueOrPullRequestForGitConfig(issue, owner),
				domain: null,
			} as unknown as GitConfigEntityIdentifier;
			const { container, read, writes } = createContainer([legacy], issue);

			await addAssociatedIssueToBranch(container, branch, issue, owner);
			await addAssociatedIssueToBranch(container, branch, issue, owner);

			assert.deepStrictEqual(read().map(getAssociatedIssueId), [getAssociatedIssueId(issue)]);
			assert.strictEqual(writes(), 1);
		});

		test(`${provider} preserves a legacy association's identity when resolving and removing it`, async () => {
			const a = createIssue(provider, 'host-a.example.com');
			const b = createIssue(provider, 'host-b.example.com');
			const legacy = {
				...encodeIssueOrPullRequestForGitConfig(a, owner),
				domain: null,
			} as unknown as GitConfigEntityIdentifier;
			const { container, read } = createContainer([legacy], a);

			await addAssociatedIssueToBranch(container, branch, b, owner);
			assert.deepStrictEqual(read().map(getAssociatedIssueId), [
				getAssociatedIssueId(legacy),
				getAssociatedIssueId(b),
			]);

			const result = await getAssociatedIssuesForBranch(container, branch as GitBranch);
			const associations = await result.value;
			assert.strictEqual(associations?.length, 2);
			assert.strictEqual(associations[0].issue, a);
			assert.strictEqual(associations[0].id, getAssociatedIssueId(legacy));
			assert.notStrictEqual(associations[0].id, getAssociatedIssueId(a));

			await removeAssociatedIssueFromBranch(container, branch, associations[0].id);
			assert.deepStrictEqual(read().map(getAssociatedIssueId), [getAssociatedIssueId(b)]);
		});
	}

	for (const provider of ['cloud-github-enterprise', 'cloud-gitlab-self-hosted', 'jira-server']) {
		test(`${provider} associates and removes same-key issues independently across hosts`, async () => {
			const { container, read, writes } = createContainer();
			const a = createIssue(provider, 'host-a.example.com');
			const b = createIssue(provider, 'host-b.example.com');

			await addAssociatedIssueToBranch(container, branch, a, owner);
			await addAssociatedIssueToBranch(container, branch, b, owner);
			await addAssociatedIssueToBranch(
				container,
				branch,
				createIssue(provider, 'https://HOST-A.EXAMPLE.COM:443/'),
				owner,
			);
			assert.strictEqual(read().length, 2);
			assert.strictEqual(writes(), 2, 'the same host expressed as a URL remains a duplicate');

			await removeAssociatedIssueFromBranch(container, branch, getAssociatedIssueId(a));
			assert.deepStrictEqual(read().map(getAssociatedIssueId), [getAssociatedIssueId(b)]);
			await removeAssociatedIssueFromBranch(container, branch, getAssociatedIssueId(b));
			assert.deepStrictEqual(read(), []);
		});
	}

	test('keeps distinct ports and providers independent', async () => {
		const { container, read } = createContainer();
		const issues = [
			createIssue('cloud-github-enterprise', 'host.example.com'),
			createIssue('cloud-github-enterprise', 'host.example.com:8443'),
			createIssue('cloud-gitlab-self-hosted', 'host.example.com'),
		];
		for (const issue of issues) {
			await addAssociatedIssueToBranch(container, branch, issue, owner);
		}
		assert.strictEqual(read().length, 3);

		await removeAssociatedIssueFromBranch(container, branch, getAssociatedIssueId(issues[1]));
		assert.deepStrictEqual(read().map(getAssociatedIssueId), [
			getAssociatedIssueId(issues[0]),
			getAssociatedIssueId(issues[2]),
		]);
	});
});
