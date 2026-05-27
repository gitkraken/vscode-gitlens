import type { GitPausedOperationStatus } from '../models/pausedOperationStatus.js';

export interface GitPausedOperationsSubProvider {
	getPausedOperationStatus(
		repoPath: string,
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitPausedOperationStatus | undefined>;
	abortPausedOperation(repoPath: string, options?: { quit?: boolean }): Promise<void>;
	continuePausedOperation(repoPath: string, options?: { skip?: boolean }): Promise<void>;
}
