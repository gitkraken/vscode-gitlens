'use strict';
import * as paths from 'path';
import { Uri } from 'vscode';
import { UriComparer } from '../comparers';
import { DocumentSchemes, GlyphChars } from '../constants';
import { Container } from '../container';
import { GitCommit, GitFile, GitService } from '../git/gitService';
import { Logger } from '../logger';
import { debug, Strings } from '../system';

const empty = '';
const slash = '/';

export interface GitCommitish {
    fileName?: string;
    repoPath: string;
    sha?: string;
    versionedPath?: string;
}

// Taken from https://github.com/Microsoft/vscode/blob/master/src/vs/base/common/uri.ts#L331-L337
interface UriComponents {
    scheme: string;
    authority: string;
    path: string;
    query: string;
    fragment: string;
}

interface UriEx {
    new (): Uri;
    new (scheme: string, authority: string, path: string, query: string, fragment: string): Uri;
    // Use this ctor, because vscode doesn't validate it
    new (components: UriComponents): Uri;
}

export class GitUri extends ((Uri as any) as UriEx) {
    repoPath?: string;
    sha?: string;
    versionedPath?: string;

    constructor(uri?: Uri);
    constructor(uri: Uri, commit: GitCommitish);
    constructor(uri: Uri, repoPath: string | undefined);
    constructor(uri?: Uri, commitOrRepoPath?: GitCommitish | string) {
        if (uri == null) {
            super();

            return;
        }

        if (uri.scheme === DocumentSchemes.GitLens) {
            const data = JSON.parse(uri.query) as IUriRevisionData;

            // When Uri's come from the FileSystemProvider, the uri.query only contains the root repo info (not the actual file path), so fix that here
            const index = uri.path.indexOf(data.path);
            if (index + data.path.length < uri.path.length) {
                data.path = uri.path.substr(index);
            }

            super({
                scheme: uri.scheme,
                authority: uri.authority,
                path: data.path,
                query: JSON.stringify(data),
                fragment: uri.fragment
            });

            this.repoPath = data.repoPath;
            if (GitService.isStagedUncommitted(data.ref) || !GitService.isUncommitted(data.ref)) {
                this.sha = data.ref;
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

        const [authority, fsPath] = GitUri.ensureValidUNCPath(
            uri.authority,
            GitUri.resolve(commitOrRepoPath.fileName || uri.fsPath, commitOrRepoPath.repoPath)
        );

        let path;
        switch (uri.scheme) {
            case 'https':
            case 'http':
            case 'file':
                if (!fsPath) {
                    path = slash;
                }
                else if (fsPath[0] !== slash) {
                    path = `/${fsPath}`;
                }
                else {
                    path = fsPath;
                }
                break;
            default:
                path = fsPath;
                break;
        }

        super({
            scheme: uri.scheme,
            authority: authority,
            path: path,
            query: uri.query,
            fragment: uri.fragment
        });
        this.repoPath = commitOrRepoPath.repoPath;
        this.versionedPath = commitOrRepoPath.versionedPath;
        if (GitService.isStagedUncommitted(commitOrRepoPath.sha) || !GitService.isUncommitted(commitOrRepoPath.sha)) {
            this.sha = commitOrRepoPath.sha;
        }
    }

    get shortSha() {
        return this.sha && GitService.shortenSha(this.sha);
    }

    documentUri(options: { useVersionedPath?: boolean } = {}) {
        if (options.useVersionedPath && this.versionedPath !== undefined) return GitUri.file(this.versionedPath);
        if (this.scheme !== 'file') return this;

        return GitUri.file(this.fsPath);
    }

    equals(uri: Uri | undefined) {
        if (!UriComparer.equals(this, uri)) return false;

        return this.sha === (uri instanceof GitUri ? uri.sha : undefined);
    }

    getDirectory(relativeTo?: string): string {
        return GitUri.getDirectory(
            this.repoPath ? paths.relative(this.repoPath, this.fsPath) : this.fsPath,
            relativeTo
        );
    }

    getFilename(relativeTo?: string): string {
        return paths.basename(this.repoPath ? paths.relative(this.repoPath, this.fsPath) : this.fsPath, relativeTo);
    }

    getFormattedPath(options: { relativeTo?: string; separator?: string; suffix?: string } = {}): string {
        const { relativeTo = this.repoPath, separator = Strings.pad(GlyphChars.Dot, 2, 2), suffix = empty } = options;

        const directory = GitUri.getDirectory(this.fsPath, relativeTo);
        return `${paths.basename(this.fsPath)}${suffix}${directory ? `${separator}${directory}` : empty}`;
    }

    getRelativePath(relativeTo?: string): string {
        let relativePath = this.repoPath ? paths.relative(this.repoPath, this.fsPath) : this.fsPath;
        if (relativeTo !== undefined) {
            relativePath = paths.relative(relativeTo, relativePath);
        }
        return Strings.normalizePath(relativePath);
    }

    toFileUri() {
        return GitUri.file(this.fsPath);
    }

    private static ensureValidUNCPath(authority: string, fsPath: string): [string, string] {
        // Taken from https://github.com/Microsoft/vscode/blob/e444eaa768a1e8bd8315f2cee265d725e96a8162/src/vs/base/common/uri.ts#L300-L325
        // check for authority as used in UNC shares or use the path as given
        if (fsPath[0] === slash && fsPath[1] === slash) {
            const index = fsPath.indexOf(slash, 2);
            if (index === -1) {
                authority = fsPath.substring(2);
                fsPath = slash;
            }
            else {
                authority = fsPath.substring(2, index);
                fsPath = fsPath.substring(index) || slash;
            }
        }

        return [authority, fsPath];
    }

    static file(path: string, useVslsScheme?: boolean) {
        const uri = Uri.file(path);
        if (Container.vsls.isMaybeGuest && useVslsScheme !== false) {
            return uri.with({ scheme: DocumentSchemes.Vsls });
        }

        return uri;
    }

    static fromCommit(commit: GitCommit, previous: boolean = false) {
        if (!previous) return new GitUri(commit.uri, commit);

        return new GitUri(commit.previousUri, {
            repoPath: commit.repoPath,
            sha: commit.previousSha
        });
    }

    static fromFile(fileName: string, repoPath: string, ref?: string): GitUri;
    static fromFile(file: GitFile, repoPath: string, ref?: string, original?: boolean): GitUri;
    static fromFile(fileOrName: GitFile | string, repoPath: string, ref?: string, original: boolean = false): GitUri {
        const uri = GitUri.resolveToUri(
            typeof fileOrName === 'string'
                ? fileOrName
                : (original && fileOrName.originalFileName) || fileOrName.fileName,
            repoPath
        );
        return ref === undefined ? new GitUri(uri, repoPath) : new GitUri(uri, { repoPath: repoPath, sha: ref });
    }

    static fromRepoPath(repoPath: string, ref?: string) {
        return ref === undefined
            ? new GitUri(GitUri.file(repoPath), repoPath)
            : new GitUri(GitUri.file(repoPath), { repoPath: repoPath, sha: ref });
    }

    static fromRevisionUri(uri: Uri): GitUri {
        return new GitUri(uri);
    }

    @debug({
        exit: uri => `returned ${Logger.toLoggable(uri)}`
    })
    static async fromUri(uri: Uri) {
        if (uri instanceof GitUri) return uri;

        if (!Container.git.isTrackable(uri)) return new GitUri(uri);

        if (uri.scheme === DocumentSchemes.GitLens) return new GitUri(uri);

        // If this is a git uri, find its repoPath
        if (uri.scheme === DocumentSchemes.Git) {
            const data: { path: string; ref: string } = JSON.parse(uri.query);

            const repoPath = await Container.git.getRepoPath(data.path);

            let ref;
            switch (data.ref) {
                case empty:
                case '~':
                    ref = GitService.stagedUncommittedSha;
                    break;

                case null:
                    ref = undefined;
                    break;

                default:
                    ref = data.ref;
                    break;
            }

            return new GitUri(uri, {
                fileName: data.path,
                repoPath: repoPath,
                sha: ref
            } as GitCommitish);
        }

        return new GitUri(uri, await Container.git.getRepoPath(uri));
    }

    static getDirectory(fileName: string, relativeTo?: string): string {
        let directory: string | undefined = paths.dirname(fileName);
        if (relativeTo !== undefined) {
            directory = paths.relative(relativeTo, directory);
        }
        directory = Strings.normalizePath(directory);
        return !directory || directory === '.' ? empty : directory;
    }

    static getFormattedPath(
        fileNameOrUri: string | Uri,
        options: { relativeTo?: string; separator?: string; suffix?: string } = {}
    ): string {
        const { relativeTo, separator = Strings.pad(GlyphChars.Dot, 2, 2), suffix = empty } = options;

        let fileName: string;
        if (fileNameOrUri instanceof Uri) {
            if (fileNameOrUri instanceof GitUri) return fileNameOrUri.getFormattedPath(options);

            fileName = fileNameOrUri.fsPath;
        }
        else {
            fileName = fileNameOrUri;
        }

        const directory = GitUri.getDirectory(fileName, relativeTo);
        return !directory
            ? `${paths.basename(fileName)}${suffix}`
            : `${paths.basename(fileName)}${suffix}${separator}${directory}`;
    }

    static getRelativePath(fileNameOrUri: string | Uri, relativeTo?: string, repoPath?: string): string {
        let fileName: string;
        if (fileNameOrUri instanceof Uri) {
            if (fileNameOrUri instanceof GitUri) return fileNameOrUri.getRelativePath(relativeTo);

            fileName = fileNameOrUri.fsPath;
        }
        else {
            fileName = fileNameOrUri;
        }

        let relativePath = repoPath ? paths.relative(repoPath, fileName) : fileName;
        if (relativeTo !== undefined) {
            relativePath = paths.relative(relativeTo, relativePath);
        }
        return Strings.normalizePath(relativePath);
    }

    static git(fileName: string, repoPath?: string) {
        const path = GitUri.resolve(fileName, repoPath);
        return Uri.parse(
            `git:${encodeURIComponent(path)}?${encodeURIComponent(
                JSON.stringify({
                    // Ensure we use the fsPath here, otherwise the url won't open properly
                    path: Uri.file(path).fsPath,
                    ref: '~'
                })
            )}`
        );
    }

    static resolve(fileName: string, repoPath?: string) {
        const normalizedFileName = Strings.normalizePath(fileName);
        if (repoPath === undefined) return normalizedFileName;

        const normalizedRepoPath = Strings.normalizePath(repoPath);
        if (normalizedFileName == null || normalizedFileName.length === 0) return normalizedRepoPath;

        if (normalizedFileName.startsWith(normalizedRepoPath)) return normalizedFileName;

        return Strings.normalizePath(paths.join(normalizedRepoPath, normalizedFileName));
    }

    static resolveToUri(fileName: string, repoPath?: string) {
        return GitUri.file(this.resolve(fileName, repoPath));
    }

    static toKey(fileName: string): string;
    static toKey(uri: Uri): string;
    static toKey(fileNameOrUri: string | Uri): string;
    static toKey(fileNameOrUri: string | Uri): string {
        return Strings.normalizePath(typeof fileNameOrUri === 'string' ? fileNameOrUri : fileNameOrUri.fsPath);

        // return typeof fileNameOrUri === 'string'
        //     ? GitUri.file(fileNameOrUri).toString(true)
        //     : fileNameOrUri.toString(true);
    }

    static toRevisionUri(uri: GitUri): Uri;
    static toRevisionUri(ref: string, fileName: string, repoPath: string): Uri;
    static toRevisionUri(ref: string, file: GitFile, repoPath: string): Uri;
    static toRevisionUri(uriOrRef: string | GitUri, fileNameOrFile?: string | GitFile, repoPath?: string): Uri {
        let fileName: string;
        let ref: string | undefined;
        let shortSha: string | undefined;

        if (typeof uriOrRef === 'string') {
            if (typeof fileNameOrFile === 'string') {
                fileName = fileNameOrFile;
            }
            else {
                fileName = GitUri.resolve(fileNameOrFile!.fileName, repoPath);
            }

            ref = uriOrRef;
            shortSha = GitService.shortenSha(ref);
        }
        else {
            fileName = uriOrRef.fsPath!;
            repoPath = uriOrRef.repoPath!;
            ref = uriOrRef.sha;
            shortSha = uriOrRef.shortSha;
        }

        repoPath = Strings.normalizePath(repoPath!);
        const repoName = paths.basename(repoPath);

        const filePath = Strings.normalizePath(fileName, { addLeadingSlash: true });
        const data: IUriRevisionData = {
            path: filePath,
            ref: ref,
            repoPath: repoPath
        };

        const uri = Uri.parse(
            `${DocumentSchemes.GitLens}:///${encodeURIComponent(repoName)}@${shortSha}${
                filePath === slash ? empty : encodeURIComponent(filePath)
            }?${encodeURIComponent(JSON.stringify(data))}`
        );
        return uri;
    }
}

interface IUriRevisionData {
    path: string;
    ref?: string;
    repoPath: string;
}
