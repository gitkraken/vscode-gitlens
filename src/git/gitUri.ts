'use strict';
import { Strings } from '../system';
import { Uri } from 'vscode';
import { DocumentSchemes, GlyphChars } from '../constants';
import { GitService, IGitStatusFile } from '../gitService';
import * as path from 'path';

export class GitUri extends Uri {

    offset: number;
    repoPath?: string | undefined;
    sha?: string | undefined;

    constructor(uri?: Uri, commit?: IGitCommitInfo);
    constructor(uri?: Uri, repoPath?: string);
    constructor(uri?: Uri, commitOrRepoPath?: IGitCommitInfo | string);
    constructor(uri?: Uri, commitOrRepoPath?: IGitCommitInfo | string) {
        super();
        if (!uri) return;

        const base = this as any;
        for (const key in uri) {
            if (uri.hasOwnProperty(key)) {
                base[key] = (uri as any)[key];
            }
        }

        this.offset = 0;
        if (uri.scheme === DocumentSchemes.GitLensGit) {
            const data = GitService.fromGitContentUri(uri);
            base._fsPath = path.resolve(data.repoPath, data.originalFileName || data.fileName);

            this.offset = (data.decoration && data.decoration.split('\n').length) || 0;
            if (!GitService.isUncommitted(data.sha)) {
                this.sha = data.sha;
                this.repoPath = data.repoPath;
            }
        }
        else if (commitOrRepoPath) {
            if (typeof commitOrRepoPath === 'string') {
                this.repoPath = commitOrRepoPath;
            }
            else {
                const commit = commitOrRepoPath;
                base._fsPath = path.resolve(commit.repoPath, commit.originalFileName || commit.fileName);

                if (commit.repoPath !== undefined) {
                    this.repoPath = commit.repoPath;
                }

                if (commit.sha !== undefined && !GitService.isUncommitted(commit.sha)) {
                    this.sha = commit.sha;
                }
            }
        }
    }

    get shortSha() {
        return this.sha && this.sha.substring(0, 8);
    }

    fileUri() {
        return Uri.file(this.sha ? this.path : this.fsPath);
    }

    getFormattedPath(separator: string = Strings.pad(GlyphChars.Dot, 2, 2)): string {
        let directory = path.dirname(this.fsPath);
        if (this.repoPath) {
            directory = path.relative(this.repoPath, directory);
        }
        directory = GitService.normalizePath(directory);

        return (!directory || directory === '.')
            ? path.basename(this.fsPath)
            : `${path.basename(this.fsPath)}${separator}${directory}`;
    }

    getRelativePath(): string {
        return GitService.normalizePath(path.relative(this.repoPath || '', this.fsPath));
    }

    static async fromUri(uri: Uri, git: GitService) {
        if (uri instanceof GitUri) return uri;

        if (!git.isTrackable(uri)) return new GitUri(uri, git.repoPath);

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

    static getDirectory(fileName: string): string {
        const directory: string | undefined = GitService.normalizePath(path.dirname(fileName));
        return (!directory || directory === '.') ? '' : directory;
    }

    static getFormattedPath(fileNameOrUri: string | Uri, separator: string = Strings.pad(GlyphChars.Dot, 2, 2)): string {
        let fileName: string;
        if (fileNameOrUri instanceof Uri) {
            if (fileNameOrUri instanceof GitUri) return fileNameOrUri.getFormattedPath(separator);

            fileName = fileNameOrUri.fsPath;
        }
        else {
            fileName = fileNameOrUri;
        }

        const directory = GitUri.getDirectory(fileName);
        return !directory
            ? path.basename(fileName)
            : `${path.basename(fileName)}${separator}${directory}`;
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
    index?: number;
    decoration?: string;
}
