import type { Uri } from '@gitlens/utils/uri.js';
import type { GitFile } from '../models/file.js';
import type { GitConflictFile } from '../models/staging.js';
import type { GitStatus } from '../models/status.js';
import type { GitStatusFile } from '../models/statusFile.js';
import type { GitCommandPriority } from '../run.types.js';

export interface GitWorkingChangesState {
	staged: boolean;
	unstaged: boolean;
	untracked: boolean;
}

export interface GitStatusSubProvider {
	/** Rejects when git fails; resolves `undefined` only for an undefined `repoPath` */
	getStatus(
		repoPath: string | undefined,
		options?: {
			priority?: GitCommandPriority;
			force?: boolean;
			/** `git status -u<value>`; defaults to `'all'` (today's `-u`, listing files in an untracked directory individually). */
			untracked?: 'no' | 'normal' | 'all';
			/** `false` omits `--branch`, computing no upstream ahead/behind; the result's `branch`, `sha`, `upstream` and `detached` are then not read and mean nothing */
			branch?: false;
		},
		cancellation?: AbortSignal,
	): Promise<GitStatus | undefined>;
	getStatusForFile?(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { renames?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatusFile | undefined>;
	getStatusForPath?(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: { renames?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitStatusFile[] | undefined>;

	/** Rejects when git fails, rather than answering `false` */
	hasWorkingChanges(
		repoPath: string,
		options?: {
			staged?: boolean;
			unstaged?: boolean;
			untracked?: boolean;
			priority?: GitCommandPriority;
		},
		cancellation?: AbortSignal,
	): Promise<boolean>;
	/** Rejects when git fails, rather than answering all `false` */
	getWorkingChangesState(repoPath: string, cancellation?: AbortSignal): Promise<GitWorkingChangesState>;
	/** Rejects when git fails, rather than answering `false` */
	hasConflictingFiles(repoPath: string, cancellation?: AbortSignal): Promise<boolean>;
	/** Rejects when git fails, rather than answering empty */
	getConflictingFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitConflictFile[]>;
	/** Rejects when git fails, rather than answering empty */
	getUntrackedFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitFile[]>;
}
