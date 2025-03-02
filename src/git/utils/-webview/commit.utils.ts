import type { Container } from '../../../container';
import type { GitCommitStats } from '../../models/commit';
import { GitCommit, GitCommitIdentity } from '../../models/commit';
import type { GitFileChange } from '../../models/fileChange';
import { uncommittedStaged } from '../../models/revision';
import type { GitUser } from '../../models/user';

export function createUncommittedChangesCommit(
	container: Container,
	repoPath: string,
	sha: string,
	now: Date,
	user: GitUser | undefined,
	options?: {
		files?: GitFileChange | GitFileChange[] | { file?: GitFileChange; files?: GitFileChange[] } | undefined;
		parents?: string[];
		stats?: GitCommitStats;
	},
): GitCommit {
	return new GitCommit(
		container,
		repoPath,
		sha,
		new GitCommitIdentity('You', user?.email ?? undefined, now),
		new GitCommitIdentity('You', user?.email ?? undefined, now),
		'Uncommitted changes',
		options?.parents ?? (sha === uncommittedStaged ? ['HEAD'] : []),
		'Uncommitted changes',
		options?.files,
		options?.stats,
		[],
	);
}
