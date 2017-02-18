'use strict';
import { Uri } from 'vscode';
import { DocumentSchemes } from '../constants';
import GitProvider, { Git } from '../gitProvider';
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
        if (uri.scheme === DocumentSchemes.Git) {
            const data = GitProvider.fromGitUri(uri);
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

    static fromUri(uri: Uri, git?: GitProvider) {
        if (uri instanceof GitUri) return uri;

        if (git) {
            const gitUri = git.getGitUriForFile(uri.fsPath);
            if (gitUri) return gitUri;
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
    repoPath: string;
    fileName: string;
    originalFileName?: string;
    sha: string;
    index: number;
    decoration?: string;
}