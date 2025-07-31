import { getIntegrationIdForRemote } from '../../../plus/integrations/utils/-webview/integration.utils';
import { configuration } from '../../../system/-webview/configuration';
import { formatDate, fromNow } from '../../../system/date';
import { map } from '../../../system/iterable';
import type { GitRemote } from '../../models/remote';
import { RemoteResourceType } from '../../models/remoteResource';
import type { Repository } from '../../models/repository';
import type { RepositoryShape } from '../../models/repositoryShape';
import type { RemoteProvider } from '../../remotes/remoteProvider';
import { millisecondsPerDay } from '../fetch.utils';

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
export async function groupRepositories(repositories: Repository[]): Promise<Map<Repository, Map<string, Repository>>> {
	const repos = new Map<string, Repository>(repositories.map(r => [r.id, r]));

	// Group worktree repos under the common repo when the common repo is also in the list
	const result = new Map<string, { repo: Repository; worktrees: Map<string, Repository> }>();
	for (const [, repo] of repos) {
		let commonRepo = await repo.getCommonRepository();
		if (commonRepo == null) {
			if (result.has(repo.id)) {
				debugger;
			}
			result.set(repo.id, { repo: repo, worktrees: new Map() });
			continue;
		}

		commonRepo = repos.get(commonRepo.id);
		if (commonRepo == null) {
			if (result.has(repo.id)) {
				debugger;
			}
			result.set(repo.id, { repo: repo, worktrees: new Map() });
			continue;
		}

		let r = result.get(commonRepo.id);
		if (r == null) {
			r = { repo: commonRepo, worktrees: new Map() };
			result.set(commonRepo.id, r);
		} else {
			r.worktrees.set(repo.path, repo);
		}
	}

	return new Map(map(result, ([, r]) => [r.repo, r.worktrees]));
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
		};
		if (provider.integration?.id == null) {
			provider.integration = undefined;
		}
	}

	return { ...toRepositoryShape(repo), provider: provider };
}
