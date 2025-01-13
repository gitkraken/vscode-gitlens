import type { Container } from '../../../../../container';
import type { GitCache } from '../../../../../git/cache';
import type { GitContributorsSubProvider } from '../../../../../git/gitProvider';
import type { GitContributorStats } from '../../../../../git/models/contributor';
import { GitContributor } from '../../../../../git/models/contributor';
import { isUserMatch } from '../../../../../git/models/user';
import { log } from '../../../../../system/decorators/log';
import { Logger } from '../../../../../system/logger';
import { getLogScope } from '../../../../../system/logger.scope';
import type { GitHubGitProviderInternal } from '../githubGitProvider';

export class ContributorsGitSubProvider implements GitContributorsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@log()
	async getContributors(
		repoPath: string,
		_options?: { all?: boolean; merges?: boolean | 'first-parent'; ref?: string; stats?: boolean },
	): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const results = await github.getContributors(session.accessToken, metadata.repo.owner, metadata.repo.name);
			const currentUser = await this.provider.getCurrentUser(repoPath);

			const contributors = [];
			for (const c of results) {
				if (c.type !== 'User') continue;

				contributors.push(
					new GitContributor(
						repoPath,
						c.name,
						c.email,
						c.contributions,
						undefined,
						undefined,
						isUserMatch(currentUser, c.name, c.email, c.login),
						undefined,
						c.login,
						c.avatar_url,
						c.node_id,
					),
				);
			}

			return contributors;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return [];
		}
	}

	@log()
	async getContributorsStats(
		repoPath: string,
		_options?: { merges?: boolean; since?: string },
	): Promise<GitContributorStats | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const results = await github.getContributors(session.accessToken, metadata.repo.owner, metadata.repo.name);

			const contributions = results.map(c => c.contributions).sort((a, b) => b - a);

			const result: GitContributorStats = {
				count: contributions.length,
				contributions: contributions,
			};
			return result;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}
}
