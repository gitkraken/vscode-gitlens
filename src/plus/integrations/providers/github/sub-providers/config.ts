import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type { GitConfigSubProvider } from '../../../../../git/gitProvider';
import type { GitUser } from '../../../../../git/models/user';
import { gate } from '../../../../../system/decorators/gate';
import { log } from '../../../../../system/decorators/log';
import { Logger } from '../../../../../system/logger';
import { getLogScope } from '../../../../../system/logger.scope';
import type { GitHubGitProviderInternal } from '../githubGitProvider';

export class ConfigGitSubProvider implements GitConfigSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@gate()
	@log()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		if (!repoPath) return undefined;

		const scope = getLogScope();

		const repo = this.cache.repoInfo.get(repoPath);

		let user = repo?.user;
		if (user != null) return user;
		// If we found the repo, but no user data was found just return
		if (user === null) return undefined;

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);
			user = await github.getCurrentUser(session.accessToken, metadata.repo.owner, metadata.repo.name);

			this.cache.repoInfo.set(repoPath, { ...repo, user: user ?? null });
			return user;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			// Mark it so we won't bother trying again
			this.cache.repoInfo.set(repoPath, { ...repo, user: null });
			return undefined;
		}
	}
}
