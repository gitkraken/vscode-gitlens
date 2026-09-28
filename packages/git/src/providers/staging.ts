import type { UnifiedAsyncDisposable } from '@gitlens/utils/disposable.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitOperationRunOptions } from './operations.js';

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
	/**
	 * Removes a file from both the working tree and the index in a single operation
	 * (`git rm [-f] -- <path>`). Use during conflict resolution when the user has chosen a
	 * side that is itself a deletion — atomic, so it can't leave a working-tree-modified
	 * file accidentally staged with content. Pass `force: true` to discard local
	 * modifications (required for conflicted files).
	 */
	removeFile(repoPath: string, pathOrUri: string | Uri, options?: { force?: boolean }): Promise<void>;
	/**
	 * Batched form of {@link removeFile}. Chunks paths to stay under the CLI length limit.
	 */
	removeFiles(repoPath: string, pathsOrUris: (string | Uri)[], options?: { force?: boolean }): Promise<void>;
	stageAll(repoPath: string): Promise<void>;
	unstageAll(repoPath: string): Promise<void>;
	/**
	 * Removes untracked files from the working tree (`git clean`). `force` defaults to `true`, since git
	 * refuses to clean without `-f` unless `clean.requireForce` is `false`. Pass
	 * `directories: true` to also remove untracked directories, `ignored: true` to also remove files git
	 * would otherwise skip (gitignored), and `paths` to restrict the clean to specific files/directories.
	 */
	clean(
		repoPath: string,
		options?: {
			paths?: (string | Uri)[];
			directories?: boolean;
			force?: boolean;
			ignored?: boolean;
		},
		runOptions?: GitOperationRunOptions,
	): Promise<void>;
}
