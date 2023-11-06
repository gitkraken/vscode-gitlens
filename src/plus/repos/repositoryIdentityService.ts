import type { Disposable } from 'vscode';
import { Uri } from 'vscode';
import type { Container } from '../../container';
import { shortenRevision } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser';
import { getRemoteProviderMatcher } from '../../git/remotes/remoteProviders';
import type {
	GkRepositoryId,
	RepositoryIdentity,
	RepositoryIdentityResponse,
} from '../../gk/models/repositoryIdentities';
import { missingRepositoryId } from '../../gk/models/repositoryIdentities';
import { log } from '../../system/decorators/log';
import type { ServerConnection } from '../gk/serverConnection';

export class RepositoryIdentityService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	getRepository(id: GkRepositoryId, options?: { openIfNeeded?: boolean }): Promise<Repository | undefined>;
	getRepository(identity: RepositoryIdentity, options?: { openIfNeeded?: boolean }): Promise<Repository | undefined>;

	@log()
	getRepository(
		idOrIdentity: GkRepositoryId | RepositoryIdentity,
		options?: { openIfNeeded?: boolean },
	): Promise<Repository | undefined> {
		return this.locateRepository(idOrIdentity, options);
	}

	@log()
	async getRepositoryOrIdentity(
		id: GkRepositoryId,
		options?: { openIfNeeded?: boolean },
	): Promise<Repository | RepositoryIdentity> {
		const identity = await this.getRepositoryIdentity(id);
		return (await this.locateRepository(identity, options)) ?? identity;
	}

	private async locateRepository(
		id: GkRepositoryId,
		options?: { openIfNeeded?: boolean },
	): Promise<Repository | undefined>;
	private async locateRepository(
		identity: RepositoryIdentity,
		options?: { openIfNeeded?: boolean },
	): Promise<Repository | undefined>;
	private async locateRepository(
		idOrIdentity: GkRepositoryId | RepositoryIdentity,
		options?: { openIfNeeded?: boolean },
	): Promise<Repository | undefined>;
	@log()
	private async locateRepository(
		idOrIdentity: GkRepositoryId | RepositoryIdentity,
		options?: { openIfNeeded?: boolean },
	): Promise<Repository | undefined> {
		const identity =
			typeof idOrIdentity === 'string' ? await this.getRepositoryIdentity(idOrIdentity) : idOrIdentity;

		const matches = await this.container.repositoryPathMapping.getLocalRepoPaths({
			remoteUrl: identity.remote?.url,
			repoInfo:
				identity.provider != null
					? {
							provider: identity.provider.id,
							owner: identity.provider.repoDomain,
							repoName: identity.provider.repoName,
					  }
					: undefined,
		});

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
				foundRepo = await this.container.git.getOrOpenRepository(Uri.file(matches[0]), { closeOnOpen: true });
			}

			return foundRepo;
		}

		const [, remoteDomain, remotePath] = identity.remote?.url != null ? parseGitRemoteUrl(identity.remote.url) : [];

		// Try to match a repo using the remote URL first, since that saves us some steps.
		// As a fallback, try to match using the repo id.
		for (const repo of this.container.git.repositories) {
			if (remoteDomain != null && remotePath != null) {
				const matchingRemotes = await repo.getRemotes({
					filter: r => r.matches(remoteDomain, remotePath),
				});
				if (matchingRemotes.length > 0) {
					foundRepo = repo;
					break;
				}
			}

			if (identity.initialCommitSha != null && identity.initialCommitSha !== missingRepositoryId) {
				// Repo ID can be any valid SHA in the repo, though standard practice is to use the
				// first commit SHA.
				if (await this.container.git.validateReference(repo.uri, identity.initialCommitSha)) {
					foundRepo = repo;
					break;
				}
			}
		}

		return foundRepo;
	}

	@log()
	async getRepositoryIdentity(id: GkRepositoryId): Promise<RepositoryIdentity> {
		type Result = { data: RepositoryIdentityResponse };

		const rsp = await this.connection.fetchGkDevApi(`/v1/git-repositories/${id}`, { method: 'GET' });
		const data = ((await rsp.json()) as Result).data;

		let name: string;
		if ('name' in data && typeof data.name === 'string') {
			name = data.name;
		} else if (data.provider?.repoName != null) {
			name = data.provider.repoName;
		} else if (data.remote?.url != null && data.remote?.domain != null && data.remote?.path != null) {
			const matcher = getRemoteProviderMatcher(this.container);
			const provider = matcher(data.remote.url, data.remote.domain, data.remote.path);
			name = provider?.repoName ?? data.remote.path;
		} else {
			name =
				data.remote?.path ??
				`Unknown ${data.initialCommitSha ? ` (${shortenRevision(data.initialCommitSha)})` : ''}`;
		}

		return {
			id: data.id,
			createdAt: new Date(data.createdAt),
			updatedAt: new Date(data.updatedAt),
			name: name,
			initialCommitSha: data.initialCommitSha,
			remote: data.remote,
			provider: data.provider,
		};
	}
}
