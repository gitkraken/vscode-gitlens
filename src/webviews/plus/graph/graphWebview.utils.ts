import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../constants.integrations';
import type { GitReference } from '../../../git/models/reference';
import type { Repository } from '../../../git/models/repository';
import type { GkProviderId } from '../../../git/models/repositoryIdentities';
import type { RemoteProviderId } from '../../../git/remotes/remoteProvider';
import { toRepositoryShapeWithProvider } from '../../../git/utils/-webview/repository.utils';
import { isGitReference } from '../../../git/utils/reference.utils';
import type { Unbrand } from '../../../system/brand';
import { getSettledValue } from '../../../system/promise';
import { isWebviewItemContext, isWebviewItemGroupContext } from '../../../system/webview';
import type {
	GraphBranchContextValue,
	GraphCommitContextValue,
	GraphContributorContextValue,
	GraphHostingServiceType,
	GraphIssueContextValue,
	GraphIssueTrackerType,
	GraphItemContext,
	GraphItemGroupContext,
	GraphItemRefContext,
	GraphItemRefGroupContext,
	GraphItemTypedContext,
	GraphItemTypedContextValue,
	GraphPullRequestContextValue,
	GraphRepository,
	GraphStashContextValue,
	GraphTagContextValue,
	GraphUpstreamStatusContextValue,
} from './protocol';

export async function formatRepositories(repositories: Repository[]): Promise<GraphRepository[]> {
	if (!repositories.length) return [];

	const result = await Promise.allSettled(
		repositories.map<Promise<GraphRepository>>(async repo => {
			const remotes = await repo.git.remotes.getBestRemotesWithProviders();
			const remote = remotes.find(r => r.supportsIntegration()) ?? remotes[0];

			return toRepositoryShapeWithProvider(repo, remote);
		}),
	);
	return result.map(r => getSettledValue(r)).filter(r => r != null);
}

function isGraphItemContext(item: unknown): item is GraphItemContext {
	if (item == null) return false;

	return isWebviewItemContext(item) && (item.webview === 'gitlens.graph' || item.webview === 'gitlens.views.graph');
}

function isGraphItemGroupContext(item: unknown): item is GraphItemGroupContext {
	if (item == null) return false;

	return (
		isWebviewItemGroupContext(item) && (item.webview === 'gitlens.graph' || item.webview === 'gitlens.views.graph')
	);
}

export function isGraphItemTypedContext(
	item: unknown,
	type: 'contributor',
): item is GraphItemTypedContext<GraphContributorContextValue>;
export function isGraphItemTypedContext(
	item: unknown,
	type: 'pullrequest',
): item is GraphItemTypedContext<GraphPullRequestContextValue>;
export function isGraphItemTypedContext(
	item: unknown,
	type: 'upstreamStatus',
): item is GraphItemTypedContext<GraphUpstreamStatusContextValue>;
export function isGraphItemTypedContext(
	item: unknown,
	type: 'issue',
): item is GraphItemTypedContext<GraphIssueContextValue>;
export function isGraphItemTypedContext(
	item: unknown,
	type: GraphItemTypedContextValue['type'],
): item is GraphItemTypedContext {
	if (item == null) return false;

	return isGraphItemContext(item) && typeof item.webviewItemValue === 'object' && item.webviewItemValue.type === type;
}

export function isGraphItemRefGroupContext(item: unknown): item is GraphItemRefGroupContext {
	if (item == null) return false;

	return (
		isGraphItemGroupContext(item) &&
		typeof item.webviewItemGroupValue === 'object' &&
		item.webviewItemGroupValue.type === 'refGroup'
	);
}

export function isGraphItemRefContext(item: unknown): item is GraphItemRefContext;
export function isGraphItemRefContext(
	item: unknown,
	refType: 'branch',
): item is GraphItemRefContext<GraphBranchContextValue>;
export function isGraphItemRefContext(
	item: unknown,
	refType: 'revision',
): item is GraphItemRefContext<GraphCommitContextValue>;
export function isGraphItemRefContext(
	item: unknown,
	refType: 'stash',
): item is GraphItemRefContext<GraphStashContextValue>;
export function isGraphItemRefContext(item: unknown, refType: 'tag'): item is GraphItemRefContext<GraphTagContextValue>;
export function isGraphItemRefContext(item: unknown, refType?: GitReference['refType']): item is GraphItemRefContext {
	if (item == null) return false;

	return (
		isGraphItemContext(item) &&
		typeof item.webviewItemValue === 'object' &&
		'ref' in item.webviewItemValue &&
		(refType == null || item.webviewItemValue.ref.refType === refType)
	);
}

