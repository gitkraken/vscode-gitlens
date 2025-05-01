import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../../container';
import type { GitStatusSubProvider } from '../../../../../git/gitProvider';
import { GitStatus } from '../../../../../git/models/status';
import { gate } from '../../../../../system/decorators/-webview/gate';
import { log } from '../../../../../system/decorators/log';
import { HeadType } from '../../../../remotehub';
import type { GitHubGitProviderInternal } from '../githubGitProvider';

export class StatusGitSubProvider implements GitStatusSubProvider {
	constructor(
		private readonly container: Container,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@gate<StatusGitSubProvider['getStatus']>(rp => rp ?? '')
	@log()
	async getStatus(repoPath: string | undefined, _cancellation?: CancellationToken): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const context = await this.provider.ensureRepositoryContext(repoPath);
		if (context == null) return undefined;

		const revision = await context.metadata.getRevision();
		if (revision == null) return undefined;

		return new GitStatus(
			this.container,
			repoPath,
			revision.name,
			revision.revision,
			[],
			revision.type === HeadType.Branch || revision.type === HeadType.RemoteBranch
				? { name: `origin/${revision.name}`, missing: false, state: { ahead: 0, behind: 0 } }
				: undefined,
		);
	}
}
