import type { Container } from '../../../../../container';
import type { GitStatusSubProvider } from '../../../../../git/gitProvider';
import { GitStatus } from '../../../../../git/models/status';
import { gate } from '../../../../../system/decorators/gate';
import { log } from '../../../../../system/decorators/log';
import { HeadType } from '../../../../remotehub';
import type { GitHubGitProviderInternal } from '../githubGitProvider';

export class StatusGitSubProvider implements GitStatusSubProvider {
	constructor(
		private readonly container: Container,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@gate()
	@log()
	async getStatus(repoPath: string | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const context = await this.provider.ensureRepositoryContext(repoPath);
		if (context == null) return undefined;

		const revision = await context.metadata.getRevision();
		if (revision == null) return undefined;

		return new GitStatus(
			repoPath,
			revision.name,
			revision.revision,
			[],
			{ ahead: 0, behind: 0 },
			revision.type === HeadType.Branch || revision.type === HeadType.RemoteBranch
				? { name: `origin/${revision.name}`, missing: false }
				: undefined,
		);
	}
}