export function hasGitReference(o: unknown): o is { ref: GitReference } {
	if (o == null || typeof o !== 'object') return false;
	if (!('ref' in o)) return false;

	return isGitReference(o.ref);
}

export function toGraphHostingServiceType(id: string): GraphHostingServiceType | undefined {
	switch (id) {
		case 'github' satisfies RemoteProviderId:
		case 'github' satisfies Unbrand<GkProviderId>:
		case GitCloudHostIntegrationId.GitHub:
			return 'github';

		case 'cloud-github-enterprise' satisfies RemoteProviderId:
		case 'githubEnterprise' satisfies Unbrand<GkProviderId>:
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return 'githubEnterprise';

		case 'gitlab' satisfies RemoteProviderId:
		case 'gitlab' satisfies Unbrand<GkProviderId>:
		case GitCloudHostIntegrationId.GitLab:
			return 'gitlab';

		case 'cloud-gitlab-self-hosted' satisfies RemoteProviderId:
		case 'gitlabSelfHosted' satisfies Unbrand<GkProviderId>:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return 'gitlabSelfHosted';

		case 'azure-devops' satisfies RemoteProviderId:
		case 'azureDevops' satisfies Unbrand<GkProviderId>:
		case 'azure':
		case GitCloudHostIntegrationId.AzureDevOps:
		case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			return 'azureDevops';

		case 'bitbucket' satisfies RemoteProviderId:
		case 'bitbucket' satisfies Unbrand<GkProviderId>:
		case GitCloudHostIntegrationId.Bitbucket:
			return 'bitbucket';

		case 'bitbucket-server' satisfies RemoteProviderId:
		case 'bitbucketServer' satisfies Unbrand<GkProviderId>:
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return 'bitbucketServer';

		default:
			return undefined;
	}
}

export function toGraphIssueTrackerType(id: string): GraphIssueTrackerType | undefined {
	switch (id) {
		case 'github' satisfies RemoteProviderId:
		case 'github' satisfies Unbrand<GkProviderId>:
		case GitCloudHostIntegrationId.GitHub:
			return 'github';

		case 'cloud-github-enterprise' satisfies RemoteProviderId:
		case 'githubEnterprise' satisfies Unbrand<GkProviderId>:
		case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			return 'githubEnterprise';

		case 'gitlab' satisfies RemoteProviderId:
		case 'gitlab' satisfies Unbrand<GkProviderId>:
		case GitCloudHostIntegrationId.GitLab:
			return 'gitlab';

		case 'cloud-gitlab-self-hosted' satisfies RemoteProviderId:
		case 'gitlabSelfHosted' satisfies Unbrand<GkProviderId>:
		case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			return 'gitlabSelfHosted';

		case 'azure-devops' satisfies RemoteProviderId:
		case 'azureDevops' satisfies Unbrand<GkProviderId>:
		case 'azure':
		case GitCloudHostIntegrationId.AzureDevOps:
			return 'azureDevops';

		case 'bitbucket' satisfies RemoteProviderId:
		case 'bitbucket' satisfies Unbrand<GkProviderId>:
		case GitCloudHostIntegrationId.Bitbucket:
			return 'bitbucket';

		// case 'bitbucket-server' satisfies RemoteProviderId:
		// case 'bitbucketServer' satisfies Unbrand<GkProviderId>:
		// case SelfHostedIntegrationId.BitbucketServer:
		// 	return 'bitbucketServer';

		case IssuesCloudHostIntegrationId.Jira:
			return 'jiraCloud';

		// case IssueIntegrationId.JiraServer:
		// 	return 'jiraServer';

		default:
			return undefined;
	}
}
