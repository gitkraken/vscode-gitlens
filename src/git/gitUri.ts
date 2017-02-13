'use strict';
import { Uri } from 'vscode';
import { DocumentSchemes } from '../constants';
import GitProvider from '../gitProvider';

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
            this.repoPath = data.repoPath;
            this.sha = data.sha;
        }
        else if (commit) {
            base._fsPath = commit.originalFileName || commit.fileName;

            this.repoPath = commit.repoPath;
            this.sha = commit.sha;
        }
    }

    fileUri() {
        return Uri.file(this.fsPath);
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