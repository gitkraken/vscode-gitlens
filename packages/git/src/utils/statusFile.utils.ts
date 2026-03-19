import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, joinUriPath } from '@gitlens/utils/uri.js';
import type { GitCommit } from '../models/commit.js';
import { GitFileChange } from '../models/fileChange.js';
import { uncommitted, uncommittedStaged } from '../models/revision.js';
import type { GitStatusFile } from '../models/statusFile.js';
import type { GitUser } from '../models/user.js';
import { createUncommittedChangesCommit } from './commit.utils.js';

export function getPseudoCommits(
	files: GitStatusFile[] | undefined,
	filteredPath: string | undefined,
	user: GitUser | undefined,
): GitCommit[] {
	if (!files?.length) return [];

	let now = new Date();
	const repoPath = files[0].repoPath;
	const repoUri = fileUri(normalizePath(repoPath));

	let conflicted: GitFileChange[] | undefined;
	let staged: GitFileChange[] | undefined;
	let wip: GitFileChange[] | undefined;

	for (const file of files) {
		const mode = file.submodule != null ? '160000' : undefined;
		const originalUri =
			file.originalPath != null ? joinUriPath(repoUri, normalizePath(file.originalPath)) : undefined;

		if (file.conflicted) {
			conflicted ??= [];
			conflicted.push(
				new GitFileChange(
					repoPath,
					file.path,
					file.status,
					file.uri,
					file.originalPath,
					originalUri,
					'HEAD',
					undefined,
					false,
					undefined,
					mode,
					file.submodule,
				),
			);
		} else {
			if (file.wip) {
				wip ??= [];
				wip.push(
					new GitFileChange(
						repoPath,
						file.path,
						file.workingTreeStatus ?? file.status,
						file.uri,
						file.originalPath,
						originalUri,
						file.staged ? uncommittedStaged : 'HEAD',
						undefined,
						false,
						undefined,
						mode,
						file.submodule,
					),
				);
			}

			if (file.staged) {
				staged ??= [];
				staged.push(
					new GitFileChange(
						repoPath,
						file.path,
						file.indexStatus ?? file.status,
						file.uri,
						file.originalPath,
						originalUri,
						'HEAD',
						undefined,
						true,
						undefined,
						mode,
						file.submodule,
					),
				);
			}
		}
	}

	const commits: GitCommit[] = [];

	if (conflicted?.length || wip?.length) {
		const conflictedAndWipFiles = [...(conflicted ?? []), ...(wip ?? [])];
		commits.push(
			createUncommittedChangesCommit(repoPath, uncommitted, now, user, {
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
			createUncommittedChangesCommit(repoPath, uncommittedStaged, now, user, {
				fileset: filteredPath
					? { files: undefined, filtered: { files: staged, pathspec: filteredPath } }
					: { files: staged },
				parents: ['HEAD'],
			}),
		);
	}

	return commits;
}

export function getStatusFilePseudoCommits(file: GitStatusFile, user: GitUser | undefined): GitCommit[] {
	return getPseudoCommits([file], file.path, user);
}

export function getStatusFilePseudoFileChanges(file: GitStatusFile): GitFileChange[] {
	const repoUri = fileUri(normalizePath(file.repoPath));
	const originalUri = file.originalPath != null ? joinUriPath(repoUri, normalizePath(file.originalPath)) : undefined;

	if (file.conflicted) {
		return [
			new GitFileChange(
				file.repoPath,
				file.path,
				file.status,
				file.uri,
				file.originalPath,
				originalUri,
				'HEAD',
				undefined,
				false,
			),
		];
	}

	const files: GitFileChange[] = [];
	const staged = file.staged;

	if (file.wip) {
		files.push(
			new GitFileChange(
				file.repoPath,
				file.path,
				file.status,
				file.uri,
				file.originalPath,
				originalUri,
				staged ? uncommittedStaged : 'HEAD',
				undefined,
				false,
			),
		);
	}

	if (staged) {
		files.push(
			new GitFileChange(
				file.repoPath,
				file.path,
				file.status,
				file.uri,
				file.originalPath,
				originalUri,
				'HEAD',
				undefined,
				true,
			),
		);
	}

	return files;
}
