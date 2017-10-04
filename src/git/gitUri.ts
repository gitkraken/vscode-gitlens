'use strict';
import { Strings } from '../system';
import { Uri } from 'vscode';
import { DocumentSchemes, GlyphChars } from '../constants';
import { GitService, IGitStatusFile } from '../gitService';
import * as path from 'path';

interface UriEx {
    new(): Uri;
    new(scheme: string, authority: string, path: string, query: string, fragment: string): Uri;
}

export class GitUri extends (Uri as UriEx) {

    repoPath?: string | undefined;
    sha?: string | undefined;

    constructor(uri?: Uri, commit?: IGitCommitInfo);
    constructor(uri?: Uri, repoPath?: string);
    constructor(uri?: Uri, commitOrRepoPath?: IGitCommitInfo | string);
    constructor(uri?: Uri, commitOrRepoPath?: IGitCommitInfo | string) {
        if (uri === undefined) {
            super();
            return;
        }

        if (uri.scheme === DocumentSchemes.GitLensGit) {
            const data = GitService.fromGitContentUri(uri);
            super(uri.scheme, uri.authority, path.resolve(data.repoPath, data.originalFileName || data.fileName), uri.query, uri.fragment);

            if (!GitService.isUncommitted(data.sha)) {
                this.sha = data.sha;
                this.repoPath = data.repoPath;
            }

            return;
        }

        if (!commitOrRepoPath) return;

        if (typeof commitOrRepoPath === 'string') {
            super(uri.scheme, uri.authority, uri.path, uri.query, uri.fragment);

            this.repoPath = commitOrRepoPath;

            return;
        }

        const commit = commitOrRepoPath;
        super(uri.scheme, uri.authority, path.resolve(commit.repoPath, commit.originalFileName || commit.fileName || ''), uri.query, uri.fragment);

        if (commit.repoPath !== undefined) {
            this.repoPath = commit.repoPath;
        }

        if (commit.sha !== undefined && !GitService.isUncommitted(commit.sha)) {
            this.sha = commit.sha;
        }
    }

    get shortSha() {
        return this.sha && GitService.shortenSha(this.sha);
    }

    fileUri() {
        return Uri.file(this.sha ? this.path : this.fsPath);
    }

    getFormattedPath(separator: string = Strings.pad(GlyphChars.Dot, 2, 2), relativeTo?: string): string {
        let directory = path.dirname(this.fsPath);
        if (this.repoPath) {
            directory = path.relative(this.repoPath, directory);
        }
        if (relativeTo !== undefined) {
            directory = path.relative(relativeTo, directory);
        }
        directory = GitService.normalizePath(directory);

        return (!directory || directory === '.')
            ? path.basename(this.fsPath)
            : `${path.basename(this.fsPath)}${separator}${directory}`;
    }

    getRelativePath(relativeTo?: string): string {
        let relativePath = path.relative(this.repoPath || '', this.fsPath);
        if (relativeTo !== undefined) {
            relativePath = path.relative(relativeTo, relativePath);
        }
        return GitService.normalizePath(relativePath);
    }

    static async fromUri(uri: Uri, git: GitService) {
        if (uri instanceof GitUri) return uri;

        if (!git.isTrackable(uri)) return new GitUri(uri, git.repoPath);

        if (uri.scheme === DocumentSchemes.GitLensGit) return new GitUri(uri);

        // If this is a git uri, assume it is showing the most recent commit
        if (uri.scheme === DocumentSchemes.Git) {
            const commit = await git.getLogCommit(undefined, uri.fsPath);
            if (commit !== undefined) return new GitUri(uri, commit);
        }

        const gitUri = git.getGitUriForFile(uri);
        if (gitUri) return gitUri;

        return new GitUri(uri, (await git.getRepoPathFromFile(uri.fsPath)) || git.repoPath);
    }

    static fromFileStatus(status: IGitStatusFile, repoPath: string, original?: boolean): GitUri;
    static fromFileStatus(status: IGitStatusFile, commit: IGitCommitInfo, original?: boolean): GitUri;
    static fromFileStatus(status: IGitStatusFile, repoPathOrCommit: string | IGitCommitInfo, original: boolean = false): GitUri {
        const repoPath = typeof repoPathOrCommit === 'string' ? repoPathOrCommit : repoPathOrCommit.repoPath;
        const uri = Uri.file(path.resolve(repoPath, original ? status.originalFileName || status.fileName : status.fileName));
        return new GitUri(uri, repoPathOrCommit);
    }

    static getDirectory(fileName: string, relativeTo?: string): string {
        let directory: string | undefined = path.dirname(fileName);
        if (relativeTo !== undefined) {
            directory = path.relative(relativeTo, directory);
        }
        directory = GitService.normalizePath(directory);
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
        return GitService.normalizePath(relativePath);
    }
}

export interface IGitCommitInfo {
    fileName: string;
    repoPath: string;
    sha?: string;
    originalFileName?: string;
}

export interface IGitUriData {
    sha: string;
    fileName: string;
    repoPath: string;
    originalFileName?: string;
}
