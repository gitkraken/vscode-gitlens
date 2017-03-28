'use strict';
import { QuickPickItem, Uri } from 'vscode';
import { getGitStatusIcon, Git, GitCommit, GitStatusFileStatus, GitService, GitUri, IGitLogFileStatusEntry } from '../gitService';
import { OpenFileCommandQuickPickItem } from './quickPicks';
import * as moment from 'moment';
import * as path from 'path';

export class CommitQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(public commit: GitCommit, descriptionSuffix: string = '') {
        this.label = `${commit.author}, ${moment(commit.date).fromNow()}`;
        this.description = `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.shortSha}${descriptionSuffix}`;
        this.detail = commit.message;
    }
}

export class CommitWithFileStatusQuickPickItem extends OpenFileCommandQuickPickItem {

    fileName: string;
    gitUri: GitUri;
    sha: string;
    shortSha: string;
    status: GitStatusFileStatus;

    constructor(commit: GitCommit, status: IGitLogFileStatusEntry) {
        const icon = getGitStatusIcon(status.status);

        let directory = Git.normalizePath(path.dirname(status.fileName));
        if (!directory || directory === '.') {
            directory = undefined;
        }

        let description = (status.status === 'R' && status.originalFileName)
            ? `${directory || ''} \u00a0\u2190\u00a0 ${status.originalFileName}`
            : directory;

        super(GitService.toGitContentUri(commit.sha, status.fileName, commit.repoPath, commit.originalFileName), {
            label: `\u00a0\u00a0\u00a0\u00a0${icon}\u00a0\u00a0 ${path.basename(status.fileName)}`,
            description: description
        });

        this.fileName = status.fileName;
        this.gitUri = new GitUri(Uri.file(path.resolve(commit.repoPath, status.fileName)));
        this.sha = commit.sha;
        this.shortSha = commit.shortSha;
        this.status = status.status;
    }
}