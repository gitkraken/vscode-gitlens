import type { QuickPickItem } from 'vscode';
import { ProgressLocation, Uri, window } from 'vscode';
import { isWeb } from '@env/platform.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { millisecondsPerDay } from '@gitlens/git/utils/fetch.utils.js';
import { parseGitRemoteUrl } from '@gitlens/git/utils/remote.utils.js';
import { getIntegrationIdForRemote } from '@gitlens/integrations/utils/integration.utils.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { map } from '@gitlens/utils/iterable.js';
import { areUrisEqual } from '@gitlens/utils/uri.js';
import type { Container } from '../../../container.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { UriMap } from '../../../system/-webview/uriMap.js';
import type { GlRepository } from '../../models/repository.js';
import type { RepositoryShape } from '../../models/repositoryShape.js';
import { getRemoteProviderUrl, isRemoteMaybeIntegrationConnected, remoteSupportsIntegration } from './remote.utils.js';

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

// export function getRepositoryOrWorktreePath(uri: Uri): string {
// 	return uri.scheme === Schemes.File ? normalizePath(uri.fsPath) : uri.toString();
// }

// export function getCommonRepositoryPath(commonUri: Uri): string {
// 	const uri = getCommonRepositoryUri(commonUri);
// 	return getRepositoryOrWorktreePath(uri);
// }

// export function getCommonRepositoryUri(commonUri: Uri): Uri {
// 	if (commonUri?.path.endsWith('/.git')) {
// 		return commonUri.with({ path: commonUri.path.substring(0, commonUri.path.length - 5) });
// 	}
// 	return commonUri;
// }

export function groupRepositories(repositories: Iterable<GlRepository>): Map<GlRepository, Map<string, GlRepository>> {
	const repos = new Map<string, GlRepository>(map(repositories, r => [r.id, r]));

	// Build a map of repo uris to repos for quick lookup
	// We use each repo's own uri as the key, so worktrees and submodules can find their main/parent repo
	const reposByUri = new UriMap<GlRepository>();
	for (const repo of repos.values()) {
		reposByUri.set(repo.uri, repo);
	}

	// Group worktree and submodule repos under the common/parent repo when that repo is also in the list
	// Note: Submodules are NOT grouped — they are independent repos with their own branches/remotes
	const result = new Map<string, { repo: GlRepository; children: Map<string, GlRepository> }>();
	for (const repo of repos.values()) {
		const { commonUri } = repo;

		// If no common URI, this is a main repo (or standalone)
		if (commonUri == null) {
			if (!result.has(repo.id)) {
				result.set(repo.id, { repo: repo, children: new Map() });
			}
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
			if (!result.has(repo.id)) {
				result.set(repo.id, { repo: repo, children: new Map() });
			}
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

export function toRepositoryShape(repo: GlRepository): RepositoryShape {
	return {
		id: repo.id,
		name: repo.name,
		path: repo.path,
		commonPath: repo.commonPath,
		uri: repo.uri.toString(),
		virtual: repo.virtual,
	};
}

export async function toRepositoryShapeWithProvider(
	repo: GlRepository,
	remote: GitRemote | undefined,
): Promise<RepositoryShape> {
	let provider: RepositoryShape['provider'] | undefined;
	if (remote?.provider != null) {
		provider = {
			name: remote.provider.name,
			icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
			integration: remoteSupportsIntegration(remote)
				? {
						id: getIntegrationIdForRemote(remote.provider)!,
						connected: isRemoteMaybeIntegrationConnected(remote) ?? false,
					}
				: undefined,
			supportedFeatures: remote.provider.supportedFeatures,
			url: await getRemoteProviderUrl(remote.provider, { type: RemoteResourceType.Repo }),
			bestRemoteName: remote.name,
		};
		if (provider.integration?.id == null) {
			provider.integration = undefined;
		}
	}

	return { ...toRepositoryShape(repo), provider: provider };
}

/** Shows a folder-picker dialog with the given title; throws {@link CancellationError} on no selection. */
async function pickFolder(title: string): Promise<Uri> {
	const folder = await window.showOpenDialog({
		title: title,
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
	});
	if (folder?.[0] == null) throw new CancellationError();

	return folder[0];
}

/**
 * Adds a repository by cloning `remoteUrl` or picking a local folder, returning the added repo
 * (added closed/un-surfaced). Persists the location mapping when a remote url is available.
 * Throws {@link CancellationError} on any user cancellation so callers can stay silent.
 */
export async function locateOrCloneRepository(
	container: Container,
	action: 'clone' | 'folder',
	options: { name: string; remoteUrl?: string },
): Promise<GlRepository> {
	let uri: Uri;
	if (action === 'clone') {
		if (options.remoteUrl == null) throw new Error('Missing remote url');

		const folder = await pickFolder('Choose a folder to clone the repository to');

		let clonePath: string | undefined;
		try {
			clonePath = await window.withProgress(
				{ location: ProgressLocation.Notification, title: `Cloning ${options.name}...` },
				() => container.git.clone(options.remoteUrl!, folder.fsPath),
			);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
			throw new Error(`Unable to clone repository: ${ex instanceof Error ? ex.message : String(ex)}`, {
				cause: ex,
			});
		}

		if (!clonePath) throw new Error('Unable to clone repository');

		uri = Uri.file(clonePath);
	} else {
		uri = await pickFolder('Choose the folder containing the repository');
	}

	const repo = await container.git.getOrAddRepository(uri, { opened: false, detectNested: false });
	if (repo == null) {
		throw new Error(`Unable to find a repository in the chosen folder for ${options.name}`);
	}

	// Persist the path mapping so future lookups resolve without prompting (mirrors the deep-link flow)
	if (options.remoteUrl != null) {
		if (action === 'clone') {
			await container.repositoryLocator?.storeLocation(repo.uri.fsPath, options.remoteUrl);
		} else {
			// Only persist a picked folder if it actually has a matching remote, otherwise a wrong pick
			// would permanently map the remote url to an unrelated repository
			const [, domain, path] = parseGitRemoteUrl(options.remoteUrl);
			const remotes = await repo.git.remotes.getRemotes({ filter: r => r.matches(domain, path) });
			if (remotes.length) {
				await container.repositoryLocator?.storeLocation(repo.uri.fsPath, options.remoteUrl);
			}
		}
	}

	return repo;
}

/**
 * Prompts (standalone quick pick — do NOT use inside a quick-wizard flow, it collides with the
 * wizard's live picker) to locate or clone a repository, then adds and returns it.
 * Throws {@link CancellationError} on any user cancellation. Throws on web, since cloning or
 * locating a local repository isn't supported there.
 */
export async function promptToLocateOrCloneRepository(
	container: Container,
	options: { title: string; placeholder: string; name: string; remoteUrl?: string },
): Promise<GlRepository> {
	if (isWeb) throw new Error('Cloning or locating a local repository is not supported on the web');

	type OpenAction = 'clone' | 'folder';
	const items: (QuickPickItem & { action?: OpenAction })[] = [];
	// Only offer cloning when we have a usable remote url (mirrors the deep-link prompt)
	if (options.remoteUrl != null) {
		items.push({ label: 'Clone Repository...', action: 'clone' });
	}
	items.push({ label: 'Choose a Local Folder...', action: 'folder' });
	items.push(createQuickPickSeparator(), { label: 'Cancel' });

	const pick = await window.showQuickPick(items, {
		title: options.title,
		placeHolder: options.placeholder,
	});

	if (pick?.action == null) throw new CancellationError();

	return locateOrCloneRepository(container, pick.action, { name: options.name, remoteUrl: options.remoteUrl });
}
