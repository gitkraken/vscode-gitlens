import type { Disposable } from 'vscode';
import { Uri, window } from 'vscode';
import type { Container } from '../../container';
import { RemoteResourceType } from '../../git/models/remoteResource';
import type { Repository } from '../../git/models/repository';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser';
import type {
	GkProviderId,
	RepositoryIdentityDescriptor,
	RepositoryIdentityProviderDescriptor,
} from '../../gk/models/repositoryIdentities';
import { missingRepositoryId } from '../../gk/models/repositoryIdentities';
import { log } from '../../system/decorators/log';
import { getSettledValue } from '../../system/promise';
import type { ServerConnection } from '../gk/serverConnection';

export class RepositoryIdentityService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	@log()
	getRepository<T extends string | GkProviderId>(
		identity: RepositoryIdentityDescriptor<T>,
		options?: { openIfNeeded?: boolean; keepOpen?: boolean; prompt?: boolean; skipRefValidation?: boolean },
	): Promise<Repository | undefined> {
		return this.locateRepository(identity, options);
	}

	async getRepositoryIdentity<T extends string | GkProviderId>(
		repository: Repository,
	): Promise<RepositoryIdentityDescriptor<T>> {
		const [bestRemotePromise, initialCommitShaPromise] = await Promise.allSettled([
			this.container.git.getBestRemoteWithProvider(repository.uri),
			this.container.git.getFirstCommitSha(repository.uri),
		]);
		const bestRemote = getSettledValue(bestRemotePromise);

		return {
			name: repository.name,
			initialCommitSha: getSettledValue(initialCommitShaPromise),
			remote: bestRemote,
			provider: bestRemote?.provider?.providerDesc as RepositoryIdentityProviderDescriptor<T>,
		};
	}

	@log()
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
				? await this.container.repositoryPathMapping.getLocalRepoPaths({
						remoteUrl: identity.remote?.url,
						repoInfo:
							identity.provider != null
								? {
										provider: identity.provider.id,
										owner: identity.provider.repoDomain,
										repoName: identity.provider.repoName,
								  }
								: undefined,
				  })
				: [];

		let foundRepo: Repository | undefined;
		if (matches.length) {
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
					const matchingRemotes = await repo.git.getRemotes({
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
					if (await this.container.git.validateReference(repo.uri, identity.initialCommitSha)) {
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
				(await this.container.git.validateReference(locatedRepo.uri, identity.initialCommitSha))
			) {
				foundRepo = locatedRepo;
				await this.addRepositoryToPathMap(foundRepo, identity);
			}
		}

		return foundRepo;
	}

	async addRepositoryToPathMap<T extends string | GkProviderId>(
		repo: Repository,
		identity?: RepositoryIdentityDescriptor<T>,
	) {
		if (repo.virtual) return;

		const [identityResult, remotesResult] = await Promise.allSettled([
			identity == null ? this.getRepositoryIdentity<T>(repo) : undefined,
			repo.git.getRemotes(),
		]);

		identity ??= getSettledValue(identityResult);
		const remotes = getSettledValue(remotesResult) ?? [];

		const repoPath = repo.uri.fsPath;

		for (const remote of remotes) {
			const remoteUrl = remote.provider?.url({ type: RemoteResourceType.Repo });
			if (remoteUrl != null) {
				await this.container.repositoryPathMapping.writeLocalRepoPath({ remoteUrl: remoteUrl }, repoPath);
			}
		}

		if (
			identity?.provider?.id != null &&
			identity?.provider?.repoDomain != null &&
			identity?.provider?.repoName != null
		) {
			await this.container.repositoryPathMapping.writeLocalRepoPath(
				{
					repoInfo: {
						provider: identity.provider.id,
						owner: identity.provider.repoDomain,
						repoName: identity.provider.repoName,
					},
				},
				repoPath,
			);
		}
	}
}
