import { Uri } from 'vscode';
import { getQueryDataFromScmGitUri } from '../@types/vscode.git.uri';
import { Schemes } from '../constants';
import { Container } from '../container';
import type { GitHubAuthorityMetadata } from '../plus/remotehub';
import { UriComparer } from '../system/comparers';
import { debug } from '../system/decorators/log';
import { memoize } from '../system/decorators/memoize';
import { basename, normalizePath } from '../system/path';
import { formatPath } from '../system/vscode/formatPath';
import { getBestPath, relativeDir, splitPath } from '../system/vscode/path';
import { isVirtualUri } from '../system/vscode/utils';
import type { RevisionUriData } from './gitProvider';
import { decodeGitLensRevisionUriAuthority, decodeRemoteHubAuthority } from './gitUri.authority';
import type { GitFile } from './models/file';
import { uncommittedStaged } from './models/revision';
import { isUncommitted, isUncommittedStaged, shortenRevision } from './models/revision.utils';

const slash = 47; //slash;

export interface GitCommitish {
	fileName?: string;
	repoPath: string;
	sha?: string;
}

interface UriComponents {
	scheme?: string;
	authority?: string;
	path?: string;
	query?: string;
	fragment?: string;
}

interface UriEx {
	new (): Uri;
	new (scheme: string, authority: string, path: string, query: string, fragment: string): Uri;
	// Use this ctor, because vscode doesn't validate it
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	new (components: UriComponents): Uri;
}

export class GitUri extends (Uri as any as UriEx) {
	readonly repoPath?: string;
	readonly sha?: string;

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
			let path = uri.path;

			const metadata = decodeGitLensRevisionUriAuthority<RevisionUriData>(uri.authority);
			if (metadata.uncPath != null && !path.startsWith(metadata.uncPath)) {
				path = `${metadata.uncPath}${uri.path}`;
			}

			super({
				scheme: uri.scheme,
				authority: uri.authority,
				path: path,
				query: uri.query,
				fragment: uri.fragment,
			});

			this.repoPath = metadata.repoPath;

			let ref = metadata.ref;
			if (commitOrRepoPath != null && typeof commitOrRepoPath !== 'string') {
				ref = commitOrRepoPath.sha;
			}

			if (!isUncommitted(ref) || isUncommittedStaged(ref)) {
				this.sha = ref;
			}

			return;
		}

		if (isVirtualUri(uri)) {
			super(uri);

			const [, owner, repo] = uri.path.split('/', 3);
			this.repoPath = uri.with({ path: `/${owner}/${repo}` }).toString();

			const data = decodeRemoteHubAuthority<GitHubAuthorityMetadata>(uri.authority);

			let ref = data.metadata?.ref?.id;
			if (commitOrRepoPath != null && typeof commitOrRepoPath !== 'string') {
				ref = commitOrRepoPath.sha;
			}

			if (ref && (!isUncommitted(ref) || isUncommittedStaged(ref))) {
				this.sha = ref;
			}

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

		let authority = uri.authority;
		let fsPath = normalizePath(
			Container.instance.git.getAbsoluteUri(commitOrRepoPath.fileName ?? uri.fsPath, commitOrRepoPath.repoPath)
				.fsPath,
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

		super({
			scheme: uri.scheme,
			authority: authority,
			path: path,
			query: uri.query,
			fragment: uri.fragment,
		});
		this.repoPath = commitOrRepoPath.repoPath;
		if (!isUncommitted(commitOrRepoPath.sha) || isUncommittedStaged(commitOrRepoPath.sha)) {
			this.sha = commitOrRepoPath.sha;
		}
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

	@memoize()
	documentUri() {
		// TODO@eamodio which is correct?
		return Uri.from({
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment,
		});
		return Container.instance.git.getAbsoluteUri(this.fsPath, this.repoPath);
	}

	equals(uri: Uri | undefined) {
		if (!UriComparer.equals(this, uri)) return false;

		return this.sha === (isGitUri(uri) ? uri.sha : undefined);
	}

	getFormattedFileName(options?: { suffix?: string; truncateTo?: number }): string {
		return formatPath(this.fsPath, { ...options, fileOnly: true });
	}

	@memoize()
	toFileUri() {
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

	static fromRepoPath(repoPath: string, ref?: string) {
		return !ref
			? new GitUri(Container.instance.git.getAbsoluteUri(repoPath, repoPath), repoPath)
			: new GitUri(Container.instance.git.getAbsoluteUri(repoPath, repoPath), { repoPath: repoPath, sha: ref });
	}

	static fromRevisionUri(uri: Uri): GitUri {
		return new GitUri(uri);
	}

	@debug({ exit: true })
	static async fromUri(uri: Uri): Promise<GitUri> {
		if (isGitUri(uri)) return uri;
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

export function isGitUri(uri: any): uri is GitUri {
	return uri instanceof GitUri;
}
