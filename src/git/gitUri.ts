import { Uri } from 'vscode';
import { realpath } from '@env/fs.js';
import { getQueryDataFromScmGitUri } from '../@types/vscode.git.uri.js';
import { Schemes } from '../constants.js';
import { Container } from '../container.js';
import type { GitHubAuthorityMetadata } from '../plus/remotehub.js';
import { configuration } from '../system/-webview/configuration.js';
import { formatPath } from '../system/-webview/formatPath.js';
import { getBestPath, relativeDir, splitPath } from '../system/-webview/path.js';
import { isVirtualUri } from '../system/-webview/vscode/uris.js';
import { trace } from '../system/decorators/log.js';
import { memoize } from '../system/decorators/memoize.js';
import { arePathsEqual, basename, normalizePath } from '../system/path.js';
import type { UriComponents } from '../system/uri.js';
import { areUrisEqual } from '../system/uri.js';
import type { RevisionUriData } from './gitProvider.js';
import { decodeGitLensRevisionUriAuthority, decodeRemoteHubAuthority } from './gitUri.authority.js';
import type { GitFile } from './models/file.js';
import { uncommittedStaged } from './models/revision.js';
import { isUncommitted, isUncommittedStaged, shortenRevision } from './utils/revision.utils.js';

const slash = 47; //slash;

export interface GitCommitish {
	fileName?: string;
	repoPath: string;
	sha?: string;
}

interface UriEx {
	new (): Uri;
	new (scheme: string, authority: string, path: string, query: string, fragment: string): Uri;
	// Use this ctor, because vscode doesn't validate it
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	new (components: Partial<UriComponents>): Uri;
}

/**
 * Extends VS Code's `Uri` with Git-specific context: `repoPath`, `sha`, and `submoduleSha`.
 *
 * GitUri instances exist in two forms:
 * - **file:// with object properties** — created by `fromFile`, `fromRepoPath`, `fromUri`, or the constructor
 *   with a `GitCommitish`. The URI scheme stays as-is (usually `file:`), but `sha` and `repoPath` are
 *   carried as instance properties for internal use within GitLens.
 * - **gitlens:// with encoded authority** — created by `GitProvider.getRevisionUri()`. Git metadata is
 *   hex-encoded in the URI authority for use with VS Code's `FileSystemProvider` and document APIs.
 *
 * Use `getRevisionUriFromGitUri()` on `GitProviderService` to convert a file:// GitUri to a gitlens:// revision URI.
 * Use {@link documentUri} for the URI as VS Code sees the document (preserves original scheme).
 * Use {@link workingFileUri} for the file:// URI of this file in the working tree.
 */
export class GitUri extends (Uri as any as UriEx) {
	readonly repoPath?: string;
	readonly sha?: string;
	readonly submoduleSha?: string;

	constructor(uri?: Uri);
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	constructor(uri: Uri, commit: GitCommitish);
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	constructor(uri: Uri, repoPath: string | undefined);
	constructor(uri?: Uri, commitOrRepoPath?: GitCommitish | string) {
		if (uri == null) {
			super({ scheme: 'unknown' });
			return;
		}

		if (uri.scheme === Schemes.GitLens) {
			const data = GitUri.parseGitLensRevisionUri(uri, commitOrRepoPath);
			super(data.components);
			this.repoPath = data.repoPath;
			this.sha = data.sha;
			this.submoduleSha = data.submoduleSha;
			return;
		}

		if (isVirtualUri(uri)) {
			const data = GitUri.parseVirtualUri(uri, commitOrRepoPath);
			super(uri);
			this.repoPath = data.repoPath;
			this.sha = data.sha;
			return;
		}

		if (commitOrRepoPath === undefined) {
			super(uri);
			return;
		}

		if (typeof commitOrRepoPath === 'string') {
			super(uri);
			this.repoPath = commitOrRepoPath;
			return;
		}

		const data = GitUri.resolveCommitish(uri, commitOrRepoPath);
		super(data.components);
		this.repoPath = data.repoPath;
		this.sha = data.sha;
	}

