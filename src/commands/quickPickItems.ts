'use strict';
import { QuickPickItem, Uri } from 'vscode';
import { Commands } from '../constants';
import { GitCommit, GitUri } from '../gitProvider';
import * as moment from 'moment';
import * as path from 'path';

export interface CommandQuickPickItem extends QuickPickItem {
    command: Commands;
    args?: any[];
}

export class CommitQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(public commit: GitCommit, descriptionSuffix: string = '') {
        this.label = `${commit.author}, ${moment(commit.date).fromNow()}`;
        this.description = `$(git-commit) ${commit.sha}${descriptionSuffix}`;
        this.detail = commit.message;
    }
}

export class FileQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;
    sha: string;
    uri: GitUri;

    constructor(commit: GitCommit, public fileName: string) {
        this.label = fileName;
        this.sha = commit.sha;
        this.uri = GitUri.fromUri(Uri.file(path.resolve(commit.repoPath, fileName)));
    }
}

export class ShowAllCommitsQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(maxItems: number) {
        this.label = `$(sync) Show Full History`;
        this.description = `\u2014 Currently only showing the first ${maxItems} commits`;
        this.detail = `This may take a while`;
    }
}