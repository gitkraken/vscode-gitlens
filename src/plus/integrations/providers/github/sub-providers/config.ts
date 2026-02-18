import type { Container } from '../../../../../container.js';
import type { GitCache } from '../../../../../git/cache.js';
import type { GitConfigSubProvider } from '../../../../../git/gitProvider.js';
import type { GitUser } from '../../../../../git/models/user.js';
import { gate } from '../../../../../system/decorators/gate.js';
import { debug } from '../../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../../system/logger.scope.js';
import { toTokenWithInfo } from '../../../authentication/models.js';
import type { GitHubGitProviderInternal } from '../githubGitProvider.js';

export class ConfigGitSubProvider implements GitConfigSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@gate()
	@debug()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		if (!repoPath) return undefined;

		const scope = getScopedLogger();

		const cached = this.cache.currentUser.get(repoPath);
		if (cached != null) return cached;
		// If we found null, user data was not found - don't bother trying again
		if (cached === null) return undefined;

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);
			const user = await github.getCurrentUser(
				toTokenWithInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
			);

			this.cache.currentUser.set(repoPath, user ?? null);
			return user;
		} catch (ex) {
			scope?.error(ex);
			debugger;

			// Mark it so we won't bother trying again
			this.cache.currentUser.set(repoPath, null);
			return undefined;
		}
	}
}
