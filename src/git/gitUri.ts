'use strict';
import { Iterables } from '../system';
import { Uri } from 'vscode';
import { DocumentSchemes } from '../constants';
import { Git, GitProvider } from '../gitProvider';
import * as path from 'path';

export class GitUri extends Uri {

    offset: number;
    repoPath?: string | undefined;
    sha?: string | undefined;

    constructor(uri?: Uri, commit?: IGitCommitInfo) {
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
            const data = GitProvider.fromGitContentUri(uri);
            base._fsPath = data.originalFileName || data.fileName;

            this.offset = (data.decoration && data.decoration.split('\n').length) || 0;
            if (!Git.isUncommitted(data.sha)) {
                this.sha = data.sha;
                this.repoPath = data.repoPath;
            }
            else {
                base._fsPath = path.join(data.repoPath, base._fsPath);
            }
        }
        else if (commit) {
            base._fsPath = commit.originalFileName || commit.fileName;

            if (!Git.isUncommitted(commit.sha)) {
                this.sha = commit.sha;
                this.repoPath = commit.repoPath;
            }
            else {
                base._fsPath = path.join(commit.repoPath, base._fsPath);
            }
        }
    }

    fileUri() {
        return Uri.file(this.sha ? this.path : this.fsPath);
    }

    static async fromUri(uri: Uri, git: GitProvider) {
        if (uri instanceof GitUri) return uri;

        const gitUri = git.getGitUriForFile(uri.fsPath);
        if (gitUri) return gitUri;

        // If this is a git uri, assume it is showing the most recent commit
        if (uri.scheme === 'git' && uri.query === '~') {
            const log = await git.getLogForFile(uri.fsPath, undefined, undefined, undefined, 1);
            const commit = log && Iterables.first(log.commits.values());
            if (commit) return new GitUri(uri, commit);
        }

        return new GitUri(uri);
    }
}

export interface IGitCommitInfo {
    sha: string;
    repoPath: string;
    fileName: string;
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