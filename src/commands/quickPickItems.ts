'use strict';
import { commands, QuickPickItem, TextEditor, Uri, window, workspace } from 'vscode';
import { Commands } from '../commands';
import { BuiltInCommands } from '../constants';
import { GitCommit, GitFileStatusItem, GitUri } from '../gitProvider';
import * as moment from 'moment';
import * as path from 'path';

export interface PartialQuickPickItem {
    label?: string;
    description?: string;
    detail?: string;
}

export class CommandQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(item: QuickPickItem, protected command: Commands, protected args?: any[]) {
        Object.assign(this, item);
    }

    execute(): Thenable<{}> {
        return commands.executeCommand(this.command, ...(this.args || []));
    }
}

export class OpenFilesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(public fileNames: string[], public repoPath: string, item: QuickPickItem) {
        super(item, undefined, undefined);
    }

    getUri(fileName: string) {
        return Uri.file(path.resolve(this.repoPath, fileName));
    }

    async execute(): Promise<{}> {
        for (const fileName of this.fileNames) {
            this.open(fileName);
        }
        return undefined;
    }

    async open(fileName: string): Promise<TextEditor | undefined> {
        try {
            const uri = this.getUri(fileName);
            const document = await workspace.openTextDocument(uri);
            return window.showTextDocument(document, 1, true);
        }
        catch (ex) {
            return undefined;
        }
    }
}

export class OpenCommitFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitCommit, fileNames?: string[], item?: PartialQuickPickItem) {
        const repoPath = commit.repoPath;

        if (!fileNames) {
            fileNames = commit.fileName.split(', ').filter(_ => !!_);
        }

        item = {
            ...{
                label: `$(file-symlink-file) Open Files`,
                description: undefined,
                detail: `Opens all of the files in commit $(git-commit) ${commit.sha}`
            },
            ...item
        };

        super(fileNames, repoPath, item as QuickPickItem);
    }
}

export class OpenStatusFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(statuses: GitFileStatusItem[], item?: PartialQuickPickItem) {
        const repoPath = statuses.length && statuses[0].repoPath;
        const fileNames = statuses.map(_ => _.fileName);

        item = {
            ...{
                label: `$(file-symlink-file) Open Files`,
                description: undefined,
                detail: `Opens all of the changed files in the repository`
            },
            ...item
        };

        super(fileNames, repoPath, item as QuickPickItem);
    }
}

export class OpenFileCommandQuickPickItem extends CommandQuickPickItem {

    constructor(public fileName: string, public repoPath: string, item: QuickPickItem) {
        super(item, undefined, undefined);
    }

    getUri() {
        return Uri.file(path.resolve(this.repoPath, this.fileName));
    }

    async execute(): Promise<{}> {
        try {
            const uri = this.getUri();
            return await commands.executeCommand(BuiltInCommands.Open, uri);
        }
        catch (ex) {
            return undefined;
        }
    }
}

export class OpenCommitFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(commit: GitCommit, item?: PartialQuickPickItem) {
        item = {
            ...{
                label: `$(file-symlink-file) Open File`,
                description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.getFormattedPath()}`
            },
            ...item
        };

        super(commit.fileName, commit.repoPath, item as QuickPickItem);
    }
}

const statusOcticons = [
    '\u00a0$(question)',
    '\u00a0$(diff-ignored)',
    '\u00a0$(diff-added)',
    '\u00a0$(diff-modified)',
    '\u00a0$(diff-removed)',
    '\u00a0$(diff-renamed)'
];

export class OpenStatusFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(status: GitFileStatusItem, item?: PartialQuickPickItem) {
        let directory = path.dirname(status.fileName);
        if (!directory || directory === '.') {
            directory = undefined;
        }

        item = {
            ...{
                label: `${status.staged ? '$(check)' : '\u00a0\u00a0\u00a0'}\u00a0${statusOcticons[status.status]}\u00a0\u00a0\u00a0${path.basename(status.fileName)}`,
                description: directory
            },
            ...item
        };

        super(status.fileName, status.repoPath, item as QuickPickItem);
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
        this.label = `$(info) ${path.basename(fileName)}`;

        let directory = path.dirname(fileName);
        if (!directory || directory === '.') {
            directory = undefined;
        }

        this.description = directory;

        this.sha = commit.sha;
        this.uri = GitUri.fromUri(Uri.file(path.resolve(commit.repoPath, fileName)));
    }

    async preview(): Promise<{}> {
        try {
            return await commands.executeCommand(BuiltInCommands.Open, this.uri);
        }
        catch (ex) {
            return undefined;
        }
    }
}