'use strict';
import { commands, QuickPickItem, TextEditor, Uri, window, workspace } from 'vscode';
import { BuiltInCommands, Commands } from '../constants';
import { GitCommit, GitUri } from '../gitProvider';
import * as moment from 'moment';
import * as path from 'path';

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
    label: string;
    description: string;
    detail: string;

    constructor(private commit: GitCommit, private fileNames?: string[]) {
        super({
            label: `$(file-symlink-file) Open Files`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(file-text) ${commit.fileName}`,
            detail: `Opens all the files in commit $(git-commit) ${commit.sha}`
        }, undefined, undefined);

        if (!this.fileNames) {
            this.fileNames = commit.fileName.split(', ').filter(_ => !!_);
        }
    }

    async execute(): Promise<{}> {
        const repoPath = this.commit.repoPath;
        for (const file of this.fileNames) {
            try {
                const uri = Uri.file(path.resolve(repoPath, file));
                const document = await workspace.openTextDocument(uri);
                await window.showTextDocument(document, 1, true);
            }
            catch (ex) { }
        }
        return undefined;
    }
}

export class OpenFileCommandQuickPickItem extends CommandQuickPickItem {
    label: string;
    description: string;
    detail: string;

    constructor(private commit: GitCommit) {
        super({
            label: `$(file-symlink-file) Open File`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(file-text) ${commit.fileName}`
        }, undefined, undefined);
    }

    async execute(): Promise<{}> {
        const repoPath = this.commit.repoPath;
        try {
            const file = path.resolve(repoPath, this.commit.fileName);
            return await commands.executeCommand(BuiltInCommands.Open, Uri.file(file));
        }
        catch (ex) {
            return undefined;
        }
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

    async open(): Promise<TextEditor | undefined> {
        let document = workspace.textDocuments.find(_ => _.fileName === this.uri.fsPath);
        const existing = !!document;
        try {
            if (!document) {
                document = await workspace.openTextDocument(this.uri);
            }

            const editor = await window.showTextDocument(document, 1, true);
            return existing ? undefined : editor;
        }
        catch (ex) {
            return undefined;
        }
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