'use strict';
import { ExtensionContext, TextDocumentContentProvider, Uri, window } from 'vscode';
import { DocumentSchemes } from './constants';
import GitProvider from './gitProvider';
import { Logger } from './logger';
import * as path from 'path';

export default class GitContentProvider implements TextDocumentContentProvider {

    static scheme = DocumentSchemes.Git;

    constructor(context: ExtensionContext, private git: GitProvider) { }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        const data = GitProvider.fromGitContentUri(uri);
        const fileName = data.originalFileName || data.fileName;
        try {
            let text = await this.git.getVersionedFileText(fileName, data.repoPath, data.sha) as string;
            if (data.decoration) {
                text = `${data.decoration}\n${text}`;
            }
            return text;
        }
        catch (ex) {
            Logger.error('[GitLens.GitContentProvider]', 'getVersionedFileText', ex);
            await window.showErrorMessage(`Unable to show Git revision ${data.sha} of '${path.relative(data.repoPath, fileName)}'`);
            return undefined;
        }
    }
}