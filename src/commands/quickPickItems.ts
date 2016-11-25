'use strict';
import { QuickPickItem, Uri } from 'vscode';
import { Commands } from '../constants';
import { GitCommit, GitUri } from '../gitProvider';
import * as moment from 'moment';
import * as path from 'path';

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

export interface CompareQuickPickItem extends QuickPickItem {
    command: Commands;
}

export class FileQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string;
    uri: GitUri;

    constructor(commit: GitCommit, public fileName: string) {
        this.label = fileName;
        this.uri = GitUri.fromUri(Uri.file(path.resolve(commit.repoPath, fileName)));
    }
}
