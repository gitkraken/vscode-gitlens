'use strict';
import { QuickPickItem, Uri } from 'vscode';
import { getGitStatusIcon, GitCommit, GitFileStatus, GitUri } from '../gitProvider';
import { openEditor } from './quickPicks';
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

export class CommitWithFileStatusQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    sha: string;
    uri: GitUri;

    constructor(commit: GitCommit, public fileName: string, public status: GitFileStatus) {
        const icon = getGitStatusIcon(status);
        this.label = `\u00a0\u00a0\u00a0\u00a0${icon}\u00a0\u00a0 ${path.basename(fileName)}`;

        let directory = path.dirname(fileName);
        if (!directory || directory === '.') {
            directory = undefined;
        }

        this.description = directory;

        this.sha = commit.sha;
        this.uri = GitUri.fromUri(Uri.file(path.resolve(commit.repoPath, fileName)));
    }

    async preview(): Promise<{}> {
        return openEditor(this.uri, true);
    }
}