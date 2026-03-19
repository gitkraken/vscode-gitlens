import type { UnifiedAsyncDisposable } from '@gitlens/utils/disposable.js';
import type { Uri } from '@gitlens/utils/uri.js';

export interface DisposableTemporaryGitIndex extends UnifiedAsyncDisposable {
	path: string;
	env: { GIT_INDEX_FILE: string };
}

export interface GitStagingSubProvider {
	createTemporaryIndex(repoPath: string, from: 'empty' | 'current'): Promise<DisposableTemporaryGitIndex>;
	createTemporaryIndex(repoPath: string, from: 'ref', ref: string): Promise<DisposableTemporaryGitIndex>;
	stageFile(repoPath: string, pathOrUri: string | Uri): Promise<void>;
	stageFiles(
		repoPath: string,
		pathsOrUris: (string | Uri)[],
		options?: { index?: DisposableTemporaryGitIndex; intentToAdd?: boolean },
	): Promise<void>;
	stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void>;
	unstageFile(repoPath: string, pathOrUri: string | Uri): Promise<void>;
	unstageFiles(repoPath: string, pathsOrUris: (string | Uri)[]): Promise<void>;
	unstageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void>;
}
