import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../../container';
import type { GitStatusSubProvider, GitWorkingChangesState } from '../../../../../git/gitProvider';
import type { GitConflictFile } from '../../../../../git/models';
import type { GitFile } from '../../../../../git/models/file';
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

	hasWorkingChanges(): Promise<boolean> {
		return Promise.resolve(false);
	}

	getWorkingChangesState(): Promise<GitWorkingChangesState> {
		return Promise.resolve({ staged: false, unstaged: false, untracked: false });
	}

	hasConflictingFiles(): Promise<boolean> {
		return Promise.resolve(false);
	}

	getConflictingFiles(): Promise<GitConflictFile[]> {
		return Promise.resolve([]);
	}

	getUntrackedFiles(): Promise<GitFile[]> {
		return Promise.resolve([]);
	}
}
