'use strict';
import { Strings } from '../system';
import { Uri } from 'vscode';
import { DocumentSchemes, GlyphChars } from '../constants';
import { Container } from '../container';
import { GitCommit, GitService, IGitStatusFile } from '../gitService';
import * as path from 'path';

export interface IGitCommitInfo {
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
    new(): Uri;
    new(scheme: string, authority: string, path: string, query: string, fragment: string): Uri;
    // Use this ctor, because vscode doesn't validate it
    new(components: UriComponents): Uri;
}

export class GitUri extends ((Uri as any) as UriEx) {

    repoPath?: string;
    sha?: string;

    versionedPath?: string;

    constructor(uri?: Uri)
    constructor(uri: Uri, commit: IGitCommitInfo);
    constructor(uri: Uri, repoPath: string | undefined);
    constructor(uri?: Uri, commitOrRepoPath?: IGitCommitInfo | string) {
        if (uri == null) {
            super();

            return;
        }

        if (uri.scheme === DocumentSchemes.GitLensGit) {
            const data: IUriRevisionData = JSON.parse(uri.query);

            const [authority, fsPath] = GitUri.ensureValidUNCPath(uri.authority, path.resolve(data.repoPath, data.fileName));
            super({ scheme: uri.scheme, authority: authority, path: fsPath, query: uri.query, fragment: uri.fragment });

            this.repoPath = data.repoPath;
            if (GitService.isStagedUncommitted(data.sha) || !GitService.isUncommitted(data.sha)) {
                this.sha = data.sha;
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

        const [authority, fsPath] = GitUri.ensureValidUNCPath(uri.authority, path.resolve(commitOrRepoPath.repoPath, commitOrRepoPath.fileName || uri.fsPath));
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

    fileUri(options: { noSha?: boolean, useVersionedPath?: boolean } = {}) {
        if (options.useVersionedPath && this.versionedPath !== undefined) return Uri.file(this.versionedPath);

        return Uri.file(!options.noSha && this.sha ? this.path : this.fsPath);
    }

    getDirectory(relativeTo?: string): string {
        return GitUri.getDirectory(path.relative(this.repoPath || '', this.fsPath), relativeTo);
    }

    getFilename(relativeTo?: string): string {
        return path.basename(path.relative(this.repoPath || '', this.fsPath), relativeTo);
    }

    getFormattedPath(separator: string = Strings.pad(GlyphChars.Dot, 2, 2), relativeTo?: string): string {
        let directory = path.dirname(this.fsPath);
        if (this.repoPath) {
            directory = path.relative(this.repoPath, directory);
        }
        if (relativeTo !== undefined) {
            directory = path.relative(relativeTo, directory);
        }
        directory = Strings.normalizePath(directory);

        return (!directory || directory === '.')
            ? path.basename(this.fsPath)
            : `${path.basename(this.fsPath)}${separator}${directory}`;
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
        if (fsPath[0] === '\\' && fsPath[1] === '\\') {
            const index = fsPath.indexOf('\\', 2);
            if (index === -1) {
                authority = fsPath.substring(2);
                fsPath = '\\';
            } else {
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

    static fromFileStatus(status: IGitStatusFile, repoPath: string, sha?: string, original: boolean = false): GitUri {
        const uri = Uri.file(path.resolve(repoPath, (original && status.originalFileName) || status.fileName));
        return sha === undefined
            ? new GitUri(uri, repoPath)
            : new GitUri(uri, { repoPath: repoPath, sha: sha });
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

        if (uri.scheme === DocumentSchemes.GitLensGit) return new GitUri(uri);

        // If this is a git uri, find its repoPath
        if (uri.scheme === DocumentSchemes.Git) {
            const data: { path: string, ref: string } = JSON.parse(uri.query);

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
            } as IGitCommitInfo);
        }

        const versionedUri = await Container.git.getVersionedUri(uri);
        if (versionedUri !== undefined) return versionedUri;

        return new GitUri(uri, await Container.git.getRepoPath(uri));
    }

    static getDirectory(fileName: string, relativeTo?: string): string {
        let directory: string | undefined = path.dirname(fileName);
        if (relativeTo !== undefined) {
            directory = path.relative(relativeTo, directory);
        }
        directory = Strings.normalizePath(directory);
        return (!directory || directory === '.') ? '' : directory;
    }

    static getFormattedPath(fileNameOrUri: string | Uri, separator: string = Strings.pad(GlyphChars.Dot, 2, 2), relativeTo?: string): string {
        let fileName: string;
        if (fileNameOrUri instanceof Uri) {
            if (fileNameOrUri instanceof GitUri) return fileNameOrUri.getFormattedPath(separator, relativeTo);

            fileName = fileNameOrUri.fsPath;
        }
        else {
            fileName = fileNameOrUri;
        }

        const directory = GitUri.getDirectory(fileName, relativeTo);
        return !directory
            ? path.basename(fileName)
            : `${path.basename(fileName)}${separator}${directory}`;
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
        return Strings.normalizePath(typeof fileNameOrUri === 'string' ? fileNameOrUri : fileNameOrUri.fsPath).toLowerCase();
    }

    static toRevisionUri(uri: GitUri): Uri;
    static toRevisionUri(sha: string, fileName: string, repoPath: string): Uri;
    static toRevisionUri(sha: string, status: IGitStatusFile, repoPath: string): Uri;
    static toRevisionUri(uriOrSha: string | GitUri, fileNameOrStatus?: string | IGitStatusFile, repoPath?: string): Uri {
        let fileName: string;
        let sha: string | undefined;
        let shortSha: string | undefined;

        if (typeof uriOrSha === 'string') {
            if (typeof fileNameOrStatus === 'string') {
                fileName = fileNameOrStatus;
            }
            else {
                fileName = path.resolve(repoPath!, fileNameOrStatus!.fileName);
            }

            sha = uriOrSha;
            shortSha = GitService.shortenSha(sha);
        }
        else {
            fileName = uriOrSha.fsPath!;
            repoPath = uriOrSha.repoPath!;
            sha = uriOrSha.sha;
            shortSha = uriOrSha.shortSha;
        }

        const data: IUriRevisionData = {
            fileName: Strings.normalizePath(path.relative(repoPath!, fileName)),
            repoPath: repoPath!,
            sha: sha
        };

        const parsed = path.parse(fileName);
        return Uri.parse(`${DocumentSchemes.GitLensGit}:${path.join(parsed.dir, parsed.name)}:${shortSha}${parsed.ext}?${JSON.stringify(data)}`);
    }

}

interface IUriRevisionData {
    sha?: string;
    fileName: string;
    repoPath: string;
}
