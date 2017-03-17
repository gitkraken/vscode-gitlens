'use strict';
import { QuickPickItem, Uri } from 'vscode';
import { getGitStatusIcon, GitCommit, GitFileStatus, GitService, GitUri } from '../gitService';
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
    status: GitFileStatus;

    constructor(commit: GitCommit, fileName: string, status: GitFileStatus) {
        const icon = getGitStatusIcon(status);

        let directory = path.dirname(fileName);
        if (!directory || directory === '.') {
            directory = undefined;
        }

        super(GitService.toGitContentUri(commit.sha, fileName, commit.repoPath, commit.originalFileName), {
            label: `\u00a0\u00a0\u00a0\u00a0${icon}\u00a0\u00a0 ${path.basename(fileName)}`,
            description: directory
        });

        this.fileName = fileName;
        this.gitUri = new GitUri(Uri.file(path.resolve(commit.repoPath, fileName)));
        this.sha = commit.sha;
        this.shortSha = commit.shortSha;
        this.status = status;
    }
}