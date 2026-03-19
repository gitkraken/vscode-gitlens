import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import { getPseudoCommits } from '@gitlens/git/utils/statusFile.utils.js';
import type { Container } from '../../../container.js';

export {
	getPseudoCommits,
	getStatusFilePseudoCommits,
	getStatusFilePseudoFileChanges,
} from '@gitlens/git/utils/statusFile.utils.js';

export async function getPseudoCommitsWithStats(
	container: Container,
	files: GitStatusFile[] | undefined,
	filteredPath: string | undefined,
	user: GitUser | undefined,
): Promise<GitCommit[]> {
	const pseudoCommits = getPseudoCommits(files, filteredPath, user);
	if (!pseudoCommits.length) return pseudoCommits;

	const diffSvc = container.git.getRepositoryService(pseudoCommits[0].repoPath).diff;

	const commits: GitCommit[] = [];

	for (const commit of pseudoCommits) {
		commits.push(
			commit.with({
				stats: await diffSvc.getChangedFilesCount(commit.sha, 'HEAD', {
					uris: commit.anyFiles?.map(f => f.uri),
				}),
			}),
		);
	}

	return commits;
}
