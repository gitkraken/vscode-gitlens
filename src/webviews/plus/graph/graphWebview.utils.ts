import type { GitReference } from '@gitlens/git/models/reference.js';
import type { RemoteProviderId } from '@gitlens/git/models/remoteProvider.js';
import type { GkProviderId } from '@gitlens/git/models/repositoryIdentities.js';
import { isGitReference } from '@gitlens/git/utils/reference.utils.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '@gitlens/integrations/constants.js';
import type { Unbrand } from '@gitlens/utils/brand.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { GraphActivityDecay } from '../../../config.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { remoteSupportsIntegration } from '../../../git/utils/-webview/remote.utils.js';
import { toRepositoryShape, toRepositoryShapeWithProvider } from '../../../git/utils/-webview/repository.utils.js';
import { isWebviewItemContext, isWebviewItemGroupContext } from '../../../system/webview.js';
import type {
	GraphBranchContextValue,
	GraphColumnsSettings,
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
	GraphRefMetadata,
	GraphRefMetadataType,
	GraphRemoteContextValue,
	GraphRepository,
	GraphStashContextValue,
	GraphTagContextValue,
	GraphUpstreamStatusContextValue,
} from './protocol.js';

/** Hard ceiling on an adaptively-grown page size — keeps the wire payload per page bounded. */
export const maxAdaptivePageLimit = 1000;

// Column layouts applied by the "Reset Columns" commands; shared by the host provider (column-settings
// seed) and the extracted graph commands module.
export const defaultGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 130, isHidden: false, order: 0, isFilterable: true },
	graph: { width: 150, mode: undefined, isHidden: false, order: 1 },
	message: { width: 300, isHidden: false, order: 2, isFilterable: true },
	author: { width: 130, isHidden: false, order: 3, isFilterable: true },
	changes: { width: 200, isHidden: false, order: 4, isFilterable: true },
	datetime: { width: 130, isHidden: false, order: 5, isFilterable: true },
	sha: { width: 130, isHidden: false, order: 6, isFilterable: true },
};

export const compactGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 32, isHidden: false, isFilterable: true },
	graph: { width: 150, mode: 'compact', isHidden: false },
	author: { width: 32, isHidden: false, order: 2, isFilterable: true },
	message: { width: 500, isHidden: false, order: 3, isFilterable: true },
	changes: { width: 200, isHidden: false, order: 4, isFilterable: true },
	datetime: { width: 130, isHidden: true, order: 5, isFilterable: true },
	sha: { width: 130, isHidden: false, order: 6, isFilterable: true },
};

/**
 * Scale the per-page row limit with how deep the graph is already loaded. `git log --skip=N` re-walks
 * N commits for each page, so page cost grows with depth; fetching larger pages deeper in history
 * amortizes that re-walk (fewer, slightly-larger requests — the deflated wire cost per page stays
 * modest). The configured `pageItemLimit` is the base; the multiple grows in bands and is capped.
 *
 * @param loadedRows Rows already loaded (paging depth).
 * @param baseLimit Configured `pageItemLimit` (0 means the user opted into an uncapped walk).
 */
export function computeAdaptivePageLimit(loadedRows: number, baseLimit: number): number {
	// 0 = "no limit" (uncapped walk) — never scale or cap it.
	if (baseLimit <= 0) return baseLimit;

	let multiplier;
	if (loadedRows < 2000) {
		multiplier = 1;
	} else if (loadedRows < 5000) {
		multiplier = 2;
	} else if (loadedRows < 10000) {
		multiplier = 4;
	} else {
		multiplier = 5;
	}
	// Cap the scaled size, but never below the configured base (a large custom base keeps its size).
	return Math.max(baseLimit, Math.min(maxAdaptivePageLimit, baseLimit * multiplier));
}

/**
 * Whether `repoPath` is in the `gitlens:repos:withHostingIntegrationsConnected` context set (which
 * carries both a repo's `uri.toString()` and its `path`). The context is re-published with a FRESHLY
 * allocated array on every `updateContext()` (repo add/remove/open/close, integration connection
 * changes), and `setContext` dedupes by reference identity — so its change event fires even when the
 * connected-repo set is UNCHANGED. Callers compare this boolean against the last observed value and
 * only react to a real flip; blindly resetting refsMetadata on every fire wipes the pills' upstream
 * ahead/behind (integration-independent local git data) until it re-fetches — the "upstream stats
 * flicker in and out" bug.
 */
export function isRepoHostingIntegrationConnected(
	connectedRepos: readonly string[] | undefined,
	repoPath: string | undefined,
): boolean {
	if (connectedRepos == null || repoPath == null) return false;

	return connectedRepos.includes(repoPath);
}

