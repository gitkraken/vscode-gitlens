import * as assert from 'assert';
import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as sinon from 'sinon';
import { window } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { GkConfigKeys } from '@gitlens/git/providers/config.js';
import type { GitRunOptions } from '@gitlens/git/run.types.js';
import type { GitConfigEntityIdentifier } from '@gitlens/integrations/providers/models.js';
import { encodeIssueOrPullRequestForGitConfig } from '@gitlens/integrations/providers/utils.js';
import { createTestRepo } from '../../../../../packages/git-cli/src/providers/__tests__/integration/helpers.js';
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
	configuredDomains: string[] = primaryIssue?.provider.domain ? [primaryIssue.provider.domain] : [],
): {
	container: Container;
	read: () => GitConfigEntityIdentifier[];
	writes: () => number;
	resolutions: () => number;
	peeks: () => number;
} {
	let encoded: string | undefined = initial.length ? JSON.stringify(initial) : undefined;
	let writes = 0;
	let resolutions = 0;
	let peeks = 0;
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
			getConfigured: (id: string) =>
				id === primaryIssue?.provider.id ? configuredDomains.map(domain => ({ domain: domain })) : [],
			get: (id: string, domain?: string) => {
				resolutions++;
				return Promise.resolve(
					id !== primaryIssue?.provider.id
						? undefined
						: {
								domain: domain ?? primaryIssue.provider.domain,
								getIssue: () =>
									Promise.resolve(
										domain == null || domain === primaryIssue.provider.domain
											? primaryIssue
											: createIssue(primaryIssue.provider.id, domain),
									),
							},
				);
			},
		},
		cache: {
			peekIssue: () => {
				peeks++;
				return primaryIssue;
			},
		},
		events: { fire: () => {} },
	} as unknown as Container;
	return {
		container: container,
		read: () => (encoded == null ? [] : (JSON.parse(encoded) as GitConfigEntityIdentifier[])),
		writes: () => writes,
		resolutions: () => resolutions,
		peeks: () => peeks,
	};
}

