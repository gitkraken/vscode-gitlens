import type { GitCommit, GitCommitStats, GitCommitWithFullDetails } from '../models/commit';
import type { GitReference } from '../models/reference';

export function assertsCommitHasFullDetails(commit: GitCommit): asserts commit is GitCommitWithFullDetails {
	if (!commit.hasFullDetails()) {
		throw new Error(`GitCommit(${commit.sha}) is not fully loaded`);
	}
}

export function getChangedFilesCount(changedFiles: GitCommitStats['files'] | undefined): number {
	if (changedFiles == null) return 0;

	return typeof changedFiles === 'number'
		? changedFiles
		: changedFiles.added + changedFiles.changed + changedFiles.deleted;
}

export function isOfCommitOrStashRefType(commit: GitReference | undefined): boolean {
	return commit?.refType === 'revision' || commit?.refType === 'stash';
}

/**
 * use `\n` symbol is presented to split commit message to description and title
 */
export function splitCommitMessage(commitMessage?: string): { summary: string; body?: string } {
	if (!commitMessage) return { summary: '' };

	const message = commitMessage.trim();
	const index = message.indexOf('\n');
	if (index < 0) return { summary: message };

	return {
		summary: message.substring(0, index),
		body: message.substring(index + 1).trim(),
	};
}
