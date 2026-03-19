import type { Uri } from '@gitlens/utils/uri.js';
import type { GitFile } from '../models/file.js';
import type { GitConflictFile } from '../models/staging.js';
import type { GitStatus } from '../models/status.js';
import type { GitStatusFile } from '../models/statusFile.js';

export interface GitWorkingChangesState {
	staged: boolean;
	unstaged: boolean;
	untracked: boolean;
}

export interface GitStatusSubProvider {
	getStatus(repoPath: string | undefined, cancellation?: AbortSignal): Promise<GitStatus | undefined>;
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

	hasWorkingChanges(
		repoPath: string,
		options?: {
			staged?: boolean;
			unstaged?: boolean;
			untracked?: boolean;
			throwOnError?: boolean;
		},
		cancellation?: AbortSignal,
	): Promise<boolean>;
	getWorkingChangesState(repoPath: string, cancellation?: AbortSignal): Promise<GitWorkingChangesState>;
	hasConflictingFiles(repoPath: string, cancellation?: AbortSignal): Promise<boolean>;
	getConflictingFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitConflictFile[]>;
	getUntrackedFiles(repoPath: string, cancellation?: AbortSignal): Promise<GitFile[]>;
}
