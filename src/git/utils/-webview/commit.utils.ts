import type { Container } from '../../../container.js';
import type { GitCommitFileset, GitCommitStats } from '../../models/commit.js';
import { GitCommit, GitCommitIdentity } from '../../models/commit.js';
import { uncommittedStaged } from '../../models/revision.js';
import type { GitUser } from '../../models/user.js';

export function createUncommittedChangesCommit(
	container: Container,
	repoPath: string,
	sha: string,
	now: Date,
	user: GitUser | undefined,
	options?: {
		fileset?: GitCommitFileset;
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
		options?.fileset,
		options?.stats,
		[],
	);
}
