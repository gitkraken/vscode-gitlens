'use strict';
import * as path from 'path';
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

const stripRepoRevisionFromPathRegex = /\/[^\/]+\/?(.*)/;

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
            path.resolve(commitOrRepoPath.repoPath, commitOrRepoPath.fileName || uri.fsPath)
        );
        super({ scheme: uri.scheme, authority: authority, path: fsPath, query: uri.query, fragment: uri.fragment });

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
        if (options.useVersionedPath && this.versionedPath !== undefined) return Uri.file(this.versionedPath);

        return this.scheme === 'file' ? Uri.file(!options.noSha && this.sha ? this.path : this.fsPath) : this;
    }

    equals(uri: Uri | undefined) {
        if (!UriComparer.equals(this, uri)) return false;

        return this.sha === (uri instanceof GitUri ? uri.sha : undefined);
    }

    getDirectory(relativeTo?: string): string {
        return GitUri.getDirectory(path.relative(this.repoPath || '', this.fsPath), relativeTo);
    }

    getFilename(relativeTo?: string): string {
        return path.basename(path.relative(this.repoPath || '', this.fsPath), relativeTo);
    }

    getFormattedPath(options: { relativeTo?: string; separator?: string; suffix?: string } = {}): string {
        const { relativeTo = this.repoPath, separator = Strings.pad(GlyphChars.Dot, 2, 2), suffix = '' } = options;

        const directory = GitUri.getDirectory(this.fsPath, relativeTo);
        return `${path.basename(this.fsPath)}${suffix}${directory ? `${separator}${directory}` : ''}`;
    }

    getRelativePath(relativeTo?: string): string {
        let relativePath = path.relative(this.repoPath || '', this.fsPath);
        if (relativeTo !== undefined) {
            relativePath = path.relative(relativeTo, relativePath);
        }
        return Strings.normalizePath(relativePath);
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

    static fromCommit(commit: GitCommit, previous: boolean = false) {
        if (!previous) return new GitUri(commit.uri, commit);

        return new GitUri(commit.previousUri, {
            repoPath: commit.repoPath,
            sha: commit.previousSha
        });
    }

    static fromFile(file: GitFile, repoPath: string, ref?: string, original: boolean = false): GitUri {
        const uri = Uri.file(path.resolve(repoPath, (original && file.originalFileName) || file.fileName));
        return ref === undefined ? new GitUri(uri, repoPath) : new GitUri(uri, { repoPath: repoPath, sha: ref });
    }

    static fromRepoPath(repoPath: string, ref?: string) {
        return ref === undefined
            ? new GitUri(Uri.file(repoPath), repoPath)
            : new GitUri(Uri.file(repoPath), { repoPath: repoPath, sha: ref });
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
        let directory: string | undefined = path.dirname(fileName);
        if (relativeTo !== undefined) {
            directory = path.relative(relativeTo, directory);
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
            ? `${path.basename(fileName)}${suffix}`
            : `${path.basename(fileName)}${suffix}${separator}${directory}`;
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

        let relativePath = path.relative(repoPath || '', fileName);
        if (relativeTo !== undefined) {
            relativePath = path.relative(relativeTo, relativePath);
        }
        return Strings.normalizePath(relativePath);
    }

    static toKey(fileName: string): string;
    static toKey(uri: Uri): string;
    static toKey(fileNameOrUri: string | Uri): string;
    static toKey(fileNameOrUri: string | Uri): string {
        return typeof fileNameOrUri === 'string'
            ? Uri.file(fileNameOrUri).toString(true)
            : fileNameOrUri.toString(true);
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
                fileName = path.resolve(repoPath!, fileNameOrFile!.fileName);
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
        const repoName = path.basename(repoPath);
        const data: IUriRevisionData = {
            path: Strings.normalizePath(fileName, { addLeadingSlash: true }),
            ref: ref,
            repoPath: repoPath
        };

        let filePath = Strings.normalizePath(path.relative(repoPath, fileName), { addLeadingSlash: true });
        if (filePath === '/') {
            filePath = '';
        }

        const uri = Uri.parse(
            `${DocumentSchemes.GitLens}://git/${repoName}@${shortSha}${filePath}?${JSON.stringify(data)}`
        );
        return uri;
    }
}

interface IUriRevisionData {
    path: string;
    ref?: string;
    repoPath: string;
}
