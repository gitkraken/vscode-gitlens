import type { GitPausedOperationStatus } from '../models/pausedOperationStatus.js';

export interface GitPausedOperationsSubProvider {
	getPausedOperationStatus(
		repoPath: string,
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitPausedOperationStatus | undefined>;
	abortPausedOperation(repoPath: string, options?: { quit?: boolean }): Promise<void>;
	continuePausedOperation(
		repoPath: string,
		options?: {
			/** Records the empty commit the operation refused to create, then concludes it (cherry-pick/revert) */
			allowEmpty?: boolean;
			skip?: boolean;
			/** Editor command used if the operation needs to edit a commit message (e.g. `true` to keep the original message without opening an editor) */
			messageEditor?: string;
		},
	): Promise<void>;
}
