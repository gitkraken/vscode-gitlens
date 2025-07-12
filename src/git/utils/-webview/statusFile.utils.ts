import type { Container } from '../../../container';
import type { GitCommit } from '../../models/commit';
import { GitFileChange } from '../../models/fileChange';
import { uncommitted, uncommittedStaged } from '../../models/revision';
import type { GitStatusFile } from '../../models/statusFile';
import type { GitUser } from '../../models/user';
import { createUncommittedChangesCommit } from './commit.utils';

export function getPseudoCommits(
	container: Container,
	files: GitStatusFile[] | undefined,
	filteredPath: string | undefined,
	user: GitUser | undefined,
): GitCommit[] {
	if (!files?.length) return [];

	let now = new Date();
	const repoPath = files[0].repoPath;

	let conflicted: GitFileChange[] | undefined;
	let staged: GitFileChange[] | undefined;
	let wip: GitFileChange[] | undefined;

	for (const file of files) {
		if (file.conflicted) {
			conflicted ??= [];
			conflicted.push(
				new GitFileChange(
					container,
					repoPath,
					file.path,
					file.status,
					file.originalPath,
					'HEAD',
					undefined,
					false,
				),
			);
		} else {
			if (file.wip) {
				wip ??= [];
				wip.push(
					new GitFileChange(
						container,
						repoPath,
						file.path,
						file.workingTreeStatus ?? file.status,
						file.originalPath,
						file.staged ? uncommittedStaged : 'HEAD',
						undefined,
						false,
					),
				);
			}

			if (file.staged) {
				staged ??= [];
				staged.push(
					new GitFileChange(
						container,
						repoPath,
						file.path,
						file.indexStatus ?? file.status,
						file.originalPath,
						'HEAD',
						undefined,
						true,
					),
				);
			}
		}
	}

	const commits: GitCommit[] = [];

	if (conflicted?.length || wip?.length) {
		const conflictedAndWipFiles = [...(conflicted ?? []), ...(wip ?? [])];
		commits.push(
			createUncommittedChangesCommit(container, repoPath, uncommitted, now, user, {
				fileset: filteredPath
					? { files: undefined, filtered: { files: conflictedAndWipFiles, pathspec: filteredPath } }
					: { files: conflictedAndWipFiles },
				parents: [staged?.length ? uncommittedStaged : 'HEAD'],
			}),
		);

		// Decrements the date to guarantee the staged entry (if exists) will be sorted before the working entry (most recent first)
		now = new Date(now.getTime() - 60000);
	}

	if (staged?.length) {
		commits.push(
			createUncommittedChangesCommit(container, repoPath, uncommittedStaged, now, user, {
				fileset: filteredPath
					? { files: undefined, filtered: { files: staged, pathspec: filteredPath } }
					: { files: staged },
				parents: ['HEAD'],
			}),
		);
	}

	return commits;
}

export async function getPseudoCommitsWithStats(
	container: Container,
	files: GitStatusFile[] | undefined,
	filteredPath: string | undefined,
	user: GitUser | undefined,
): Promise<GitCommit[]> {
	const pseudoCommits = getPseudoCommits(container, files, filteredPath, user);
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
