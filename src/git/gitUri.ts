import { Uri } from 'vscode';
import { decodeUtf8Hex, encodeUtf8Hex } from '@env/hex';
import { UriComparer } from '../comparers';
import { Schemes } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { GitHubAuthorityMetadata } from '../premium/remotehub';
import { debug } from '../system/decorators/log';
import { memoize } from '../system/decorators/memoize';
import { basename, dirname, isAbsolute, normalizePath, relative } from '../system/path';
import { CharCode, truncateLeft, truncateMiddle } from '../system/string';
import { RevisionUriData } from './gitProvider';
import { GitFile, GitRevision } from './models';

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
	new (components: UriComponents): Uri;
}

export class GitUri extends (Uri as any as UriEx) {
	private static readonly _unknown = new GitUri();
	static get unknown() {
		return this._unknown;
	}

	static is(uri: any): uri is GitUri {
		return uri instanceof GitUri;
	}

	readonly repoPath?: string;
	readonly sha?: string;

	constructor(uri?: Uri);
	constructor(uri: Uri, commit: GitCommitish);
	constructor(uri: Uri, repoPath: string | undefined);
	constructor(uri?: Uri, commitOrRepoPath?: GitCommitish | string) {
		if (uri == null) {
			super({ scheme: 'unknown' });

			return;
		}

		if (uri.scheme === Schemes.GitLens) {
			super({
				scheme: uri.scheme,
				authority: uri.authority,
				path: uri.path,
				query: uri.query,
				fragment: uri.fragment,
			});

			const metadata = decodeGitLensRevisionUriAuthority<RevisionUriData>(uri.authority);
			this.repoPath = metadata.repoPath;

			let ref = metadata.ref;
			if (commitOrRepoPath != null && typeof commitOrRepoPath !== 'string') {
				ref = commitOrRepoPath.sha;
			}

			if (GitRevision.isUncommittedStaged(ref) || !GitRevision.isUncommitted(ref)) {
				this.sha = ref;
			}

			return;
		}

		if (uri.scheme === Schemes.Virtual || uri.scheme === Schemes.GitHub) {
			super(uri);

			const [, owner, repo] = uri.path.split('/', 3);
			this.repoPath = uri.with({ path: `/${owner}/${repo}` }).toString();

			const data = decodeRemoteHubAuthority<GitHubAuthorityMetadata>(uri);

			let ref = data.metadata?.ref?.id;
			if (commitOrRepoPath != null && typeof commitOrRepoPath !== 'string') {
				ref = commitOrRepoPath.sha;
			}

			if (ref && (GitRevision.isUncommittedStaged(ref) || !GitRevision.isUncommitted(ref))) {
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
		if (fsPath.charCodeAt(0) === CharCode.Slash && fsPath.charCodeAt(1) === CharCode.Slash) {
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
				} else if (fsPath.charCodeAt(0) !== CharCode.Slash) {
					path = `/${fsPath}`;
				} else {
					path = fsPath;
				}
				break;
			default:
				path = fsPath.charCodeAt(0) !== CharCode.Slash ? `/${fsPath}` : fsPath;
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
		if (GitRevision.isUncommittedStaged(commitOrRepoPath.sha) || !GitRevision.isUncommitted(commitOrRepoPath.sha)) {
			this.sha = commitOrRepoPath.sha;
		}
	}

	@memoize()
	get directory(): string {
		return GitUri.getDirectory(this.relativeFsPath);
	}

	@memoize()
	get fileName(): string {
		return basename(this.relativeFsPath);
	}

	@memoize()
	get isUncommitted() {
		return GitRevision.isUncommitted(this.sha);
	}

	@memoize()
	get isUncommittedStaged() {
		return GitRevision.isUncommittedStaged(this.sha);
	}

	@memoize()
	private get relativeFsPath() {
		return !this.repoPath ? this.fsPath : relative(this.repoPath, this.fsPath);
	}

	@memoize()
	get relativePath() {
		return normalizePath(this.relativeFsPath);
	}

	@memoize()
	get shortSha() {
		return GitRevision.shorten(this.sha);
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

		return this.sha === (GitUri.is(uri) ? uri.sha : undefined);
	}

	getFormattedFileName(options: { suffix?: string; truncateTo?: number } = {}): string {
		return GitUri.getFormattedFileName(this.fsPath, options);
	}

	getFormattedPath(options: { relativeTo?: string; suffix?: string; truncateTo?: number } = {}): string {
		return GitUri.getFormattedPath(this.fsPath, { relativeTo: this.repoPath, ...options });
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
		return !ref ? new GitUri(uri, repoPath) : new GitUri(uri, { repoPath: repoPath, sha: ref });
	}

	static fromRepoPath(repoPath: string, ref?: string) {
		return !ref
			? new GitUri(Container.instance.git.getAbsoluteUri(repoPath, repoPath), repoPath)
			: new GitUri(Container.instance.git.getAbsoluteUri(repoPath, repoPath), { repoPath: repoPath, sha: ref });
	}

	static fromRevisionUri(uri: Uri): GitUri {
		return new GitUri(uri);
	}

	@debug({
		exit: uri => `returned ${Logger.toLoggable(uri)}`,
	})
	static async fromUri(uri: Uri): Promise<GitUri> {
		if (GitUri.is(uri)) return uri;
		if (!Container.instance.git.isTrackable(uri)) return new GitUri(uri);
		if (uri.scheme === Schemes.GitLens) return new GitUri(uri);

		// If this is a git uri, find its repoPath
		if (uri.scheme === Schemes.Git) {
			let data: { path: string; ref: string } | undefined;
			try {
				data = JSON.parse(uri.query);
			} catch {}

			if (data?.path) {
				const repository = await Container.instance.git.getOrOpenRepository(Uri.file(data.path));
				if (repository == null) {
					debugger;
					throw new Error(`Unable to find repository for uri=${uri.toString(false)}`);
				}

				let ref;
				switch (data.ref) {
					case '':
					case '~':
						ref = GitRevision.uncommittedStaged;
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
					repoPath: repository?.path,
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
				const repository = await Container.instance.git.getOrOpenRepository(Uri.file(data.fileName));
				if (repository == null) {
					debugger;
					throw new Error(`Unable to find repository for uri=${uri.toString(false)}`);
				}

				let repoPath = normalizePath(uri.fsPath);
				if (repoPath.endsWith(data.fileName)) {
					repoPath = repoPath.substr(0, repoPath.length - data.fileName.length - 1);
				} else {
					// eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
					repoPath = (await Container.instance.git.getOrOpenRepository(uri))?.path!;
					if (!repoPath) {
						debugger;
					}
				}

				const commitish: GitCommitish = {
					fileName: data.fileName,
					repoPath: repoPath,
					sha: data.isBase ? data.baseCommit : data.headCommit,
				};
				return new GitUri(uri, commitish);
			}
		}

		const repository = await Container.instance.git.getOrOpenRepository(uri);
		return new GitUri(uri, repository?.path);
	}

	static getDirectory(fileName: string, relativeTo?: string): string {
		let directory: string | undefined = dirname(fileName);
		directory = relativeTo != null ? GitUri.relativeTo(directory, relativeTo) : normalizePath(directory);
		return directory == null || directory.length === 0 || directory === '.' ? '' : directory;
	}

	static getFormattedFileName(
		fileNameOrUri: string | Uri,
		options?: {
			suffix?: string;
			truncateTo?: number;
		},
	): string {
		let fileName: string;
		if (fileNameOrUri instanceof Uri) {
			fileName = fileNameOrUri.fsPath;
		} else {
			fileName = fileNameOrUri;
		}

		let file = basename(fileName);
		if (options?.truncateTo != null && file.length >= options.truncateTo) {
			return truncateMiddle(file, options.truncateTo);
		}

		if (options?.suffix) {
			if (options?.truncateTo != null && file.length + options.suffix.length >= options?.truncateTo) {
				return `${truncateMiddle(file, options.truncateTo - options.suffix.length)}${options.suffix}`;
			}

			file += options.suffix;
		}

		return file;
	}

	static getFormattedPath(
		fileNameOrUri: string | Uri,
		options: {
			relativeTo?: string;
			suffix?: string;
			truncateTo?: number;
		},
	): string {
		const { relativeTo, suffix, truncateTo } = options;

		let fileName: string;
		if (fileNameOrUri instanceof Uri) {
			fileName = fileNameOrUri.fsPath;
		} else {
			fileName = fileNameOrUri;
		}

		let file = basename(fileName);
		if (truncateTo != null && file.length >= truncateTo) {
			return truncateMiddle(file, truncateTo);
		}

		if (suffix) {
			if (truncateTo != null && file.length + suffix.length >= truncateTo) {
				return `${truncateMiddle(file, truncateTo - suffix.length)}${suffix}`;
			}

			file += suffix;
		}

		const directory = GitUri.getDirectory(fileName, relativeTo);
		if (!directory) return file;

		file = `/${file}`;

		if (truncateTo != null && file.length + directory.length >= truncateTo) {
			return `${truncateLeft(directory, truncateTo - file.length)}${file}`;
		}

		return `${directory}${file}`;
	}

	static relativeTo(fileNameOrUri: string | Uri, relativeTo: string | undefined): string {
		const fileName = fileNameOrUri instanceof Uri ? fileNameOrUri.fsPath : fileNameOrUri;
		const relativePath =
			relativeTo == null || relativeTo.length === 0 || !isAbsolute(fileName)
				? fileName
				: relative(relativeTo, fileName);
		return normalizePath(relativePath);
	}

	static git(path: string, repoPath?: string): Uri {
		const uri = Container.instance.git.getAbsoluteUri(path, repoPath);
		return Uri.from({
			scheme: Schemes.Git,
			path: uri.path,
			query: JSON.stringify({
				// Ensure we use the fsPath here, otherwise the url won't open properly
				path: uri.fsPath,
				ref: '~',
			}),
		});
	}

	static toKey(fileName: string): string;
	static toKey(uri: Uri): string;
	static toKey(fileNameOrUri: string | Uri): string;
	static toKey(fileNameOrUri: string | Uri): string {
		return normalizePath(typeof fileNameOrUri === 'string' ? fileNameOrUri : fileNameOrUri.fsPath);

		// return typeof fileNameOrUri === 'string'
		//     ? GitUri.file(fileNameOrUri).toString(true)
		//     : fileNameOrUri.toString(true);
	}
}

export function decodeGitLensRevisionUriAuthority<T>(authority: string): T {
	return JSON.parse(decodeUtf8Hex(authority)) as T;
}

export function encodeGitLensRevisionUriAuthority<T>(metadata: T): string {
	return encodeUtf8Hex(JSON.stringify(metadata));
}

function decodeRemoteHubAuthority<T>(uri: Uri): { scheme: string; metadata: T | undefined } {
	const [scheme, encoded] = uri.authority.split('+');

	let metadata: T | undefined;
	if (encoded) {
		try {
			const data = JSON.parse(decodeUtf8Hex(encoded));
			metadata = data as T;
		} catch {}
	}

	return { scheme: scheme, metadata: metadata };
}
