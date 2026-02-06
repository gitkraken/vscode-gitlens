import type { Uri } from 'vscode';
import { Schemes } from '../../../constants.js';
import { getIntegrationIdForRemote } from '../../../plus/integrations/utils/-webview/integration.utils.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { UriMap } from '../../../system/-webview/uriMap.js';
import { formatDate, fromNow } from '../../../system/date.js';
import { map } from '../../../system/iterable.js';
import { normalizePath } from '../../../system/path.js';
import { areUrisEqual } from '../../../system/uri.js';
import type { GitRemote } from '../../models/remote.js';
import { RemoteResourceType } from '../../models/remoteResource.js';
import type { Repository } from '../../models/repository.js';
import type { RepositoryShape } from '../../models/repositoryShape.js';
import type { RemoteProvider } from '../../remotes/remoteProvider.js';
import { millisecondsPerDay } from '../fetch.utils.js';

export function formatLastFetched(lastFetched: number, short: boolean = true): string {
	const date = new Date(lastFetched);
	if (Date.now() - lastFetched < millisecondsPerDay) {
		return fromNow(date);
	}

	if (short) {
		return formatDate(date, configuration.get('defaultDateShortFormat') ?? 'short');
	}

	let format =
		configuration.get('defaultDateFormat') ??
		`dddd, MMMM Do, YYYY [at] ${configuration.get('defaultTimeFormat') ?? 'h:mma'}`;
	if (!/[hHm]/.test(format)) {
		format += ` [at] ${configuration.get('defaultTimeFormat') ?? 'h:mma'}`;
	}
	return formatDate(date, format);
}

export function getRepositoryOrWorktreePath(uri: Uri): string {
	return uri.scheme === Schemes.File ? normalizePath(uri.fsPath) : uri.toString();
}

export function getCommonRepositoryPath(commonUri: Uri): string {
	const uri = getCommonRepositoryUri(commonUri);
	return getRepositoryOrWorktreePath(uri);
}

export function getCommonRepositoryUri(commonUri: Uri): Uri {
	if (commonUri?.path.endsWith('/.git')) {
		return commonUri.with({ path: commonUri.path.substring(0, commonUri.path.length - 5) });
	}
	return commonUri;
}

export function groupRepositories(repositories: Iterable<Repository>): Map<Repository, Map<string, Repository>> {
	const repos = new Map<string, Repository>(map(repositories, r => [r.id, r]));

	// Build a map of repo uris to repos for quick lookup
	// We use each repo's own uri as the key, so worktrees and submodules can find their main/parent repo
	const reposByUri = new UriMap<Repository>();
	for (const repo of repos.values()) {
		reposByUri.set(repo.uri, repo);
	}

	// Group worktree and submodule repos under the common/parent repo when that repo is also in the list
	const result = new Map<string, { repo: Repository; children: Map<string, Repository> }>();
	for (const repo of repos.values()) {
		const { commonUri, parentUri } = repo;

		// Check if this is a submodule with a parent in our list
		if (repo.isSubmodule && parentUri != null) {
			const parentRepo = reposByUri.get(parentUri);
			if (parentRepo != null) {
				// Add the submodule to its parent repo's children map
				let r = result.get(parentRepo.id);
				if (r == null) {
					r = { repo: parentRepo, children: new Map() };
					result.set(parentRepo.id, r);
				}
				r.children.set(repo.path, repo);
				continue;
			}
			// Parent repo not in the list, treat this submodule as standalone (fall through)
		}

		// If no common URI, this is a main repo (or standalone)
		if (commonUri == null) {
			if (result.has(repo.id)) {
				debugger;
			}

			result.set(repo.id, { repo: repo, children: new Map() });
			continue;
		}

		// Check if the common repo is this repo itself (it's a main repo)
		if (areUrisEqual(repo.uri, commonUri)) {
			// Only add if not already present (could have been added by a worktree or submodule)
			if (!result.has(repo.id)) {
				result.set(repo.id, { repo: repo, children: new Map() });
			}
			continue;
		}

		// This is a worktree - find its common repo in our list
		const commonRepo = reposByUri.get(commonUri);
		if (commonRepo == null) {
			// Common repo not in the list, treat this worktree as standalone
			if (result.has(repo.id)) {
				debugger;
			}

			result.set(repo.id, { repo: repo, children: new Map() });
			continue;
		}

		// Add the worktree to its common repo's children map
		let r = result.get(commonRepo.id);
		if (r == null) {
			r = { repo: commonRepo, children: new Map() };
			result.set(commonRepo.id, r);
		}
		r.children.set(repo.path, repo);
	}

	return new Map(map(result, ([, r]) => [r.repo, r.children]));
}

export function toRepositoryShape(repo: Repository): RepositoryShape {
	return { id: repo.id, name: repo.name, path: repo.path, uri: repo.uri.toString(), virtual: repo.virtual };
}

export async function toRepositoryShapeWithProvider(
	repo: Repository,
	remote: GitRemote<RemoteProvider> | undefined,
): Promise<RepositoryShape> {
	let provider: RepositoryShape['provider'] | undefined;
	if (remote?.provider != null) {
		provider = {
			name: remote.provider.name,
			icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
			integration: remote.supportsIntegration()
				? {
						id: getIntegrationIdForRemote(remote.provider)!,
						connected: remote.maybeIntegrationConnected ?? false,
					}
				: undefined,
			supportedFeatures: remote.provider.supportedFeatures,
			url: await remote.provider.url({ type: RemoteResourceType.Repo }),
			bestRemoteName: remote.name,
		};
		if (provider.integration?.id == null) {
			provider.integration = undefined;
		}
	}

	return { ...toRepositoryShape(repo), provider: provider };
}