export async function formatRepositories(repositories: GlRepository[]): Promise<GraphRepository[]> {
	if (!repositories.length) return [];

	const result = await Promise.allSettled(
		repositories.map<Promise<GraphRepository>>(async repo => {
			try {
				const remotes = await repo.git.remotes.getBestRemotesWithProviders();
				const remote = remotes.find(r => remoteSupportsIntegration(r)) ?? remotes[0];

				return await toRepositoryShapeWithProvider(repo, remote);
			} catch {
				// If provider info fails (e.g. during integration reconnection),
				// still return the repo shape without provider details
				return toRepositoryShape(repo);
			}
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
	type: 'remote',
): item is GraphItemTypedContext<GraphRemoteContextValue>;
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

/** Maps the ids common to BOTH hosting-service and issue-tracker contexts. Shared by
 *  `toGraphHostingServiceType` and `toGraphIssueTrackerType` so the alias lists can't drift apart —
 *  each function still owns any cases specific to its own union (e.g. `bitbucketServer` is
 *  hosting-only; `jiraCloud`/`linear` are issue-tracker-only). */
function toGraphCommonServiceType(id: string): GraphHostingServiceType | undefined {
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

		default:
			return undefined;
	}
}

export function toGraphHostingServiceType(id: string): GraphHostingServiceType | undefined {
	switch (id) {
		case 'bitbucket-server' satisfies RemoteProviderId:
		case 'bitbucketServer' satisfies Unbrand<GkProviderId>:
		case GitSelfManagedHostIntegrationId.BitbucketServer:
			return 'bitbucketServer';

		default:
			return toGraphCommonServiceType(id);
	}
}

export function toGraphIssueTrackerType(id: string): GraphIssueTrackerType | undefined {
	switch (id) {
		case IssuesCloudHostIntegrationId.Jira:
			return 'jiraCloud';
		case IssuesCloudHostIntegrationId.Linear:
			return 'linear';

		// case 'bitbucket-server' satisfies RemoteProviderId:
		// case 'bitbucketServer' satisfies Unbrand<GkProviderId>:
		// case SelfHostedIntegrationId.BitbucketServer:
		// 	return 'bitbucketServer';

		// case IssueIntegrationId.JiraServer:
		// 	return 'jiraServer';

		default:
			return toGraphCommonServiceType(id);
	}
}

/** Resolves a {@link GraphActivityDecay} setting value (e.g. `'5m'`) to its corresponding
 *  millisecond duration. Drives the Treemap Activity-mode decay window. Falls back to 5 minutes
 *  for unknown values (forward-compat against future enum additions). */
export function activityDecayToMs(decay: GraphActivityDecay): number {
	switch (decay) {
		case '30s':
			return 30 * 1000;
		case '1m':
			return 60 * 1000;
		case '2m':
			return 2 * 60 * 1000;
		case '5m':
			return 5 * 60 * 1000;
		case '10m':
			return 10 * 60 * 1000;
		case '30m':
			return 30 * 60 * 1000;
		default:
			return 5 * 60 * 1000;
	}
}

/**
 * Copy-on-write strip of integration-derived enrichment from a refsMetadata map: returns a fresh map where
 * each entry drops ONLY the `drop` types (e.g. `pullRequest`/`issue`) while preserving everything else —
 * notably `upstream` (local-git ahead/behind, integration-independent). Used on a hosting/issue integration
 * connect/disconnect so pills keep their tracking counts instead of blanking; the dropped keys' ABSENCE is
 * what lets the webview re-request just those types for visible rows.
 *
 * An entry is re-created (fresh object) only when it actually carried a dropped type — untouched entries and
 * `null` entries keep their reference. Dropping is keyed on key PRESENCE (`type in value`), so an already-null
 * enrichment (`pullRequest: null`) is removed too, forcing a re-resolve after the flip.
 */
export function stripRefsMetadataTypes(
	metadata: ReadonlyMap<string, GraphRefMetadata>,
	drop: readonly GraphRefMetadataType[],
): Map<string, GraphRefMetadata> {
	const dropSet = new Set<string>(drop);
	const result = new Map<string, GraphRefMetadata>();
	for (const [id, value] of metadata) {
		if (value == null) {
			result.set(id, value);
			continue;
		}

		// Copy-on-write: rebuild the entry keeping every key EXCEPT the dropped integration-owned types, so an
		// UNCHANGED entry keeps its reference (nothing dropped) and a changed one is a fresh object.
		const kept = Object.entries(value).filter(([key]) => !dropSet.has(key));
		result.set(id, kept.length === Object.keys(value).length ? value : Object.fromEntries(kept));
	}
	return result;
}
