'use strict';
import {ExtensionContext, TextDocumentContentProvider, Uri} from 'vscode';
import {DocumentSchemes} from './constants';
import GitProvider from './gitProvider';

export default class GitContentProvider implements TextDocumentContentProvider {
    static scheme = DocumentSchemes.Git;

    constructor(context: ExtensionContext, private git: GitProvider) { }

    provideTextDocumentContent(uri: Uri): string | Thenable<string> {
        const data = GitProvider.fromGitUri(uri);
        return this.git.getVersionedFileText(data.originalFileName || data.fileName, data.sha);
    }
}