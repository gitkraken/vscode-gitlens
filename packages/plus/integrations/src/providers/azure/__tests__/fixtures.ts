import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { TokenWithInfo } from '../../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../../constants.js';
import type { AzureProjectDescriptor, AzurePullRequest, WorkItem } from '../models.js';

export const azureProvider: Provider = {
	id: GitCloudHostIntegrationId.AzureDevOps,
	name: 'Azure DevOps',
	domain: 'dev.azure.com',
	icon: 'azure-devops',
	getIgnoreSSLErrors: () => false,
	reauthenticate: async () => {},
	trackRequestException: () => {},
};

export const azureToken: TokenWithInfo<typeof GitCloudHostIntegrationId.AzureDevOps> = {
	providerId: GitCloudHostIntegrationId.AzureDevOps,
	accessToken: 'token',
	microHash: 'hash',
	cloud: true,
	type: undefined,
	scopes: undefined,
};

export function createAzurePullRequest(
	apiUrl: string,
	projectName: string,
	repoName: string,
	projectId: string = 'project-id',
): AzurePullRequest {
	return {
		url: apiUrl,
		pullRequestId: 5,
		codeReviewId: 5,
		status: 'active',
		createdBy: {
			displayName: 'Author',
			url: 'https://dev.azure.com/myorg/_apis/identities/author',
			_links: { avatar: { href: 'https://dev.azure.com/myorg/_apis/graphprofile/memberavatars/author' } },
			id: 'author',
			uniqueName: 'author@example.com',
			imageUrl: 'https://dev.azure.com/myorg/_apis/graphprofile/memberavatars/author',
		},
		creationDate: '2026-09-11T00:00:00Z',
		title: 'Pull request',
		description: '',
		sourceRefName: 'refs/heads/feature',
		targetRefName: 'refs/heads/main',
		isDraft: false,
		mergeId: 'merge-id',
		lastMergeSourceCommit: { commitId: 'head-sha', url: `${apiUrl}/commits/head-sha` },
		lastMergeTargetCommit: { commitId: 'base-sha', url: `${apiUrl}/commits/base-sha` },
		reviewers: [],
		supportsIterations: true,
		repository: {
			id: 'repository-id',
			name: repoName,
			url: 'https://attacker.invalid/repository-id',
			project: { id: projectId, name: projectName },
		},
	};
}

export function createAzureForkSource(pr: AzurePullRequest, remoteUrl?: string): AzurePullRequest['forkSource'] {
	return {
		creator: pr.createdBy,
		isLocked: false,
		isLockedBy: pr.createdBy,
		name: 'refs/heads/feature',
		objectId: 'head-sha',
		peeledObjectId: 'head-sha',
		repository: {
			id: 'fork-repository-id',
			name: 'fork repo',
			url: 'https://dev.azure.com/myorg/_apis/git/repositories/fork-repository-id',
			remoteUrl: remoteUrl,
		},
		statuses: [],
		url: 'https://dev.azure.com/myorg/_apis/git/repositories/fork-repository-id/refs/heads/feature',
	};
}

export const azureProject: AzureProjectDescriptor = {
	key: 'project-id',
	id: 'project-id',
	name: 'Payments',
	resourceId: 'org-id',
	resourceName: 'acme',
};

export function createWorkItem(iterationPath?: string): WorkItem {
	const link = { href: 'https://dev.azure.com/acme/Payments/_workitems/edit/42' };
	const author = {
		id: 'author-id',
		displayName: 'Author',
		uniqueName: 'author@example.com',
		url: link.href,
		imageUrl: link.href,
		_links: { avatar: link },
	};
	return {
		id: 42,
		rev: 1,
		url: link.href,
		_links: {
			fields: link,
			html: link,
			self: link,
			workItemComments: link,
			workItemRevisions: link,
			workItemType: link,
			workItemUpdates: link,
		},
		fields: {
			'System.TeamProject': azureProject.name,
			'System.IterationPath': iterationPath,
			'System.WorkItemType': 'Bug',
			'System.State': 'Active',
			'System.AssignedTo': author,
			'System.CreatedDate': '2026-09-01T00:00:00Z',
			'System.CreatedBy': author,
			'System.ChangedDate': '2026-09-02T00:00:00Z',
			'System.ChangedBy': author,
			'System.CommentCount': 0,
			'System.Description': '',
			'System.Title': 'Issue 42',
			'Microsoft.VSTS.Common.ClosedDate': '',
		},
	};
}
