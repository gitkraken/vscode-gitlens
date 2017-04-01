'use strict';
import { Uri } from 'vscode';
import { DocumentSchemes } from '../constants';
import { Git, GitCommit, GitService, IGitStatusFile } from '../gitService';
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
        base._scheme = uri.scheme;
        base._authority = uri.authority;
        base._path = uri.path;
        base._query = uri.query;
        base._fragment = uri.fragment;

        this.offset = 0;
        if (uri.scheme === DocumentSchemes.GitLensGit) {
            const data = GitService.fromGitContentUri(uri);
            base._fsPath = path.resolve(data.repoPath, data.originalFileName || data.fileName);

            this.offset = (data.decoration && data.decoration.split('\n').length) || 0;
            if (!Git.isUncommitted(data.sha)) {
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

                if (!Git.isUncommitted(commit.sha)) {
                    this.sha = commit.sha;
                    this.repoPath = commit.repoPath;
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

    getFormattedPath(separator: string = ' \u00a0\u2022\u00a0 '): string {
        let directory = path.dirname(this.fsPath);
        if (this.repoPath) {
            directory = path.relative(this.repoPath, directory);
        }
        directory = Git.normalizePath(directory);

        return (!directory || directory === '.')
            ? path.basename(this.fsPath)
            : `${path.basename(this.fsPath)}${separator}${directory}`;
    }

    getRelativePath(): string {
        return Git.normalizePath(path.relative(this.repoPath, this.fsPath));
    }

    static async fromUri(uri: Uri, git: GitService) {
        if (uri instanceof GitUri) return uri;

        const gitUri = git.getGitUriForFile(uri.fsPath);
        if (gitUri) return gitUri;

        // If this is a git uri, assume it is showing the most recent commit
        if (uri.scheme === 'git' && uri.query === '~') {
            const commit = await git.getLogCommit(undefined, uri.fsPath);
            if (commit) return new GitUri(uri, commit);
        }

        return new GitUri(uri, (await git.getRepoPathFromFile(uri.fsPath)) || git.repoPath);
    }

    static fromFileStatus(status: IGitStatusFile, repoPath: string, original?: boolean): GitUri;
    static fromFileStatus(status: IGitStatusFile, commit: GitCommit, original?: boolean): GitUri;
    static fromFileStatus(status: IGitStatusFile, repoPathOrCommit: string | GitCommit, original: boolean = false): GitUri {
        const repoPath = repoPathOrCommit instanceof GitCommit ? repoPathOrCommit.repoPath : repoPathOrCommit;
        const uri = Uri.file(path.resolve(repoPath, original ? status.originalFileName || status.fileName : status.fileName));
        return new GitUri(uri, repoPathOrCommit);
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