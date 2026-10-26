import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { TokenWithInfo } from '../../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../../constants.js';
import type { AzureProjectDescriptor, AzurePullRequest, AzureWorkItemStateCategory, WorkItem } from '../models.js';

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

/**
 * The workflow {@link azureWorkItemTypeStatesResponse} answers for every work item type: each Azure category once,
 * and names that say the opposite of their category, so a test can tell a category read from metadata from one
 * guessed from the name.
 */
export const azureWorkItemTypeStates: readonly { name: string; category: AzureWorkItemStateCategory }[] = [
	{ name: 'To Do', category: 'Proposed' },
	{ name: 'New', category: 'Proposed' },
	{ name: 'Doing', category: 'InProgress' },
	{ name: 'Active', category: 'InProgress' },
	{ name: 'Resolved', category: 'Resolved' },
	{ name: 'Done', category: 'Completed' },
	{ name: 'Closed', category: 'Completed' },
	{ name: 'Descartado', category: 'Removed' },
	{ name: 'Canceled', category: 'Completed' },
	{ name: 'Removed', category: 'InProgress' },
];

/** Whether `url` is a work item type's states read (`GET …/_apis/wit/workItemTypes/{type}/states`). */
export function isAzureWorkItemTypeStatesUrl(url: string | URL): boolean {
	return /\/_apis\/wit\/workItemTypes\/[^/]+\/states$/i.test(new URL(url.toString()).pathname);
}

/**
 * Azure's answer to a work item type's states read, as `GET …/_apis/wit/workItemTypes/{type}/states` returns it;
 * `undefined` for any other URL, so a fake server answers this route first and serves the rest itself.
 */
export function azureWorkItemTypeStatesResponse(
	url: string | URL,
	states: readonly { name: string; category: AzureWorkItemStateCategory }[] = azureWorkItemTypeStates,
): Response | undefined {
	if (!isAzureWorkItemTypeStatesUrl(url)) return undefined;

	const value = states.map(s => ({ ...s, color: '007acc' }));
	return new Response(JSON.stringify({ count: value.length, value: value }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

export function azureRestDiscoveryResponse(
	input: string | URL,
	options: {
		maxVersion?: string;
		releasedVersion?: string;
		resourceVersion?: number;
		previewOnlyResources?: readonly string[];
	} = {},
): Response | undefined {
	const area = new URL(input.toString()).pathname.match(/\/_apis\/(wit|git|work|IMS)$/i)?.[1].toLowerCase();
	if (area == null) return undefined;

	const definitions = [
		['wit', 'b51fd764-e5c2-4b9b-aaf7-3395cf4bdd94', '_apis/wit/fields'],
		['wit', '1a9c53f7-f243-4447-b110-35ef023636e4', '{project}/{team}/_apis/wit/wiql'],
		['wit', '72c7ddf8-2cdc-4f60-90cd-ab71c14a399b', '{project}/_apis/wit/workItems/{id}'],
		['wit', '908509b6-4248-4475-a1cd-829139ba419f', '{project}/_apis/wit/workItemsBatch'],
		['wit', '7c8d7a76-4a09-43e8-b5df-bd792f4ac6aa', '{project}/_apis/wit/workItemTypes/{type}'],
		['wit', '7c9d7a76-4a09-43e8-b5df-bd792f4ac6aa', '{project}/_apis/wit/workItemTypes/{type}/states'],
		[
			'git',
			'9946fd70-0d40-406e-b686-b4744cbbcc37',
			'{project}/_apis/git/repositories/{repositoryId}/pullRequests/{pullRequestId}',
		],
		['git', '225f7195-f9c7-4d14-ab28-a83f7ff77e1f', '{project}/_apis/git/repositories/{repositoryId}'],
		[
			'git',
			'b3a6eebe-9cf0-49ea-b6cb-1a4c5f5007b0',
			'{project}/_apis/git/repositories/{repositoryId}/pullRequestQuery',
		],
		['work', '7799f497-3cb5-4f16-ad4f-5cd06012db64', '{project}/{team}/_apis/work/backlogconfiguration'],
		['ims', '28010c54-d0c0-4c89-a5b0-1c9e188b9fb7', '_apis/identities/{identityId}'],
		['ims', '299e50df-fe45-4d3a-8b5b-a5836fac74dc', '_apis/identityBatch'],
	];
	return Response.json({
		value: definitions
			.filter(([name]) => name === area)
			.map(([, id, route]) => ({
				id: id,
				routeTemplate: route,
				minVersion: '1.0',
				maxVersion: options.maxVersion ?? '7.1',
				releasedVersion: options.previewOnlyResources?.includes(route.split('/').at(-1)!)
					? '0.0'
					: (options.releasedVersion ?? '7.1'),
				resourceVersion: options.resourceVersion ?? 3,
			})),
	});
}
