import type { WorkspaceFolder } from 'vscode';
import type { GitDir } from '@gitlens/git/models/repository.js';
import type { GitProviderDescriptor, RepositoryVisibility } from '@gitlens/git/providers/types.js';
import type { UnsafeGit } from '@gitlens/git/run.types.js';
import type { RevisionUriOptions } from '@gitlens/git/utils/uriAuthority.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { Commit, InputBox } from '../@types/vscode.git.d.js';
import type { ForcePushMode } from '../@types/vscode.git.enums.js';
import type { Source } from '../constants.telemetry.js';
import type { Features } from '../features.js';
import type { GitUri } from './gitUri.js';
import type { GlRepository, RepositoryChangeEvent } from './models/repository.js';

export interface ScmRepository {
	readonly rootUri: Uri;
	readonly inputBox: InputBox;

	getCommit(ref: string): Promise<Commit>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;
}

export interface RepositoryCloseEvent {
	readonly uri: Uri;
	readonly source?: 'scm';
}

export interface RepositoryOpenEvent {
	readonly uri: Uri;
	readonly source?: 'scm';
}

/**
 * VS Code integration provider for Git repositories.
 *
 * This interface handles environment-specific concerns: SCM integration, URI utilities,
 * repository discovery, visibility, and tracking. Git operations (sub-providers like
 * branches, commits, etc.) are accessed through the package {@link RepositoryService}
 * via {@link getRepoService}, NOT through this interface.
 */
export interface GlGitProvider extends UnifiedDisposable {
	get onDidChange(): Event<void>;
	get onWillChangeRepository(): Event<RepositoryChangeEvent>;
	get onDidChangeRepository(): Event<RepositoryChangeEvent>;
	get onDidCloseRepository(): Event<RepositoryCloseEvent>;
	get onDidOpenRepository(): Event<RepositoryOpenEvent>;

	readonly descriptor: GitProviderDescriptor;
	readonly supportedSchemes: Set<string>;

	/**
	 * Ensures the provider is registered with the package-level GitService so that path-based
	 * APIs (`forRepo`, `validateRepo`, `getRepositoryService`) can resolve the provider before
	 * any deep operation has triggered lazy initialization. Idempotent.
	 */
	ensureRegistered(): void;

	discoverRepositories(
		uri: Uri,
		options?: { cancellation?: AbortSignal; depth?: number; silent?: boolean },
	): Promise<GlRepository[]>;
	updateContext?(): void;
	openRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir | undefined,
		root: boolean,
		closed?: boolean,
	): GlRepository[];
	supports(feature: Features): Promise<boolean>;
	visibility(repoPath: string): Promise<[visibility: RepositoryVisibility, cacheKey: string | undefined]>;

	getOpenScmRepositories(): Promise<ScmRepository[]>;
	getScmRepository(repoPath: string): Promise<ScmRepository | undefined>;
	getOrOpenScmRepository(repoPath: string, source?: Source): Promise<ScmRepository | undefined>;

	canHandlePathOrUri(scheme: string, pathOrUri: string | Uri): string | undefined;
	findRepositoryUri(uri: Uri, isDirectory?: boolean): Promise<Uri | undefined>;
	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri;
	getBestRevisionUri(repoPath: string, pathOrUri: string | Uri, rev: string | undefined): Promise<Uri | undefined>;
	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string;
	getRevisionUri(repoPath: string, rev: string, path: string, options?: RevisionUriOptions): Uri;
	getWorkingUri(repoPath: string, uri: Uri): Promise<Uri | undefined>;
	isFolderUri(repoPath: string, uri: Uri): Promise<boolean>;

	excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]>;
	getIgnoredUrisFilter(repoPath: string): Promise<(uri: Uri) => boolean>;
	getLastFetchedTimestamp(repoPath: string): Promise<number | undefined>;

	applyChangesToWorkingFile?(uri: GitUri, ref1?: string, ref2?: string): Promise<void>;
	clone?(url: string, parentPath: string): Promise<string | undefined>;
	hasUnsafeRepositories?(): boolean;
	isTrackable(uri: Uri): boolean;
	isTracked(uri: Uri): Promise<boolean>;

	/**
	 * Build an {@link UnsafeGit} for raw `git <args>` invocation against `repoPath`.
	 *
	 * Implemented by CLI-backed providers; omitted by virtual providers (GitHub,
	 * `vscode-vfs`, PRs) that have no `git` binary to invoke. Consumers should
	 * not call this directly — go through `createUnsafeGit` in `src/git/internal/unsafeGit.ts`,
	 * which is import-restricted to the compose-tools adapter and provider code.
	 */
	createUnsafeGit?(repoPath: string): UnsafeGit;
}

export type { RevisionUriData, RevisionUriOptions } from '@gitlens/git/utils/uriAuthority.js';
