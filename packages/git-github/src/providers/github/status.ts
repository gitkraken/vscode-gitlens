import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitConflictFile } from '@gitlens/git/models/staging.js';
import { GitStatus } from '@gitlens/git/models/status.js';
import type { GitStatusSubProvider, GitWorkingChangesState } from '@gitlens/git/providers/status.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { HeadType } from '../../context.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

export class StatusGitSubProvider implements GitStatusSubProvider {
	constructor(private readonly provider: GitHubGitProviderInternal) {}

	@gate()
	@debug()
	async getStatus(repoPath: string | undefined, _cancellation?: AbortSignal): Promise<GitStatus | undefined> {
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
			revision.type === HeadType.Branch || revision.type === HeadType.RemoteBranch
				? { name: `origin/${revision.name}`, missing: false, state: { ahead: 0, behind: 0 } }
				: undefined,
		);
	}

	hasWorkingChanges(
		_repoPath: string,
		_options?: {
			staged?: boolean;
			unstaged?: boolean;
			untracked?: boolean;
			throwOnError?: boolean;
		},
		_cancellation?: AbortSignal,
	): Promise<boolean> {
		return Promise.resolve(false);
	}

	getWorkingChangesState(_repoPath: string, _cancellation?: AbortSignal): Promise<GitWorkingChangesState> {
		return Promise.resolve({ staged: false, unstaged: false, untracked: false });
	}

	hasConflictingFiles(_repoPath: string, _cancellation?: AbortSignal): Promise<boolean> {
		return Promise.resolve(false);
	}

	getConflictingFiles(_repoPath: string, _cancellation?: AbortSignal): Promise<GitConflictFile[]> {
		return Promise.resolve([]);
	}

	getUntrackedFiles(_repoPath: string, _cancellation?: AbortSignal): Promise<GitFile[]> {
		return Promise.resolve([]);
	}
}
