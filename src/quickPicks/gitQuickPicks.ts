'use strict';
import { QuickPickItem, Uri } from 'vscode';
import { getGitStatusIcon, GitCommit, GitFileStatus, GitProvider, GitUri } from '../gitProvider';
import { OpenFileCommandQuickPickItem } from './quickPicks';
import * as moment from 'moment';
import * as path from 'path';

export class CommitQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(public commit: GitCommit, descriptionSuffix: string = '') {
        this.label = `${commit.author}, ${moment(commit.date).fromNow()}`;
        this.description = `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha}${descriptionSuffix}`;
        this.detail = commit.message;
    }
}

export class CommitWithFileStatusQuickPickItem extends OpenFileCommandQuickPickItem {

    fileName: string;
    gitUri: GitUri;
    sha: string;
    status: GitFileStatus;

    constructor(commit: GitCommit, fileName: string, status: GitFileStatus) {
        const icon = getGitStatusIcon(status);

        let directory = path.dirname(fileName);
        if (!directory || directory === '.') {
            directory = undefined;
        }

        super(GitProvider.toGitContentUri(commit.sha, fileName, commit.repoPath, commit.originalFileName), {
            label: `\u00a0\u00a0\u00a0\u00a0${icon}\u00a0\u00a0 ${path.basename(fileName)}`,
            description: directory
        });

        this.fileName = fileName;
        this.gitUri = GitUri.fromUri(Uri.file(path.resolve(commit.repoPath, fileName)));
        this.sha = commit.sha;
        this.status = status;
    }
}