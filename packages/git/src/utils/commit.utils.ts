import type { GitCommitFileset, GitCommitStats, GitCommitWithFullDetails } from '../models/commit.js';
import { GitCommit, GitCommitIdentity } from '../models/commit.js';
import type { GitReference } from '../models/reference.js';
import { uncommittedStaged } from '../models/revision.js';
import type { GitUser } from '../models/user.js';

export type CurrentUserNameStyle = 'you' | 'name' | 'nameAndYou';

export function formatCurrentUserDisplayName(name: string, style: CurrentUserNameStyle): string {
	switch (style) {
		case 'name':
			return name;
		case 'nameAndYou':
			if (name === 'You' || name.endsWith(' (you)')) {
				debugger;
				return name;
			}
			return name ? `${name} (you)` : 'You';
		case 'you':
		default:
			return 'You';
	}
}

export function formatIdentityDisplayName(
	identity: { name: string; current?: boolean | undefined },
	style: CurrentUserNameStyle,
): string {
	return identity.current ? formatCurrentUserDisplayName(identity.name, style) : identity.name;
}

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

export function createUncommittedChangesCommit(
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
		repoPath,
		sha,
		new GitCommitIdentity(user?.name ?? '', user?.email ?? undefined, now, undefined, true),
		new GitCommitIdentity(user?.name ?? '', user?.email ?? undefined, now, undefined, true),
		'Uncommitted changes',
		options?.parents ?? (sha === uncommittedStaged ? ['HEAD'] : []),
		'Uncommitted changes',
		options?.fileset,
		options?.stats,
		[],
	);
}
