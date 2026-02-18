import type { Disposable } from 'vscode';
import { Uri, window } from 'vscode';
import type { Container } from '../../container.js';
import type {
	RepositoryLocationEntry,
	RepositoryLocationProvider,
} from '../../git/location/repositorylocationProvider.js';
import { RemoteResourceType } from '../../git/models/remoteResource.js';
import type { Repository } from '../../git/models/repository.js';
import type {
	GkProviderId,
	RepositoryIdentityDescriptor,
	RepositoryIdentityProviderDescriptor,
} from '../../git/models/repositoryIdentities.js';
import { missingRepositoryId } from '../../git/models/repositoryIdentities.js';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser.js';
import { debug } from '../../system/decorators/log.js';
import { getScopedLogger } from '../../system/logger.scope.js';
import { getSettledValue } from '../../system/promise.js';

export class RepositoryIdentityService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly locator: RepositoryLocationProvider | undefined,
	) {}

	dispose(): void {}

	@debug()
	getRepository<T extends string | GkProviderId>(
		identity: RepositoryIdentityDescriptor<T>,
		options?: { openIfNeeded?: boolean; keepOpen?: boolean; prompt?: boolean; skipRefValidation?: boolean },
	): Promise<Repository | undefined> {
		return this.locateRepository(identity, options);
	}

	@debug()
	async getRepositoryIdentity<T extends string | GkProviderId>(
		repository: Repository,
	): Promise<RepositoryIdentityDescriptor<T>> {
		const [bestRemotePromise, initialCommitShaPromise] = await Promise.allSettled([
			repository.git.remotes.getBestRemoteWithProvider(),
			repository.git.commits.getInitialCommitSha?.(),
		]);
		const bestRemote = getSettledValue(bestRemotePromise);

		return {
			name: repository.name,
			initialCommitSha: getSettledValue(initialCommitShaPromise),
			remote: bestRemote,
			provider: bestRemote?.provider?.providerDesc as RepositoryIdentityProviderDescriptor<T>,
		};
	}

	@debug()
	private async locateRepository<T extends string | GkProviderId>(
		identity: RepositoryIdentityDescriptor<T>,
		options?: { openIfNeeded?: boolean; keepOpen?: boolean; prompt?: boolean; skipRefValidation?: boolean },
	): Promise<Repository | undefined> {
		const hasInitialCommitSha =
			identity.initialCommitSha != null && identity.initialCommitSha !== missingRepositoryId;
		const hasRemoteUrl = identity?.remote?.url != null;
		const hasProviderInfo =
			identity.provider?.id != null && identity.provider.repoDomain != null && identity.provider.repoName != null;

		if (!hasInitialCommitSha && !hasRemoteUrl && !hasProviderInfo) {
			return undefined;
		}

		const matches =
			hasRemoteUrl || hasProviderInfo
				? await this.locator?.getLocation(
						identity.remote?.url,
						identity.provider != null
							? {
									provider: identity.provider.id,
									owner: identity.provider.repoDomain,
									repoName: identity.provider.repoName,
								}
							: undefined,
					)
				: [];

		let foundRepo: Repository | undefined;
		if (matches?.length) {
			for (const match of matches) {
				const repo = this.container.git.getRepository(Uri.file(match));
				if (repo != null) {
					foundRepo = repo;
					break;
				}
			}

			if (foundRepo == null && options?.openIfNeeded) {
				foundRepo = await this.container.git.getOrOpenRepository(Uri.file(matches[0]), {
					closeOnOpen: !options?.keepOpen,
				});
			}
		} else {
			const [, remoteDomain, remotePath] =
				identity.remote?.url != null ? parseGitRemoteUrl(identity.remote.url) : [];

			// Try to match a repo using the remote URL first, since that saves us some steps.
			// As a fallback, try to match using the repo id.
			for (const repo of this.container.git.repositories) {
				if (remoteDomain != null && remotePath != null) {
					const matchingRemotes = await repo.git.remotes.getRemotes({
						filter: r => r.matches(remoteDomain, remotePath),
					});
					if (matchingRemotes.length > 0) {
						foundRepo = repo;
						break;
					}
				}

				if (!options?.skipRefValidation && hasInitialCommitSha) {
					// Repo ID can be any valid SHA in the repo, though standard practice is to use the
					// first commit SHA.
					if (await repo.git.refs.isValidReference(identity.initialCommitSha)) {
						foundRepo = repo;
						break;
					}
				}
			}
		}

		if (foundRepo == null && options?.prompt) {
			const locate = { title: 'Locate Repository' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const decision = await window.showInformationMessage(
				`Unable to find a repository for '${identity.name}'.\nWould you like to locate it?`,
				{ modal: true },
				locate,
				cancel,
			);

			if (decision !== locate) return undefined;

			const repoLocatedUri = (
				await window.showOpenDialog({
					title: `Choose a location for ${identity.name}`,
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
				})
			)?.[0];

			if (repoLocatedUri == null) return undefined;

			const locatedRepo = await this.container.git.getOrOpenRepository(repoLocatedUri, {
				closeOnOpen: !options?.keepOpen,
				detectNested: false,
			});

			if (locatedRepo == null) return undefined;
			if (
				identity.initialCommitSha == null ||
				(await locatedRepo.git.refs.isValidReference(identity.initialCommitSha))
			) {
				foundRepo = locatedRepo;
				await this.storeRepositoryLocation(foundRepo, identity);
			}
		}

		return foundRepo;
	}

	@debug({ args: (repo: Repository) => ({ repo: repo.id }) })
	async storeRepositoryLocation<T extends string | GkProviderId>(
		repo: Repository,
		identity?: RepositoryIdentityDescriptor<T>,
	): Promise<void> {
		if (repo.virtual || this.locator == null) return;

		const [identityResult, remotesResult] = await Promise.allSettled([
			identity == null ? this.getRepositoryIdentity<T>(repo) : undefined,
			repo.git.remotes.getRemotes(),
		]);

		identity ??= getSettledValue(identityResult);
		const remotes = getSettledValue(remotesResult) ?? [];

		const repoPath = repo.uri.fsPath;

		for (const remote of remotes) {
			const remoteUrl = await remote.provider?.url({ type: RemoteResourceType.Repo });
			if (remoteUrl != null) {
				await this.locator.storeLocation(repoPath, remoteUrl);
			}
		}

		if (
			identity?.provider?.id != null &&
			identity?.provider?.repoDomain != null &&
			identity?.provider?.repoName != null
		) {
			await this.locator.storeLocation(repoPath, undefined, {
				provider: identity.provider.id,
				owner: identity.provider.repoDomain,
				repoName: identity.provider.repoName,
			});
		}
	}

	@debug({ args: repos => ({ repos: repos.length }) })
	async storeRepositoryLocations(repos: Repository[]): Promise<void> {
		if (!repos.length || this.locator == null) return;

		const scope = getScopedLogger();

		// Use batched method if available, otherwise fall back to sequential
		if (this.locator.storeLocations == null) {
			for (const repo of repos) {
				try {
					await this.storeRepositoryLocation(repo);
				} catch (ex) {
					scope?.error(ex);
				}
			}
			return;
		}

		// Gather all identity/remote info for all repos in parallel
		const repoDataPromises = repos
			.filter(repo => !repo.virtual)
			.map(async repo => {
				const [identityResult, remotesResult] = await Promise.allSettled([
					this.getRepositoryIdentity(repo),
					repo.git.remotes.getRemotes(),
				]);

				const identity = getSettledValue(identityResult);
				const remotes = getSettledValue(remotesResult) ?? [];

				return { repo: repo, identity: identity, remotes: remotes };
			});

		const repoDataResults = await Promise.allSettled(repoDataPromises);

		// Build batch of location entries
		const entries: RepositoryLocationEntry[] = [];

		for (const result of repoDataResults) {
			if (result.status !== 'fulfilled') continue;

			const { repo, identity, remotes } = result.value;
			const repoPath = repo.uri.fsPath;

			// Collect remote URLs in parallel
			const remoteUrlPromises = remotes.map(async remote => {
				try {
					return await remote.provider?.url({ type: RemoteResourceType.Repo });
				} catch {
					return undefined;
				}
			});

			const remoteUrls = await Promise.all(remoteUrlPromises);

			// Add entries for each remote URL
			for (const remoteUrl of remoteUrls) {
				if (remoteUrl != null) {
					entries.push({ path: repoPath, remoteUrl: remoteUrl, repoInfo: undefined });
				}
			}

			// Add entry for provider identity if available
			if (
				identity?.provider?.id != null &&
				identity?.provider?.repoDomain != null &&
				identity?.provider?.repoName != null
			) {
				entries.push({
					path: repoPath,
					remoteUrl: undefined,
					repoInfo: {
						provider: identity.provider.id,
						owner: identity.provider.repoDomain,
						repoName: identity.provider.repoName,
					},
				});
			}
		}

		// Store all locations in a single batched call
		if (entries.length) {
			try {
				await this.locator.storeLocations(entries);
			} catch (ex) {
				scope?.error(ex);
			}
		}
	}
}
