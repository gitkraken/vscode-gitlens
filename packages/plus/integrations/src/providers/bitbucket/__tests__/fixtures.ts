import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { TokenWithInfo } from '../../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../../constants.js';
import type { BitbucketPullRequest } from '../models.js';

export const bitbucketProvider: Provider = {
	id: GitCloudHostIntegrationId.Bitbucket,
	name: 'Bitbucket',
	domain: 'bitbucket.org',
	icon: 'bitbucket',
	getIgnoreSSLErrors: () => false,
	reauthenticate: async () => {},
	trackRequestException: () => {},
};

export const bitbucketToken: TokenWithInfo<typeof GitCloudHostIntegrationId.Bitbucket> = {
	providerId: GitCloudHostIntegrationId.Bitbucket,
	accessToken: 'token',
	microHash: 'hash',
	cloud: true,
	type: undefined,
	scopes: undefined,
};

function link(href: string): { href: string } {
	return { href: href };
}

function user(name: string): BitbucketPullRequest['author'] {
	return {
		type: 'user',
		uuid: `{${name}}`,
		display_name: name,
		nickname: name,
		links: {
			self: link(`https://api.bitbucket.org/2.0/users/${name}`),
			avatar: link(`https://bitbucket.org/${name}/avatar`),
			html: link(`https://bitbucket.org/${name}`),
		},
	};
}

function commit(hash: string): BitbucketPullRequest['destination']['commit'] {
	return {
		type: 'commit',
		hash: hash,
		links: {
			self: link(`https://api.bitbucket.org/2.0/commit/${hash}`),
			html: link(`https://bitbucket.org/commits/${hash}`),
		},
	};
}

function repository(owner: string, repo: string): BitbucketPullRequest['destination']['repository'] {
	return {
		type: 'repository',
		uuid: `{${owner}-${repo}}`,
		full_name: `${owner}/${repo}`,
		name: repo,
		slug: repo,
		is_private: true,
		parent: null,
		scm: 'git',
		owner: user(owner),
		workspace: {
			type: 'workspace',
			uuid: `{${owner}}`,
			name: owner,
			slug: owner,
			links: {
				self: link(`https://api.bitbucket.org/2.0/workspaces/${owner}`),
				html: link(`https://bitbucket.org/${owner}`),
				avatar: link(`https://bitbucket.org/${owner}/avatar`),
			},
		},
		project: {
			type: 'project',
			key: 'PROJ',
			uuid: '{proj}',
			name: 'Project',
			links: {
				self: link(`https://api.bitbucket.org/2.0/workspaces/${owner}/projects/PROJ`),
				html: link(`https://bitbucket.org/${owner}/workspace/projects/PROJ`),
				avatar: link(`https://bitbucket.org/${owner}/avatar`),
			},
		},
		created_on: '2026-01-01T00:00:00Z',
		updated_on: '2026-01-01T00:00:00Z',
		size: 0,
		language: '',
		has_issues: false,
		has_wiki: false,
		fork_policy: 'no_public_forks',
		website: '',
		links: {
			self: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}`),
			html: link(`https://bitbucket.org/${owner}/${repo}`),
			avatar: link(`https://bitbucket.org/${owner}/${repo}/avatar`),
		},
	};
}

export function createBitbucketPullRequest(
	owner: string = 'myworkspace',
	repo: string = 'myrepo',
	id: number = 5,
): BitbucketPullRequest {
	return {
		type: 'pullrequest',
		id: id,
		title: 'Pull request',
		description: '',
		state: 'MERGED',
		merge_commit: commit('merge-sha'),
		comment_count: 0,
		task_count: 0,
		close_source_branch: true,
		closed_by: user('author'),
		author: user('author'),
		reason: '',
		created_on: '2026-09-11T00:00:00Z',
		updated_on: '2026-09-12T00:00:00Z',
		destination: { branch: { name: 'main' }, commit: commit('base-sha'), repository: repository(owner, repo) },
		source: { branch: { name: 'feature' }, commit: commit('head-sha'), repository: repository(owner, repo) },
		summary: { type: 'rendered', raw: '', markup: 'markdown', html: '' },
		reviewers: [],
		participants: [],
		links: {
			self: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}`),
			html: link(`https://bitbucket.org/${owner}/${repo}/pull-requests/${id}`),
			commits: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/commits`),
			approve: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/approve`),
			'request-changes': link(
				`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/request-changes`,
			),
			diff: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/diff`),
			diffstat: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/diffstat`),
			comments: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/comments`),
			activity: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/activity`),
			merge: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/merge`),
			decline: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/decline`),
			statuses: link(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${id}/statuses`),
		},
	};
}