suite('branch issue associations', () => {
	let warnings: sinon.SinonStub;

	setup(() => {
		warnings = sinon.stub(window, 'showWarningMessage').resolves(undefined);
	});

	teardown(() => {
		sinon.restore();
	});

	for (const failure of ['read', 'prepare-write'] as const) {
		test(`reports real config provider ${failure} failure without replacing prior links or emitting success`, async () => {
			const repo = createTestRepo();
			try {
				const actualBranch = { ...branch, repoPath: repo.path };
				const key = `branch.${branch.name}.gk-associated-issues` satisfies GkConfigKeys;
				const config = repo.provider.config;
				const prior = JSON.stringify([
					encodeIssueOrPullRequestForGitConfig(
						{ ...createIssue('jira', 'atlassian.net'), id: 'EXISTING-1', nodeId: 'I_existing' },
						{ key: 'resource', id: 'resource', name: '' },
					),
				]);
				if (failure === 'read') {
					await config.setGkConfig(repo.path, key, prior);
					const real = repo.provider.git.run.bind(repo.provider.git);
					sinon
						.stub(repo.provider.git, 'run')
						.callsFake(async (options: GitRunOptions, ...args: readonly (string | undefined)[]) => {
							if (!args.includes('--list')) return real(options, ...args);

							return {
								stdout: '',
								stderr: undefined,
								completion: { status: 'failed', reason: 'unstarted', error: new Error('read failed') },
							};
						});
				} else {
					await config.getGkConfig(repo.path, key);
					sinon
						.stub(fs, 'mkdir')
						.withArgs(join(repo.path, '.git', 'gk'), { recursive: true })
						.rejects(new Error('permission denied'));
				}

				const { container } = createContainer();
				const writes = sinon.spy(config, 'setGkConfig');
				const changes = sinon.spy(container.events, 'fire');
				sinon.stub(container.git, 'getRepositoryService').returns({
					config: {
						getGkConfig: config.getGkConfig.bind(config, repo.path),
						setGkConfig: config.setGkConfig.bind(config, repo.path),
					},
				} as ReturnType<Container['git']['getRepositoryService']>);
				await addAssociatedIssueToBranch(container, actualBranch, createIssue('jira', 'atlassian.net'));
				assert.strictEqual(warnings.callCount, 1);
				assert.strictEqual(changes.callCount, 0);
				if (failure === 'read') {
					assert.strictEqual(writes.callCount, 0);
					assert.ok(readFileSync(join(repo.path, '.git', 'gk', 'config'), 'utf8').includes('EXISTING-1'));
				} else {
					assert.strictEqual(writes.callCount, 1);
				}
			} finally {
				repo.cleanup();
			}
		});
	}

	test('reports missing owner information without writing an association', async () => {
		const { container, writes } = createContainer();
		const issue = { ...createIssue('jira', 'example.atlassian.net'), project: undefined };
		await addAssociatedIssueToBranch(container, branch, issue, undefined);
		assert.strictEqual(writes(), 0);
		assert.strictEqual(warnings.callCount, 1);
		assert.ok(warnings.firstCall.args[0].includes(issue.id));
		assert.ok(warnings.firstCall.args[0].includes(branch.name));
	});

	for (const operation of ['read', 'write', 'unavailable'] as const) {
		test(`reports a failed association when config ${operation} fails`, async () => {
			const { container, writes } = createContainer();
			const config = container.git.getRepositoryService(branch.repoPath).config;
			if (operation === 'read') {
				sinon.stub(config, 'getGkConfig').rejects(new Error('read failed'));
			} else if (operation === 'write') {
				sinon.stub(config, 'setGkConfig').rejects(new Error('write failed'));
			} else {
				sinon.stub(config, 'setGkConfig').value(undefined);
			}
			sinon
				.stub(container.git, 'getRepositoryService')
				.returns({ config: config } as ReturnType<Container['git']['getRepositoryService']>);
			const issue = createIssue('jira', 'example.atlassian.net');
			await addAssociatedIssueToBranch(container, branch, issue, owner);
			assert.strictEqual(writes(), 0);
			assert.strictEqual(warnings.callCount, 1);
			assert.ok(warnings.firstCall.args[0].includes(issue.id));
		});
	}

	test('persists and resolves Jira association by actual site id without a namespace', async () => {
		const issue = createIssue('jira', 'example.atlassian.net');
		issue.project!.resourceName = '';
		const { container, read, writes } = createContainer([], issue);
		await addAssociatedIssueToBranch(container, branch, issue);
		assert.strictEqual(writes(), 1);
		const encoded = read()[0];
		assert.strictEqual('resourceId' in encoded ? encoded.resourceId : undefined, 'resource');
		assert.strictEqual(read()[0].metadata.owner.id, 'resource');
		assert.strictEqual(read()[0].metadata.owner.name, '');
		const result = await getAssociatedIssuesForBranch(container, branch as GitBranch);
		assert.strictEqual((await result.value)?.[0].issue, issue);
		assert.strictEqual(warnings.callCount, 0);
	});

	for (const provider of [
		'cloud-github-enterprise',
		'cloud-gitlab-self-hosted',
		'bitbucket-server',
		'azure-devops-server',
	]) {
		test(`${provider} migrates a legacy association when its only configured host is selected again`, async () => {
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

		test(`${provider} preserves ambiguous legacy associations when adding the primary host's issue`, async () => {
			const issue = createIssue(provider, 'host-a.example.com');
			const legacy = {
				...encodeIssueOrPullRequestForGitConfig(issue, owner),
				domain: null,
			} as unknown as GitConfigEntityIdentifier;
			for (const domains of [[], ['host-a.example.com', 'host-b.example.com']]) {
				const { container, read } = createContainer([legacy], issue, domains);
				await addAssociatedIssueToBranch(container, branch, issue, owner);
				assert.deepStrictEqual(read().map(getAssociatedIssueId), [
					getAssociatedIssueId(legacy),
					getAssociatedIssueId(issue),
				]);
			}
		});

		test(`${provider} stops resolving a legacy association when a second host is configured`, async () => {
			const issue = createIssue(provider, 'host-a.example.com');
			const legacy = {
				...encodeIssueOrPullRequestForGitConfig(issue, owner),
				domain: null,
			} as unknown as GitConfigEntityIdentifier;
			const domains = ['host-a.example.com'];
			const { container, read, writes, resolutions, peeks } = createContainer([legacy], issue, domains);
			const result = await getAssociatedIssuesForBranch(container, branch as GitBranch);
			assert.deepStrictEqual(await result.value, [{ id: getAssociatedIssueId(legacy), issue: issue }]);

			domains.push('host-b.example.com');
			for (const cached of [false, true]) {
				const unresolved = await getAssociatedIssuesForBranch(container, branch as GitBranch, {
					cached: cached,
				});
				assert.deepStrictEqual(await unresolved.value, []);
			}
			assert.strictEqual(resolutions(), 1);
			assert.strictEqual(peeks(), 0);
			assert.strictEqual(writes(), 0);
			assert.strictEqual(JSON.stringify(read()), JSON.stringify([legacy]));
		});
	}

	for (const provider of [
		'cloud-github-enterprise',
		'cloud-gitlab-self-hosted',
		'bitbucket-server',
		'azure-devops-server',
		'jira-server',
	]) {
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

	test("ignores another provider's configured host for a legacy association", async () => {
		const configured = createIssue('cloud-github-enterprise', 'host-a.example.com');
		const issue = createIssue('cloud-gitlab-self-hosted', 'host-a.example.com');
		const legacy = {
			...encodeIssueOrPullRequestForGitConfig(issue, owner),
			domain: null,
		} as unknown as GitConfigEntityIdentifier;
		const { container, read } = createContainer([legacy], configured);

		const result = await getAssociatedIssuesForBranch(container, branch as GitBranch);
		assert.deepStrictEqual(await result.value, []);

		await addAssociatedIssueToBranch(container, branch, issue, owner);
		assert.deepStrictEqual(read().map(getAssociatedIssueId), [
			getAssociatedIssueId(legacy),
			getAssociatedIssueId(issue),
		]);
	});

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
