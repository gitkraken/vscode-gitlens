import type { QuickPickItem } from 'vscode';
import { l10n, ProgressLocation, Uri, window } from 'vscode';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { millisecondsPerDay } from '@gitlens/git/utils/fetch.utils.js';
import { getIntegrationIdForRemote } from '@gitlens/integrations/utils/integration.utils.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { map } from '@gitlens/utils/iterable.js';
import { areUrisEqual } from '@gitlens/utils/uri.js';
import type { Container } from '../../../container.js';
import { getPresentableErrorMessage } from '../../../errors.js';
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
	// Truthiness, not `!= null`: providers that can't supply a clone url emit an empty string rather than
	// omitting the field (e.g. `PullRequestRef.url` in the provider-api mapper), and `git clone ""` fails
	const remoteUrl = options.remoteUrl || undefined;

	let uri: Uri;
	if (action === 'clone') {
		if (remoteUrl == null) throw new Error('Missing remote url');

		const folder = await pickFolder(l10n.t('Choose a folder to clone the repository to'));

		let clonePath: string | undefined;
		try {
			clonePath = await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: l10n.t('Cloning {name}...', { name: options.name }),
				},
				() => container.git.clone(remoteUrl, folder.fsPath),
			);
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;
			throw new Error(l10n.t('Unable to clone repository: {error}', { error: getPresentableErrorMessage(ex) }), {
				cause: ex,
			});
		}

		if (!clonePath) throw new Error(l10n.t('Unable to clone repository'));

		uri = Uri.file(clonePath);
	} else {
		uri = await pickFolder(l10n.t('Choose the folder containing the repository'));
	}

	const repo = await container.git.getOrAddRepository(uri, { opened: false, detectNested: false });
	if (repo == null) {
		throw new Error(l10n.t('Unable to find a repository in the chosen folder for {name}', { name: options.name }));
	}

	// Persist the path mapping so future lookups resolve without prompting (mirrors the deep-link flow).
	// A cloned repo is known-good; only persist a picked folder if it actually has a matching remote,
	// otherwise a wrong pick would permanently map the remote url to an unrelated repository.
	if (remoteUrl != null) {
		const trusted =
			action === 'clone' ||
			(await repo.git.remotes.getRemotes({ filter: r => r.matches(remoteUrl) })).length !== 0;
		if (trusted) {
			await container.repositoryLocator?.storeLocation(repo.uri.fsPath, remoteUrl);
		} else {
			// `action === 'folder'` here (a `clone` action always makes `trusted` true above). A mismatch
			// alone isn't proof this is the wrong repository — `r.matches` can't normalize every valid
			// remote form (e.g. an SSH config host alias) — so confirm rather than hard-rejecting what
			// could still be a legitimate pick. Callers (e.g. Start Review) act on the returned repo by
			// creating branches/worktrees in it, so an unconfirmed mismatch must not pass through silently.
			const confirm = l10n.t('Use Folder');
			const chosen = await window.showWarningMessage(
				l10n.t('The chosen folder does not appear to be a clone of {name}. Use it anyway?', {
					name: options.name,
				}),
				{ modal: true },
				confirm,
			);

			if (chosen !== confirm) throw new CancellationError();
		}
	}

	return repo;
}

/**
 * Prompts (standalone quick pick — do NOT use inside a quick-wizard flow, it collides with the
 * wizard's live picker) to locate or clone a repository, then adds and returns it.
 * Throws {@link CancellationError} on any user cancellation.
 */
export async function promptToLocateOrCloneRepository(
	container: Container,
	options: { title: string; placeholder: string; name: string; remoteUrl?: string },
): Promise<GlRepository> {
	type OpenAction = 'clone' | 'folder';
	const items: (QuickPickItem & { action?: OpenAction })[] = [];
	// Only offer cloning when we have a usable remote url (mirrors the deep-link prompt) — truthiness,
	// since a provider that can't supply one emits an empty string rather than omitting the field
	if (options.remoteUrl) {
		items.push({ label: l10n.t('Clone Repository...'), action: 'clone' });
	}
	items.push({ label: l10n.t('Choose a Local Folder...'), action: 'folder' });
	items.push(createQuickPickSeparator(), { label: l10n.t('Cancel') });

	const pick = await window.showQuickPick(items, {
		title: options.title,
		placeHolder: options.placeholder,
	});

	if (pick?.action == null) throw new CancellationError();

	return locateOrCloneRepository(container, pick.action, { name: options.name, remoteUrl: options.remoteUrl });
}
