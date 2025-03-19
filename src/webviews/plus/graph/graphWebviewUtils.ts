import { HostingIntegrationId, IssueIntegrationId } from '../../../constants.integrations';
import type { GitReference } from '../../../git/models/reference';
import { RemoteResourceType } from '../../../git/models/remoteResource';
import type { Repository } from '../../../git/models/repository';
import { isGitReference } from '../../../git/utils/reference.utils';
import { remoteProviderIdToIntegrationId } from '../../../plus/integrations/integrationService';
import { getSettledValue } from '../../../system/promise';
import { isWebviewItemContext, isWebviewItemGroupContext } from '../../../system/webview';
import type {
	GraphBranchContextValue,
	GraphCommitContextValue,
	GraphContributorContextValue,
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
	if (repositories.length === 0) return Promise.resolve([]);

	const result = await Promise.allSettled(
		repositories.map<Promise<GraphRepository>>(async repo => {
			const remotes = await repo.git.remotes().getBestRemotesWithProviders();
			const remote = remotes.find(r => r.hasIntegration()) ?? remotes[0];

			return {
				formattedName: repo.formattedName,
				id: repo.id,
				name: repo.name,
				path: repo.path,
				provider: remote?.provider
					? {
							name: remote.provider.name,
							integration: remote.hasIntegration()
								? {
										id: remoteProviderIdToIntegrationId(remote.provider.id)!,
										connected: remote.maybeIntegrationConnected ?? false,
								  }
								: undefined,
							icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
							url: await remote.provider.url({ type: RemoteResourceType.Repo }),
					  }
					: undefined,
				isVirtual: repo.provider.virtual,
			};
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

export function toGraphIssueTrackerType(id: string): GraphIssueTrackerType | undefined {
	switch (id) {
		case HostingIntegrationId.GitHub:
			return 'github';
		case HostingIntegrationId.GitLab:
			return 'gitlab';
		case IssueIntegrationId.Jira:
			return 'jiraCloud';
		case HostingIntegrationId.AzureDevOps:
		case 'azure':
		case 'azure-devops':
			// TODO: Remove the casting once this is officially recognized by the component
			return 'azureDevops' as GraphIssueTrackerType;
		case 'bitbucket':
			// TODO: Remove the casting once this is officially recognized by the component
			return HostingIntegrationId.Bitbucket as GraphIssueTrackerType;
		default:
			return undefined;
	}
}