	private static parseGitLensRevisionUri(
		uri: Uri,
		commitOrRepoPath: GitCommitish | string | undefined,
	): { components: Partial<UriComponents>; repoPath: string; sha: string | undefined; submoduleSha?: string } {
		const metadata = decodeGitLensRevisionUriAuthority<RevisionUriData>(uri.authority);

		let path = uri.path;
		if (metadata.uncPath != null && !path.startsWith(metadata.uncPath)) {
			path = `${metadata.uncPath}${uri.path}`;
		}

		let ref = metadata.ref;
		if (commitOrRepoPath != null && typeof commitOrRepoPath !== 'string') {
			ref = commitOrRepoPath.sha;
		}

		return {
			components: {
				scheme: uri.scheme,
				authority: uri.authority,
				path: path,
				query: uri.query,
				fragment: uri.fragment,
			},
			repoPath: metadata.repoPath,
			sha: !isUncommitted(ref) || isUncommittedStaged(ref) ? ref : undefined,
			submoduleSha: metadata.submoduleSha,
		};
	}

	private static parseVirtualUri(
		uri: Uri,
		commitOrRepoPath: GitCommitish | string | undefined,
	): { repoPath: string; sha: string | undefined } {
		const [, owner, repo] = uri.path.split('/', 3);
		const repoPath = uri.with({ path: `/${owner}/${repo}` }).toString();

		const data = decodeRemoteHubAuthority<GitHubAuthorityMetadata>(uri.authority);

		let ref = data.metadata?.ref?.id;
		if (commitOrRepoPath != null && typeof commitOrRepoPath !== 'string') {
			ref = commitOrRepoPath.sha;
		}

		return {
			repoPath: repoPath,
			sha: ref && (!isUncommitted(ref) || isUncommittedStaged(ref)) ? ref : undefined,
		};
	}

	private static resolveCommitish(
		uri: Uri,
		commitish: GitCommitish,
	): { components: Partial<UriComponents>; repoPath: string; sha: string | undefined } {
		let authority = uri.authority;
		let fsPath = normalizePath(
			Container.instance.git.getAbsoluteUri(commitish.fileName ?? uri.fsPath, commitish.repoPath).fsPath,
		);

		// Check for authority as used in UNC shares or use the path as given
		if (fsPath.charCodeAt(0) === slash && fsPath.charCodeAt(1) === slash) {
			const index = fsPath.indexOf('/', 2);
			if (index === -1) {
				authority = fsPath.substring(2);
				fsPath = '/';
			} else {
				authority = fsPath.substring(2, index);
				fsPath = fsPath.substring(index) || '/';
			}
		}

		let path;
		switch (uri.scheme) {
			case 'https':
			case 'http':
			case 'file':
				if (!fsPath) {
					path = '/';
				} else if (fsPath.charCodeAt(0) !== slash) {
					path = `/${fsPath}`;
				} else {
					path = fsPath;
				}
				break;
			default:
				path = fsPath.charCodeAt(0) !== slash ? `/${fsPath}` : fsPath;
				break;
		}

		return {
			components: {
				scheme: uri.scheme,
				authority: authority,
				path: path,
				query: uri.query,
				fragment: uri.fragment,
			},
			repoPath: commitish.repoPath,
			sha: !isUncommitted(commitish.sha) || isUncommittedStaged(commitish.sha) ? commitish.sha : undefined,
		};
	}

	@memoize()
	get directory(): string {
		return relativeDir(this.relativePath);
	}

	@memoize()
	get fileName(): string {
		return basename(this.relativePath);
	}

	@memoize()
	get isUncommitted(): boolean {
		return isUncommitted(this.sha);
	}

	@memoize()
	get isUncommittedStaged(): boolean {
		return isUncommittedStaged(this.sha);
	}

	@memoize()
	get relativePath(): string {
		return splitPath(getBestPath(this.fsPath), this.repoPath)[0];
	}

	@memoize()
	get shortSha(): string {
		return shortenRevision(this.sha);
	}

	/**
	 * Returns a plain (non-GitUri) `Uri` for this document as VS Code sees it.
	 * For revision files this preserves the gitlens: scheme; for working copies it preserves file:.
	 * Use {@link workingFileUri} when you need the underlying working-copy file:// URI.
	 */
	@memoize()
	get documentUri(): Uri {
		return Uri.from({
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment,
		});
	}

