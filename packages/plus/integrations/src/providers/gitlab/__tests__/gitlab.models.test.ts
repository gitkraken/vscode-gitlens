import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { getRepositoryIdentityForPullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import type { ProviderApiConfig } from '../../apiConfig.js';
import { GitLabApi } from '../gitlab.js';
import type { GitLabMergeRequestFull, GitLabRepositoryStub } from '../models.js';
import { gitLabProvider, gitLabToken } from './fixtures.js';

function projectStub(fullPath: string): GitLabRepositoryStub {
	return { id: `gid://gitlab/Project/${fullPath}`, fullPath: fullPath, webUrl: `https://gitlab.com/${fullPath}` };
}

function mergeRequest(fullPath: string, sourceFullPath: string = fullPath): GitLabMergeRequestFull {
	return {
		id: 'gid://gitlab/MergeRequest/100',
		iid: '7',
		author: null,
		title: 'MR 7',
		description: null,
		state: 'opened',
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T00:00:00Z',
		mergedAt: null,
		webUrl: `https://gitlab.com/${fullPath}/-/merge_requests/7`,
		targetBranch: 'main',
		sourceBranch: 'feature',
		diffRefs: { baseSha: 'base', headSha: 'head' },
		project: projectStub(fullPath),
		sourceProject: projectStub(sourceFullPath),
	};
}

function jsonResponse(body: unknown): Response {
	return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Answers every merge request read's queries and REST pages with `mr`. */
function apiAnswering(mr: GitLabMergeRequestFull): GitLabApi {
	const config: ProviderApiConfig = {
		fetch: (input: string | URL) => {
			if (!new URL(input.toString()).pathname.endsWith('/graphql')) {
				return Promise.resolve(
					jsonResponse([
						{
							id: 100,
							iid: 7,
							author: null,
							title: mr.title,
							description: '',
							state: mr.state,
							created_at: mr.createdAt,
							updated_at: mr.updatedAt,
							closed_at: null,
							merged_at: null,
							source_branch: mr.sourceBranch,
							target_branch: mr.targetBranch,
							web_url: mr.webUrl,
						},
					]),
				);
			}

			return Promise.resolve(
				jsonResponse({
					data: {
						project: { id: 'gid://gitlab/Project/1', mergeRequest: mr, mergeRequests: { nodes: [mr] } },
						mergeRequest_0: mr,
					},
				}),
			);
		},
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
	};
	return new GitLabApi(config);
}

/** Both reads that convert a whole merge request, each answered from the merge request's own project. */
const reads: { name: string; read: (api: GitLabApi) => Promise<PullRequest | undefined> }[] = [
	{
		name: 'getPullRequest',
		read: api => api.getPullRequest(gitLabProvider, gitLabToken, 'any', 'path', 7),
	},
	{
		name: 'searchPullRequests',
		read: async api => (await api.searchPullRequests(gitLabProvider, gitLabToken, { search: 'fix' }))[0],
	},
];

/** The reads whose row takes its repository from their arguments, however the caller split the path. */
const readsNamedByTheirArguments: {
	name: string;
	read: (api: GitLabApi, owner: string, repo: string) => Promise<PullRequest | undefined>;
}[] = [
	{
		name: 'getPullRequestForBranch',
		read: (api, owner, repo) => api.getPullRequestForBranch(gitLabProvider, gitLabToken, owner, repo, 'feature'),
	},
	{
		name: 'getPullRequestForCommit',
		read: (api, owner, repo) => api.getPullRequestForCommit(gitLabProvider, gitLabToken, owner, repo, 'abc123'),
	},
];

suite('GitLab merge request repository', () => {
	for (const { name, read } of reads) {
		suite(name, () => {
			test('a nested group is the owner and the last segment is the repository', async () => {
				const pr = await read(apiAnswering(mergeRequest('acme/platform/kepler')));

				assert.equal(pr?.repository.owner, 'acme/platform');
				assert.equal(pr?.repository.repo, 'kepler');
				assert.equal(pr?.repository.url, 'https://gitlab.com/acme/platform/kepler');
				assert.equal(pr?.refs?.base.owner, 'acme/platform');
				assert.equal(pr?.refs?.base.repo, 'kepler');
				assert.equal(pr?.refs?.head.owner, 'acme/platform');
				assert.equal(pr?.refs?.head.repo, 'kepler');
				assert.equal(pr?.refs?.isCrossRepository, false);
			});

			test('a flat path splits the same way', async () => {
				const pr = await read(apiAnswering(mergeRequest('group/r')));

				assert.equal(pr?.repository.owner, 'group');
				assert.equal(pr?.repository.repo, 'r');
				assert.equal(pr?.refs?.base.owner, 'group');
				assert.equal(pr?.refs?.base.repo, 'r');
				assert.equal(pr?.refs?.head.owner, 'group');
				assert.equal(pr?.refs?.head.repo, 'r');
			});

			test('a fork in another nested group keeps its own owner and repository', async () => {
				const pr = await read(apiAnswering(mergeRequest('acme/platform/kepler', 'contrib/team/fork')));

				assert.equal(pr?.repository.owner, 'acme/platform');
				assert.equal(pr?.repository.repo, 'kepler');
				assert.equal(pr?.refs?.head.owner, 'contrib/team');
				assert.equal(pr?.refs?.head.repo, 'fork');
				assert.equal(pr?.refs?.head.url, 'https://gitlab.com/contrib/team/fork');
				assert.equal(pr?.refs?.isCrossRepository, true);
			});

			test('the repository identity names the whole path once', async () => {
				const pr = await read(apiAnswering(mergeRequest('acme/platform/kepler', 'contrib/team/fork')));
				assert.ok(pr != null);

				const head = getRepositoryIdentityForPullRequest(pr);
				assert.equal(head.name, 'contrib/team/fork');
				assert.equal(head.provider.repoDomain, 'contrib/team');
				assert.equal(head.provider.repoName, 'fork');

				const base = getRepositoryIdentityForPullRequest(pr, false);
				assert.equal(base.name, 'acme/platform/kepler');
				assert.equal(base.provider.repoDomain, 'acme/platform');
				assert.equal(base.provider.repoName, 'kepler');
			});

			test('with its source project gone, the repository identity falls back to the repository', async () => {
				const pr = await read(apiAnswering({ ...mergeRequest('acme/platform/kepler'), sourceProject: null }));
				assert.ok(pr != null);
				assert.equal(pr.refs, undefined);

				const identity = getRepositoryIdentityForPullRequest(pr);
				assert.equal(identity.name, 'acme/platform/kepler');
				assert.equal(identity.provider.repoDomain, 'acme/platform');
				assert.equal(identity.provider.repoName, 'kepler');
			});
		});
	}

	for (const { name, read } of readsNamedByTheirArguments) {
		suite(name, () => {
			test("a remote's first-slash split of a nested group names the same repository", async () => {
				const pr = await read(apiAnswering(mergeRequest('acme/platform/kepler')), 'acme', 'platform/kepler');

				assert.equal(pr?.repository.owner, 'acme/platform');
				assert.equal(pr?.repository.repo, 'kepler');
			});

			test('a last-slash split of a nested group is kept', async () => {
				const pr = await read(apiAnswering(mergeRequest('acme/platform/kepler')), 'acme/platform', 'kepler');

				assert.equal(pr?.repository.owner, 'acme/platform');
				assert.equal(pr?.repository.repo, 'kepler');
			});

			test('a flat path is kept', async () => {
				const pr = await read(apiAnswering(mergeRequest('group/r')), 'group', 'r');

				assert.equal(pr?.repository.owner, 'group');
				assert.equal(pr?.repository.repo, 'r');
			});
		});
	}
});
