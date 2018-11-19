'use strict';
import * as paths from 'path';
import { Uri } from 'vscode';
import { UriComparer } from '../comparers';
import { DocumentSchemes, GlyphChars } from '../constants';
import { Container } from '../container';
import { GitCommit, GitFile, GitService } from '../git/gitService';
import { Strings } from '../system';

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

const stripRepoRevisionFromPathRegex = /^\/<.+>\/?(.*)$/;

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

            data.repoPath = Strings.normalizePath(data.repoPath);
            data.path = Strings.normalizePath(
                `/${data.repoPath}/${uri.path.replace(stripRepoRevisionFromPathRegex, '$1')}`
            );
            // Make sure we aren't starting with //
            if (data.path[1] === '/') {
                data.path = data.path.substr(1);
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
                    path = '/';
                }
                else if (fsPath[0] !== '/') {
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

    documentUri(options: { noSha?: boolean; useVersionedPath?: boolean } = {}) {
        if (options.useVersionedPath && this.versionedPath !== undefined) return GitUri.file(this.versionedPath);

        return this.scheme === 'file' ? GitUri.file(!options.noSha && this.sha ? this.path : this.fsPath) : this;
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
        const { relativeTo = this.repoPath, separator = Strings.pad(GlyphChars.Dot, 2, 2), suffix = '' } = options;

        const directory = GitUri.getDirectory(this.fsPath, relativeTo);
        return `${paths.basename(this.fsPath)}${suffix}${directory ? `${separator}${directory}` : ''}`;
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
        // Taken from https://github.com/Microsoft/vscode/blob/master/src/vs/base/common/uri.ts#L239-L251
        // check for authority as used in UNC shares or use the path as given
        if (
            fsPath.charCodeAt(0) === Strings.CharCode.Backslash &&
            fsPath.charCodeAt(1) === Strings.CharCode.Backslash
        ) {
            const index = fsPath.indexOf('\\', 2);
            if (index === -1) {
                authority = fsPath.substring(2);
                fsPath = '\\';
            }
            else {
                authority = fsPath.substring(2, index);
                fsPath = fsPath.substring(index) || '\\';
            }
        }

        return [authority, fsPath];
    }

    static file(path: string) {
        const uri = Uri.file(path);
        if (Container.vsls.isMaybeGuest) {
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
                case '':
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
        return !directory || directory === '.' ? '' : directory;
    }

    static getFormattedPath(
        fileNameOrUri: string | Uri,
        options: { relativeTo?: string; separator?: string; suffix?: string } = {}
    ): string {
        const { relativeTo, separator = Strings.pad(GlyphChars.Dot, 2, 2), suffix = '' } = options;

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

    static resolve(fileName: string, repoPath?: string) {
        const normalizedFileName = Strings.normalizePath(fileName);
        if (repoPath === undefined) return normalizedFileName;

        const normalizedRepoPath = Strings.normalizePath(repoPath);

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
        const data: IUriRevisionData = {
            path: Strings.normalizePath(fileName, { addLeadingSlash: true }),
            ref: ref,
            repoPath: repoPath
        };

        let filePath = Strings.normalizePath(paths.relative(repoPath, fileName), { addLeadingSlash: true });
        if (filePath === '/') {
            filePath = '';
        }

        const uri = Uri.parse(
            `${DocumentSchemes.GitLens}://git/<${repoName}@${shortSha}>${filePath}?${JSON.stringify(data)}`
        );
        return uri;
    }
}

interface IUriRevisionData {
    path: string;
    ref?: string;
    repoPath: string;
}