	equals(uri: Uri | undefined): boolean {
		if (!areUrisEqual(this, uri)) return false;

		return this.sha === (isGitUri(uri) ? uri.sha : undefined);
	}

	getFormattedFileName(options?: { suffix?: string; truncateTo?: number }): string {
		return formatPath(this.fsPath, { ...options, fileOnly: true });
	}

	/** Returns the file:// URI of this file in the working tree, resolving from `fsPath` and `repoPath`. */
	@memoize()
	get workingFileUri(): Uri {
		return Container.instance.git.getAbsoluteUri(this.fsPath, this.repoPath);
	}

	static fromFile(file: string | GitFile, repoPath: string, ref?: string, original: boolean = false): GitUri {
		const uri = Container.instance.git.getAbsoluteUri(
			typeof file === 'string' ? file : (original && file.originalPath) || file.path,
			repoPath,
		);

		return !ref
			? new GitUri(uri, repoPath)
			: new GitUri(uri, {
					repoPath: repoPath,
					// If the file is `?` (untracked), then this must be a stash, so get the ^3 commit to access the untracked file
					sha: typeof file !== 'string' && file.status === '?' ? `${ref}^3` : ref,
				});
	}

	static fromRepoPath(repoPath: string, ref?: string): GitUri {
		return !ref
			? new GitUri(Container.instance.git.getAbsoluteUri(repoPath, repoPath), repoPath)
			: new GitUri(Container.instance.git.getAbsoluteUri(repoPath, repoPath), { repoPath: repoPath, sha: ref });
	}

	@trace({ exit: true })
	static async fromUri(uri: Uri): Promise<GitUri> {
		if (isGitUri(uri)) return uri;

		// Check for symbolic links
		if (uri.scheme === Schemes.File && configuration.get('advanced.resolveSymlinks')) {
			try {
				const realPath = await realpath(uri.fsPath);
				if (!arePathsEqual(uri.fsPath, realPath)) {
					uri = Uri.file(realPath);
				}
			} catch {
				// Ignore errors (e.g., if path doesn't exist)
			}
		}

		if (!Container.instance.git.isTrackable(uri)) return new GitUri(uri);
		if (uri.scheme === Schemes.GitLens) return new GitUri(uri);

		// If this is a git uri, find its repoPath
		if (uri.scheme === Schemes.Git) {
			const data = getQueryDataFromScmGitUri(uri);
			if (data?.path) {
				const repository = await Container.instance.git.getOrOpenRepository(Uri.file(data.path));
				if (repository == null) {
					debugger;
					throw new Error(`Unable to find repository for uri=${Uri.file(data.path).toString(true)}`);
				}

				let ref;
				switch (data.ref) {
					case '':
					case '~':
						ref = uncommittedStaged;
						break;

					case null:
						ref = undefined;
						break;

					default:
						ref = data.ref;
						break;
				}

				const commitish: GitCommitish = {
					fileName: data.path,
					repoPath: repository.path,
					sha: ref,
				};
				return new GitUri(uri, commitish);
			}
		}

		if (uri.scheme === Schemes.PRs) {
			let data:
				| {
						baseCommit: string;
						headCommit: string;
						isBase: boolean;
						fileName: string;
						prNumber: number;
						status: number;
						remoteName: string;
				  }
				| undefined;
			try {
				data = JSON.parse(uri.query);
			} catch {}

			if (data?.fileName) {
				const repository = await Container.instance.git.getOrOpenRepository(uri);
				if (repository == null) {
					debugger;
					throw new Error(`Unable to find repository for uri=${Uri.file(data.fileName).toString(true)}`);
				}

				const commitish: GitCommitish = {
					fileName: data.fileName,
					repoPath: repository.path,
					sha: data.isBase ? data.baseCommit : data.headCommit,
				};
				return new GitUri(uri, commitish);
			}
		}

		const repository = await Container.instance.git.getOrOpenRepository(uri);
		return new GitUri(uri, repository?.path);
	}
}

export const unknownGitUri = Object.freeze(new GitUri());

export function isGitUri(uri: unknown): uri is GitUri {
	return uri instanceof GitUri;
}
