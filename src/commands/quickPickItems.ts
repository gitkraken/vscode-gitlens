'use strict';
import { commands, QuickPickItem, Uri } from 'vscode';
import { Commands } from '../constants';
import { GitCommit, GitUri } from '../gitProvider';
import * as moment from 'moment';
import * as path from 'path';

export class CommandQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string;

    constructor(item: QuickPickItem, public command: Commands, public args?: any[]) {
        Object.assign(this, item);
    }

    execute() {
        return commands.executeCommand(this.command, ...(this.args || []));
    }
}

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